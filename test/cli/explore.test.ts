import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { once } from 'events';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Readable, Writable } from 'stream';
import { pathToFileURL } from 'url';
import { packFiles } from '../../src/encoder/archive-builder';
import { CHMReader } from '../../src/reader/chm-reader';
import { browseArchive } from '../../src/cli/browse';
import { byteSize, filePredicate } from '../../src/cli/filters';
import { extractionOptions } from '../../src/cli/commands/extract';
import { loadConfig } from '../../src/core/config';
import { ParserOperations } from '../../src/operations/parser';

let root: string;
let archive: string;
const cliPath = resolve('src/cli/index.ts');
const loader = pathToFileURL(require.resolve('tsx')).href;
const binary = Buffer.from([0, 0xff, 0x80, 65]);
const text = 'Alpha alpha\nword';
const malicious =
  '<html><head><base href="https://outside.invalid/"></head><body><script>parent.document.body.innerHTML="owned"</script><img src="https://outside.invalid/leak"><iframe src="https://outside.invalid/frame"></iframe><a href="javascript:alert(1)">click</a></body></html>';

function cli(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    ['--import', loader, cliPath, ...args],
    { cwd: root, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  return result;
}
function success(...args: string[]) {
  const result = cli(...args);
  expect(result.status, result.stderr.toString()).toBe(0);
  return result;
}
function failure(...args: string[]) {
  const result = cli(...args);
  expect(result.status).not.toBe(0);
  expect(result.stdout.length).toBe(0);
  expect(result.stderr.length).toBeGreaterThan(0);
  return result;
}

beforeAll(async () => {
  root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'chm-explore-'));
  archive = join(root, 'sample.chm');
  await fs.writeFile(
    archive,
    packFiles(
      new Map([
        ['docs/a.txt', Buffer.from(text)],
        ['empty.txt', Buffer.alloc(0)],
        ['binary.bin', binary],
        ['page.html', Buffer.from(malicious)],
        ['control.txt', Buffer.from('\x1b[31munsafe')],
      ]),
    ),
  );
});
afterEach(async () => {
  await fs.rm(join(root, 'chmkit.config.json'), { force: true });
});
afterAll(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

test('tree and list apply intersecting glob/type/size filters, including empty and exact boundaries', () => {
  const result = JSON.parse(
    success(
      'tree',
      archive,
      '--type',
      'txt',
      '--filter',
      '**/a.txt',
      '--min-size',
      String(Buffer.byteLength(text)),
      '--max-size',
      String(Buffer.byteLength(text)),
      '--json',
    ).stdout.toString(),
  );
  expect(result.children).toHaveLength(1);
  expect(result.children[0].path).toBe('/docs/');
  expect(result.children[0].children[0].path).toBe('/docs/a.txt');
  expect(
    JSON.parse(
      success('tree', archive, '--depth', '0', '--json').stdout.toString(),
    ).children,
  ).toEqual([]);
  expect(success('tree', archive).stdout.toString()).toContain('a.txt');
  const list = JSON.parse(
    success(
      'read',
      archive,
      '--list',
      '--type',
      '.txt',
      '--max-size',
      '0',
      '--format',
      'json',
    ).stdout.toString(),
  );
  expect(list).toEqual(['/empty.txt']);
  expect(
    JSON.parse(
      success(
        'read',
        archive,
        '--list',
        '--type',
        'application/octet-stream',
        '--format',
        'json',
      ).stdout.toString(),
    ),
  ).toEqual(['/binary.bin']);
  failure('read', archive, 'binary.bin', '--type', 'bin', '--format', 'raw');
  failure('tree', archive, '--min-size', '10', '--max-size', '1');
  failure('tree', archive, '--type', '');
});

test('search performs bounded literal content/name searches with Unicode whole-word and case options', () => {
  const result = JSON.parse(
    success(
      'search',
      archive,
      'alpha',
      '--type',
      'txt',
      '--json',
      '--max-matches',
      '1',
    ).stdout.toString(),
  );
  expect(result).toHaveLength(1);
  expect(result[0].path).toBe('/docs/a.txt');
  expect(result[0].matches).toHaveLength(1);
  expect(result[0].matches[0].index).toBe(0);
  expect(
    JSON.parse(
      success(
        'search',
        archive,
        'ALPHA',
        '--case-sensitive',
        '--json',
      ).stdout.toString(),
    ),
  ).toEqual([]);
  expect(
    JSON.parse(
      success(
        'search',
        archive,
        'alp',
        '--whole-word',
        '--json',
      ).stdout.toString(),
    ),
  ).toEqual([]);
  expect(
    JSON.parse(
      success(
        'search',
        archive,
        'a',
        '--names',
        '--limit',
        '1',
        '--json',
      ).stdout.toString(),
    ),
  ).toHaveLength(1);
  expect(
    JSON.parse(
      success(
        'search',
        archive,
        'alpha',
        '--limit',
        '0',
        '--json',
      ).stdout.toString(),
    ),
  ).toEqual([]);
  failure('search', archive, 'alpha', '--names', '--whole-word');
  failure('search', archive, 'alpha', '--limit', '-1');
});

test('preview emits escaped sandboxed static HTML and refuses binary, links and overwrites at output', async () => {
  const html = success('preview', archive, 'page.html').stdout.toString();
  expect(html).toContain('sandbox="" inert tabindex="-1"');
  expect(html).toContain('pointer-events:none');
  expect(html).toContain('script-src &#39;none&#39;');
  expect(html).toContain('connect-src &#39;none&#39;');
  expect(html).toContain('frame-src &#39;none&#39;');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('allow-scripts');
  expect(html).not.toContain('allow-same-origin');
  const output = join(root, 'preview.html');
  expect(
    success('preview', archive, 'page.html', '--output', output).stdout.length,
  ).toBe(0);
  expect(await fs.readFile(output, 'utf8')).toBe(html);
  failure('preview', archive, 'page.html', '--output', output);
  expect(await fs.readFile(output, 'utf8')).toBe(html);
  const linked = join(root, 'linked-preview.html');
  await fs.symlink(output, linked, 'file');
  failure('preview', archive, 'page.html', '--output', linked);
  failure('preview', archive, 'binary.bin');
});

test('configuration discovery, explicit path and CLI overrides affect actual outputs and keep raw/JSON clean', async () => {
  const automatic = join(root, 'chmkit.config.json');
  await fs.writeFile(
    automatic,
    JSON.stringify({
      cli: {
        defaultOutputDir: './configured',
        maxConcurrency: 1,
        showProgress: false,
      },
      performance: { chunkSize: 1 },
    }),
  );
  const result = JSON.parse(
    success('extract', archive, '--type', 'bin', '--json').stdout.toString(),
  );
  expect(result.output).toBe('./configured');
  expect(await fs.readFile(join(root, 'configured/binary.bin'))).toEqual(
    binary,
  );
  const explicit = join(root, 'explicit.json');
  await fs.writeFile(
    explicit,
    JSON.stringify({
      cli: { defaultOutputDir: './explicit-output', showProgress: false },
    }),
  );
  const selected = JSON.parse(
    success(
      '--config',
      explicit,
      'extract',
      archive,
      '--type',
      'bin',
      '--json',
    ).stdout.toString(),
  );
  expect(selected.output).toBe('./explicit-output');
  const override = JSON.parse(
    success(
      'extract',
      archive,
      '--config',
      explicit,
      '--output',
      './override',
      '--type',
      'bin',
      '--json',
      '--concurrency',
      '2',
    ).stdout.toString(),
  );
  expect(override.output).toBe('./override');
  const progress = success(
    'extract',
    archive,
    '--type',
    'bin',
    '--output',
    './progress',
    '--json',
    '--progress',
    '--chunk-size',
    '2',
  );
  expect(JSON.parse(progress.stdout.toString()).files).toEqual(['/binary.bin']);
  expect(progress.stderr.toString()).toContain('2/4 字节');
  expect(progress.stderr.toString()).not.toContain('1/4 字节');
  const noProgress = success(
    'extract',
    archive,
    '--type',
    'bin',
    '--output',
    './no-progress',
    '--json',
    '--progress',
    '--no-progress',
  );
  expect(noProgress.stderr.length).toBe(0);
  expect(JSON.parse(noProgress.stdout.toString()).files).toEqual([
    '/binary.bin',
  ]);
  expect(
    success('read', archive, 'binary.bin', '--format', 'raw').stdout,
  ).toEqual(binary);
  expect(success('read', archive, 'binary.bin', '--stream').stdout).toEqual(
    binary,
  );
  await fs.writeFile(automatic, '{invalid');
  expect(
    JSON.parse(
      success(
        'info',
        archive,
        '--config',
        explicit,
        '--json',
      ).stdout.toString(),
    ).fileCount,
  ).toBeGreaterThan(0);
  failure('info', archive, '--json');
  failure('--config', join(root, 'missing.json'), 'info', archive, '--json');
});

test('configured read limits take effect, can be overridden explicitly, and do not limit streams', async () => {
  await fs.writeFile(
    join(root, 'chmkit.config.json'),
    JSON.stringify({ performance: { maxFileSize: 2 } }),
  );
  failure('read', archive, 'binary.bin', '--format', 'raw');
  expect(
    success(
      'read',
      archive,
      'binary.bin',
      '--format',
      'raw',
      '--max-read-size',
      '4',
    ).stdout,
  ).toEqual(binary);
  expect(success('read', archive, 'binary.bin', '--stream').stdout).toEqual(
    binary,
  );
});

test('search and preview also honor configured materialization limits and explicit overrides', async () => {
  await fs.writeFile(
    join(root, 'chmkit.config.json'),
    JSON.stringify({ performance: { maxFileSize: 2 } }),
  );
  failure('search', archive, 'alpha', '--type', 'txt', '--json');
  expect(
    JSON.parse(
      success(
        'search',
        archive,
        'alpha',
        '--type',
        'txt',
        '--json',
        '--max-read-size',
        '1KiB',
      ).stdout.toString(),
    ),
  ).toHaveLength(1);
  failure('preview', archive, 'page.html');
  expect(
    success(
      'preview',
      archive,
      'page.html',
      '--max-read-size',
      '1KiB',
    ).stdout.toString(),
  ).toContain('sandbox=""');
});

test('removed config sections warn on stderr and are ignored without polluting JSON', async () => {
  await fs.writeFile(
    join(root, 'chmkit.config.json'),
    JSON.stringify({
      default: { maxMemory: 1 },
      cli: { colorOutput: false },
      validation: { validateChecksums: false },
    }),
  );
  const result = success('info', archive, '--json');
  expect(JSON.parse(result.stdout.toString()).fileCount).toBeGreaterThan(0);
  expect(result.stderr.toString()).toContain(
    "Unknown config key 'default' will be ignored",
  );
  expect(result.stderr.toString()).toContain(
    "Unknown config key 'validation' will be ignored",
  );
  expect(result.stderr.toString()).toContain(
    "Unknown config key 'cli.colorOutput' will be ignored",
  );
});

test('batch isolates duplicate names, continues after input errors, reports partial failure as JSON and refuses overwrite', async () => {
  const output = join(root, 'batch');
  const result = cli(
    'batch',
    archive,
    join(root, 'missing.chm'),
    archive,
    '--output',
    output,
    '--type',
    'bin',
    '--json',
    '--concurrency',
    '2',
  );
  expect(result.status).toBe(1);
  const items = JSON.parse(result.stdout.toString());
  expect(items).toHaveLength(3);
  expect(items[0].errors).toEqual([]);
  expect(items[1].errors.length).toBeGreaterThan(0);
  expect(items[2].errors).toEqual([]);
  expect(items[0].output).not.toBe(items[2].output);
  expect(await fs.readFile(join(items[0].output, 'binary.bin'))).toEqual(
    binary,
  );
  const rerun = cli(
    'batch',
    archive,
    '--output',
    output,
    '--type',
    'bin',
    '--json',
  );
  expect(rerun.status).toBe(1);
  expect(JSON.parse(rerun.stdout.toString())[0].errors[0]).toContain(
    '拒绝覆盖',
  );
});

test('browse rejects non-TTY machine use while the real readline loop handles commands, errors and EOF', async () => {
  failure('browse', archive);
  const reader = await CHMReader.open(archive);
  const input = Readable.from([
    'list **/*.txt\ninfo docs/a.txt\nread docs/a.txt\nread control.txt\nread binary.bin\ninfo missing.txt\nsearch Alpha\nunknown\nquit\n',
  ]);
  let transcript = '';
  const output = new Writable({
    write(chunk, _encoding, done) {
      transcript += chunk.toString();
      done();
    },
  });
  try {
    await browseArchive(reader, input, output);
  } finally {
    reader.close();
  }
  expect(transcript).toContain('/docs/a.txt');
  expect(transcript).toContain(text);
  expect(transcript).toContain('\\u001b[31munsafe');
  expect(transcript).not.toContain('\x1b');
  expect(transcript).toContain('终端不显示二进制');
  expect(transcript).toContain('错误:');
  expect(transcript).toContain('未知命令');
  const second = await CHMReader.open(archive);
  try {
    await browseArchive(
      second,
      Readable.from([]),
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    );
  } finally {
    second.close();
  }
});

test('size parser and filters reject malformed/overflowing values and distinguish decimal/binary units', () => {
  expect(byteSize('1KiB')).toBe(1024);
  expect(byteSize('1KB')).toBe(1000);
  expect(byteSize('1.5KiB')).toBe(1536);
  for (const value of [
    '-1',
    'Infinity',
    '1.1B',
    '1e100',
    '99999999999999999GiB',
    'bad',
    '',
  ])
    expect(() => byteSize(value)).toThrow();
  expect(() => filePredicate({ minSize: 2, maxSize: 1 })).toThrow();
  expect(() => filePredicate({ type: 'text/**' })).toThrow();
});

test('pack configuration and explicit advanced flags reach the actual encoder and change the archive', async () => {
  const source = join(root, 'pack-source');
  await fs.mkdir(source);
  const payload = Buffer.from(
    'adaptive compression and reset testing '.repeat(4000),
  );
  await fs.writeFile(join(source, 'data.txt'), payload);
  await fs.writeFile(
    join(root, 'chmkit.config.json'),
    JSON.stringify({
      cli: { defaultOutputFile: './configured-pack.chm' },
      lzx: { windowSize: 65536, resetInterval: 65536, compressionLevel: 0 },
    }),
  );
  success('pack', source);
  const configured = join(root, 'configured-pack.chm');
  const first = await ParserOperations.parse(configured);
  expect(first.header.lzxc.windowSize).toBe(65536);
  expect(first.header.lzxc.resetInterval).toBe(65536);
  const override = join(root, 'override-pack.chm');
  success(
    'pack',
    source,
    '--output',
    override,
    '--window-bits',
    '17',
    '--reset-interval',
    '131072',
    '--compression-level',
    '9',
    '--block-size',
    '4096',
  );
  const second = await ParserOperations.parse(override);
  expect(second.header.lzxc.windowSize).toBe(131072);
  expect(second.header.lzxc.resetInterval).toBe(131072);
  expect((await fs.stat(override)).size).toBeLessThan(
    (await fs.stat(configured)).size,
  );
  expect(
    success('read', override, 'data.txt', '--format', 'raw').stdout,
  ).toEqual(payload);
  failure(
    'pack',
    source,
    '--output',
    join(root, 'invalid-pack.chm'),
    '--window-bits',
    '14',
  );
  await expect(fs.stat(join(root, 'invalid-pack.chm'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test.skipIf(process.platform === 'win32')(
  'POSIX SIGINT cancels actual CLI extraction with JSON intact, exit 130 and no unfinished file',
  async () => {
    const path = join(root, 'interrupt.chm');
    await fs.writeFile(
      path,
      packFiles(new Map([['large.bin', Buffer.alloc(2 * 1024 * 1024, 17)]]), {
        compression: false,
      }),
    );
    const output = join(root, 'interrupt-output');
    const child = spawn(
      process.execPath,
      [
        '--import',
        loader,
        cliPath,
        'extract',
        path,
        '--output',
        output,
        '--type',
        'bin',
        '--concurrency',
        '1',
        '--chunk-size',
        '1024',
        '--progress',
        '--json',
      ],
      { cwd: root, timeout: 20000 },
    );
    const exited = once(child, 'close');
    let interrupted = false;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (!interrupted && /[1-9]\d*\/\d+ 字节/.test(stderr)) {
        interrupted = true;
        child.kill('SIGINT');
      }
    });
    const [code] = await exited;
    expect(interrupted).toBe(true);
    expect(code, stderr).toBe(130);
    expect(JSON.parse(stdout).cancelled).toBe(true);
    expect(JSON.parse(stdout).files).toEqual([]);
    expect(await fs.readdir(output)).toEqual([]);
  },
);

test('extraction runtime options honor explicit flags before connected config fields', () => {
  const config = loadConfig({ searchPaths: [] });
  config.cli!.maxConcurrency = 2;
  config.cli!.showProgress = false;
  config.performance!.chunkSize = 17;
  const controller = new AbortController();
  const defaults = extractionOptions({}, config, controller.signal);
  expect(defaults.concurrency).toBe(2);
  expect(defaults.chunkSize).toBe(17);
  expect(defaults.onProgress).toBeUndefined();
  const explicit = extractionOptions(
    { concurrency: 3, chunkSize: 19, progress: true },
    config,
    controller.signal,
  );
  expect(explicit.concurrency).toBe(3);
  expect(explicit.chunkSize).toBe(19);
  expect(explicit.onProgress).toBeTypeOf('function');
});

import { test, beforeAll, afterAll } from 'vitest';
import { deepStrictEqual as equal, ok } from 'node:assert/strict';
import { spawn, spawnSync } from 'child_process';
import { once } from 'events';
import { packFiles } from '../../src/encoder/archive-builder';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { BitReader } from '../../src/utils/io/bit-reader';
import { existsSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const cliPath = resolve('src/cli/index.ts');
let root: string;
let source: string;
let archive: string;
const binary = Buffer.from([0, 255, 128, 10, 13, 65]);
const html = '<html><body>roundtrip 中文</body></html>';
const toc =
  '<UL><LI><OBJECT type="text/sitemap"><param name="Name" value="Home"><param name="Local" value="index.html"></OBJECT></UL>';

function cli(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', cliPath, ...args],
    {
      timeout: 20000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  return result;
}

function success(...args: string[]) {
  const result = cli(...args);
  equal(
    result.status,
    0,
    `${args.join(' ')} failed: ${result.stderr.toString()}`,
  );
  return result;
}

function failure(...args: string[]) {
  const result = cli(...args);
  ok(result.status !== null && result.status !== 0, 'must exit nonzero');
  equal(result.stdout.length, 0, 'failures must not write to stdout');
  ok(result.stderr.length > 0, 'diagnostics must be on stderr');
  return result;
}

beforeAll(async () => {
  ok(existsSync(cliPath), 'CLI source entry must exist');
  root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'chm-cli-'));
  source = join(root, 'source');
  archive = join(root, 'test.chm');
  await fs.mkdir(join(source, 'docs'), { recursive: true });
  await fs.writeFile(join(source, 'index.html'), html);
  await fs.writeFile(join(source, 'docs/nested.txt'), 'nested');
  await fs.writeFile(join(source, 'binary.bin'), binary);
  await fs.writeFile(join(source, 'empty.txt'), '');
  await fs.writeFile(join(source, 'safe.txt'), 'safe');
  await fs.writeFile(join(source, 'toc.hhc'), toc);
  await fs.writeFile(join(source, 'index.hhk'), toc);
  success(
    'pack',
    source,
    '--output',
    archive,
    '--title',
    'Roundtrip',
    '--default-topic',
    'index.html',
  );
  equal((await fs.readFile(archive)).subarray(0, 4).toString(), 'ITSF');
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('CLI help, version and invalid commands are actually checked', () => {
  const help = success('--help').stdout.toString();
  ok(help.includes('Usage:'));
  ok(help.includes('read'));
  ok(success('--version').stdout.toString().includes('1.0.0'));
  failure('invalid-command');
});

test('pack/info/list/read/extract roundtrip with strict JSON and exact binary output', async () => {
  const info = JSON.parse(success('info', archive, '--json').stdout.toString());
  equal(info.fileCount, 7);
  ok(info.totalSize >= binary.length + Buffer.byteLength(html));
  ok(Number.isFinite(info.compressionRatio));
  const list = JSON.parse(
    success('read', archive, '--list', '--format', 'json').stdout.toString(),
  ) as string[];
  ok(list.includes('/index.html'));
  ok(list.includes('/docs/nested.txt'));
  ok(!list.some(name => /DataSpace|^\/#|^\/\$/.test(name)));
  equal(success('read', archive, 'INDEX.HTML').stdout.toString(), html);
  equal(
    success('read', archive, '/binary.bin', '--format', 'raw').stdout,
    binary,
  );
  equal(
    success('read', archive, '/empty.txt', '--format', 'raw').stdout.length,
    0,
  );
  const output = join(root, 'extracted');
  success('extract', archive, '--output', output, '--preserve-structure');
  equal(await fs.readFile(join(output, 'index.html'), 'utf8'), html);
  equal(await fs.readFile(join(output, 'binary.bin')), binary);
  equal(await fs.readFile(join(output, 'docs/nested.txt'), 'utf8'), 'nested');
});

test('uncompressed pack/info/read/extract roundtrip uses the section-0 data base', async () => {
  const uncompressed = join(root, 'uncompressed.chm');
  success('pack', source, '--output', uncompressed, '--no-compression');
  const info = JSON.parse(
    success('info', uncompressed, '--json').stdout.toString(),
  );
  equal(info.fileCount, 7);
  equal(info.compressionRatio, 100);
  equal(
    success('read', uncompressed, 'binary.bin', '--format', 'raw').stdout,
    binary,
  );
  equal(
    success('read', uncompressed, 'empty.txt', '--format', 'raw').stdout.length,
    0,
  );
  const output = join(root, 'uncompressed-output');
  success('extract', uncompressed, '--output', output, '--preserve-structure');
  equal(await fs.readFile(join(output, 'docs/nested.txt'), 'utf8'), 'nested');
  equal(await fs.readFile(join(output, 'binary.bin')), binary);
});

test('read supports ranges, output files, encoding and strict JSON', async () => {
  equal(
    success('read', archive, 'binary.bin', '--range', '1:4', '--format', 'raw')
      .stdout,
    binary.subarray(1, 4),
  );
  equal(
    success(
      'read',
      archive,
      'binary.bin',
      '--format',
      'text',
      '--encoding',
      'hex',
    ).stdout.toString(),
    binary.toString('hex'),
  );
  const json = JSON.parse(
    success(
      'read',
      archive,
      'binary.bin',
      '--format',
      'json',
      '--encoding',
      'base64',
      '--range',
      '1:4',
    ).stdout.toString(),
  );
  equal(json.content, binary.subarray(1, 4).toString('base64'));
  equal(
    success('read', archive, 'binary.bin', '--range', '2:2', '--format', 'raw')
      .stdout.length,
    0,
  );
  const output = join(root, 'read.bin');
  equal(
    success(
      'read',
      archive,
      'binary.bin',
      '--format',
      'raw',
      '--output',
      output,
    ).stdout.length,
    0,
  );
  equal(await fs.readFile(output), binary);
  const listing = join(root, 'files.json');
  equal(
    success('read', archive, '--list', '--format', 'json', '--output', listing)
      .stdout.length,
    0,
  );
  ok(JSON.parse(await fs.readFile(listing, 'utf8')).includes('/index.html'));
});

test('read exposes TOC and index without stdout diagnostics', () => {
  equal(success('read', archive, '--toc').stdout.toString(), toc);
  equal(
    JSON.parse(
      success('read', archive, '--index', '--format', 'json').stdout.toString(),
    ),
    [{ name: 'Home', local: '/index.html', level: 0 }],
  );
  equal(
    success('read', archive, '--index', '--format', 'raw').stdout,
    Buffer.from(toc),
  );
});

test('navigation source follows case-insensitive #SYSTEM metadata, not preferred filenames', async () => {
  const selected =
    '<UL><LI><OBJECT type="text/sitemap"><param name="Name" value="Selected &amp; 中文"><param name="Local" value="../index.html"></OBJECT></UL>';
  const packed = packFiles(
    new Map([
      ['index.html', Buffer.from(html)],
      ['toc.hhc', Buffer.from(toc)],
      ['index.hhk', Buffer.from(toc)],
      ['nav/custom.hhc', Buffer.from(selected)],
      ['nav/custom.hhk', Buffer.from(selected)],
    ]),
  );
  const parsed = new CHMParser().parse(new BitReader(packed));
  const systemEntry = parsed.directory.entries.get('/#SYSTEM')!;
  const base = Number(packed.readBigUInt64LE(88));
  const system = packed.subarray(
    base + systemEntry.offset,
    base + systemEntry.offset + systemEntry.length,
  );
  const records = Buffer.concat([
    Buffer.from([3, 0, 0, 0]),
    ...[
      [0, 'NAV/CUSTOM.HHC'],
      [1, 'NAV/CUSTOM.HHK'],
    ].map(([code, value]) => {
      const bytes = Buffer.from(`${value}\0`);
      const header = Buffer.alloc(4);
      header.writeUInt16LE(Number(code));
      header.writeUInt16LE(bytes.length, 2);
      return Buffer.concat([header, bytes]);
    }),
  ]);
  ok(records.length + 4 <= system.length);
  records.copy(system);
  system.writeUInt16LE(0xffff, records.length);
  system.writeUInt16LE(system.length - records.length - 4, records.length + 2);
  system.fill(0, records.length + 4);
  const path = join(root, 'navigation.chm');
  await fs.writeFile(path, packed);
  equal(success('read', path, '--toc').stdout.toString(), selected);
  equal(
    success('read', path, '--index', '--format', 'raw').stdout,
    Buffer.from(selected),
  );
  for (const flag of ['--toc', '--index']) {
    equal(
      JSON.parse(
        success('read', path, flag, '--format', 'json').stdout.toString(),
      ),
      [{ name: 'Selected & 中文', local: '/index.html', level: 0 }],
    );
  }
});

test('read supports TextDecoder GBK for text and JSON', async () => {
  const path = join(root, 'gbk.chm');
  await fs.writeFile(
    path,
    packFiles(new Map([['gbk.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4])]])),
  );
  equal(
    success('read', path, 'gbk.txt', '--encoding', 'gbk').stdout.toString(),
    '中文',
  );
  equal(
    JSON.parse(
      success(
        'read',
        path,
        'gbk.txt',
        '--encoding',
        'GBK',
        '--format',
        'json',
      ).stdout.toString(),
    ).content,
    '中文',
  );
});

test('read --stream emits exact binary and large-file ranges to stdout and files', async () => {
  equal(success('read', archive, 'binary.bin', '--stream').stdout, binary);
  equal(success('read', archive, 'empty.txt', '--stream').stdout.length, 0);
  const large = Buffer.alloc(2 * 1024 * 1024 + 19);
  for (let i = 0; i < large.length; i++) large[i] = i % 251;
  const path = join(root, 'large.chm');
  await fs.writeFile(path, packFiles(new Map([['large.bin', large]])));
  equal(
    success('read', path, 'large.bin', '--stream', '--range', '65531:400123')
      .stdout,
    large.subarray(65531, 400123),
  );
  const output = join(root, 'stream.bin');
  equal(
    success(
      'read',
      path,
      'large.bin',
      '--stream',
      '--range',
      '512345:900012',
      '--output',
      output,
    ).stdout.length,
    0,
  );
  equal(await fs.readFile(output), large.subarray(512345, 900012));
  equal(
    success(
      'read',
      path,
      'large.bin',
      '--range',
      '1048570:1048590',
      '--format',
      'raw',
    ).stdout,
    large.subarray(1048570, 1048590),
  );
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', cliPath, 'read', path, 'large.bin', '--stream'],
    { timeout: 20000 },
  );
  const errors: Buffer[] = [];
  child.stderr.on('data', chunk => errors.push(Buffer.from(chunk)));
  const closed = once(child, 'close');
  await Promise.race([
    once(child.stdout, 'readable'),
    closed.then(() => {
      throw new Error('Stream closed before producing bytes');
    }),
  ]);
  await new Promise(resolve => setTimeout(resolve, 30));
  equal(child.exitCode, null, 'large output must wait for a paused consumer');
  const chunks: Buffer[] = [];
  child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
  child.stdout.resume();
  const [code] = await closed;
  equal(code, 0, Buffer.concat(errors).toString());
  equal(Buffer.concat(chunks), large);
  equal(Buffer.concat(errors).length, 0);
});

test('stream option, range and destination errors exit nonzero without stdout diagnostics', async () => {
  failure('read', archive, 'binary.bin', '--stream', '--format', 'json');
  failure('read', archive, '--list', '--stream');
  failure('read', archive, '--toc', '--format', 'json', '--range', '0:1');
  failure('read', archive, 'missing.bin', '--stream');
  failure('read', archive, 'binary.bin', '--stream', '--output', root);
  failure(
    'read',
    archive,
    'binary.bin',
    '--stream',
    '--output',
    join(root, 'missing/stream.bin'),
  );
  const output = join(root, 'protected-stream.bin');
  await fs.writeFile(output, 'original');
  failure(
    'read',
    archive,
    'binary.bin',
    '--stream',
    '--range',
    '0:9999',
    '--output',
    output,
  );
  equal(await fs.readFile(output, 'utf8'), 'original');
});

test('read invalid arguments, ranges, input and paths fail nonzero on stderr', () => {
  for (const range of [
    '-1:2',
    '4:1',
    '0:9999',
    'a:2',
    '1',
    '1:',
    ':2',
    '1.5:2',
    '9007199254740992:9007199254740993',
  ]) {
    failure(
      'read',
      archive,
      'binary.bin',
      `--range=${range}`,
      '--format',
      'raw',
    );
  }
  failure('read', archive);
  failure('read', archive, 'missing.txt', '--format', 'json');
  failure('read', archive, 'index.html', '--encoding', 'not-an-encoding');
  failure('read', archive, 'index.html', '--format', 'invalid');
  failure('read', archive, '--list', '--toc');
  failure('read', archive, 'index.html', '--list');
  failure('read', archive, '--list', '--range', '0:1');
  failure('read', archive, '--list', '--format', 'raw');
  failure(
    'read',
    archive,
    'index.html',
    '--output',
    join(root, 'missing/output.txt'),
  );
  failure('info', join(root, 'missing.chm'), '--json');
  failure('extract', join(root, 'missing.chm'));
  failure('pack', join(root, 'missing-dir'), '--output', join(root, 'bad.chm'));
});

test('extraction flattening and glob filtering apply to actual packed files', async () => {
  const output = join(root, 'flat');
  success('extract', archive, '--output', output, '--filter', '**/*.txt');
  equal((await fs.readdir(output)).sort(), [
    'empty.txt',
    'nested.txt',
    'safe.txt',
  ]);
  equal(await fs.readFile(join(output, 'nested.txt'), 'utf8'), 'nested');
});

test('unsafe archive paths fail nonzero without escaping output', async () => {
  const content = await fs.readFile(archive);
  const old = Buffer.from('/safe.txt');
  const position = content.indexOf(old);
  ok(position >= 0, 'packed directory contains the user path');
  Buffer.from('/../x.txt').copy(content, position);
  const unsafe = join(root, 'unsafe.chm');
  await fs.writeFile(unsafe, content);
  const result = cli(
    'extract',
    unsafe,
    '--output',
    join(root, 'unsafe-output'),
    '--preserve-structure',
  );
  ok(result.status !== null && result.status !== 0);
  ok(
    result.stderr.toString().includes('x.txt'),
    'unsafe entry must be reported, not an unrelated failure',
  );
  equal(existsSync(join(root, 'x.txt')), false);
});

test('partial extraction failures and existing output collisions exit nonzero', async () => {
  const output = join(root, 'partial');
  await fs.mkdir(output);
  await fs.writeFile(join(output, 'index.html'), 'original');
  const result = cli(
    'extract',
    archive,
    '--output',
    output,
    '--preserve-structure',
  );
  ok(result.status !== null && result.status !== 0);
  ok(
    result.stderr.toString().includes('index.html'),
    'the colliding file must be reported',
  );
  equal(await fs.readFile(join(output, 'index.html'), 'utf8'), 'original');
  equal(await fs.readFile(join(output, 'binary.bin')), binary);
});

test('CLI rejects symbolic-link roots, parent directories and file destinations', async () => {
  const outside = join(root, 'outside');
  const output = join(root, 'links-output');
  await fs.mkdir(outside);
  await fs.mkdir(output);
  await fs.writeFile(join(outside, 'target'), 'original');
  await fs.symlink(outside, join(root, 'root-link'), 'dir');
  const linkedRoot = failure(
    'extract',
    archive,
    '--output',
    join(root, 'root-link'),
  );
  ok(/符号链接|symlink/i.test(linkedRoot.stderr.toString()));
  await fs.symlink(outside, join(output, 'docs'), 'dir');
  await fs.symlink(join(outside, 'target'), join(output, 'index.html'), 'file');
  const result = cli(
    'extract',
    archive,
    '--output',
    output,
    '--preserve-structure',
  );
  ok(result.status !== null && result.status !== 0);
  ok(
    result.stderr.toString().includes('docs/nested.txt'),
    'linked parent must be reported',
  );
  ok(
    result.stderr.toString().includes('index.html'),
    'linked destination must be reported',
  );
  equal(await fs.readFile(join(outside, 'target'), 'utf8'), 'original');
  equal(await fs.readdir(outside), ['target']);
});

test('pack safely rejects linked source roots, ancestors, files, directories and dangling links', async () => {
  const output = join(root, 'unsafe-source.chm');
  const sourceLink = join(root, 'source-link');
  await fs.symlink(source, sourceLink, 'dir');
  failure('pack', sourceLink, '--output', output);
  failure('pack', join(sourceLink, 'docs'), '--output', output);
  const unsafeSource = join(root, 'unsafe-source');
  await fs.mkdir(unsafeSource);
  await fs.writeFile(join(unsafeSource, 'index.html'), html);
  for (const [target, type] of [
    [join(source, 'binary.bin'), 'file'],
    [source, 'dir'],
    [join(root, 'nonexistent'), 'file'],
    [join(root, 'nonexistent-dir'), 'dir'],
    [unsafeSource, 'dir'],
  ] as const) {
    const link = join(unsafeSource, 'link');
    await fs.symlink(target, link, type);
    const result = failure('pack', unsafeSource, '--output', output);
    ok(/符号链接|symlink/i.test(result.stderr.toString()));
    equal(existsSync(output), false);
    await fs.unlink(link);
  }
});

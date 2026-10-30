import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  consumerSources,
  invoke,
  invokePackageManager,
  isolatedEnv,
  packageRoot,
  tsc,
} from './support';

interface PackedTarball {
  filename: string;
  files: { path: string }[];
}

interface InstalledManifest {
  dependencies: Record<string, string>;
  bin: Record<string, string>;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

const html = '<title>Package</title>中文';
const binary = Buffer.from([0, 128, 255]);
// The runner/build stays on the supported development Node; consumers may use
// an explicitly supplied older library runtime without executing Vite there.
const runtime = process.env.CHM_TEST_NODE ?? process.execPath;
// npm 10's prepare hook can ignore --ignore-scripts and pollute JSON stdout.
const packOptions = [
  '--ignore-scripts',
  '--foreground-scripts=false',
  '--json',
];

let directory: string | undefined;
let consumer: string;
let packed: PackedTarball;
let installed: InstalledManifest;

function cli(...args: string[]): Buffer {
  return invoke(
    runtime,
    [join(consumer, 'node_modules/chmkit', installed.bin.chmkit), ...args],
    consumer,
  );
}

function expectInsideConsumer(path: string): void {
  const fromConsumer = relative(consumer, path);
  expect(isAbsolute(fromConsumer)).toBe(false);
  expect(fromConsumer).not.toMatch(/^\.\.(?:[/\\]|$)/);
}

describe('build command interface', () => {
  it.each([
    { args: ['--typo'] },
    { args: ['--esm-only'] },
    { args: ['--esm-only', '--types-only'] },
  ])('rejects unsupported arguments: $args', ({ args }) => {
    const result = spawnSync(
      process.execPath,
      [join(packageRoot, 'scripts/build.mjs'), ...args],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: node scripts/build.mjs');
  });
});

it('keeps npm pack JSON clean even when prepare writes to stdout', async () => {
  expect(isolatedEnv().HUSKY).toBe('0');
  const fixture = await mkdtemp(
    join(await realpath(tmpdir()), 'chmkit pack output '),
  );
  try {
    await writeFile(
      join(fixture, 'package.json'),
      JSON.stringify({
        name: 'chmkit-pack-output-test',
        version: '1.0.0',
        scripts: { prepare: 'node prepare.cjs' },
      }),
    );
    await writeFile(
      join(fixture, 'prepare.cjs'),
      "process.stdout.write('prepare output must not pollute JSON\\n');\n",
    );
    const archives = JSON.parse(
      invokePackageManager(
        'npm',
        ['pack', ...packOptions, '--pack-destination', fixture],
        fixture,
        20_000,
      ),
    ) as PackedTarball[];
    expect(archives).toHaveLength(1);
    expect(archives[0].filename).toBe('chmkit-pack-output-test-1.0.0.tgz');
    expect(archives[0].files.map(file => file.path)).toContain('prepare.cjs');
  } finally {
    await rm(fixture, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});

describe('installed npm tarball', () => {
  beforeAll(async () => {
    // Resolve macOS /tmp aliases and stay outside repository node_modules ancestry.
    directory = await mkdtemp(
      join(await realpath(tmpdir()), 'chmkit-package-'),
    );
    const delivery = JSON.parse(
      await readFile(join(packageRoot, 'dist/package/manifest.json'), 'utf8'),
    ) as { version: string; packageFiles: string[] };
    packed = {
      filename: `chmkit-${delivery.version}.tgz`,
      files: delivery.packageFiles.map(path => ({ path })),
    };
    await cp(
      join(packageRoot, 'dist/package', packed.filename),
      join(directory, packed.filename),
    );

    consumer = join(directory, 'consumer');
    // The .mts/.cts files are compile-only consumer examples, not runtime tests.
    await cp(consumerSources, consumer, { recursive: true });
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify(
        {
          private: true,
          dependencies: { chmkit: `file:${join(directory, packed.filename)}` },
        },
        null,
        2,
      ),
    );
    invokePackageManager(
      'pnpm',
      [
        'install',
        '--prefer-offline',
        '--ignore-scripts',
        '--no-frozen-lockfile',
      ],
      consumer,
      90_000,
    );
    installed = JSON.parse(
      await readFile(
        join(consumer, 'node_modules/chmkit/package.json'),
        'utf8',
      ),
    ) as InstalledManifest;
    invoke(process.execPath, ['smoke.cjs', 'fixture'], consumer, 5_000);
  });

  afterAll(async () => {
    if (directory)
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
  });

  it('publishes the browser bundle in the tarball', () => {
    expect(packed.files.map(file => file.path)).toContain(
      'dist/browser/index.mjs',
    );
  });

  it('ships a complete browser viewer that resolves outside the repository without a consumer build', async () => {
    const metadata = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    ) as { version: string };
    const archive = join(
      packageRoot,
      'dist/package',
      `chmkit-${metadata.version}-browser.tar.gz`,
    );
    const files = invoke('tar', ['-tzf', archive], directory!)
      .toString('utf8')
      .trim()
      .split(/\r?\n/);
    expect(files).toEqual(
      expect.arrayContaining([
        'dist/viewer/index.html',
        'dist/viewer/viewer.js',
        'dist/viewer/reader.worker.js',
        'dist/viewer/worker-client.js',
      ]),
    );
    expect(
      files.filter(
        name =>
          !/^(?:dist\/(?:browser|viewer|types)(?:\/|$)|LICENSE$|README(?:_zh)?\.md$|THIRD_PARTY_NOTICES\.txt$)/.test(
            name,
          ),
      ),
    ).toEqual([]);
    const extracted = join(directory!, 'browser-download');
    await mkdir(extracted);
    invoke('tar', ['-xzf', archive, '-C', extracted], directory!);
    const html = await readFile(
      join(extracted, 'dist/viewer/index.html'),
      'utf8',
    );
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('viewer.js');
    const linked = await build({
      absWorkingDir: extracted,
      entryPoints: ['dist/viewer/viewer.js', 'dist/viewer/reader.worker.js'],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      outdir: 'verification-only',
      write: false,
      metafile: true,
    });
    for (const input of Object.keys(linked.metafile!.inputs)) {
      const path = relative(extracted, resolve(extracted, input));
      expect(isAbsolute(path)).toBe(false);
      expect(path).not.toMatch(/^\.\.(?:[/\\]|$)/);
    }
    for (const output of Object.values(linked.metafile!.outputs))
      expect(output.imports.filter(item => item.external)).toEqual([]);
  });

  it('excludes tests, fixtures, demo content and test artifacts from the tarball', () => {
    const forbidden =
      /(?:^test\/|test-results|package-test|^dist\/demo|example\.chm|(?:^|\/)fixtures?\/)/;
    expect(packed.files.filter(file => forbidden.test(file.path))).toEqual([]);
  });

  it('delivers consumer metadata without build/install hooks or development tools', () => {
    expect(installed.scripts).toBeUndefined();
    expect(installed.devDependencies).toBeUndefined();
    expect(installed.packageManager).toBeUndefined();
  });

  it('ships @types/node as an actual installed runtime dependency', async () => {
    expect(installed.dependencies['@types/node']).toBeTruthy();
    // Resolve in a clean Node process, outside Vitest/Vite's module hooks.
    const resolved = invoke(
      process.execPath,
      ['smoke.cjs', 'node-types'],
      consumer,
    )
      .toString('utf8')
      .trim();
    expectInsideConsumer(resolved);
  });

  describe('runtime exports', () => {
    it.each([
      ['CommonJS root reads exact UTF-8 text and binary bytes', 'cjs-root'],
      ['Node CHMReader opens the archive and reads its TOC', 'node-reader'],
      ['native ESM root imports and opens the archive', 'esm-root'],
      ['CommonJS config subpath loads configuration', 'cjs-config'],
      ['native ESM config subpath loads configuration', 'esm-config'],
      ['CommonJS reader subpath exposes CHMReader.open', 'cjs-reader'],
      ['native ESM reader subpath exposes CHMReader.open', 'esm-reader'],
      ['browser subpath returns plain Uint8Array bytes', 'browser'],
      [
        'Worker and Electron conditional subpaths expose importable modules',
        'platforms',
      ],
      [
        'installed Worker client/host exchange actual CHM bytes',
        'worker-roundtrip',
      ],
      [
        'root and browser Map templates/update keep byte types and version consistent',
        'advanced',
      ],
    ])('%s', (_description, mode) => {
      invoke(runtime, ['smoke.cjs', mode], consumer);
    });
  });

  describe('installed CLI', () => {
    it('exposes matching chm/chmkit binaries and read help', () => {
      expect(installed.bin.chm).toBe(installed.bin.chmkit);
      expect(cli('--help').toString('utf8')).toContain('read [options]');
    });

    it('runs info on smoke.chm and returns parseable archive JSON', () => {
      const info = JSON.parse(
        cli('info', 'smoke.chm', '--json').toString('utf8'),
      );
      // Two source files plus the generated HHC and HHK navigation files.
      expect(info.fileCount).toBe(4);
      expect(info.totalSize).toBeGreaterThanOrEqual(
        Buffer.byteLength(html) + binary.length,
      );
      expect(Number.isFinite(info.compressionRatio)).toBe(true);
    });

    it('reads exact UTF-8 content from smoke.chm', () => {
      expect(cli('read', 'smoke.chm', '/index.html').toString('utf8')).toBe(
        html,
      );
    });

    it('reads exact raw binary bytes from smoke.chm', () => {
      expect(
        cli('read', 'smoke.chm', '/binary.bin', '--format', 'raw'),
      ).toEqual(binary);
    });
  });

  describe('consumer declarations', () => {
    it('publishes browser declarations without Node symbols or references', async () => {
      const declarations = await readFile(
        join(consumer, 'node_modules/chmkit/dist/types/browser.d.mts'),
        'utf8',
      );
      expect(declarations.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
        /\bBuffer\b|\bBufferEncoding\b|node:|reference\s+types\s*=\s*['"]node['"]/,
      );
    });

    it.each([
      ['NodeNext ESM root/config/reader', 'node.mts'],
      ['NodeNext CommonJS root/config', 'node.cts'],
      ['browser subpath without Node globals', 'browser.mts'],
      ['root browser condition without Node globals', 'browser-root.mts'],
      ['portable Worker/Electron without DOM or Node globals', 'portable.mts'],
    ])('typechecks %s', async (_description, file) => {
      // These are consumer test cases, not additional repository configurations.
      await writeFile(
        join(consumer, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2020',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              strict: true,
              noEmit: true,
              skipLibCheck: false,
              lib:
                file === 'portable.mts'
                  ? ['ES2020']
                  : ['ES2020', 'DOM', 'DOM.Iterable'],
              typeRoots: ['./node_modules/@types'],
              ...(file.startsWith('browser') || file === 'portable.mts'
                ? { types: [] }
                : {}),
              ...(file === 'browser-root.mts'
                ? { customConditions: ['browser'] }
                : {}),
            },
            files: [file],
          },
          null,
          2,
        ),
      );
      invoke(process.execPath, [tsc, '-p', 'tsconfig.json'], consumer);
    });
  });

  it('bundles the root browser condition from the consumer without external imports', async () => {
    const { metafile } = await build({
      absWorkingDir: consumer,
      entryPoints: ['browser-root.mts'],
      platform: 'browser',
      format: 'esm',
      bundle: true,
      outfile: 'browser-root.mjs',
      metafile: true,
    });
    const browserInputs = Object.keys(metafile.inputs).filter(path =>
      path.replace(/\\/g, '/').endsWith('/dist/browser/root.mjs'),
    );
    expect(browserInputs.length).toBeGreaterThan(0);
    for (const path of browserInputs)
      expectInsideConsumer(await realpath(resolve(consumer, path)));
    expect(
      Object.values(metafile.outputs).flatMap(output =>
        output.imports.filter(item => item.external),
      ),
    ).toEqual([]);
    invoke(runtime, ['browser-root.mjs'], consumer);
  });
});

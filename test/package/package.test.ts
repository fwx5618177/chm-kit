import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import {
  cp,
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
}

const html = '<title>Package</title>中文';
const binary = Buffer.from([0, 128, 255]);

let directory: string | undefined;
let consumer: string;
let packed: PackedTarball;
let installed: InstalledManifest;

function cli(...args: string[]): Buffer {
  return invoke(
    process.execPath,
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

describe('installed npm tarball', () => {
  beforeAll(async () => {
    // Resolve macOS /tmp aliases and stay outside repository node_modules ancestry.
    directory = await mkdtemp(
      join(await realpath(tmpdir()), 'chmkit-package-'),
    );
    const archives = JSON.parse(
      invokePackageManager(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
        packageRoot,
        20_000,
      ),
    ) as PackedTarball[];
    if (archives.length !== 1)
      throw new Error(`Expected one npm tarball, received ${archives.length}`);
    packed = archives[0];

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

  it('excludes tests, fixtures, demo content and test artifacts from the tarball', () => {
    const forbidden =
      /(?:^test\/|test-results|package-test|^dist\/demo|example\.chm|(?:^|\/)fixtures?\/)/;
    expect(packed.files.filter(file => forbidden.test(file.path))).toEqual([]);
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
    ])('%s', (_description, mode) => {
      invoke(process.execPath, ['smoke.cjs', mode], consumer);
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
              lib: ['ES2020', 'DOM', 'DOM.Iterable'],
              typeRoots: ['./node_modules/@types'],
              ...(file.startsWith('browser') ? { types: [] } : {}),
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
    invoke(process.execPath, ['browser-root.mjs'], consumer);
  });
});

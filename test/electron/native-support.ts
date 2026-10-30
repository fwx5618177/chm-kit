import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { build } from 'esbuild';
import { consumerEnvironment } from '../../scripts/lib/environment.mjs';
import { runNpm } from '../../scripts/lib/npm.mjs';

const root = resolve(__dirname, '../..');
const requireFromRoot = createRequire(join(root, 'package.json'));

interface TocEntry {
  name: string;
  local: string;
  children?: TocEntry[];
}

// Structural renderer types only. Runtime imports must come from the installed tgz.
declare global {
  interface Window {
    manual: {
      open(key: string): Promise<string>;
      list(handle: string, pattern?: string): Promise<string[]>;
      read(
        handle: string,
        path: string,
        start?: number,
        end?: number,
      ): Promise<Uint8Array>;
      toc(handle: string): Promise<TocEntry[]>;
      search(
        handle: string,
        keyword: string,
        options?: { maxResults?: number },
      ): Promise<{ path: string; fileName: string; matches: unknown[] }[]>;
      close(handle: string): Promise<void>;
      dispose(): Promise<void>;
    };
  }
}

export interface ReaderCounts {
  attempts: number;
  opened: number;
  closed: number;
  closeErrors: number;
  active: number;
}

export interface Consumer {
  directory: string;
  seed: string;
  close(): Promise<void>;
}

function inside(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function createConsumer(): Promise<Consumer> {
  // Playwright's shared webServer must have completed the canonical build first.
  // Never rebuild here or fall back to source imports while other projects run.
  for (const artifact of [
    'dist/esm/index.mjs',
    'dist/esm/electron-main.mjs',
    'dist/cjs/electron-preload.js',
  ]) {
    await access(join(root, artifact)).catch(error => {
      throw new Error(
        `Missing ${artifact}; run through the shared Playwright configuration, whose webServer builds CHMKit first.`,
        { cause: error },
      );
    });
  }
  execFileSync(process.execPath, [join(root, 'scripts/package.mjs')], {
    cwd: root,
    env: consumerEnvironment(),
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'chmkit-native-electron-')),
  );
  try {
    assert.ok(
      !inside(await realpath(root), directory),
      'The native consumer must be outside repository ancestry',
    );
    const metadata = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    ) as { version: string };
    const tarball = join(
      root,
      'dist/package',
      `chmkit-${metadata.version}.tgz`,
    );
    await access(tarball);
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    );
    // npm installs only the shipped package and its runtime dependencies here.
    // Electron and esbuild are repository dev tools, never consumer dependencies.
    await runNpm(
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        tarball,
      ],
      directory,
    );
    const installed = join(directory, 'node_modules/chmkit');
    assert.ok(!(await lstat(installed)).isSymbolicLink());
    assert.ok(inside(directory, await realpath(installed)));
    const installedMetadata = JSON.parse(
      await readFile(join(installed, 'package.json'), 'utf8'),
    ) as { version: string };
    assert.equal(installedMetadata.version, metadata.version);

    const appDirectory = join(directory, 'app');
    await cp(join(root, 'examples/electron'), appDirectory, {
      recursive: true,
    });
    for (const name of [
      'launch.mjs',
      'observe.mjs',
      'seed.mjs',
      'manual-data.mjs',
    ]) {
      await copyFile(join(root, 'test/electron', name), join(directory, name));
    }
    const preload = join(appDirectory, 'preload.cjs');
    const bundle = await build({
      absWorkingDir: directory,
      entryPoints: [preload],
      outfile: join(appDirectory, 'preload.bundle.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'es2022',
      external: ['electron'],
      metafile: true,
      logLevel: 'silent',
    });
    assert.ok(
      Object.keys(bundle.metafile.inputs).some(path =>
        inside(installed, resolve(directory, path)),
      ),
      'The sandboxed preload must bundle the installed public package',
    );
    for (const path of Object.keys(bundle.metafile.inputs)) {
      assert.ok(
        inside(directory, resolve(directory, path)),
        `Preload borrowed a repository dependency: ${path}`,
      );
    }
    for (const output of Object.values(bundle.metafile.outputs)) {
      for (const dependency of output.imports) {
        assert.ok(
          dependency.external && dependency.path === 'electron',
          `Sandboxed preload has an unexpected runtime import: ${dependency.path}`,
        );
      }
    }
    const seed = join(directory, 'seed.chm');
    execFileSync(process.execPath, [join(directory, 'seed.mjs'), seed], {
      cwd: directory,
      env: consumerEnvironment(),
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return {
      directory,
      seed,
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export interface NativeSession {
  application: ElectronApplication;
  page: Page;
  manualPath: string;
  counts(): Promise<ReaderCounts>;
  close(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function launchNative(consumer: Consumer): Promise<NativeSession> {
  const directory = await mkdtemp(join(consumer.directory, 'run-'));
  const manualPath = join(directory, 'approved.chm');
  const journal = join(directory, 'readers.json');
  let application: ElectronApplication | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closing) {
      closing = (async () => {
        if (!application) return;
        const child = application.process();
        const exited =
          child.exitCode !== null || child.signalCode !== null
            ? Promise.resolve()
            : new Promise<void>(resolve => child.once('exit', () => resolve()));
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            (async () => {
              await application.close();
              await exited;
            })(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error('Electron did not quit within 10 seconds'));
              }, 10_000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
            let killTimer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                exited,
                new Promise<void>(resolve => {
                  killTimer = setTimeout(resolve, 2000);
                }),
              ]);
            } finally {
              clearTimeout(killTimer);
            }
          }
        }
      })();
    }
    return closing;
  };
  try {
    await copyFile(consumer.seed, manualPath);
    const env = consumerEnvironment() as NodeJS.ProcessEnv;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_SANDBOX;
    const expectedExecutable = requireFromRoot('electron') as string;
    assert.equal(typeof expectedExecutable, 'string');
    // Let Playwright resolve Electron and inject its own readiness loader.
    // The absolute entry and consumer cwd keep application imports outside the repo.
    application = await _electron.launch({
      chromiumSandbox: true,
      args: [
        join(consumer.directory, 'launch.mjs'),
        `--user-data-dir=${join(directory, 'profile')}`,
        `--manual=${manualPath}`,
      ],
      cwd: consumer.directory,
      env: { ...env, CHMKIT_ELECTRON_JOURNAL: journal },
      timeout: 30_000,
    });
    const actualExecutable = await application.evaluate(() => process.execPath);
    assert.equal(
      await realpath(actualExecutable),
      await realpath(expectedExecutable),
      'Playwright must launch the installed native Electron executable',
    );
    application.context().setDefaultTimeout(10_000);
    const page = await application.firstWindow({ timeout: 15_000 });
    page.setDefaultTimeout(10_000);
    await page.waitForFunction(() => typeof window.manual?.open === 'function');
    return {
      application,
      page,
      manualPath,
      counts: async () =>
        JSON.parse(await readFile(journal, 'utf8')) as ReaderCounts,
      close,
      cleanup: async () => {
        try {
          await close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
  }
}

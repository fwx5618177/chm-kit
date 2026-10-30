import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';
import {
  createConsumer,
  launchNative,
  type Consumer,
  type NativeSession,
} from './native-support';
import { binaryBytes, manualHtml, privateMarker } from './manual-data.mjs';

let consumer: Consumer;
const test = base.extend<{ native: NativeSession }>({
  native: [
    // Playwright requires destructuring even when no browser fixtures are used.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const native = await launchNative(consumer);
      const errors: string[] = [];
      native.page.on('pageerror', error => errors.push(error.message));
      try {
        await use(native);
        expect(errors, 'uncaught errors in the native renderer').toEqual([]);
      } finally {
        try {
          if (
            testInfo.status !== testInfo.expectedStatus &&
            !native.page.isClosed()
          ) {
            await testInfo.attach('native-window-on-failure', {
              body: await native.page.screenshot({ timeout: 5000 }),
              contentType: 'image/png',
            });
          }
        } finally {
          await native.cleanup();
        }
      }
    },
    { timeout: 60_000 },
  ],
});

// Keep this file together despite fullyParallel in the shared configuration:
// packaging/install happens once per worker, never once per test or in parallel.
test.describe.configure({ mode: 'default' });
test.beforeAll(async () => {
  test.setTimeout(360_000);
  consumer = await createConsumer();
});
test.afterAll(async () => {
  await consumer?.close();
});

async function readThroughUi(native: NativeSession): Promise<void> {
  await native.page
    .getByRole('button', { name: 'Read approved manual' })
    .click();
  await expect(native.page.getByRole('status')).toHaveText(
    'Complete — archive closed.',
  );
  await expect(
    native.page.getByRole('button', { name: 'Read approved manual' }),
  ).toBeEnabled();
}

async function reloadTrustedPage(native: NativeSession): Promise<void> {
  await Promise.all([
    native.page.waitForEvent('domcontentloaded', { timeout: 10_000 }),
    native.application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.reload();
    }),
  ]);
  await native.page.waitForFunction(
    () => typeof window.manual?.open === 'function',
  );
}

async function sessionListeners(native: NativeSession): Promise<number[]> {
  return native.application.evaluate(({ BrowserWindow }) => {
    const sender = BrowserWindow.getAllWindows()[0].webContents;
    return ['destroyed', 'did-start-navigation', 'render-process-gone'].map(
      name => sender.listenerCount(name),
    );
  });
}

test('native sandboxed UI reads the installed archive and closes it; metadata screenshot', async ({
  native,
}, testInfo) => {
  const runtime = await native.application.evaluate(
    ({ app, BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      // Electron 45 exposes this native inspection method at runtime but omits
      // it from electron.d.ts. Keep the main-only inspection narrowly structural.
      const preferences = (
        contents as typeof contents & {
          getLastWebPreferences(): {
            sandbox: boolean;
            contextIsolation: boolean;
            nodeIntegration: boolean;
          };
        }
      ).getLastWebPreferences();
      return {
        electron: process.versions.electron,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
      };
    },
  );
  expect(runtime).toMatchObject({
    noSandbox: false,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  expect(runtime.electron).toBeTruthy();
  testInfo.annotations.push({
    type: 'native-electron-version',
    description: runtime.electron,
  });
  const bridge = await native.page.evaluate(() => ({
    require: typeof require,
    process: typeof process,
    Buffer: typeof Buffer,
    ipcRenderer: typeof (window as Window & { ipcRenderer?: unknown })
      .ipcRenderer,
    frozen: Object.isFrozen(window.manual),
    methods: Object.keys(window.manual).sort(),
    onlyFunctions: Object.values(window.manual).every(
      value => typeof value === 'function',
    ),
  }));
  expect(bridge).toEqual({
    require: 'undefined',
    process: 'undefined',
    Buffer: 'undefined',
    ipcRenderer: 'undefined',
    frozen: true,
    methods: ['close', 'dispose', 'list', 'open', 'read', 'search', 'toc'],
    onlyFunctions: true,
  });

  await readThroughUi(native);
  const output = JSON.parse(
    (await native.page.locator('#output').textContent())!,
  );
  expect(output.files).toEqual(
    expect.arrayContaining(['/index.html', '/assets/bytes.bin']),
  );
  expect(output.toc).toEqual([
    expect.objectContaining({ name: 'Approved manual', local: '/index.html' }),
  ]);
  expect(output.results).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: '/index.html' })]),
  );
  expect(output.firstFile).toEqual({
    path: '/index.html',
    byteLength: Buffer.byteLength(manualHtml),
    hexPreview: [...Buffer.from(manualHtml).subarray(0, 32)]
      .map(value => value.toString(16).padStart(2, '0'))
      .join(' '),
  });
  expect(JSON.stringify(output)).not.toContain(privateMarker);
  expect(JSON.stringify(output)).not.toContain('/private/');
  expect(
    await native.page.evaluate(
      () =>
        (window as Window & { __archiveScriptExecuted?: boolean })
          .__archiveScriptExecuted,
    ),
  ).toBeUndefined();
  await expect
    .poll(() => native.counts())
    .toMatchObject({
      opened: 1,
      closed: 1,
      active: 0,
      closeErrors: 0,
    });
  await native.page.locator('#output').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await testInfo.attach('approved-manual-metadata-and-byte-preview', {
    body: await native.page.screenshot({ timeout: 5000 }),
    contentType: 'image/png',
  });
});

test('contextBridge transports real typed bytes/ranges and close invalidates only its handle', async ({
  native,
}) => {
  const result = await native.page.evaluate(async expectedHtml => {
    const first = await window.manual.open('manual');
    const second = await window.manual.open('manual');
    try {
      const [bytes, range, html, files] = await Promise.all([
        window.manual.read(first, '/assets/bytes.bin'),
        window.manual.read(first, '/assets/bytes.bin', 32767, 65537),
        window.manual.read(first, '/index.html'),
        window.manual.list(second, '**/*.html'),
      ]);
      await Promise.all([
        window.manual.close(first),
        window.manual.close(first),
      ]);
      let closedMessage = '';
      try {
        await window.manual.list(first);
      } catch (error) {
        closedMessage = (error as Error).message;
      }
      return {
        typed: bytes instanceof Uint8Array && range instanceof Uint8Array,
        length: bytes.byteLength,
        exactBytes: bytes.every((value, index) => value === index % 256),
        rangeLength: range.byteLength,
        exactRange: range.every(
          (value, index) => value === (index + 32767) % 256,
        ),
        exactHtml: new TextDecoder().decode(html) === expectedHtml,
        files,
        closedMessage,
        secondStillUsable: (await window.manual.list(second)).includes(
          '/index.html',
        ),
      };
    } finally {
      await window.manual.close(first).catch(() => {});
      await window.manual.close(second);
    }
  }, manualHtml);
  expect(result).toMatchObject({
    typed: true,
    length: binaryBytes.length,
    exactBytes: true,
    rangeLength: 32770,
    exactRange: true,
    exactHtml: true,
    closedMessage: 'Unknown archive handle',
    secondStillUsable: true,
  });
  expect(result.files).toContain('/index.html');
  await expect
    .poll(() => native.counts())
    .toMatchObject({
      opened: 2,
      closed: 2,
      active: 0,
      closeErrors: 0,
    });
});

test('denies OS paths/URLs/unknown keys and private, internal or aliased archive paths', async ({
  native,
}) => {
  const result = await native.page.evaluate(async osPath => {
    const denied = async (operation: Promise<unknown>): Promise<string> => {
      try {
        await operation;
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('An unauthorized operation unexpectedly succeeded');
    };
    const keys = await Promise.all(
      [osPath, `file://${osPath}`, 'unapproved'].map(key =>
        denied(window.manual.open(key)),
      ),
    );
    const handle = await window.manual.open('manual');
    try {
      const paths = await Promise.all(
        [
          '/private/secret.html',
          '/#SYSTEM',
          '/Table of Contents.hhc',
          '/Index.hhk',
          '/assets/../index.html',
          '/index.html?query',
          '/missing.html',
        ].map(path => denied(window.manual.read(handle, path))),
      );
      const [files, toc, results] = await Promise.all([
        window.manual.list(handle),
        window.manual.toc(handle),
        window.manual.search(handle, 'manual', { maxResults: 20 }),
      ]);
      return { keys, paths, files, toc, results };
    } finally {
      await window.manual.close(handle);
    }
  }, native.manualPath);
  expect(result.keys.slice(0, 2)).toEqual([
    'Expected an approved archive key, not a path or URL',
    'Expected an approved archive key, not a path or URL',
  ]);
  expect(result.keys[2]).toBe('Archive key is not approved for this sender');
  expect(result.paths).toEqual(Array(7).fill('Archive path is not granted'));
  expect(result.files).toContain('/index.html');
  expect(result.results.some(item => item.path === '/index.html')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('/private/');
  expect(JSON.stringify(result)).not.toContain(privateMarker);
  // Rejected opens never invoke the main-owned filesystem factory.
  expect(await native.counts()).toMatchObject({ attempts: 1, opened: 1 });
});

test('real IPC rejects a second window with the same page and the approved sender at a different frame URL', async ({
  native,
}) => {
  const trustedUrl = native.page.url();
  const otherWindow = native.application.waitForEvent('window', {
    timeout: 10_000,
  });
  const [windowId, otherPage] = await Promise.all([
    native.application.evaluate(
      async ({ BrowserWindow }, { url, preload }) => {
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        await other.loadURL(url);
        return other.id;
      },
      {
        url: trustedUrl,
        preload: join(consumer.directory, 'app/preload.bundle.cjs'),
      },
    ),
    otherWindow,
  ]);
  try {
    await otherPage.waitForFunction(
      () => typeof window.manual?.open === 'function',
    );
    const denied = await otherPage.evaluate(async () => {
      try {
        await window.manual.open('manual');
        return 'unexpectedly allowed';
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(denied).toBe('IPC sender is not authorized');
  } finally {
    await native.application.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.fromId(id)?.destroy();
    }, windowId);
  }

  const wrongFrameUrl = `${trustedUrl}?not-the-approved-frame`;
  await native.application.evaluate(async ({ BrowserWindow }, url) => {
    await BrowserWindow.getAllWindows()[0].loadURL(url);
  }, wrongFrameUrl);
  expect(native.page.url()).toBe(wrongFrameUrl);
  const denied = await native.page.evaluate(async () => {
    try {
      await window.manual.open('manual');
      return 'unexpectedly allowed';
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(denied).toBe('IPC sender is not authorized');
  expect(await native.counts()).toMatchObject({ attempts: 0, active: 0 });
});

test('UI reports a sanitized filesystem failure and retries when the trusted file becomes available', async ({
  native,
}) => {
  await rm(native.manualPath);
  await native.page
    .getByRole('button', { name: 'Read approved manual' })
    .click();
  await expect(native.page.getByRole('status')).toHaveText(
    'Read failed. You can retry.',
  );
  await expect(native.page.locator('#output')).toHaveText(
    'Archive operation failed',
  );
  expect(await native.counts()).toMatchObject({
    attempts: 1,
    opened: 0,
    active: 0,
  });
  await copyFile(consumer.seed, native.manualPath);
  await readThroughUi(native);
  expect(await native.counts()).toMatchObject({
    attempts: 2,
    opened: 1,
    closed: 1,
    active: 0,
    closeErrors: 0,
  });
});

test('dispose and real navigation release readers/listeners; a fresh preload can reopen', async ({
  native,
}) => {
  const baseline = await sessionListeners(native);
  await native.page.evaluate(async () => {
    await Promise.all([
      window.manual.open('manual'),
      window.manual.open('manual'),
    ]);
  });
  expect(await native.counts()).toMatchObject({ opened: 2, active: 2 });
  expect(await sessionListeners(native)).toEqual(
    baseline.map(count => count + 1),
  );
  const disposed = await native.page.evaluate(async () => {
    await window.manual.dispose();
    try {
      await window.manual.open('manual');
      return 'unexpectedly allowed';
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(disposed).toBe('Archive bridge is disposed');
  await expect
    .poll(() => native.counts())
    .toMatchObject({ closed: 2, active: 0 });
  expect(await sessionListeners(native)).toEqual(baseline);

  await reloadTrustedPage(native);
  const oldHandle = await native.page.evaluate(() =>
    window.manual.open('manual'),
  );
  expect(await native.counts()).toMatchObject({ opened: 3, active: 1 });
  await reloadTrustedPage(native);
  await expect
    .poll(() => native.counts())
    .toMatchObject({ closed: 3, active: 0 });
  expect(await sessionListeners(native)).toEqual(baseline);
  const stale = await native.page.evaluate(async handle => {
    try {
      await window.manual.list(handle);
      return 'unexpectedly allowed';
    } catch (error) {
      return (error as Error).message;
    }
  }, oldHandle);
  expect(stale).toBe('Unknown archive handle');
  await readThroughUi(native);
  expect(await native.counts()).toMatchObject({
    opened: 4,
    closed: 4,
    active: 0,
    closeErrors: 0,
  });
});

test('native application quit drains unclosed real readers through the example shutdown handler', async ({
  native,
}) => {
  await native.page.evaluate(async () => {
    await Promise.all([
      window.manual.open('manual'),
      window.manual.open('manual'),
    ]);
  });
  expect(await native.counts()).toMatchObject({ opened: 2, active: 2 });
  // Playwright disposes the application's dispatcher on exit, so retain the
  // native ChildProcess before closing rather than querying a closed channel.
  const child = native.application.process();
  await native.close();
  // The main-only journal survives process exit; it records successful calls to
  // the real installed reader.close(), not renderer-supplied cleanup claims.
  expect(await native.counts()).toMatchObject({
    opened: 2,
    closed: 2,
    active: 0,
    closeErrors: 0,
  });
  expect(child.exitCode).toBe(0);
});

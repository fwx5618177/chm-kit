import { app, BrowserWindow, ipcMain } from 'electron';
import { once } from 'node:events';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHMReader } from 'chmkit';
import { registerElectronArchiveHandler } from 'chmkit/electron/main';

// Only the trusted application launcher selects an OS path. Renderer calls use "manual".
const manualArguments = process.argv.filter(value =>
  value.startsWith('--manual='),
);
const manualPath = manualArguments[0]?.slice('--manual='.length);
if (manualArguments.length !== 1 || !manualPath || !isAbsolute(manualPath)) {
  console.error(
    'Select a trusted archive at startup: electron app/main.mjs --manual=/absolute/path/to/manual.chm',
  );
  app.exit(1);
} else {
  // Let Electron finish evaluating its entry module before waiting for ready.
  void start(manualPath).catch(error => {
    console.error('Unable to start the approved manual application:', error);
    app.exit(1);
  });
}

async function start(manualPath) {
  await app.whenReady();
  const page = new URL('./index.html', import.meta.url).href;
  const window = new BrowserWindow({
    width: 1100,
    height: 820,
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.bundle.cjs', import.meta.url)),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const handler = registerElectronArchiveHandler({
    ipcMain,
    archives: new Map([
      [
        'manual',
        {
          open: () =>
            CHMReader.open(manualPath, {
              maxFileSize: 16 * 1024 * 1024,
              maxCacheBytes: 2 * 1024 * 1024,
            }),
          // Raw navigation sources can name hidden topics even when TOC is filtered.
          allowPath: path =>
            !path.startsWith('/private/') && !/\.hh[ck]$/i.test(path),
        },
      ],
    ]),
    validateSender: event =>
      event.sender === window.webContents &&
      event.senderFrame?.parent === null &&
      event.senderFrame.url === page,
    authorizeArchive: (event, key) =>
      event.sender === window.webContents && key === 'manual',
    limits: { maxOutputBytes: 16 * 1024 * 1024 },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadURL(page);

  let stopping = false;
  app.on('before-quit', event => {
    if (stopping) return;
    event.preventDefault();
    stopping = true;
    // Keep IPC registered through pagehide. Removing it before the renderer
    // closes makes its final bridge disposal invoke an already-removed channel.
    void (async () => {
      if (!window.isDestroyed()) {
        const closed = once(window, 'closed');
        window.close();
        await closed;
      }
      await handler.dispose();
      app.quit();
    })().catch(error => {
      console.error(error);
      app.exit(1);
    });
  });
  app.on('window-all-closed', () => {
    if (!stopping) app.quit();
  });
}

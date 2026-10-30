import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { CHMReader } from '../../dist/esm/index.mjs';
import { registerElectronArchiveHandler } from '../../dist/esm/electron.mjs';

await app.whenReady();
const page = new URL('./index.html', import.meta.url).href;
// Main selects a fixed approved file. No renderer string is ever interpreted as a filesystem path.
const manualPath = fileURLToPath(
  new URL('../../dist/demo/sample.chm', import.meta.url),
);
const window = new BrowserWindow({
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
          CHMReader.open(manualPath, { maxFileSize: 16 * 1024 * 1024 }),
        allowPath: path => !path.startsWith('/private/'),
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
  void handler.dispose().then(
    () => app.quit(),
    error => {
      console.error(error);
      app.exit(1);
    },
  );
});
app.on('window-all-closed', () => app.quit());

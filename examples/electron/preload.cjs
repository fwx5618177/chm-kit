// Bundle this file for a sandboxed preload; only Electron itself remains external.
const { contextBridge, ipcRenderer } = require('electron');
const { createElectronRendererApi } = require('chmkit/electron/preload');

const api = createElectronRendererApi(ipcRenderer, { timeoutMs: 10000 });
contextBridge.exposeInMainWorld('manual', api);
window.addEventListener(
  'pagehide',
  () => {
    void api.dispose().catch(() => {});
  },
  { once: true },
);

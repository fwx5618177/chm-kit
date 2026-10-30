import {
  WorkerArchiveClient,
  createWorkerArchiveHost,
  type WorkerEndpoint,
  type WorkerHostEndpoint,
  type ArchiveAdapter,
  type RemoteArchive,
} from 'chmkit/worker';
import {
  createElectronRendererApi,
  type IpcRendererLike,
} from 'chmkit/electron/preload';
import {
  registerElectronArchiveHandler,
  type IpcMainLike,
} from 'chmkit/electron/main';

// Structural host bindings are intentionally independent of platform declarations.
declare const endpoint: WorkerEndpoint & WorkerHostEndpoint;
declare const archive: ArchiveAdapter;
declare const ipcRenderer: IpcRendererLike;
declare const ipcMain: IpcMainLike;
const client = new WorkerArchiveClient(endpoint);
void client.open(new Uint8Array(0));
void createWorkerArchiveHost(endpoint, () => archive);
void createElectronRendererApi(ipcRenderer).open('approved-manual');
void registerElectronArchiveHandler({
  ipcMain,
  archives: new Map([['approved-manual', { open: () => archive }]]),
  validateSender: () => false,
  authorizeArchive: () => false,
});
// @ts-expect-error No Node globals may be introduced by portable platform entries.
export type NoNodeBuffer = Buffer;
void ({} as RemoteArchive);

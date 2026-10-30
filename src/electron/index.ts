export {
  registerElectronArchiveHandler,
  type ElectronMainOptions,
  type ApprovedArchive,
  type IpcMainLike,
  type IpcInvokeEvent,
  type IpcSender,
  type IpcSenderFrame,
  type ElectronRpcRequest,
} from './main';
export {
  createElectronArchiveProxy,
  createElectronRendererApi,
  type ElectronRendererApi,
  type ElectronPreloadOptions,
  type IpcRendererLike,
} from './preload';
export { DEFAULT_ELECTRON_CHANNEL, type ElectronOpenParams } from './protocol';

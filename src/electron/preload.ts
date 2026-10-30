import {
  RemoteArchive,
  RpcClient,
  type ClientOptions,
  type RequestOptions,
  type RpcTransport,
} from '../worker/client';
import type { SearchOptions } from '../reader/types';
import { RpcError } from '../worker/protocol';
import {
  DEFAULT_ELECTRON_CHANNEL,
  validateChannel,
  validateElectronOpen,
  type ElectronOpenParams,
} from './protocol';

export interface IpcRendererLike {
  invoke(channel: string, request: unknown): Promise<unknown>;
}
export interface ElectronPreloadOptions extends Omit<
  ClientOptions,
  'terminateOnDispose'
> {
  channel?: string;
}

/** Keep this object in preload. Never expose ipcRenderer or a caller-selected channel. */
export function createElectronArchiveProxy(
  ipcRenderer: IpcRendererLike,
  options: ElectronPreloadOptions = {},
): {
  open(
    key: string,
    options?: RequestOptions,
  ): Promise<RemoteArchive<ElectronOpenParams>>;
  dispose(options?: RequestOptions): Promise<void>;
} {
  const channel = validateChannel(options.channel ?? DEFAULT_ELECTRON_CHANNEL);
  let receive: ((data: unknown) => void) | undefined;
  let failed: ((error: unknown) => void) | undefined;
  const transport: RpcTransport = {
    send(request) {
      void ipcRenderer.invoke(channel, request).then(
        response => {
          if (response !== null && response !== undefined) receive?.(response);
        },
        error => failed?.(error),
      );
    },
    subscribe(message, failure) {
      receive = message;
      failed = failure;
      return () => {
        receive = undefined;
        failed = undefined;
      };
    },
  };
  const client = new RpcClient(transport, validateElectronOpen, options);
  return {
    async open(key, requestOptions) {
      const result = await client.request('open', { key }, requestOptions);
      return new RemoteArchive(client, result.archiveId);
    },
    dispose: requestOptions => client.dispose(requestOptions),
  };
}

/** Plain function-only surface suitable for contextBridge (no class instances or Signals). */
export interface ElectronRendererApi {
  open(key: string): Promise<string>;
  read(
    handle: string,
    path: string,
    start?: number,
    end?: number,
  ): Promise<Uint8Array>;
  list(handle: string, pattern?: string): Promise<string[]>;
  toc(handle: string): ReturnType<RemoteArchive['toc']>;
  search(
    handle: string,
    keyword: string,
    options?: SearchOptions,
  ): ReturnType<RemoteArchive['search']>;
  close(handle: string): Promise<void>;
  dispose(): Promise<void>;
}

/** Expose only this surface with contextBridge.exposeInMainWorld(). */
export function createElectronRendererApi(
  ipcRenderer: IpcRendererLike,
  options?: ElectronPreloadOptions,
): ElectronRendererApi {
  const proxy = createElectronArchiveProxy(ipcRenderer, options);
  const handles = new Map<string, RemoteArchive<ElectronOpenParams>>();
  let stopped = false;
  let sequence = 0;
  const lookup = (id: string): RemoteArchive<ElectronOpenParams> => {
    const handle = handles.get(id);
    if (!handle) throw new RpcError('UNAUTHORIZED', 'Unknown archive handle');
    return handle;
  };
  return Object.freeze({
    async open(key: string) {
      if (stopped) throw new RpcError('DISPOSED', 'Archive bridge is disposed');
      const handle = await proxy.open(key);
      if (stopped) {
        await handle.close();
        throw new RpcError('DISPOSED', 'Archive bridge is disposed');
      }
      const id = `handle:${++sequence}`;
      handles.set(id, handle);
      return id;
    },
    async read(id: string, path: string, start?: number, end?: number) {
      const handle = lookup(id);
      return start === undefined && end === undefined
        ? handle.read(path)
        : handle.readRange(path, start ?? 0, end);
    },
    async list(id: string, pattern?: string) {
      return lookup(id).list(pattern);
    },
    async toc(id: string) {
      return lookup(id).toc();
    },
    async search(id: string, keyword: string, searchOptions?: SearchOptions) {
      return lookup(id).search(keyword, searchOptions);
    },
    async close(id: string) {
      const handle = lookup(id);
      await handle.close();
      handles.delete(id);
    },
    async dispose() {
      stopped = true;
      handles.clear();
      await proxy.dispose();
    },
  });
}

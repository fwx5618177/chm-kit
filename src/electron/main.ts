import { ArchiveSession, type OpenContext } from '../worker/session';
import {
  RPC_PROTOCOL,
  RpcError,
  checkOutput,
  failure,
  record,
  resolveLimits,
  validId,
  validateRequest,
  type ArchiveAdapter,
  type MaybePromise,
  type RpcLimits,
  type RpcRequest,
} from '../worker/protocol';
import {
  DEFAULT_ELECTRON_CHANNEL,
  validateArchiveKey,
  validateChannel,
  validateElectronOpen,
  type ElectronOpenParams,
} from './protocol';

export interface IpcSender {
  readonly id: number;
  isDestroyed(): boolean;
  once(type: 'destroyed', listener: () => void): unknown;
  on(
    type: 'did-start-navigation' | 'render-process-gone',
    listener: () => void,
  ): unknown;
  removeListener(
    type: 'destroyed' | 'did-start-navigation' | 'render-process-gone',
    listener: () => void,
  ): unknown;
}
export interface IpcSenderFrame {
  readonly url: string;
  readonly processId: number;
  readonly routingId: number;
  readonly parent?: unknown;
}
export interface IpcInvokeEvent {
  readonly sender: IpcSender;
  readonly senderFrame: IpcSenderFrame | null;
}
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: IpcInvokeEvent,
      request: unknown,
    ) => MaybePromise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}
export interface ApprovedArchive {
  /** Main-owned factory. Renderer parameters (especially paths) never reach it. */
  open(context: OpenContext): MaybePromise<ArchiveAdapter>;
  /** Default: all public paths returned by listFiles(). Internal resources are never granted. */
  allowPath?(path: string): boolean;
  /** Default: all four read-only operations. close/dispose are always available. */
  operations?: readonly ('read' | 'list' | 'toc' | 'search')[];
}
export interface ElectronMainOptions {
  ipcMain: IpcMainLike;
  archives: ReadonlyMap<string, ApprovedArchive>;
  /** Required, synchronous, fail-closed. Check webContents identity AND trusted frame URL. */
  validateSender(event: IpcInvokeEvent): boolean;
  /** Required, rechecked for open and every subsequent use of the granted capability. */
  authorizeArchive(event: IpcInvokeEvent, key: string): boolean;
  channel?: string;
  limits?: Partial<RpcLimits>;
  maxSessions?: number;
  onError?(error: unknown): void;
}
interface FrameSession {
  url: string;
  session: ArchiveSession<ElectronOpenParams>;
  keys: Map<string, string>;
  disposal?: Promise<void>;
}
interface SenderSessions {
  frames: Map<string, FrameSession>;
  destroyed(): void;
  navigated(): void;
}

/** Snapshot public capabilities. No renderer-controlled filename reaches a filesystem adapter. */
async function restrictArchive(
  archive: ArchiveAdapter,
  grant: ApprovedArchive,
  limits: RpcLimits,
): Promise<ArchiveAdapter> {
  const listing = await archive.listFiles();
  checkOutput(listing, limits);
  if (!Array.isArray(listing) || listing.some(path => typeof path !== 'string'))
    throw new RpcError('INVALID_RESULT', 'Archive returned invalid paths');
  const publicPath = (path: string): boolean => {
    const relative = path.replace(/^\/+/, '');
    return (
      !!relative &&
      !path.includes('\\') &&
      !path.includes('\u0000') &&
      !relative.split('/').some(part => part === '.' || part === '..') &&
      !/^[#$]|^::dataspace(?:\/|$)/i.test(relative) &&
      (!grant.allowPath || grant.allowPath(path))
    );
  };
  const paths = new Set(listing.filter(publicPath));
  const permitted = (operation: 'read' | 'list' | 'toc' | 'search'): void => {
    if (grant.operations && !grant.operations.includes(operation))
      throw new RpcError('UNAUTHORIZED', 'Archive operation is not granted');
  };
  const readable = (path: string): void => {
    permitted('read');
    // Exact listing membership rejects aliases, traversal, URL suffixes and internal files.
    if (!paths.has(path))
      throw new RpcError('UNAUTHORIZED', 'Archive path is not granted');
  };
  return {
    readFile(path) {
      readable(path);
      return archive.readFile(path);
    },
    readRange(path, start, end) {
      readable(path);
      return archive.readRange(path, start, end);
    },
    async listFiles(pattern) {
      permitted('list');
      return (await archive.listFiles(pattern)).filter(path => paths.has(path));
    },
    async getTOC() {
      permitted('toc');
      const entries = await archive.getTOC();
      checkOutput(entries, limits);
      // Do not leak external/hidden navigation targets or hidden grouping labels.
      const filter = (items: typeof entries): typeof entries =>
        items.flatMap(item => {
          if (!paths.has(item.local)) return [];
          return [
            {
              ...item,
              children: item.children ? filter(item.children) : undefined,
            },
          ];
        });
      return filter(entries);
    },
    async search(keyword, options) {
      permitted('search');
      return (await archive.search(keyword, options)).filter(result =>
        paths.has(result.path),
      );
    },
    close: () => archive.close(),
  };
}

async function drain(jobs: readonly Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(jobs);
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Registers exactly one namespaced invoke handler. No Electron runtime dependency. */
export function registerElectronArchiveHandler(options: ElectronMainOptions): {
  channel: string;
  releaseSender(sender: IpcSender): Promise<void>;
  dispose(): Promise<void>;
} {
  const channel = validateChannel(options.channel ?? DEFAULT_ELECTRON_CHANNEL);
  const limits = resolveLimits(options.limits);
  const maxSessions = options.maxSessions ?? 32;
  if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0)
    throw new RpcError('INVALID_REQUEST', 'Invalid session limit');
  const approved = new Map(options.archives);
  for (const [key, grant] of approved) {
    validateArchiveKey(key, limits);
    if (!grant || typeof grant.open !== 'function')
      throw new RpcError('INVALID_REQUEST', 'Invalid archive factory');
  }
  const senders = new Map<IpcSender, SenderSessions>();
  let count = 0;
  let stopped = false;
  let disposal: Promise<void> | undefined;
  const cleanupJobs = new Set<Promise<void>>();
  const track = (job: Promise<void>): Promise<void> => {
    cleanupJobs.add(job);
    void job.finally(() => cleanupJobs.delete(job)).catch(() => undefined);
    return job;
  };
  const report = (job: Promise<void>): void => {
    void job.catch(error => options.onError?.(error));
  };
  const retire = (frame: FrameSession): Promise<void> => {
    if (!frame.disposal) {
      // Closing factories/readers still consume the global session budget.
      frame.disposal = track(
        frame.session.dispose().finally(() => {
          count--;
        }),
      );
    }
    return frame.disposal;
  };
  const detach = (sender: IpcSender, owner: SenderSessions): void => {
    sender.removeListener('destroyed', owner.destroyed);
    sender.removeListener('did-start-navigation', owner.navigated);
    sender.removeListener('render-process-gone', owner.navigated);
    senders.delete(sender);
  };
  const releaseSender = (sender: IpcSender): Promise<void> => {
    const owner = senders.get(sender);
    if (!owner) return Promise.resolve();
    detach(sender, owner);
    const frames = [...owner.frames.values()];
    owner.frames.clear();
    return track(drain(frames.map(retire)));
  };
  const trusted = (event: IpcInvokeEvent): boolean => {
    try {
      const frame = event.senderFrame;
      return (
        !!frame &&
        !event.sender.isDestroyed() &&
        Number.isSafeInteger(frame.processId) &&
        frame.processId >= 0 &&
        Number.isSafeInteger(frame.routingId) &&
        frame.routingId >= 0 &&
        typeof frame.url === 'string' &&
        frame.url.length <= limits.maxStringLength &&
        options.validateSender(event) === true
      );
    } catch {
      return false;
    }
  };
  options.ipcMain.handle(channel, async (event, raw) => {
    let id: string | undefined;
    try {
      const candidate = record(raw).id;
      if (validId(candidate)) id = candidate;
      if (!id) throw new RpcError('INVALID_REQUEST', 'Invalid request id');
      if (stopped) throw new RpcError('DISPOSED', 'IPC handler is disposed');
      if (!trusted(event))
        throw new RpcError('UNAUTHORIZED', 'IPC sender is not authorized');
      const request = validateRequest(raw, limits, validateElectronOpen);
      const frame = event.senderFrame!;
      const identity = `${frame.processId}:${frame.routingId}`;
      let owner = senders.get(event.sender);
      let current = owner?.frames.get(identity);
      if (current && current.url !== frame.url) {
        owner!.frames.delete(identity);
        report(retire(current));
        current = undefined;
      }
      if (current) {
        for (const archiveId of current.keys.keys()) {
          if (!current.session.hasArchive(archiveId))
            current.keys.delete(archiveId);
        }
      }
      if (request.kind === 'cancel')
        return current
          ? ((await current.session.handle(request)) ?? null)
          : null;
      if (request.method === 'dispose' && !current)
        return {
          protocol: RPC_PROTOCOL,
          kind: 'response',
          id,
          ok: true,
          result: null,
        };
      if (request.method === 'open') {
        if (
          !approved.has(request.params.key) ||
          options.authorizeArchive(event, request.params.key) !== true
        )
          throw new RpcError(
            'UNAUTHORIZED',
            'Archive key is not approved for this sender',
          );
      } else if (request.method !== 'dispose') {
        const key = current?.keys.get(request.params.archiveId);
        if (!key || options.authorizeArchive(event, key) !== true)
          throw new RpcError(
            'UNAUTHORIZED',
            'Archive capability is not granted to this sender/frame',
          );
      }
      if (!current) {
        if (count >= maxSessions)
          throw new RpcError('LIMIT_EXCEEDED', 'Too many IPC sessions');
        if (!owner) {
          owner = {
            frames: new Map(),
            destroyed: () => report(releaseSender(event.sender)),
            navigated: () => report(releaseSender(event.sender)),
          };
          senders.set(event.sender, owner);
          event.sender.once('destroyed', owner.destroyed);
          event.sender.on('did-start-navigation', owner.navigated);
          event.sender.on('render-process-gone', owner.navigated);
        }
        current = {
          url: frame.url,
          keys: new Map(),
          session: new ArchiveSession({
            validateOpen: validateElectronOpen,
            limits,
            exposeArchiveErrors: false,
            async open(params, context) {
              const grant = approved.get(params.key)!;
              const archive = await grant.open(context);
              try {
                return await restrictArchive(archive, grant, limits);
              } catch (error) {
                await archive.close();
                throw error;
              }
            },
          }),
        };
        owner.frames.set(identity, current);
        count++;
      }
      const active = current;
      const response = await active.session.handle(request);
      if (response?.ok && request.method === 'open') {
        const archiveId = (response.result as { archiveId: string }).archiveId;
        if (active.session.hasArchive(archiveId))
          active.keys.set(archiveId, request.params.key);
      } else if (request.method === 'close')
        active.keys.delete(request.params.archiveId);
      if (request.method === 'dispose') {
        // Even a rejected/busy disposal request must release its session.
        try {
          await retire(active);
        } catch (error) {
          options.onError?.(error);
        }
        if (owner!.frames.get(identity) === active) {
          owner!.frames.delete(identity);
          if (owner!.frames.size === 0 && senders.get(event.sender) === owner)
            detach(event.sender, owner!);
        }
      }
      return response ?? null;
    } catch (error) {
      // Policy callback exceptions are fail-closed and never expose privileged diagnostics.
      return failure(
        id ?? 'invalid',
        error instanceof RpcError
          ? error
          : new RpcError('UNAUTHORIZED', 'IPC request denied'),
      );
    }
  });
  return {
    channel,
    releaseSender,
    dispose() {
      if (!disposal) {
        stopped = true;
        options.ipcMain.removeHandler(channel);
        disposal = drain([
          ...[...senders.keys()].map(releaseSender),
          ...cleanupJobs,
        ]);
      }
      return disposal;
    },
  };
}

// Export the wire type without leaking Electron's nominal implementation types.
export type ElectronRpcRequest = RpcRequest<ElectronOpenParams>;

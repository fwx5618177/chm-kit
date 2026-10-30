import {
  RPC_PROTOCOL,
  RemoteArchiveError,
  RpcError,
  resolveLimits,
  validateRequest,
  validateFatal,
  validateResponse,
  validateResult,
  validateWorkerOpen,
  type Method,
  type ParamsMap,
  type ResultMap,
  type RpcLimits,
  type WorkerOpenParams,
} from './protocol';
import type { ReaderOptions, SearchOptions } from '../reader/types';

export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
export interface RequestOptions {
  signal?: CancellationSignal;
  /** 0 disables the timeout. The default is 30 seconds. */
  timeoutMs?: number;
  /** Transfers a newly owned response buffer, never a host cache's backing store. */
  transferResult?: boolean;
}
export interface RpcTransport {
  send(message: unknown, transfer?: ArrayBuffer[]): void;
  subscribe(
    message: (data: unknown) => void,
    failure: (error: unknown) => void,
  ): () => void;
  terminate?(): void;
}
export interface ClientOptions {
  timeoutMs?: number;
  limits?: Partial<RpcLimits>;
  /** Only enable when this client owns the Worker. Defaults to false. */
  terminateOnDispose?: boolean;
}
interface Pending {
  method: Method;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cleanup(): void;
}

/** Transport-neutral client, also used by the Electron preload adapter. */
export class RpcClient<Open> {
  private readonly pending = new Map<string, Pending>();
  private readonly limits: RpcLimits;
  private readonly unsubscribe: () => void;
  private sequence = 0;
  private readonly namespace = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private stopped = false;
  private remoteDisposed = false;
  private disposing?: Promise<void>;
  private readonly timeoutMs: number;

  constructor(
    private readonly transport: RpcTransport,
    private readonly validateOpen: (params: unknown, limits: RpcLimits) => Open,
    private readonly options: ClientOptions = {},
  ) {
    this.limits = resolveLimits(options.limits);
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.checkTimeout(this.timeoutMs);
    this.unsubscribe = transport.subscribe(
      data => this.receive(data),
      () =>
        this.stop(new RpcError('TRANSPORT_ERROR', 'Archive transport failed')),
    );
  }

  request<M extends Method>(
    method: M,
    params: ParamsMap<Open>[M],
    options: RequestOptions = {},
    transfer: ArrayBuffer[] = [],
  ): Promise<ResultMap[M]> {
    try {
      if (this.stopped || (this.disposing && method !== 'dispose'))
        throw new RpcError('DISPOSED', 'Archive client is disposed');
      if (options.signal?.aborted)
        throw new RpcError('ABORTED', 'Request cancelled');
      const timeout = options.timeoutMs ?? this.timeoutMs;
      this.checkTimeout(timeout);
      if (this.pending.size >= this.limits.maxPending && method !== 'dispose')
        throw new RpcError('LIMIT_EXCEEDED', 'Too many pending requests');
      const id = `${this.namespace}:${++this.sequence}`;
      const message = {
        protocol: RPC_PROTOCOL,
        kind: 'request',
        id,
        method,
        params,
        transferResult: options.transferResult ?? false,
      };
      validateRequest(message, this.limits, this.validateOpen);
      return new Promise<ResultMap[M]>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cancel = (code: string, reason: string): void => {
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          pending.cleanup();
          pending.reject(new RpcError(code, reason));
          try {
            this.transport.send({ protocol: RPC_PROTOCOL, kind: 'cancel', id });
          } catch {
            this.stop(
              new RpcError('TRANSPORT_ERROR', 'Archive transport failed'),
            );
          }
        };
        const abort = (): void => cancel('ABORTED', 'Request cancelled');
        const cleanup = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
        };
        this.pending.set(id, {
          method,
          resolve: value => resolve(value as ResultMap[M]),
          reject,
          cleanup,
        });
        options.signal?.addEventListener('abort', abort);
        if (options.signal?.aborted) {
          abort();
          return;
        }
        if (timeout > 0)
          timer = setTimeout(
            () => cancel('TIMEOUT', 'Archive request timed out'),
            timeout,
          );
        try {
          this.transport.send(message, transfer);
        } catch {
          this.stop(
            new RpcError('TRANSPORT_ERROR', 'Unable to send archive request'),
          );
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private checkTimeout(timeout: number): void {
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483647)
      throw new RpcError(
        'INVALID_REQUEST',
        'Timeout must be an integer between 0 and 2147483647',
      );
  }
  private receive(raw: unknown): void {
    if (this.stopped) return;
    try {
      const fatal = validateFatal(raw);
      if (fatal) {
        this.stop(new RemoteArchiveError(fatal.error));
        return;
      }
      const response = validateResponse(raw, this.limits);
      const pending = this.pending.get(response.id);
      if (!pending) return; // A cancelled/timed-out operation may finish later.
      if (response.ok) validateResult(pending.method, response.result);
      this.pending.delete(response.id);
      pending.cleanup();
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new RemoteArchiveError(response.error));
    } catch {
      this.stop(
        new RpcError('INVALID_RESPONSE', 'Invalid archive transport response'),
      );
    }
  }
  private stop(error: RpcError): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const [id, pending] of this.pending) {
      // Best effort: release a factory still opening on the other side.
      try {
        this.transport.send({ protocol: RPC_PROTOCOL, kind: 'cancel', id });
      } catch {
        /* transport already failed */
      }
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.remoteDisposed) {
      try {
        this.transport.send({
          protocol: RPC_PROTOCOL,
          kind: 'request',
          id: `${this.namespace}:cleanup`,
          method: 'dispose',
          params: {},
        });
      } catch {
        /* a failed transport cannot guarantee remote cleanup */
      }
    }
    this.unsubscribe?.();
    if (this.options.terminateOnDispose) this.transport.terminate?.();
  }
  dispose(options?: RequestOptions): Promise<void> {
    if (this.disposing) return this.disposing;
    if (this.stopped) return Promise.resolve();
    const request = this.request('dispose', {}, options);
    this.disposing = request
      .then(() => {
        this.remoteDisposed = true;
      })
      .finally(() => {
        this.stop(new RpcError('DISPOSED', 'Archive client is disposed'));
      });
    // Reject current callers immediately, not after a slow archive close finishes.
    for (const [id, pending] of this.pending) {
      if (pending.method === 'dispose') continue;
      this.pending.delete(id);
      pending.cleanup();
      pending.reject(new RpcError('DISPOSED', 'Archive client is disposing'));
      try {
        this.transport.send({ protocol: RPC_PROTOCOL, kind: 'cancel', id });
      } catch {
        /* disposal will report failure */
      }
    }
    return this.disposing;
  }
}

/** A handle is a capability within one client/session, not an operating-system path. */
export class RemoteArchive<Open = WorkerOpenParams> {
  private closed = false;
  private closing?: Promise<void>;
  /** @internal */
  constructor(
    private readonly client: RpcClient<Open>,
    readonly archiveId: string,
  ) {}
  private assertOpen(): void {
    if (this.closed || this.closing)
      throw new RpcError('CLOSED', 'Archive handle is closing or closed');
  }
  async read(path: string, options?: RequestOptions): Promise<Uint8Array> {
    this.assertOpen();
    return this.client.request(
      'read',
      { archiveId: this.archiveId, path },
      options,
    );
  }
  async readRange(
    path: string,
    start = 0,
    end?: number,
    options?: RequestOptions,
  ): Promise<Uint8Array> {
    this.assertOpen();
    return this.client.request(
      'read',
      { archiveId: this.archiveId, path, start, end },
      options,
    );
  }
  async list(pattern?: string, options?: RequestOptions): Promise<string[]> {
    this.assertOpen();
    return this.client.request(
      'list',
      { archiveId: this.archiveId, pattern },
      options,
    );
  }
  async toc(options?: RequestOptions) {
    this.assertOpen();
    return this.client.request('toc', { archiveId: this.archiveId }, options);
  }
  async search(
    keyword: string,
    searchOptions?: SearchOptions,
    options?: RequestOptions,
  ) {
    this.assertOpen();
    return this.client.request(
      'search',
      { archiveId: this.archiveId, keyword, options: searchOptions },
      options,
    );
  }
  close(options?: RequestOptions): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = this.client
      .request('close', { archiveId: this.archiveId }, options)
      .then(
        () => {
          this.closed = true;
        },
        error => {
          if (
            error instanceof RemoteArchiveError &&
            (error.code === 'NOT_FOUND' || error.code === 'CLOSED')
          ) {
            this.closed = true;
            return;
          }
          this.closing = undefined;
          throw error;
        },
      );
    return this.closing;
  }
}

export interface WorkerEndpoint {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: 'error' | 'messageerror',
    listener: (event: unknown) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'error' | 'messageerror',
    listener: (event: unknown) => void,
  ): void;
  terminate?(): void;
}
export function endpointTransport(endpoint: WorkerEndpoint): RpcTransport {
  return {
    send: (message, transfer) => endpoint.postMessage(message, transfer ?? []),
    subscribe(message, failure) {
      const receive = (event: { data: unknown }): void => message(event.data);
      endpoint.addEventListener('message', receive);
      endpoint.addEventListener('error', failure);
      endpoint.addEventListener('messageerror', failure);
      return () => {
        endpoint.removeEventListener('message', receive);
        endpoint.removeEventListener('error', failure);
        endpoint.removeEventListener('messageerror', failure);
      };
    },
    terminate: () => endpoint.terminate?.(),
  };
}
export interface WorkerOpenOptions extends RequestOptions {
  readerOptions?: ReaderOptions;
  /** Detaches the ENTIRE input ArrayBuffer, including sibling views. Opt-in only. */
  transferInput?: boolean;
}
export function createWorkerClient(
  endpoint: WorkerEndpoint,
  options?: ClientOptions,
): WorkerArchiveClient {
  return new WorkerArchiveClient(endpoint, options);
}

export class WorkerArchiveClient {
  private readonly client: RpcClient<WorkerOpenParams>;
  private readonly limits: RpcLimits;
  constructor(endpoint: WorkerEndpoint, options?: ClientOptions) {
    this.limits = resolveLimits(options?.limits);
    this.client = new RpcClient(
      endpointTransport(endpoint),
      validateWorkerOpen,
      options,
    );
  }
  async open(
    source: Uint8Array | ArrayBuffer,
    options: WorkerOpenOptions = {},
  ): Promise<RemoteArchive> {
    const bytes =
      source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    if (
      !(bytes instanceof Uint8Array) ||
      !(bytes.buffer instanceof ArrayBuffer)
    )
      throw new RpcError(
        'INVALID_REQUEST',
        'Open expects Uint8Array or ArrayBuffer',
      );
    validateWorkerOpen(
      { source: bytes, options: options.readerOptions },
      this.limits,
    );
    if (
      options.transferInput &&
      bytes.buffer.byteLength > this.limits.maxInputBytes
    )
      throw new RpcError(
        'LIMIT_EXCEEDED',
        'Transferred backing buffer exceeds input limit',
      );
    // Copy by default so the caller can continue to mutate/reuse its input safely.
    const owned = options.transferInput ? bytes : Uint8Array.from(bytes);
    const result = await this.client.request(
      'open',
      { source: owned, options: options.readerOptions },
      options,
      options.transferInput ? [owned.buffer as ArrayBuffer] : [],
    );
    return new RemoteArchive(this.client, result.archiveId);
  }
  dispose(options?: RequestOptions): Promise<void> {
    return this.client.dispose(options);
  }
}

import { ArchiveSession, type OpenContext } from './session';
import {
  RPC_PROTOCOL,
  RpcError,
  failure,
  serializeError,
  validateWorkerOpen,
  type ArchiveAdapter,
  type MaybePromise,
  type RpcLimits,
  type WorkerOpenParams,
} from './protocol';

export interface WorkerHostEndpoint {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: { data?: unknown }) => void,
  ): void;
}
export type WorkerArchiveFactory = (
  source: Uint8Array,
  options: WorkerOpenParams['options'],
  context: OpenContext,
) => MaybePromise<ArchiveAdapter>;
export interface WorkerHostOptions {
  limits?: Partial<RpcLimits>;
  /** Reports transport/cleanup errors that cannot be sent back to a client. */
  onError?(error: unknown): void;
}

/** Install once in a dedicated Worker. Inject the browser reader from its browser bundle. */
export function createWorkerArchiveHost(
  endpoint: WorkerHostEndpoint,
  factory: WorkerArchiveFactory,
  options: WorkerHostOptions = {},
): { dispose(): Promise<void> } {
  const session = new ArchiveSession({
    open: (params: WorkerOpenParams, context) =>
      factory(params.source, params.options, context),
    validateOpen: validateWorkerOpen,
    limits: options.limits,
  });
  let stopped = false;
  let disposal: Promise<void> | undefined;
  const detach = (): void => {
    stopped = true;
    endpoint.removeEventListener('message', receive);
    endpoint.removeEventListener('messageerror', broken);
  };
  const notifyFatal = (code: string, message: string): void => {
    try {
      endpoint.postMessage(
        {
          protocol: RPC_PROTOCOL,
          kind: 'fatal',
          error: serializeError(new RpcError(code, message)),
        },
        [],
      );
    } catch {
      /* the peer may already be unreachable */
    }
  };
  const dispose = (): Promise<void> => {
    if (!disposal) {
      if (!stopped) notifyFatal('DISPOSED', 'Archive host is disposed');
      detach();
      disposal = session.dispose();
    }
    return disposal;
  };
  const broken = (): void => {
    notifyFatal('TRANSPORT_ERROR', 'Unable to deserialize archive request');
    detach();
    void dispose().catch(error => options.onError?.(error));
  };
  const receive = (event: { data?: unknown }): void => {
    if (stopped) return;
    void (async () => {
      const response = await session.handle(event.data);
      if (!response || stopped) return;
      try {
        const transfer =
          response.ok &&
          response.result instanceof Uint8Array &&
          (event.data as { transferResult?: boolean }).transferResult === true
            ? [response.result.buffer as ArrayBuffer]
            : [];
        endpoint.postMessage(response, transfer);
      } catch (error) {
        try {
          endpoint.postMessage(failure(response.id, error), []);
        } catch {
          await dispose();
          options.onError?.(error);
        }
      }
      if (
        (event.data as { method?: string }).method === 'dispose' &&
        response.ok
      )
        detach();
    })().catch(error => options.onError?.(error));
  };
  endpoint.addEventListener('message', receive);
  endpoint.addEventListener('messageerror', broken);
  return { dispose };
}

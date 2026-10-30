import type {
  NavigationEntry,
  ReaderOptions,
  SearchOptions,
  SearchResult,
} from '../reader/types';

export const RPC_PROTOCOL = 'chmkit.rpc.v1' as const;
export type MaybePromise<T> = T | Promise<T>;

/** No DOM, Node or Electron declarations are needed to implement this adapter. */
export interface ArchiveAdapter {
  readFile(path: string): MaybePromise<Uint8Array>;
  readRange(
    path: string,
    start?: number,
    end?: number,
  ): MaybePromise<Uint8Array>;
  listFiles(pattern?: string): MaybePromise<string[]>;
  getTOC(): MaybePromise<NavigationEntry[]>;
  search(
    keyword: string,
    options?: SearchOptions,
  ): MaybePromise<SearchResult[]>;
  close(): MaybePromise<void>;
}

export interface WorkerOpenParams {
  source: Uint8Array;
  options?: ReaderOptions;
}
export interface ParamsMap<Open = WorkerOpenParams> {
  open: Open;
  read: { archiveId: string; path: string; start?: number; end?: number };
  list: { archiveId: string; pattern?: string };
  toc: { archiveId: string };
  search: { archiveId: string; keyword: string; options?: SearchOptions };
  close: { archiveId: string };
  dispose: Record<string, never>;
}
export interface ResultMap {
  open: { archiveId: string };
  read: Uint8Array;
  list: string[];
  toc: NavigationEntry[];
  search: SearchResult[];
  close: null;
  dispose: null;
}
export type Method = keyof ResultMap;
export type RpcRequest<Open = WorkerOpenParams> = {
  [M in Method]: {
    protocol: typeof RPC_PROTOCOL;
    kind: 'request';
    id: string;
    method: M;
    params: ParamsMap<Open>[M];
    transferResult?: boolean;
  };
}[Method];
export interface CancelMessage {
  protocol: typeof RPC_PROTOCOL;
  kind: 'cancel';
  id: string;
}
export interface SerializedError {
  name: string;
  message: string;
  code: string;
}
export interface FatalMessage {
  protocol: typeof RPC_PROTOCOL;
  kind: 'fatal';
  error: SerializedError;
}
export type RpcMessage<Open = WorkerOpenParams> =
  RpcRequest<Open> | CancelMessage | RpcResponse | FatalMessage;
export type RpcResponse = {
  protocol: typeof RPC_PROTOCOL;
  kind: 'response';
  id: string;
} & (
  | { ok: true; result: ResultMap[Method] }
  | { ok: false; error: SerializedError }
);

export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}
export class RemoteArchiveError extends RpcError {
  constructor(error: SerializedError) {
    super(error.code, error.message);
    this.name = error.name;
  }
}

/** Stack traces, causes and custom properties never cross the trust boundary. */
export function serializeError(error: unknown): SerializedError {
  const fallback = {
    name: 'Error',
    message: 'Archive operation failed',
    code: 'ARCHIVE_ERROR',
  };
  try {
    if (!(error instanceof Error)) return fallback;
    return {
      name:
        typeof error.name === 'string' && error.name
          ? error.name.slice(0, 100)
          : 'Error',
      message:
        typeof error.message === 'string'
          ? error.message.slice(0, 2048)
          : fallback.message,
      code:
        error instanceof RpcError &&
        typeof error.code === 'string' &&
        error.code
          ? error.code.slice(0, 100)
          : fallback.code,
    };
  } catch {
    return fallback;
  }
}
export function failure(id: string, error: unknown): RpcResponse {
  return {
    protocol: RPC_PROTOCOL,
    kind: 'response',
    id,
    ok: false,
    error: serializeError(error),
  };
}

export interface RpcLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxStringLength: number;
  maxPending: number;
  maxArchives: number;
  maxCollectionEntries: number;
}
export const DEFAULT_RPC_LIMITS: Readonly<RpcLimits> = Object.freeze({
  maxInputBytes: 128 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024,
  maxStringLength: 8192,
  maxPending: 128,
  maxArchives: 8,
  maxCollectionEntries: 100000,
});
export function resolveLimits(limits: Partial<RpcLimits> = {}): RpcLimits {
  const result = { ...DEFAULT_RPC_LIMITS, ...limits };
  for (const value of Object.values(result)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RpcError(
        'INVALID_REQUEST',
        'RPC limits must be positive safe integers',
      );
  }
  return result;
}
export function invalid(message: string): never {
  throw new RpcError('INVALID_REQUEST', message);
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Expected an object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    invalid('Expected a plain object');
  return value as Record<string, unknown>;
}
export function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some(key => !allowed.includes(key)))
    invalid('Unexpected message field');
}
export function text(
  value: unknown,
  limits: RpcLimits,
  label = 'string',
): string {
  if (typeof value !== 'string' || value.length === 0)
    invalid(`Invalid ${label}`);
  if (value.length > limits.maxStringLength)
    throw new RpcError('LIMIT_EXCEEDED', `${label} is too long`);
  return value;
}
function integer(value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    invalid('Expected a non-negative safe integer');
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value);
}

function readerOptions(value: unknown, limits: RpcLimits): void {
  const options = record(value);
  keys(options, [
    'maxCacheBytes',
    'maxFileSize',
    'cacheStrategy',
    'defaultEncoding',
    'readAhead',
    'adaptivePreload',
  ]);
  for (const field of ['maxCacheBytes', 'maxFileSize']) {
    if (options[field] !== undefined) integer(options[field]);
  }
  if (
    options.cacheStrategy !== undefined &&
    options.cacheStrategy !== 'none' &&
    options.cacheStrategy !== 'lru'
  )
    invalid('Invalid cache strategy');
  if (options.defaultEncoding !== undefined)
    text(options.defaultEncoding, limits, 'encoding');
  if (options.readAhead !== undefined && typeof options.readAhead !== 'boolean')
    invalid('readAhead must be a boolean');
  if (options.adaptivePreload !== undefined) {
    const config = record(options.adaptivePreload);
    keys(config, ['maxFiles', 'maxBytes']);
    integer(config.maxFiles);
    integer(config.maxBytes);
    if (
      (config.maxFiles as number) < 1 ||
      (config.maxFiles as number) > 32 ||
      (config.maxBytes as number) < 1
    )
      invalid(
        'adaptivePreload requires maxFiles in [1, 32] and positive maxBytes',
      );
  }
}
export function validateWorkerOpen(
  value: unknown,
  limits: RpcLimits,
): WorkerOpenParams {
  const params = record(value);
  keys(params, ['source', 'options']);
  if (
    !(params.source instanceof Uint8Array) ||
    !(params.source.buffer instanceof ArrayBuffer)
  )
    invalid('Open expects bytes backed by an ArrayBuffer');
  if (params.source.byteLength > limits.maxInputBytes)
    throw new RpcError('LIMIT_EXCEEDED', 'Archive input exceeds limit');
  if (params.options !== undefined) readerOptions(params.options, limits);
  return params as unknown as WorkerOpenParams;
}
function searchOptions(value: unknown, limits: RpcLimits): void {
  const options = record(value);
  keys(options, [
    'caseSensitive',
    'wholeWord',
    'maxResults',
    'maxMatchesPerFile',
    'pattern',
    'encoding',
    'contextLength',
  ]);
  for (const field of ['caseSensitive', 'wholeWord']) {
    if (options[field] !== undefined && typeof options[field] !== 'boolean')
      invalid('Expected a boolean');
  }
  for (const field of ['maxResults', 'maxMatchesPerFile', 'contextLength']) {
    if (options[field] !== undefined) {
      integer(options[field]);
      if ((options[field] as number) > limits.maxCollectionEntries)
        throw new RpcError('LIMIT_EXCEEDED', 'Search option exceeds limit');
    }
  }
  for (const field of ['pattern', 'encoding']) {
    if (options[field] !== undefined) text(options[field], limits, field);
  }
}
export function validateRequest<Open>(
  value: unknown,
  limits: RpcLimits,
  validateOpen: (params: unknown, limits: RpcLimits) => Open,
): RpcRequest<Open> | CancelMessage {
  const message = record(value);
  if (message.protocol !== RPC_PROTOCOL || !validId(message.id))
    invalid('Invalid protocol or request id');
  if (message.kind === 'cancel') {
    keys(message, ['protocol', 'kind', 'id']);
    return message as unknown as CancelMessage;
  }
  keys(message, [
    'protocol',
    'kind',
    'id',
    'method',
    'params',
    'transferResult',
  ]);
  if (message.kind !== 'request') invalid('Invalid message kind');
  if (
    message.transferResult !== undefined &&
    typeof message.transferResult !== 'boolean'
  )
    invalid('Invalid transfer flag');
  const params = record(message.params);
  switch (message.method) {
    case 'open':
      validateOpen(params, limits);
      break;
    case 'read':
      keys(params, ['archiveId', 'path', 'start', 'end']);
      text(params.path, limits, 'archive path');
      if (params.start !== undefined) integer(params.start);
      if (params.end !== undefined) integer(params.end);
      if (
        params.start !== undefined &&
        params.end !== undefined &&
        (params.start as number) > (params.end as number)
      )
        invalid('Invalid byte range');
      break;
    case 'list':
      keys(params, ['archiveId', 'pattern']);
      if (params.pattern !== undefined) text(params.pattern, limits, 'pattern');
      break;
    case 'search':
      keys(params, ['archiveId', 'keyword', 'options']);
      text(params.keyword, limits, 'keyword');
      if (params.options !== undefined) searchOptions(params.options, limits);
      break;
    case 'toc':
    case 'close':
      keys(params, ['archiveId']);
      break;
    case 'dispose':
      keys(params, []);
      break;
    default:
      invalid('Unknown RPC method');
  }
  if (
    message.method !== 'open' &&
    message.method !== 'dispose' &&
    !validId(params.archiveId)
  )
    invalid('Invalid archive id');
  return message as unknown as RpcRequest<Open>;
}

/** Bounded traversal: rejects cycles, exotic objects and oversized structured output. */
export function checkOutput(value: unknown, limits: RpcLimits): void {
  let bytes = 0;
  let entries = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++entries > limits.maxCollectionEntries || depth > 64)
      throw new RpcError(
        'LIMIT_EXCEEDED',
        'Result has too many entries or levels',
      );
    if (typeof item === 'string') bytes += item.length * 2;
    else if (item instanceof Uint8Array && item.buffer instanceof ArrayBuffer)
      bytes += item.byteLength;
    else if (item === null) return;
    else if (
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    )
      bytes += 8;
    else if (typeof item === 'object' && item !== null) {
      if (ancestors.has(item)) invalid('Cyclic result');
      ancestors.add(item);
      if (!Array.isArray(item)) record(item);
      else if (item.length > limits.maxCollectionEntries)
        throw new RpcError(
          'LIMIT_EXCEEDED',
          'Result array exceeds entry limit',
        );
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        if (++entries > limits.maxCollectionEntries)
          throw new RpcError('LIMIT_EXCEEDED', 'Result has too many entries');
        const child = (item as Record<string, unknown>)[key];
        bytes += key.length * 2;
        if (child !== undefined) visit(child, depth + 1);
        if (bytes > limits.maxOutputBytes) break;
      }
      ancestors.delete(item);
    } else invalid('Non-serializable result');
    if (bytes > limits.maxOutputBytes)
      throw new RpcError('LIMIT_EXCEEDED', 'Result exceeds output limit');
  };
  visit(value, 0);
}

export function validateResponse(
  value: unknown,
  limits: RpcLimits,
): RpcResponse {
  const message = record(value);
  if (
    message.protocol !== RPC_PROTOCOL ||
    message.kind !== 'response' ||
    !validId(message.id)
  )
    invalid('Invalid response envelope');
  if (message.ok === true) {
    keys(message, ['protocol', 'kind', 'id', 'ok', 'result']);
    checkOutput(message.result, limits);
  } else if (message.ok === false) {
    keys(message, ['protocol', 'kind', 'id', 'ok', 'error']);
    validateSerializedError(message.error);
  } else invalid('Invalid response status');
  return message as unknown as RpcResponse;
}

export function validateSerializedError(value: unknown): void {
  const error = record(value);
  keys(error, ['name', 'message', 'code']);
  if (typeof error.message !== 'string' || error.message.length > 2048)
    invalid('Invalid remote error');
  for (const field of ['name', 'code']) {
    if (
      typeof error[field] !== 'string' ||
      !error[field] ||
      (error[field] as string).length > 100
    )
      invalid('Invalid remote error');
  }
}

export function validateFatal(value: unknown): FatalMessage | undefined {
  const message = record(value);
  if (message.kind !== 'fatal') return undefined;
  keys(message, ['protocol', 'kind', 'error']);
  if (message.protocol !== RPC_PROTOCOL)
    invalid('Invalid fatal message protocol');
  validateSerializedError(message.error);
  return message as unknown as FatalMessage;
}

export function validateResult(method: Method, result: unknown): void {
  if (method === 'read') {
    if (
      !(result instanceof Uint8Array) ||
      !(result.buffer instanceof ArrayBuffer)
    )
      invalid('Expected binary response');
  } else if (method === 'open') {
    const opened = record(result);
    keys(opened, ['archiveId']);
    if (!validId(opened.archiveId)) invalid('Invalid archive response');
  } else if (method === 'close' || method === 'dispose') {
    if (result !== null) invalid('Expected empty response');
  } else if (!Array.isArray(result)) invalid('Expected array response');
  else if (method === 'list') {
    if (result.some(item => typeof item !== 'string'))
      invalid('Expected file paths');
  } else if (method === 'toc') {
    const visit = (items: unknown[]): void => {
      for (const value of items) {
        const item = record(value);
        keys(item, ['name', 'local', 'level', 'children']);
        if (typeof item.name !== 'string' || typeof item.local !== 'string')
          invalid('Invalid navigation entry');
        integer(item.level);
        if (item.children !== undefined) {
          if (!Array.isArray(item.children))
            invalid('Invalid navigation children');
          visit(item.children);
        }
      }
    };
    visit(result);
  } else if (method === 'search') {
    for (const value of result) {
      const item = record(value);
      keys(item, ['path', 'fileName', 'matches', 'score']);
      if (
        typeof item.path !== 'string' ||
        typeof item.fileName !== 'string' ||
        !Array.isArray(item.matches)
      )
        invalid('Invalid search result');
      if (
        item.score !== undefined &&
        (typeof item.score !== 'number' || !Number.isFinite(item.score))
      )
        invalid('Invalid search score');
      for (const value of item.matches) {
        const match = record(value);
        keys(match, ['index', 'length', 'match', 'line', 'column', 'context']);
        for (const field of ['index', 'length', 'line', 'column'])
          integer(match[field]);
        if (
          typeof match.match !== 'string' ||
          typeof match.context !== 'string'
        )
          invalid('Invalid search match');
      }
    }
  }
}

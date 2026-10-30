import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RPC_PROTOCOL,
  RpcError,
  WorkerArchiveClient,
  createWorkerArchiveHost,
  type ArchiveAdapter,
  type ClientOptions,
  type RpcResponse,
  type WorkerArchiveFactory,
} from '../../src/worker';
import { CHMArchive } from '../../src/reader/chm-archive';
import type { ReaderOptions } from '../../src/reader/types';
import { ArchiveSession } from '../../src/worker/session';
import { validateWorkerOpen } from '../../src/worker/protocol';
import { adapter, clonePair, deferred, flush, sampleBytes } from './support';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function setup(
  factory: WorkerArchiveFactory = bytes => adapter(bytes),
  options: ClientOptions = {},
) {
  const [endpoint, scope] = clonePair();
  const host = createWorkerArchiveHost(scope, factory);
  const client = new WorkerArchiveClient(endpoint, {
    timeoutMs: 2000,
    terminateOnDispose: true,
    ...options,
  });
  cleanup.push(() => host.dispose());
  cleanup.push(() => client.dispose());
  return { endpoint, scope, host, client };
}
function request(id: string, method: string, params: unknown) {
  return { protocol: RPC_PROTOCOL, kind: 'request', id, method, params };
}

describe('Worker typed client/host roundtrip', () => {
  it('opens real CHM bytes, lists, reads/ranges, TOC/searches, correlates reordered responses and closes', async () => {
    const { endpoint, scope, client } = setup();
    const original = sampleBytes();
    const handle = await client.open(original);
    expect(original.byteLength).toBeGreaterThan(0);
    scope.delay = raw => {
      const response = raw as RpcResponse;
      return response.ok && response.result instanceof Uint8Array ? 20 : 0;
    };
    const [bytes, files, toc, results, range] = await Promise.all([
      handle.read('/index.html'),
      handle.list('**/*.html'),
      handle.toc(),
      handle.search('manual', { maxResults: 1 }),
      handle.readRange('/assets/data.bin', 1, 4),
    ]);
    expect(new TextDecoder().decode(bytes)).toContain('Hello worker manual');
    expect(files).toEqual(['/index.html', '/private.html']);
    expect(toc.some(entry => entry.name === 'Manual')).toBe(true);
    expect(results).toHaveLength(1);
    expect(range).toEqual(new Uint8Array([2, 3, 4]));
    expect(
      new Set(endpoint.sent.map(raw => (raw as { id: string }).id)).size,
    ).toBe(endpoint.sent.length);
    await handle.close();
    await handle.close();
    await expect(handle.list()).rejects.toMatchObject({ code: 'CLOSED' });
    await client.dispose();
    expect(endpoint.terminate).toHaveBeenCalledOnce();
    expect(endpoint.events.listenerCount('message')).toBe(0);
    expect(scope.events.listenerCount('message')).toBe(0);
  });

  it('transfers input only by opt-in and transfers a fresh output allocation, never the archive/cache view', async () => {
    const cached = new Uint8Array([9, 8, 7]);
    const source = adapter();
    source.readFile = () => cached;
    const { client, scope } = setup(() => source);
    const input = sampleBytes();
    const sibling = input.subarray(0, 5);
    const handle = await client.open(input, { transferInput: true });
    expect(input.byteLength).toBe(0);
    expect(sibling.byteLength).toBe(0);
    const output = await handle.read('/anything', { transferResult: true });
    expect(output).toEqual(cached);
    expect(scope.transferred).toHaveLength(1);
    expect(scope.transferred[0].byteLength).toBe(0);
    expect(cached.byteLength).toBe(3);
    output[0] = 0;
    expect(cached[0]).toBe(9);
  });

  it('serializes errors without stack/cause/custom properties and remains usable after archive errors', async () => {
    const { client, scope } = setup();
    const handle = await client.open(sampleBytes());
    await expect(handle.read('/missing')).rejects.toMatchObject({
      code: 'ARCHIVE_ERROR',
      name: 'Error',
    });
    const response = scope.sent.find(
      raw => (raw as RpcResponse).ok === false,
    ) as RpcResponse;
    expect(response.ok === false && Object.keys(response.error).sort()).toEqual(
      ['code', 'message', 'name'],
    );
    expect(await handle.list()).toContain('/index.html');
  });

  it('rejects pre-abort, in-flight abort and timeout, cleans listeners, and closes cancelled late opens', async () => {
    const [endpoint, scope] = clonePair();
    const late = deferred<ArchiveAdapter>();
    const opened = adapter();
    const host = createWorkerArchiveHost(scope, () => late.promise);
    const client = new WorkerArchiveClient(endpoint, { timeoutMs: 1000 });
    cleanup.push(() => host.dispose());
    cleanup.push(() => client.dispose());
    const pre = new AbortController();
    pre.abort();
    await expect(
      client.open(sampleBytes(), { signal: pre.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(endpoint.sent).toHaveLength(0);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = client.open(sampleBytes(), { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await flush();
    controller.abort();
    await rejected;
    late.resolve(opened);
    await flush();
    await flush();
    expect(opened.close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalled();

    const second = deferred<ArchiveAdapter>();
    const [other, otherScope] = clonePair();
    const otherHost = createWorkerArchiveHost(otherScope, () => second.promise);
    const otherClient = new WorkerArchiveClient(other, { timeoutMs: 10 });
    cleanup.push(() => otherHost.dispose());
    cleanup.push(() => otherClient.dispose());
    await expect(otherClient.open(sampleBytes())).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    const secondAdapter = adapter();
    second.resolve(secondAdapter);
    await flush();
    await flush();
    expect(secondAdapter.close).toHaveBeenCalledOnce();
  });

  it('cancels a completed open whose successful response arrives after the caller times out', async () => {
    const opened = adapter();
    const { client, scope } = setup(() => opened);
    scope.delay = () => 40;
    await expect(
      client.open(sampleBytes(), { timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    await flush();
    expect(opened.close).toHaveBeenCalledOnce();
    await new Promise(resolve => setTimeout(resolve, 50));
    scope.delay = () => 0;
  });

  it.each(['error', 'messageerror'])(
    'rejects every pending call and removes handlers on Worker %s',
    async event => {
      const gate = deferred<Uint8Array>();
      const opened = adapter();
      opened.readFile = () => gate.promise;
      const { client, endpoint } = setup(() => opened);
      const handle = await client.open(sampleBytes());
      const first = expect(handle.read('/one')).rejects.toMatchObject({
        code: 'TRANSPORT_ERROR',
      });
      const second = expect(handle.list()).rejects.toMatchObject({
        code: 'TRANSPORT_ERROR',
      });
      await flush();
      endpoint.events.emit(event, new Error('worker died'));
      await Promise.all([first, second]);
      expect(endpoint.events.listenerCount('message')).toBe(0);
      gate.resolve(new Uint8Array());
      await flush();
      await expect(handle.toc()).rejects.toMatchObject({ code: 'DISPOSED' });
    },
  );

  it('reports host-side message deserialization failure to reject callers before timeout', async () => {
    const gate = deferred<Uint8Array>();
    const opened = adapter();
    opened.readFile = () => gate.promise;
    const { client, scope } = setup(() => opened);
    const handle = await client.open(sampleBytes());
    const pending = expect(handle.read('/x')).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
    });
    await flush();
    scope.events.emit('messageerror', {});
    await pending;
    expect(scope.events.listenerCount('message')).toBe(0);
    gate.resolve(new Uint8Array());
    await flush();
    expect(opened.close).toHaveBeenCalledOnce();
  });

  it('rejects all pending requests when postMessage throws', async () => {
    const { client, endpoint } = setup();
    const handle = await client.open(sampleBytes());
    endpoint.failSend = true;
    await expect(handle.list()).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
    });
    expect(endpoint.events.listenerCount('error')).toBe(0);
  });

  it('host-side shutdown notifies and rejects pending callers while draining a late factory', async () => {
    const [endpoint, scope] = clonePair();
    const gate = deferred<ArchiveAdapter>();
    const host = createWorkerArchiveHost(scope, () => gate.promise);
    const client = new WorkerArchiveClient(endpoint);
    const pending = expect(client.open(sampleBytes())).rejects.toMatchObject({
      code: 'DISPOSED',
    });
    await flush();
    const closing = host.dispose();
    await pending;
    const opened = adapter();
    gate.resolve(opened);
    await closing;
    await client.dispose();
    expect(opened.close).toHaveBeenCalledOnce();
  });

  it('dispose rejects pending operations immediately, waits for the factory, then closes/unsubscribes', async () => {
    const [endpoint, scope] = clonePair();
    const gate = deferred<ArchiveAdapter>();
    const host = createWorkerArchiveHost(scope, () => gate.promise);
    const client = new WorkerArchiveClient(endpoint);
    const pending = expect(client.open(sampleBytes())).rejects.toMatchObject({
      code: 'DISPOSED',
    });
    await flush();
    let done = false;
    const disposal = client.dispose().then(() => {
      done = true;
    });
    await pending;
    await flush();
    expect(done).toBe(false);
    const opened = adapter();
    gate.resolve(opened);
    await disposal;
    await host.dispose();
    expect(opened.close).toHaveBeenCalledOnce();
    expect(scope.events.listenerCount('messageerror')).toBe(0);
  });
});

describe('RemoteArchive retryable close roundtrip', () => {
  const closeRequests = (endpoint: { sent: unknown[] }): unknown[] =>
    endpoint.sent.filter(raw => {
      const message = raw as { kind?: string; method?: string };
      return message.kind === 'request' && message.method === 'close';
    });

  it.each(['pre-abort', 'invalid-timeout'] as const)(
    'retries after %s without sending the failed close',
    async reason => {
      const opened = adapter();
      const { client, endpoint } = setup(() => opened);
      const handle = await client.open(sampleBytes());
      const controller = new AbortController();
      controller.abort();
      const options =
        reason === 'pre-abort'
          ? { signal: controller.signal }
          : { timeoutMs: -1 };
      const failed = handle.close(options);
      expect(handle.close()).toBe(failed);
      await expect(failed).rejects.toMatchObject({
        code: reason === 'pre-abort' ? 'ABORTED' : 'INVALID_REQUEST',
      });
      expect(closeRequests(endpoint)).toHaveLength(0);
      expect(opened.close).not.toHaveBeenCalled();
      expect(await handle.list()).toContain('/index.html');

      const retry = handle.close();
      expect(retry).not.toBe(failed);
      expect(handle.close(options)).toBe(retry);
      await retry;
      expect(opened.close).toHaveBeenCalledOnce();
      expect(closeRequests(endpoint)).toHaveLength(1);
      expect(handle.close(options)).toBe(retry);
      await expect(handle.list()).rejects.toMatchObject({ code: 'CLOSED' });
    },
  );

  it('retries a locally rejected close after the pending budget becomes available', async () => {
    const gate = deferred<Uint8Array>();
    const opened = adapter();
    opened.readFile = () => gate.promise;
    const { client, endpoint } = setup(() => opened, {
      limits: { maxPending: 1 },
    });
    const handle = await client.open(sampleBytes());
    const reading = handle.read('/index.html');
    try {
      const failed = handle.close();
      expect(handle.close()).toBe(failed);
      await expect(failed).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
      expect(closeRequests(endpoint)).toHaveLength(0);
      expect(opened.close).not.toHaveBeenCalled();
    } finally {
      gate.resolve(new Uint8Array([1]));
    }
    await expect(reading).resolves.toEqual(new Uint8Array([1]));
    const retry = handle.close();
    expect(handle.close()).toBe(retry);
    await retry;
    expect(closeRequests(endpoint)).toHaveLength(1);
    expect(opened.close).toHaveBeenCalledOnce();
  });

  it('blocks new reads while closing and retains one successful promise without reopening', async () => {
    const gate = deferred<void>();
    const opened = adapter();
    const originalClose = opened.close;
    opened.close = vi.fn(async () => {
      await gate.promise;
      originalClose();
    });
    const { client, endpoint } = setup(() => opened);
    const handle = await client.open(sampleBytes());
    const closing = handle.close();
    try {
      expect(handle.close({ timeoutMs: -1 })).toBe(closing);
      await Promise.all([
        expect(handle.read('/index.html')).rejects.toMatchObject({
          code: 'CLOSED',
        }),
        expect(handle.readRange('/index.html', 0, 1)).rejects.toMatchObject({
          code: 'CLOSED',
        }),
        expect(handle.list()).rejects.toMatchObject({ code: 'CLOSED' }),
        expect(handle.toc()).rejects.toMatchObject({ code: 'CLOSED' }),
        expect(handle.search('manual')).rejects.toMatchObject({
          code: 'CLOSED',
        }),
      ]);
      expect(closeRequests(endpoint)).toHaveLength(1);
    } finally {
      gate.resolve();
    }
    await closing;
    expect(opened.close).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    expect(handle.close({ signal: controller.signal, timeoutMs: -1 })).toBe(
      closing,
    );
    await handle.close();
    await expect(handle.read('/index.html')).rejects.toMatchObject({
      code: 'CLOSED',
    });
    expect(closeRequests(endpoint)).toHaveLength(1);
  });

  it('retries a timed-out close after remote execution, accepting NOT_FOUND and ignoring its late reply', async () => {
    const opened = adapter();
    const { client, endpoint, scope } = setup(() => opened);
    const handle = await client.open(sampleBytes());
    scope.delay = raw => {
      const response = raw as RpcResponse;
      return response.ok && response.result === null ? 40 : 0;
    };
    const failed = handle.close({ timeoutMs: 5 });
    await expect(failed).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(opened.close).toHaveBeenCalledOnce();
    scope.delay = () => 0;
    const retry = handle.close();
    expect(retry).not.toBe(failed);
    expect(handle.close()).toBe(retry);
    await retry;
    expect(scope.sent).toContainEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    );
    expect(closeRequests(endpoint)).toHaveLength(2);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(handle.close()).toBe(retry);
    await expect(handle.list()).rejects.toMatchObject({ code: 'CLOSED' });
    expect(opened.close).toHaveBeenCalledOnce();
  });

  it('accepts remote CLOSED when a timed-out close is still draining the adapter', async () => {
    const gate = deferred<void>();
    const opened = adapter();
    const originalClose = opened.close;
    opened.close = vi.fn(async () => {
      await gate.promise;
      originalClose();
    });
    const { client, endpoint, scope } = setup(() => opened);
    const handle = await client.open(sampleBytes());
    try {
      await expect(handle.close({ timeoutMs: 5 })).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
      const retry = handle.close();
      expect(handle.close()).toBe(retry);
      await retry;
      expect(scope.sent).toContainEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'CLOSED' }),
        }),
      );
      expect(closeRequests(endpoint)).toHaveLength(2);
      await expect(handle.read('/index.html')).rejects.toMatchObject({
        code: 'CLOSED',
      });
      expect(handle.close()).toBe(retry);
      expect(opened.close).toHaveBeenCalledOnce();
    } finally {
      gate.resolve();
    }
    await flush();
  });

  it('propagates host close exceptions and allows retry after the host releases the capability', async () => {
    const opened = adapter();
    const originalClose = opened.close;
    opened.close = vi.fn(() => {
      originalClose();
      throw new Error('Host close failed');
    });
    const { client, endpoint, scope } = setup(() => opened);
    const handle = await client.open(sampleBytes());
    const failed = handle.close();
    expect(handle.close()).toBe(failed);
    await expect(failed).rejects.toMatchObject({
      code: 'ARCHIVE_ERROR',
      message: 'Host close failed',
    });
    const retry = handle.close();
    expect(retry).not.toBe(failed);
    expect(handle.close()).toBe(retry);
    await retry;
    expect(scope.sent).toContainEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    );
    expect(closeRequests(endpoint)).toHaveLength(2);
    expect(opened.close).toHaveBeenCalledOnce();
    await expect(handle.list()).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it.each(['UNAUTHORIZED', 'LIMIT_EXCEEDED', 'DISPOSED'])(
    'does not swallow remote %s errors or cache their rejected close promise',
    async code => {
      const opened = adapter();
      const originalClose = opened.close;
      opened.close = vi.fn(() => {
        originalClose();
        throw new RpcError(code, `Host rejected close: ${code}`);
      });
      const { client } = setup(() => opened);
      const handle = await client.open(sampleBytes());
      const failed = handle.close();
      await expect(failed).rejects.toMatchObject({
        code,
        message: `Host rejected close: ${code}`,
      });
      const retry = handle.close();
      expect(retry).not.toBe(failed);
      await retry;
      expect(handle.close()).toBe(retry);
    },
  );
});

describe('Worker reader options roundtrip', () => {
  it.each<ReaderOptions>([
    { readAhead: false },
    { readAhead: true },
    { adaptivePreload: { maxFiles: 1, maxBytes: 1 } },
    { adaptivePreload: { maxFiles: 32, maxBytes: Number.MAX_SAFE_INTEGER } },
    {
      maxCacheBytes: 4096,
      maxFileSize: 4096,
      cacheStrategy: 'none',
      defaultEncoding: 'utf-8',
      readAhead: false,
      adaptivePreload: { maxFiles: 2, maxBytes: 2048 },
    },
  ])(
    'passes validated ReaderOptions to a real host reader: %j',
    async readerOptions => {
      const factory = vi.fn(
        (bytes: Uint8Array, options?: ReaderOptions) =>
          new CHMArchive(bytes, options),
      );
      const { client } = setup(factory);
      const handle = await client.open(sampleBytes(), { readerOptions });
      expect(factory).toHaveBeenCalledOnce();
      const received = factory.mock.calls[0][1];
      expect(received).toEqual(readerOptions);
      expect(received).not.toBe(readerOptions);
      if (readerOptions.adaptivePreload)
        expect(received?.adaptivePreload).not.toBe(
          readerOptions.adaptivePreload,
        );
      expect(await handle.list()).toContain('/index.html');
      expect(
        new TextDecoder().decode(await handle.read('/index.html')),
      ).toContain('Hello worker manual');
      await handle.close();
    },
  );

  const invalidOptions: [string, unknown][] = [
    ['readAhead null', { readAhead: null }],
    ['readAhead number', { readAhead: 1 }],
    ['readAhead string', { readAhead: 'false' }],
    ['readAhead object', { readAhead: {} }],
    ['unknown reader key', { readAhead: true, extra: true }],
    ...[null, false, 1, 'on', [], new Date(0)].map(
      (value): [string, unknown] => [
        `adaptivePreload ${String(value)}`,
        { adaptivePreload: value },
      ],
    ),
    ['empty adaptivePreload', { adaptivePreload: {} }],
    ['missing maxFiles', { adaptivePreload: { maxBytes: 1 } }],
    ['missing maxBytes', { adaptivePreload: { maxFiles: 1 } }],
    [
      'unknown nested key',
      { adaptivePreload: { maxFiles: 1, maxBytes: 1, extra: true } },
    ],
    ...[
      0,
      -1,
      1.5,
      33,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
      null,
    ].map((value): [string, unknown] => [
      `maxFiles ${String(value)}`,
      { adaptivePreload: { maxFiles: value, maxBytes: 1 } },
    ]),
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null].map(
      (value): [string, unknown] => [
        `maxBytes ${String(value)}`,
        { adaptivePreload: { maxFiles: 1, maxBytes: value } },
      ],
    ),
  ];
  it.each(invalidOptions)(
    'rejects %s both before transfer and at the host boundary',
    async (_label, options) => {
      const factory = vi.fn(() => adapter());
      const { client, endpoint, scope } = setup(factory);
      const bytes = new Uint8Array([1]);
      await expect(
        client.open(bytes, {
          readerOptions: options as ReaderOptions,
          transferInput: true,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(bytes.byteLength).toBe(1);
      expect(endpoint.sent).toHaveLength(0);
      expect(factory).not.toHaveBeenCalled();

      endpoint.postMessage(
        request('invalid-options', 'open', { source: bytes, options }),
      );
      await flush();
      expect(scope.sent).toContainEqual(
        expect.objectContaining({
          id: 'invalid-options',
          ok: false,
          error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
        }),
      );
      expect(factory).not.toHaveBeenCalled();
    },
  );
});

describe('Worker trust-boundary validation', () => {
  it('copies input by default before caller mutation, without detaching sibling views', async () => {
    const { client } = setup();
    const bytes = sampleBytes();
    const sibling = bytes.subarray(0, 5);
    const opening = client.open(bytes);
    bytes.fill(0);
    const handle = await opening;
    expect(await handle.list()).toContain('/index.html');
    expect(sibling.byteLength).toBe(5);
  });

  it('cleans failed open replies, bounds structured results and handles odd thrown errors', async () => {
    const opened: ReturnType<typeof adapter>[] = [];
    const session = new ArchiveSession({
      open: () => {
        const archive = adapter();
        opened.push(archive);
        return archive;
      },
      validateOpen: validateWorkerOpen,
      limits: { maxArchives: 1, maxOutputBytes: 1 },
    });
    for (const id of ['one', 'two']) {
      expect(
        await session.handle(
          request(id, 'open', { source: new Uint8Array(1) }),
        ),
      ).toMatchObject({
        ok: false,
        error: {
          code: 'LIMIT_EXCEEDED',
          message: 'Result exceeds output limit',
        },
      });
    }
    expect(opened).toHaveLength(2);
    expect(opened.every(archive => archive.close.mock.calls.length === 1)).toBe(
      true,
    );
    await session.dispose();

    const archive = adapter();
    const { client } = setup(() => archive);
    const handle = await client.open(sampleBytes());
    archive.getTOC = () => [{ name: 'x', local: '/x', level: -1 }];
    await expect(handle.toc()).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    archive.search = () => {
      const error = new Error('test');
      Object.defineProperty(error, 'name', {
        get() {
          throw new Error('getter');
        },
      });
      throw error;
    };
    await expect(handle.search('x')).rejects.toMatchObject({
      code: 'ARCHIVE_ERROR',
      name: 'Error',
    });
    expect(await handle.list()).toContain('/index.html');
  });

  it('drains every archive even when one close fails and another close is asynchronous', async () => {
    const first = adapter();
    first.close = vi.fn(() => {
      throw new Error('close failed');
    });
    const last = adapter();
    const gate = deferred<void>();
    last.close = vi.fn(() => gate.promise);
    const queue = [first, last];
    const session = new ArchiveSession({
      open: () => queue.shift()!,
      validateOpen: validateWorkerOpen,
    });
    await session.handle(request('a', 'open', { source: new Uint8Array(1) }));
    await session.handle(request('b', 'open', { source: new Uint8Array(1) }));
    let done = false;
    const disposed = expect(
      session.dispose().finally(() => {
        done = true;
      }),
    ).rejects.toThrow('close failed');
    await flush();
    expect(done).toBe(false);
    gate.resolve();
    await disposed;
    expect(first.close).toHaveBeenCalledOnce();
    expect(last.close).toHaveBeenCalledOnce();
  });
  it('rejects invalid protocol, unknown methods/fields, bad ranges/options and oversized inputs', async () => {
    const factory = vi.fn(() => adapter());
    const session = new ArchiveSession({
      open: factory,
      validateOpen: validateWorkerOpen,
      limits: { maxInputBytes: 2, maxStringLength: 8 },
    });
    const bad = [
      { ...request('a', 'list', { archiveId: 'x' }), protocol: 'wrong' },
      request('b', '__proto__', {}),
      request('c', 'open', { source: new Uint8Array(3) }),
      request('d', 'open', { source: new Uint8Array(1), path: '/etc/passwd' }),
      request('e', 'read', { archiveId: 'x', path: '/x', start: -1 }),
      request('f', 'read', { archiveId: 'x', path: '/x', start: 5, end: 2 }),
      request('g', 'search', {
        archiveId: 'x',
        keyword: 'x',
        options: { maxResults: Infinity },
      }),
      request('h', 'open', {
        source: new Uint8Array(1),
        options: { cacheStrategy: 'fake' },
      }),
      request('i', 'read', { archiveId: 'x', path: 'too long string' }),
      request('j', 'open', {
        source: new Uint8Array(new SharedArrayBuffer(1)),
      }),
    ];
    for (const raw of bad) expect((await session.handle(raw))?.ok).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(await session.handle(null)).toBeUndefined();
    expect(
      await session.handle(request('bad id!', 'dispose', {})),
    ).toBeUndefined();
    await session.dispose();
  });

  it('limits pending requests, archives and outputs; duplicate ids and unknown capabilities fail', async () => {
    const gate = deferred<ArchiveAdapter>();
    const session = new ArchiveSession({
      open: () => gate.promise,
      validateOpen: validateWorkerOpen,
      limits: { maxArchives: 1, maxPending: 2, maxOutputBytes: 100 },
    });
    const first = session.handle(
      request('a', 'open', { source: new Uint8Array(1) }),
    );
    expect(
      await session.handle(request('a', 'open', { source: new Uint8Array(1) })),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(
      await session.handle(request('b', 'open', { source: new Uint8Array(1) })),
    ).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
    const opened = adapter();
    opened.readFile = () => new Uint8Array(101);
    gate.resolve(opened);
    const response = await first;
    expect(response?.ok).toBe(true);
    const id = response?.ok
      ? (response.result as { archiveId: string }).archiveId
      : '';
    expect(
      await session.handle(request('c', 'read', { archiveId: id, path: '/x' })),
    ).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
    expect(
      await session.handle(request('d', 'toc', { archiveId: 'not-mine' })),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await session.dispose();
    expect(opened.close).toHaveBeenCalledOnce();
    expect(
      await session.handle(request('e', 'list', { archiveId: id })),
    ).toMatchObject({ ok: false, error: { code: 'DISPOSED' } });
  });

  it('rejects malformed or oversized responses instead of leaving callers pending', async () => {
    const { client, scope } = setup();
    const handle = await client.open(sampleBytes());
    scope.postMessage({
      protocol: RPC_PROTOCOL,
      kind: 'response',
      id: 'fake',
      ok: 'yes',
    });
    const pending = expect(handle.list()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await pending;
  });

  it('enforces input/client pending limits before transfer or sending and rejects invalid timeouts', async () => {
    const [endpoint, scope] = clonePair();
    const gate = deferred<ArchiveAdapter>();
    const host = createWorkerArchiveHost(scope, () => gate.promise);
    const client = new WorkerArchiveClient(endpoint, {
      limits: { maxInputBytes: 2, maxPending: 1 },
    });
    const bytes = new Uint8Array(3);
    await expect(
      client.open(bytes, { transferInput: true }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(bytes.byteLength).toBe(3);
    await expect(
      client.open(new Uint8Array(1), { timeoutMs: -1 }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const pending = expect(
      client.open(new Uint8Array(1)),
    ).rejects.toMatchObject({ code: 'DISPOSED' });
    await expect(client.open(new Uint8Array(1))).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    const disposal = client.dispose();
    await pending;
    gate.resolve(adapter());
    await disposal;
    await flush();
    await host.dispose();
  });
});

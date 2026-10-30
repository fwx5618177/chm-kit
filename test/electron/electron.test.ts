import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ELECTRON_CHANNEL,
  createElectronArchiveProxy,
  createElectronRendererApi,
  registerElectronArchiveHandler,
  type ApprovedArchive,
  type ElectronMainOptions,
  type IpcInvokeEvent,
  type IpcMainLike,
  type IpcSender,
} from '../../src/electron';
import { RPC_PROTOCOL, type ArchiveAdapter } from '../../src/worker';
import { adapter, deferred, flush } from '../worker/support';

class Sender extends EventEmitter implements IpcSender {
  dead = false;
  constructor(readonly id = 1) {
    super();
  }
  isDestroyed(): boolean {
    return this.dead;
  }
}
class Main implements IpcMainLike {
  handlers = new Map<string, Parameters<IpcMainLike['handle']>[1]>();
  handle(channel: string, handler: Parameters<IpcMainLike['handle']>[1]): void {
    if (this.handlers.has(channel)) throw new Error('Already registered');
    this.handlers.set(channel, handler);
  }
  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }
  async invoke(
    event: IpcInvokeEvent,
    message: unknown,
    channel = DEFAULT_ELECTRON_CHANNEL,
  ): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error('No handler');
    return structuredClone(await handler(event, structuredClone(message)));
  }
}
function event(sender = new Sender(), routingId = 1): IpcInvokeEvent {
  return {
    sender,
    senderFrame: {
      url: 'app://manual/index.html',
      processId: 7,
      routingId,
      parent: null,
    },
  };
}
let sequence = 0;
function request(method: string, params: unknown, id = `test:${++sequence}`) {
  return { protocol: RPC_PROTOCOL, kind: 'request', id, method, params };
}
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function setup(overrides: Partial<ElectronMainOptions> = {}) {
  const ipcMain = new Main();
  const sender = new Sender();
  const invokeEvent = event(sender);
  const opened: ReturnType<typeof adapter>[] = [];
  const open = vi.fn(() => {
    const archive = adapter();
    opened.push(archive);
    return archive;
  });
  const handler = registerElectronArchiveHandler({
    ipcMain,
    archives: new Map([['manual', { open }]]),
    validateSender: e =>
      e.sender === sender && e.senderFrame?.url === 'app://manual/index.html',
    authorizeArchive: (_event, key) => key === 'manual',
    ...overrides,
  });
  const renderer = {
    invoke: (channel: string, message: unknown) =>
      ipcMain.invoke(invokeEvent, message, channel),
  };
  const proxy = createElectronArchiveProxy(renderer, { timeoutMs: 2000 });
  cleanup.push(() => handler.dispose());
  cleanup.push(() =>
    proxy.dispose().catch(error => {
      // These tests deliberately revoke authorization or remove the server first.
      if (!['UNAUTHORIZED', 'TRANSPORT_ERROR'].includes(error.code))
        throw error;
    }),
  );
  return {
    ipcMain,
    sender,
    invokeEvent,
    renderer,
    handler,
    proxy,
    opened,
    open,
  };
}

describe('Electron injected IPC roundtrip (not native Electron)', () => {
  it('opens only an approved key and supports concurrent read/list/TOC/search/ranges/close', async () => {
    const { proxy, opened, ipcMain, sender, handler } = setup();
    const handle = await proxy.open('manual');
    const [data, listing, toc, results, range] = await Promise.all([
      handle.read('/index.html'),
      handle.list('**/*.html'),
      handle.toc(),
      handle.search('manual'),
      handle.readRange('/assets/data.bin', 2, 4),
    ]);
    expect(new TextDecoder().decode(data)).toContain('Hello worker manual');
    expect(listing).toContain('/index.html');
    expect(toc).not.toHaveLength(0);
    expect(results.some(result => result.path === '/index.html')).toBe(true);
    expect(range).toEqual(new Uint8Array([3, 4]));
    await handle.close();
    await proxy.dispose();
    expect(opened[0].close).toHaveBeenCalledOnce();
    expect(sender.listenerCount('destroyed')).toBe(0);
    await handler.dispose();
    expect(ipcMain.handlers.size).toBe(0);
    await handler.dispose();
  });

  it('exposes a plain function-only contextBridge API without arbitrary invoke/channel/path opening', async () => {
    const { renderer } = setup();
    const api = createElectronRendererApi(renderer);
    const id = await api.open('manual');
    expect(Object.values(api).every(value => typeof value === 'function')).toBe(
      true,
    );
    expect(Object.keys(api).sort()).toEqual([
      'close',
      'dispose',
      'list',
      'open',
      'read',
      'search',
      'toc',
    ]);
    expect(await api.list(id)).toContain('/index.html');
    expect(await api.read(id, '/assets/data.bin', 0, 2)).toEqual(
      new Uint8Array([1, 2]),
    );
    expect(await api.toc(id)).not.toHaveLength(0);
    expect(await api.search(id, 'manual')).not.toHaveLength(0);
    await expect(api.read('guessed', '/index.html')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(api.open('/etc/passwd')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await api.close(id);
    await expect(api.list(id)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await api.dispose();
    await expect(api.open('manual')).rejects.toMatchObject({
      code: 'DISPOSED',
    });
  });

  it('retains the plain bridge handle when a close exceeds the pending budget, then retries after the read drains', async () => {
    const { renderer, opened } = setup();
    const invoke = vi.spyOn(renderer, 'invoke');
    const api = createElectronRendererApi(renderer, {
      timeoutMs: 2000,
      limits: { maxPending: 1 },
    });
    cleanup.push(() => api.dispose());
    const id = await api.open('manual');
    const gate = deferred<Uint8Array>();
    opened[0].readFile = () => gate.promise;
    const reading = api.read(id, '/index.html');
    const closeCalls = () =>
      invoke.mock.calls.filter(
        ([, raw]) => (raw as { method?: string }).method === 'close',
      );
    try {
      await expect(
        Promise.all([api.close(id), api.close(id)]),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
      expect(closeCalls()).toHaveLength(0);
      expect(opened[0].close).not.toHaveBeenCalled();
    } finally {
      gate.resolve(new Uint8Array([7]));
    }
    await expect(reading).resolves.toEqual(new Uint8Array([7]));
    expect(await api.list(id)).toContain('/index.html');
    await Promise.all([api.close(id), api.close(id)]);
    expect(closeCalls()).toHaveLength(1);
    expect(opened[0].close).toHaveBeenCalledOnce();
    await expect(api.list(id)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Unknown archive handle',
    });
  });

  it('retains the plain bridge handle after a host policy exception and retries when the host recovers', async () => {
    let rejectClose = false;
    const { renderer, opened } = setup({
      authorizeArchive() {
        if (rejectClose) throw new Error('Privileged policy failure');
        return true;
      },
    });
    const invoke = vi.spyOn(renderer, 'invoke');
    const api = createElectronRendererApi(renderer);
    cleanup.push(() => api.dispose());
    const id = await api.open('manual');
    rejectClose = true;
    try {
      await expect(api.close(id)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'IPC request denied',
      });
      expect(opened[0].close).not.toHaveBeenCalled();
    } finally {
      rejectClose = false;
    }
    expect(await api.list(id)).toContain('/index.html');
    await Promise.all([api.close(id), api.close(id)]);
    const closes = invoke.mock.calls.filter(
      ([, raw]) => (raw as { method?: string }).method === 'close',
    );
    expect(closes).toHaveLength(2);
    expect(opened[0].close).toHaveBeenCalledOnce();
    await expect(api.list(id)).rejects.toMatchObject({
      message: 'Unknown archive handle',
    });
  });

  it('retries the host after an adapter close exception without swallowing a revoked capability', async () => {
    const { renderer, opened } = setup();
    const invoke = vi.spyOn(renderer, 'invoke');
    const api = createElectronRendererApi(renderer);
    cleanup.push(() => api.dispose());
    const id = await api.open('manual');
    const originalClose = opened[0].close;
    opened[0].close = vi.fn(() => {
      originalClose();
      throw new Error('Cannot close /secret/main/path');
    });
    await expect(api.close(id)).rejects.toMatchObject({
      code: 'ARCHIVE_ERROR',
      message: 'Archive operation failed',
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(api.close(id)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Archive capability is not granted to this sender/frame',
      });
    }
    const closes = invoke.mock.calls.filter(
      ([, raw]) => (raw as { method?: string }).method === 'close',
    );
    expect(closes).toHaveLength(3);
    expect(opened[0].close).toHaveBeenCalledOnce();
    await api.dispose();
    await expect(api.close(id)).rejects.toMatchObject({
      message: 'Unknown archive handle',
    });
  });

  it.each([false, true])(
    'does not restore plain bridge handles when concurrent close/dispose drains (adapter fails: %s)',
    async fail => {
      const { renderer, opened, sender } = setup();
      const api = createElectronRendererApi(renderer);
      cleanup.push(() => api.dispose());
      const id = await api.open('manual');
      const gate = deferred<void>();
      const entered = deferred<void>();
      const originalClose = opened[0].close;
      opened[0].close = vi.fn(async () => {
        entered.resolve();
        await gate.promise;
        originalClose();
        if (fail) throw new Error('Adapter close failed');
      });
      const first = api.close(id);
      const second = api.close(id);
      const results = Promise.allSettled([first, second]);
      try {
        await entered.promise;
        await expect(api.read(id, '/index.html')).rejects.toMatchObject({
          code: 'CLOSED',
        });
        const disposing = api.dispose();
        const again = api.dispose();
        await expect(api.close(id)).rejects.toMatchObject({
          message: 'Unknown archive handle',
        });
        expect(
          (await results).every(
            result =>
              result.status === 'rejected' && result.reason.code === 'DISPOSED',
          ),
        ).toBe(true);
        await expect(api.open('manual')).rejects.toMatchObject({
          code: 'DISPOSED',
        });
        gate.resolve();
        await Promise.all([disposing, again]);
      } finally {
        gate.resolve();
      }
      expect(opened[0].close).toHaveBeenCalledOnce();
      expect(sender.listenerCount('destroyed')).toBe(0);
      await expect(api.close(id)).rejects.toMatchObject({
        message: 'Unknown archive handle',
      });
    },
  );

  it.each([
    '/etc/passwd',
    'C:\\secret.chm',
    'file:///secret.chm',
    '../secret.chm',
    'https://host/help.chm',
  ])(
    'rejects renderer filesystem/URL input %s without calling a factory',
    async key => {
      const { ipcMain, invokeEvent, open } = setup();
      expect(
        await ipcMain.invoke(invokeEvent, request('open', { key })),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('rejects unauthorized senders, null frames, unknown keys, and extra fields; fails closed if policy throws', async () => {
    const { ipcMain, invokeEvent, open } = setup();
    for (const hostile of [
      event(new Sender(2)),
      { ...invokeEvent, senderFrame: null },
      {
        ...invokeEvent,
        senderFrame: {
          ...invokeEvent.senderFrame!,
          url: 'https://evil.example/',
        },
      },
    ]) {
      expect(
        await ipcMain.invoke(hostile, request('open', { key: 'manual' })),
      ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    }
    expect(
      await ipcMain.invoke(invokeEvent, request('open', { key: 'unknown' })),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(
      await ipcMain.invoke(
        invokeEvent,
        request('open', { key: 'manual', path: '/etc/passwd' }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(open).not.toHaveBeenCalled();
    const other = setup({
      validateSender: () => {
        throw new Error('/secret/application/path');
      },
    });
    expect(
      await other.ipcMain.invoke(
        other.invokeEvent,
        request('open', { key: 'manual' }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'IPC sender is not authorized' },
    });
  });

  it('scopes capabilities to sender/frame and rechecks authorization after grant revocation', async () => {
    let allowed = true;
    const { ipcMain, invokeEvent, proxy, sender } = setup({
      validateSender: () => true,
      authorizeArchive: () => allowed,
    });
    const handle = await proxy.open('manual');
    for (const hostile of [event(new Sender(99)), event(sender, 2)]) {
      expect(
        await ipcMain.invoke(
          hostile,
          request('read', { archiveId: handle.archiveId, path: '/index.html' }),
        ),
      ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    }
    allowed = false;
    await expect(handle.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    allowed = true;
    expect(await handle.list()).toContain('/index.html');
    expect(
      await ipcMain.invoke(
        invokeEvent,
        request('read', { archiveId: handle.archiveId, path: '/#SYSTEM' }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('enforces file and operation capability restrictions and filters hidden TOC/search/list data', async () => {
    const open = vi.fn(() => adapter());
    const { proxy } = setup({
      archives: new Map([
        ['manual', { open, allowPath: path => path === '/index.html' }],
      ]),
    });
    const handle = await proxy.open('manual');
    expect(await handle.list()).toEqual(['/index.html']);
    expect(
      (await handle.toc()).every(entry => entry.local === '/index.html'),
    ).toBe(true);
    expect(
      (await handle.search('manual')).every(
        result => result.path === '/index.html',
      ),
    ).toBe(true);
    await expect(handle.read('/private.html')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(handle.read('/assets/../index.html')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    const limited = setup({
      archives: new Map<string, ApprovedArchive>([
        ['manual', { open, operations: ['list'] }],
      ]),
    });
    const listOnly = await limited.proxy.open('manual');
    expect(await listOnly.list()).not.toHaveLength(0);
    await expect(listOnly.read('/index.html')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(listOnly.toc()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(listOnly.search('manual')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('hides main-side archive errors and rejects oversized/malformed requests and results', async () => {
    const opened = adapter();
    opened.readFile = () => {
      throw new Error('Cannot read /secret/main/path');
    };
    const { proxy, ipcMain, invokeEvent } = setup({
      archives: new Map([['manual', { open: () => opened }]]),
      limits: { maxOutputBytes: 500 },
    });
    const handle = await proxy.open('manual');
    await expect(handle.read('/index.html')).rejects.toMatchObject({
      code: 'ARCHIVE_ERROR',
      message: 'Archive operation failed',
    });
    opened.readFile = () => new Uint8Array(501);
    await expect(handle.read('/index.html')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    expect(
      await ipcMain.invoke(
        invokeEvent,
        request('read', {
          archiveId: handle.archiveId,
          path: '/index.html',
          end: -1,
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(
      await ipcMain.invoke(
        invokeEvent,
        request('search', {
          archiveId: handle.archiveId,
          keyword: 'x'.repeat(8193),
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
  });

  it.each(['destroyed', 'did-start-navigation', 'render-process-gone'])(
    'closes owned instances on %s and removes lifecycle listeners',
    async name => {
      const { proxy, sender, opened, handler } = setup();
      await proxy.open('manual');
      await proxy.open('manual');
      sender.emit(name);
      await flush();
      expect(
        opened.every(archive => archive.close.mock.calls.length === 1),
      ).toBe(true);
      expect(sender.listenerCount('did-start-navigation')).toBe(0);
      await handler.releaseSender(sender);
    },
  );

  it('disposal waits for late opens and closes them, unregistering only its own channel', async () => {
    const gate = deferred<ArchiveAdapter>();
    const { proxy, handler, ipcMain } = setup({
      archives: new Map([['manual', { open: () => gate.promise }]]),
    });
    ipcMain.handle('other:channel', () => null);
    const pending = expect(proxy.open('manual')).rejects.toMatchObject({
      code: 'ABORTED',
    });
    await flush();
    let done = false;
    const dispose = handler.dispose().then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(false);
    const opened = adapter();
    gate.resolve(opened);
    await pending;
    await dispose;
    expect(opened.close).toHaveBeenCalledOnce();
    expect(ipcMain.handlers.has('other:channel')).toBe(true);
    expect(ipcMain.handlers.has(DEFAULT_ELECTRON_CHANNEL)).toBe(false);
  });

  it('counts disposing sessions once across concurrent sender release and client dispose', async () => {
    const slow = adapter();
    const gate = deferred<void>();
    slow.close = vi.fn(() => gate.promise);
    let calls = 0;
    const { ipcMain, sender, proxy, handler } = setup({
      maxSessions: 1,
      validateSender: () => true,
      archives: new Map([
        ['manual', { open: () => (calls++ === 0 ? slow : adapter()) }],
      ]),
    });
    await proxy.open('manual');
    const clientDisposal = proxy.dispose();
    await flush();
    const released = handler.releaseSender(sender);
    const second = event(new Sender(2));
    expect(
      await ipcMain.invoke(second, request('open', { key: 'manual' })),
    ).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
    gate.resolve();
    await Promise.all([clientDisposal, released]);
    expect(
      await ipcMain.invoke(second, request('open', { key: 'manual' })),
    ).toMatchObject({ ok: true });
    expect(
      await ipcMain.invoke(
        event(new Sender(3)),
        request('open', { key: 'manual' }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
    expect(slow.close).toHaveBeenCalledOnce();
  });

  it('does not replace existing channels and drains all sessions when a close fails', async () => {
    const ipcMain = new Main();
    const failing = adapter();
    failing.close = vi.fn(() => {
      throw new Error('close failed');
    });
    const slow = adapter();
    const gate = deferred<void>();
    slow.close = vi.fn(() => gate.promise);
    const factories = [failing, slow];
    const options: ElectronMainOptions = {
      ipcMain,
      archives: new Map([['manual', { open: () => factories.shift()! }]]),
      validateSender: () => true,
      authorizeArchive: () => true,
    };
    const handler = registerElectronArchiveHandler(options);
    expect(() => registerElectronArchiveHandler(options)).toThrow(
      'Already registered',
    );
    await ipcMain.invoke(
      event(new Sender(1)),
      request('open', { key: 'manual' }),
    );
    await ipcMain.invoke(
      event(new Sender(2)),
      request('open', { key: 'manual' }),
    );
    let done = false;
    const closing = expect(
      handler.dispose().finally(() => {
        done = true;
      }),
    ).rejects.toThrow('close failed');
    await flush();
    expect(done).toBe(false);
    expect(ipcMain.handlers.size).toBe(0);
    gate.resolve();
    await closing;
    expect(failing.close).toHaveBeenCalledOnce();
    expect(slow.close).toHaveBeenCalledOnce();
  });

  it('supports cancellation/timeouts, transport failure, invalid channels and bounded sessions', async () => {
    const gate = deferred<ArchiveAdapter>();
    const { renderer, handler } = setup({
      archives: new Map([['manual', { open: () => gate.promise }]]),
    });
    const short = createElectronArchiveProxy(renderer, { timeoutMs: 5 });
    await expect(short.open('manual')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    const opened = adapter();
    gate.resolve(opened);
    await flush();
    expect(opened.close).toHaveBeenCalledOnce();
    await short.dispose();
    const broken = createElectronArchiveProxy({
      invoke: async () => {
        throw new Error('closed');
      },
    });
    await expect(broken.open('manual')).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
    });
    await broken.dispose();
    expect(() =>
      createElectronArchiveProxy(renderer, { channel: '*' }),
    ).toThrow(/channel/);
    await handler.dispose();
    const bounded = setup({ maxSessions: 1, validateSender: () => true });
    await bounded.proxy.open('manual');
    expect(
      await bounded.ipcMain.invoke(
        event(new Sender(5)),
        request('open', { key: 'manual' }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'LIMIT_EXCEEDED' } });
  });
});

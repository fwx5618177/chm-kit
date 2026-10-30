import {
  RPC_PROTOCOL,
  RpcError,
  checkOutput,
  failure,
  record,
  resolveLimits,
  validId,
  validateRequest,
  validateResult,
  type ArchiveAdapter,
  type MaybePromise,
  type RpcLimits,
  type RpcRequest,
  type RpcResponse,
  type ResultMap,
} from './protocol';

export interface OpenContext {
  /** Cooperative only; synchronous CHM parsing cannot be preempted. */
  isCancelled(): boolean;
}
export interface SessionOptions<Open> {
  open(params: Open, context: OpenContext): MaybePromise<ArchiveAdapter>;
  validateOpen(params: unknown, limits: RpcLimits): Open;
  limits?: Partial<RpcLimits>;
  /** Set false at a privilege boundary to hide filesystem/parser diagnostics. */
  exposeArchiveErrors?: boolean;
}
interface ArchiveSlot {
  archive: ArchiveAdapter;
  tail: Promise<unknown>;
  closing: boolean;
}
interface Task {
  cancelled: boolean;
}

/** Internal transport-neutral session. Each instance owns only its own archives. */
export class ArchiveSession<Open> {
  readonly limits: RpcLimits;
  private readonly archives = new Map<string, ArchiveSlot>();
  private readonly tasks = new Map<string, Task>();
  private opening = 0;
  private readonly openingJobs = new Set<Promise<{ archiveId: string }>>();
  private readonly openRequests = new Map<string, string>();
  private sequence = 0;
  private disposed = false;
  private disposal?: Promise<void>;

  constructor(private readonly options: SessionOptions<Open>) {
    this.limits = resolveLimits(options.limits);
  }

  async handle(raw: unknown): Promise<RpcResponse | undefined> {
    let request: RpcRequest<Open>;
    try {
      const message = validateRequest(
        raw,
        this.limits,
        this.options.validateOpen,
      );
      if (message.kind === 'cancel') {
        const task = this.tasks.get(message.id);
        if (task) task.cancelled = true;
        const archiveId = this.openRequests.get(message.id);
        if (archiveId) await this.closeArchive(archiveId);
        return;
      }
      request = message;
    } catch (error) {
      // No response is possible without a valid correlation id.
      try {
        const id = record(raw).id;
        if (validId(id)) return failure(id, error);
      } catch {
        /* malformed input is intentionally ignored */
      }
      return;
    }
    if (this.disposed && request.method !== 'dispose')
      return failure(
        request.id,
        new RpcError('DISPOSED', 'Archive session is disposed'),
      );
    if (this.tasks.has(request.id))
      return failure(
        request.id,
        new RpcError('INVALID_REQUEST', 'Duplicate active request id'),
      );
    if (
      this.tasks.size >= this.limits.maxPending &&
      request.method !== 'dispose'
    )
      return failure(
        request.id,
        new RpcError('LIMIT_EXCEEDED', 'Too many active requests'),
      );
    const task: Task = { cancelled: false };
    this.tasks.set(request.id, task);
    try {
      const result = await this.execute(request, task);
      if (task.cancelled) return;
      checkOutput(result, this.limits);
      validateResult(request.method, result);
      return {
        protocol: RPC_PROTOCOL,
        kind: 'response',
        id: request.id,
        ok: true,
        result,
      };
    } catch (error) {
      if (request.method === 'open') {
        const archiveId = this.openRequests.get(request.id);
        if (archiveId) {
          try {
            await this.closeArchive(archiveId);
          } catch {
            /* preserve the original operation error after releasing the capability */
          }
        }
      }
      if (task.cancelled) return;
      const safe =
        this.options.exposeArchiveErrors === false &&
        !(error instanceof RpcError)
          ? new RpcError('ARCHIVE_ERROR', 'Archive operation failed')
          : error;
      return failure(request.id, safe);
    } finally {
      this.tasks.delete(request.id);
    }
  }

  private async execute(
    request: RpcRequest<Open>,
    task: Task,
  ): Promise<ResultMap[keyof ResultMap]> {
    if (request.method === 'dispose') {
      await this.dispose();
      return null;
    }
    if (request.method === 'open') {
      if (this.archives.size + this.opening >= this.limits.maxArchives)
        throw new RpcError('LIMIT_EXCEEDED', 'Too many open archives');
      this.opening++;
      const job = (async () => {
        const archive = await this.options.open(request.params, {
          isCancelled: () => task.cancelled || this.disposed,
        });
        if (task.cancelled || this.disposed) {
          await archive.close();
          throw new RpcError('ABORTED', 'Open was cancelled');
        }
        const archiveId = `archive:${++this.sequence}`;
        this.archives.set(archiveId, {
          archive,
          tail: Promise.resolve(),
          closing: false,
        });
        this.openRequests.set(request.id, archiveId);
        return { archiveId };
      })();
      this.openingJobs.add(job);
      try {
        return await job;
      } finally {
        this.opening--;
        this.openingJobs.delete(job);
      }
    }
    const slot = this.archives.get(request.params.archiveId);
    if (!slot)
      throw new RpcError(
        'NOT_FOUND',
        'Archive capability does not exist in this session',
      );
    if (slot.closing) throw new RpcError('CLOSED', 'Archive is closing');
    if (request.method === 'close') slot.closing = true;
    const operation = slot.tail.then(async () => {
      // Close/dispose remain cleanup operations even if the caller has stopped waiting.
      if (task.cancelled && request.method !== 'close')
        throw new RpcError('ABORTED', 'Request cancelled');
      switch (request.method) {
        case 'read': {
          const { path, start, end } = request.params;
          const bytes =
            start !== undefined || end !== undefined
              ? await slot.archive.readRange(path, start ?? 0, end)
              : await slot.archive.readFile(path);
          if (!(bytes instanceof Uint8Array))
            throw new RpcError(
              'INVALID_RESULT',
              'Archive returned non-binary data',
            );
          if (bytes.byteLength > this.limits.maxOutputBytes)
            throw new RpcError('LIMIT_EXCEEDED', 'Read exceeds output limit');
          // Never transfer a cache view, pooled Buffer slab or factory-owned backing store.
          return Uint8Array.from(bytes);
        }
        case 'list':
          return slot.archive.listFiles(request.params.pattern);
        case 'toc':
          return slot.archive.getTOC();
        case 'search':
          return slot.archive.search(
            request.params.keyword,
            request.params.options,
          );
        case 'close':
          try {
            await slot.archive.close();
          } finally {
            this.forgetArchive(request.params.archiveId);
          }
          return null;
      }
    });
    slot.tail = operation.catch(() => undefined);
    return operation;
  }

  hasArchive(archiveId: string): boolean {
    return this.archives.has(archiveId);
  }

  private forgetArchive(archiveId: string): void {
    this.archives.delete(archiveId);
    for (const [id, opened] of this.openRequests) {
      if (opened === archiveId) this.openRequests.delete(id);
    }
  }
  private async closeArchive(archiveId: string): Promise<void> {
    const slot = this.archives.get(archiveId);
    if (!slot) return;
    if (slot.closing) {
      await slot.tail;
      return;
    }
    slot.closing = true;
    const close = slot.tail
      .then(() => slot.archive.close())
      .finally(() => this.forgetArchive(archiveId));
    slot.tail = close.catch(() => undefined);
    await close;
  }

  /** Invalidates immediately, drains in-flight archive calls, and closes every handle. */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const closing = [...this.archives.keys()].map(id => this.closeArchive(id));
    this.disposal = (async () => {
      const results = await Promise.allSettled([
        ...closing,
        ...this.openingJobs,
      ]);
      this.archives.clear();
      this.openRequests.clear();
      // Cancelled late opens reject with ABORTED only after closing their adapter.
      const failed = results.find(
        result =>
          result.status === 'rejected' &&
          !(
            result.reason instanceof RpcError &&
            result.reason.code === 'ABORTED'
          ),
      );
      if (failed?.status === 'rejected') throw failed.reason;
    })();
    return this.disposal;
  }
}

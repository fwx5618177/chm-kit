import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { packFiles } from '../../src/encoder/archive-builder';
import { CHMArchive } from '../../src/reader/chm-archive';
import type { ArchiveAdapter } from '../../src/worker';

/** A real structured-clone/transfer boundary, with deterministic response reordering. */
export class CloneEndpoint {
  readonly events = new EventEmitter();
  peer!: CloneEndpoint;
  delay: (message: unknown) => number = () => 0;
  readonly sent: unknown[] = [];
  readonly transferred: ArrayBuffer[] = [];
  readonly terminate = vi.fn();
  failSend = false;
  postMessage(message: unknown, transfer: ArrayBuffer[] = []): void {
    if (this.failSend) throw new Error('transport unavailable');
    const clone = structuredClone(message, { transfer });
    this.sent.push(clone);
    this.transferred.push(...transfer);
    const deliver = (): void => {
      this.peer.events.emit('message', { data: clone });
    };
    const delay = this.delay(clone);
    if (delay) setTimeout(deliver, delay);
    else queueMicrotask(deliver);
  }
  addEventListener(
    type: string,
    listener: (event: { data: unknown }) => void,
  ): void {
    this.events.on(type, listener);
  }
  removeEventListener(
    type: string,
    listener: (event: { data: unknown }) => void,
  ): void {
    this.events.off(type, listener);
  }
}
export function clonePair(): [CloneEndpoint, CloneEndpoint] {
  const a = new CloneEndpoint();
  const b = new CloneEndpoint();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
export function sampleBytes(): Uint8Array {
  return Uint8Array.from(
    packFiles(
      new Map([
        [
          'index.html',
          Buffer.from('<title>Manual</title><p>Hello worker manual</p>'),
        ],
        [
          'private.html',
          Buffer.from('<title>Private</title>classified manual'),
        ],
        ['assets/data.bin', Buffer.from([1, 2, 3, 4, 5])],
      ]),
      { title: 'Manual', defaultTopic: 'index.html', compression: true },
    ),
  );
}
export function adapter(
  bytes = sampleBytes(),
): ArchiveAdapter & { close: ReturnType<typeof vi.fn> } {
  const archive = new CHMArchive(bytes);
  return {
    readFile: path => archive.readFile(path),
    readRange: (path, start, end) => archive.readRange(path, start, end),
    listFiles: pattern => archive.listFiles(pattern),
    getTOC: () => archive.getTOC(),
    search: (keyword, options) => archive.search(keyword, options),
    close: vi.fn(() => archive.close()),
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

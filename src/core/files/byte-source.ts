import { checkedEnd } from '../headers/binary';

export interface SourceCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  maxBytes: number;
}

/** Synchronous, exact random reads. Returned bytes remain valid after later reads. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Buffer;
  /** Check external input validity before returning any higher-level cache hit. */
  validate?(): void;
  close?(): void;
  readonly cache?: {
    clear(): void;
    setLimit(bytes: number): void;
    setReadAhead?(enabled: boolean): void;
    getStats(): SourceCacheStats;
  };
}

export function requireSourceRange(
  source: ByteSource,
  offset: number,
  length: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(source.size) ||
    source.size < 0 ||
    checkedEnd(offset, length, label) > source.size
  )
    throw new Error(`${label}: truncated or out of bounds`);
}

/** A stable view over library-owned memory; this adapter does not copy input. */
export class MemoryByteSource implements ByteSource {
  constructor(private readonly buffer: Buffer) {}

  get size(): number {
    return this.buffer.length;
  }

  read(offset: number, length: number): Buffer {
    requireSourceRange(this, offset, length, 'CHM source');
    return this.buffer.subarray(offset, offset + length);
  }
}

export function asByteSource(
  input: ByteSource | { buffer: Buffer },
): ByteSource {
  return 'read' in input && 'size' in input
    ? input
    : new MemoryByteSource(input.buffer);
}

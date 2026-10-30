export interface DrainOptions {
  maxChunk?: number;
  timeoutMs?: number;
  onChunk?: (chunk: Uint8Array, offset: number) => void;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Harness stream deadline exceeded')),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function drainStream(
  stream: ReadableStream<Uint8Array>,
  expectedLength: number,
  { maxChunk = 64 * 1024, timeoutMs = 5000, onChunk }: DrainOptions = {},
): Promise<number> {
  for (const limit of [expectedLength, maxChunk, timeoutMs]) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error('Invalid harness stream budget');
  }
  if (!maxChunk || !timeoutMs) throw new Error('Zero harness stream budget');
  const deadline = performance.now() + timeoutMs;
  const reader = stream.getReader();
  let offset = 0;
  try {
    // Positive chunks imply at most one pull per byte, plus a final EOF pull.
    for (let pulls = 0; pulls <= expectedLength; pulls++) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('Harness stream deadline exceeded');
      const { value, done } = await withTimeout(reader.read(), remaining);
      if (done) {
        if (offset !== expectedLength)
          throw new Error(`Short stream: ${offset}/${expectedLength}`);
        return offset;
      }
      if (!value.length || value.length > maxChunk)
        throw new Error(`Invalid stream chunk length: ${value.length}`);
      if (offset + value.length > expectedLength)
        throw new Error('Stream exceeded oracle byte budget');
      onChunk?.(value, offset);
      offset += value.length;
    }
    throw new Error('Stream exceeded pull budget');
  } finally {
    try {
      await withTimeout(reader.cancel(), Math.min(1000, timeoutMs));
    } finally {
      reader.releaseLock();
    }
  }
}

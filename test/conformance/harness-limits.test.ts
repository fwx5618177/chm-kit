import { expect, test } from 'vitest';
import { drainStream } from './bounded-stream';

function chunks(values: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });
}

test('stream harness accepts exact EOF and rejects empty, short, oversized and excess output', async () => {
  expect(await drainStream(chunks([]), 0)).toBe(0);
  expect(
    await drainStream(chunks([Uint8Array.of(1), Uint8Array.of(2)]), 2),
  ).toBe(2);
  await expect(drainStream(chunks([new Uint8Array(0)]), 1)).rejects.toThrow(
    /chunk/,
  );
  await expect(drainStream(chunks([]), 1)).rejects.toThrow(/Short/);
  await expect(drainStream(chunks([new Uint8Array(3)]), 2)).rejects.toThrow(
    /budget/,
  );
  await expect(
    drainStream(chunks([new Uint8Array(3)]), 3, { maxChunk: 2 }),
  ).rejects.toThrow(/chunk/);
  await expect(drainStream(chunks([]), Infinity)).rejects.toThrow(/budget/);
});

test('stalled asynchronous stream and cancellation fail within fixed deadlines', async () => {
  const stalled = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise(() => {});
    },
  });
  await expect(drainStream(stalled, 1, { timeoutMs: 25 })).rejects.toThrow(
    /deadline/,
  );
  const stalledCancel = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(0));
    },
    cancel() {
      return new Promise(() => {});
    },
  });
  await expect(
    drainStream(stalledCancel, 1, { timeoutMs: 25 }),
  ).rejects.toThrow(/deadline/);
}, 2000);

import { createWorkerClient } from '../../dist/browser/worker.mjs';

export function createReaderWorker(options = {}) {
  return createWorkerClient(
    new Worker(new URL('./reader.worker.js', import.meta.url), {
      type: 'module',
    }),
    { terminateOnDispose: true, ...options },
  );
}

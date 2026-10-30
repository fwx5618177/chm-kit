// An asynchronous factory demonstrates timeout/cancellation cleanup in the native browser tests.
import { CHMReader } from '../../dist/browser/index.mjs';
import { serveWorker } from '../../dist/browser/worker.mjs';

serveWorker(
  self,
  async (bytes, options) => {
    await new Promise(resolve => setTimeout(resolve, 50));
    return new CHMReader(bytes, options);
  },
  { limits: { maxArchives: 1 } },
);

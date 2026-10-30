import { CHMReader } from '../../dist/browser/index.mjs';
import { serveWorker } from '../../dist/browser/worker.mjs';

// A real library host, with no application-owned message format or request bookkeeping.
serveWorker(self, (bytes, options) => new CHMReader(bytes, options));

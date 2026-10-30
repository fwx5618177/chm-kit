// Real module Worker entry: keep the filesystem-free browser reader in this realm.
import { CHMReader } from '../../dist/browser/index.mjs';
import { createWorkerArchiveHost } from '../../dist/browser/worker.mjs';

createWorkerArchiveHost(
  self,
  (bytes, options) => new CHMReader(bytes, options),
  {
    limits: {
      maxInputBytes: 64 * 1024 * 1024,
      maxOutputBytes: 16 * 1024 * 1024,
    },
  },
);

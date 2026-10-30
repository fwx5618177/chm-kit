# Reusable module Worker integration

The library entry is `src/worker/index.ts`. This example is a **real browser module Worker entry**, not an inline message-protocol sketch. After the shared build/export integration provides `dist/browser/worker.mjs`, run `pnpm build` from the repository root, serve the repository over HTTP, and open `/examples/worker/`. For example, manually start `python3 -m http.server 8080 --bind 127.0.0.1`; stop it with Ctrl+C. `file:` URLs do not work for module Workers.

`reader.worker.js` imports the browser reader and installs `createWorkerArchiveHost(self, factory)`. `main.js` constructs a native `Worker` and `WorkerArchiveClient`. Neither application file builds protocol messages. With a bundler the equivalent is:

```ts
// app.ts
import { WorkerArchiveClient } from 'chmkit/worker';
const client = new WorkerArchiveClient(
  new Worker(new URL('./reader.worker.ts', import.meta.url), {
    type: 'module',
  }),
  { terminateOnDispose: true },
);
const controller = new AbortController();
const archive = await client.open(await file.arrayBuffer(), {
  transferInput: true,
  readerOptions: { maxFileSize: 16 * 1024 * 1024 },
  signal: controller.signal,
  timeoutMs: 10000,
});
try {
  const [files, toc] = await Promise.all([archive.list(), archive.toc()]);
  console.log(toc, await archive.search('manual', { maxResults: 5 }));
  if (files[0])
    console.log(await archive.read(files[0], { transferResult: true }));
} finally {
  try {
    await archive.close();
  } finally {
    await client.dispose();
  }
}
```

```ts
// reader.worker.ts
import { CHMReader } from 'chmkit/browser';
import { createWorkerArchiveHost } from 'chmkit/worker';
createWorkerArchiveHost(
  self,
  (bytes, options) => new CHMReader(bytes, options),
);
```

## Ownership, lifetime and limits

- One client per dedicated Worker host. A client can own multiple archive handles. Other transports can implement the structural endpoint interfaces; public types do not mention DOM Worker, Buffer or Node streams.
- `open()` accepts bytes/ArrayBuffer, not a path, URL or Blob. For a `File`, call `file.arrayBuffer()` yourself. Input is copied by default. `transferInput: true` transfers and detaches the **entire backing ArrayBuffer**, including all sibling views. Do not opt in for buffers you do not exclusively own. SharedArrayBuffer is rejected. An oversized backing buffer is rejected before transfer even for a small view.
- `read()` and strict half-open `readRange(path, start, end?)` return `Uint8Array`. A transferred response always owns a new allocation; a factory cache view or Node Buffer slab is never detached. Transfer is opt-in per request. Errors cross as `{ name, message, code }`, never stack/cause/custom properties.
- IDs correlate concurrent requests and out-of-order replies. Calls on one archive execute in arrival order, so `close()` drains prior operations. Different archives and asynchronous opens can progress independently.
- `signal` and `timeoutMs` settle the local promise and send best-effort cancellation. Late opens are closed, including opens whose reply arrived too late. **Synchronous parsing/decompression/search cannot be interrupted mid-call.** To forcibly interrupt CPU work, terminate the owned Worker; its realm/resources are then destroyed. Do not advertise cooperative cancellation as CPU preemption.
- `dispose()` immediately rejects pending callers, drains/cleans host archives (including late asynchronous factories), detaches listeners, and optionally terminates the owned Worker. Explicit host disposal also notifies the client; host-side deserialization failure sends a fatal transport error before cleanup. External `worker.terminate()` does not emit a portable close event; always dispose the client yourself. Worker `error`/`messageerror`, invalid responses and send failures reject all pending callers and attempt host cleanup.
- Defaults: input 128 MiB, output 64 MiB, string 8192 UTF-16 code units, 128 pending calls, 8 open archives, 100000 structured entries and a fixed maximum output depth of 64. `limits` can be set independently on client and host; host limits are authoritative. Collection/string accounting is conservative, not an exact structured-clone byte measurement.
- Limits bound protocol payloads, **not total process memory or CPU**. The browser clones incoming messages before the host can validate them. Configure reader `maxFileSize`/cache limits in a trusted factory for your workload. For asynchronous factories, `context.isCancelled()` can avoid wasted work; factories must eventually settle for graceful disposal to complete.
- This demo displays only text metadata and byte counts. CHM HTML is untrusted: do not insert it into the host DOM. A viewer needs a sandbox without scripts/same-origin, restrictive CSP, and validated resource/navigation rewriting.

## Validation

```sh
pnpm exec vitest run --project node test/worker test/electron
pnpm exec tsx test/worker/module-worker.integration.ts
```

Vitest covers structured-clone roundtrips, transferred ownership, invalid/oversized payloads, errors, cleanup, cancellation/timeouts, IPC capability restrictions and emitted declarations consumed with **ES2020 only** (no DOM/Node/Electron types). Separate DOM/WebWorker consumers verify native Worker and worker-global assignability.

The opt-in integration command requires an installed Playwright Chromium runtime. It bundles source entries **in memory**, serves the actual example files on an ephemeral loopback port, runs a real browser module Worker for CHM open/list/read/TOC/search, malformed archives, disposal and a native Worker error, then shuts down browser/server. It does not write shared build artifacts and is not evidence that package export wiring works. Only Chromium is selected by this check; it does not claim Firefox/WebKit execution.

## Maintainer build handoff

Add a `chmkit/worker` subpath for `src/worker/index.ts`, CJS/ESM artifacts and a filesystem-free `dist/browser/worker.mjs`, plus `.d.mts`/`.d.cts` declarations (and browser-compatible types). The Worker entry itself has no runtime reader dependency: the host factory imports `chmkit/browser` explicitly, preserving the existing Buffer adapter injection boundary. No auto-starting Worker should be exported as a side effect. Source-only tests do not establish packaged-subpath correctness; run consumer/package checks after the shared build wiring lands.

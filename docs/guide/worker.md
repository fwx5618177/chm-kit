# Browser module Worker integration

[Documentation](../index.md) · [Browser](browser.md) · [Complete example](../../examples/worker/)

`chmkit/worker` provides `WorkerArchiveClient` and `createWorkerArchiveHost`.
It does not auto-create a Worker or decide where your worker script is hosted.
Use one client per dedicated host; multiple archive handles may share that client.
The host receives an explicit reader factory, keeping Node filesystem code out
of the browser dependency graph.

## Application and worker entry

With `chmkit` installed in your existing browser application:

```ts
// reader.worker.ts — your application's module Worker entry
import { CHMReader } from 'chmkit/browser';
import { createWorkerArchiveHost } from 'chmkit/worker';

createWorkerArchiveHost(
  self,
  (bytes, options) => new CHMReader(bytes, options),
  {
    limits: {
      maxInputBytes: 32 * 1024 * 1024,
      maxOutputBytes: 8 * 1024 * 1024,
    },
  },
);
```

```ts
// application.ts — pass a File selected by your file input
import { WorkerArchiveClient } from 'chmkit/worker';

async function inspect(file: File) {
  const worker = new Worker(new URL('./reader.worker.ts', import.meta.url), {
    type: 'module',
  });
  const client = new WorkerArchiveClient(worker, { terminateOnDispose: true });
  try {
    const input = await file.arrayBuffer();
    const archive = await client.open(input, {
      transferInput: true,
      readerOptions: {
        maxFileSize: 8 * 1024 * 1024,
        maxCacheBytes: 2 * 1024 * 1024,
      },
      timeoutMs: 10000,
    });
    try {
      const files = await archive.list();
      console.log(await archive.toc());
      console.log(await archive.search('installation', { maxResults: 5 }));
      if (files[0])
        console.log(await archive.read(files[0], { transferResult: true }));
    } finally {
      await archive.close();
    }
  } finally {
    await client.dispose();
  }
}
```

Call `inspect(file)` from your application. This uses the application's bundler
for its worker entry, not a CHMKit source build. With the browser archive and no
bundler, use `.js` module entries and relative imports to
`dist/browser/worker.mjs` and `dist/browser/index.mjs`; preserve chunks and host
over HTTP(S). The browser archive also carries `dist/viewer/reader.worker.js`
and `worker-client.js` for integration. The standalone viewer's classic-script
`file:` support does **not** make module Workers work from disk.
[The example](../../examples/worker/) includes the complete HTML, main script,
Worker script, display and cleanup wiring.

## API differences from the local reader

The remote handle exposes **asynchronous** `list`, `read`, `readRange`, `toc`,
`search` and `close`. It is not every method on `CHMReader`: there is no remote
WHATWG stream, packer or arbitrary method-dispatch bridge. `readRange()` retains
strict `[start, end)` byte bounds. Values crossing the boundary use `Uint8Array`
and structured data, not Node Buffer, class instances or filesystem handles.

Request IDs correlate concurrent/out-of-order responses. Operations for a single
archive run in arrival order; close drains prior work. Different archives and
asynchronous factories may progress independently.

`client.open(..., { readerOptions })` accepts `maxCacheBytes`, `maxFileSize`,
`cacheStrategy`, `defaultEncoding`, `readAhead` and `adaptivePreload`. Both client
and host strictly validate keys and nested prediction bounds (`maxFiles: 1..32`,
positive safe-integer `maxBytes`). The trusted host factory may further restrict
these options. `readAhead` applies only to file-backed inputs, so it has no effect
on the usual in-memory browser Worker reader. Adaptive preload remains opt-in.
The remote handle does not expose `getPreloadError()` or cache-management methods;
host-enabled prediction therefore needs host-side diagnostics and cleanup.

## Transfers, cancellation and ownership

- Input is copied by default. `transferInput: true` detaches the **entire backing
  ArrayBuffer**, including sibling views. Use it only for exclusively owned data.
  SharedArrayBuffer is rejected; an oversized backing buffer is refused even
  when the selected view is small.
- `transferResult: true` transfers a newly owned response allocation, not host
  cache storage or a Buffer slab. It does not mean every reader allocation is
  zero-copy.
- `signal`/`timeoutMs` settle the local promise and send best-effort cancellation.
  Default timeout is 30 seconds; `0` disables it. Late asynchronous opens are
  cleaned up. Synchronous parsing/search/decompression **cannot be interrupted
  mid-call** by a queued cancel message. Terminate an owned Worker for forced CPU
  interruption; arrange client cleanup as well.
- `dispose()` rejects local pending calls, requests/drains remote cleanup and
  removes listeners. `terminateOnDispose` is opt-in because not every client owns
  its endpoint. An externally terminated Worker emits no portable close event;
  do not rely on it to settle all client promises.
- Async factories must eventually settle for graceful disposal to complete.
  `context.isCancelled()` can let a cooperative factory avoid wasted work.

## Limits and failure handling

Defaults are 128 MiB input, 64 MiB output, 8192 UTF-16 string code units,
128 pending requests, 8 open archives and 100000 structured entries, with a fixed
output depth bound. Client and host limits can differ; host policy is authoritative.
Use a trusted factory to enforce reader budgets rather than accepting arbitrary
client policy in a hostile service.

Errors cross as `{ name, message, code }`, without stack/cause/custom properties.
Transport failures/invalid responses reject pending calls and attempt cleanup.
An already broken transport cannot guarantee graceful remote disposal.

Protocol limits apply **after transport cloning** and are conservative payload
limits, not total memory or CPU caps. Use worker/process isolation and application
quotas for adversarial workloads. The Worker moves browser parser CPU off the UI
thread; it does not make untrusted HTML safe to render or eliminate network privacy
risks. See [SECURITY.md](../../SECURITY.md) and [validation evidence](../../VALIDATION.md).

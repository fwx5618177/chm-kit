# Node.js readers and services

[Documentation](../index.md) · [API](../api.md) · [Configuration](configuration.md)

Install the [prebuilt tarball](downloads.md); no library build is needed.
Use named ESM imports from `chmkit`, or CommonJS `require('chmkit')`.
`chmkit/reader` is the focused Node reader entry.

## Choose input ownership deliberately

```ts
import { CHMArchive, CHMReader, CHMKit } from 'chmkit';

const disk = await CHMReader.open('manual.chm', {
  maxCacheBytes: 4 * 1024 * 1024,
  maxFileSize: 8 * 1024 * 1024,
});
try {
  console.log(disk.listFiles(), disk.getIOStats());
} finally {
  disk.close();
}

const memory = new CHMArchive(new Uint8Array(archiveBytes));
try {
  console.log(memory.getMetadata());
} finally {
  memory.close();
}
// Equivalent owned-memory facade: CHMKit.from(archiveBytes).
```

`archiveBytes` above is your existing byte input. Memory construction copies it;
Node filesystem opening instead holds one descriptor and uses synchronous,
positioned reads plus bounded read-ahead. Directory metadata is still parsed
at open. `getIOStats()` reports physical read calls/bytes including initialization;
it is `null` for a memory-constructed `CHMReader`. `getFilePath()` is the original
open argument, not a canonicalized security identity.

**Keep the underlying file immutable while its descriptor is alive.** A stable
path is insufficient if another process truncates or overwrites the same file.
For uploads, stage a private immutable file with size/quota checks first. Do not
replace an open archive in place. `close()` is explicit and idempotent; parsing
failure closes the acquired source. Finish or cancel streams before closing.
The file source checks descriptor identity, size and timestamps at read boundaries,
including cached reads, and closes/refuses detected mutations. These checks are
not a file lock or a race-free snapshot; immutability is still your responsibility.
Timestamp granularity varies by filesystem: a same-size rewrite that leaves all
observed metadata unchanged cannot be detected by these checks. Do not rely on
them to secure a file that another process can modify.

Only descriptor acquisition is asynchronous. Parsing, source reads, search and
decoding run synchronously on the calling thread, including stream pulls. An
`await` on a synchronous method does not move work off the event loop. Use an
application-owned worker thread/process for heavy or hostile workloads; the
browser Worker adapter is not a turnkey Node filesystem worker service.

## Read and stream

```ts
import { CHMReader } from 'chmkit';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const reader = await CHMReader.open('manual.chm', { maxFileSize: 1024 * 1024 });
try {
  const path = reader.listFiles()[0];
  if (path) {
    const end = Math.min(256, reader.getFileSize(path));
    const prefix = reader.readRange(path, 0, end); // Buffer; strict [0, end)
    console.log(prefix.length);
    // Adapt DOM/Node declarations for the same WHATWG stream at runtime.
    const stream = reader.createReadStream(path);
    await pipeline(
      Readable.fromWeb(stream as NodeReadableStream<Uint8Array>),
      createWriteStream('selected-file.bin', { flags: 'wx' }),
    );
  }
} finally {
  reader.close();
}
```

The stream is WHATWG `ReadableStream<Uint8Array>`, not a Node `Readable`. Node's
and DOM's TypeScript stream declarations can differ: use your project's
`node:stream/web` type when adapting them; do not change runtime stream behavior
merely to satisfy duplicate ambient types.

`readRange(path, start, end?)` materializes only the requested interval, subject
to the single-read budget. `createReadStream(path, start, end?)` can consume a file
larger than that budget in bounded chunks (at most 64 KiB, also bounded by
`maxFileSize`). Ranges are strict byte offsets, never clamped. Decoding can require
history from a preceding LZX reset. One sequential stream retains decoder state;
repeated independent ranges may repeat that prefix work. Collecting all chunks
into an array or `Response(...).arrayBuffer()` materializes the entire result.

`readText`, `readHTML`, `readJSON`, `readMultiple` and `readWithMetadata` are
materializing APIs. A caller accumulating multiple results owns those allocations;
`maxCacheBytes` is not a cap on them. `readHTML()` detects HTML charset but does
not sanitize markup. See [configuration and resource accounting](configuration.md).

## Optional adjacent-file preloading

Leave prediction off for purely random access or if you need to avoid speculative
CPU/I/O. Opt in only with explicit budgets:

```ts
import { CHMReader } from 'chmkit';
import { setTimeout as delay } from 'node:timers/promises';

const reader = await CHMReader.open('manual.chm', {
  maxCacheBytes: 4 * 1024 * 1024,
  maxFileSize: 1024 * 1024,
  readAhead: false,
  adaptivePreload: { maxFiles: 2, maxBytes: 256 * 1024 },
});
try {
  // In an application these full reads would usually follow user navigation.
  const paths = reader.listFiles().sort().slice(0, 3);
  for (const path of paths) console.log(reader.readFile(path).length);
  await delay(10); // yield; this is not a completion API or timing guarantee
  const failure = reader.getPreloadError();
  if (failure) throw failure;
  console.log(reader.getCacheStats());
} finally {
  reader.close(); // cancels queued speculative work and releases the descriptor
}
```

Three adjacent full-file reads establish the forward sequence; range/stream
reads do not. Speculation considers following public files in name order, skips
unaffordable candidates and uses available cache headroom without evicting files.
`maxBytes` accounts conservatively for reconstruction/input cost, including LZX
history, rather than only output lengths. No particular candidate is guaranteed
to be cached. Timers perform synchronous work on this thread, not in a worker.

`readAhead: false` above disables only the Node source's synchronous sequential
window expansion; adaptive whole-file warmup remains separately enabled.
`preload(paths)` is a third, explicit synchronous warmup method. `clearCache()`,
`close()` and `setCacheStrategy('none')` cancel prediction. A background failure
closes the archive, is available through `getPreloadError()`, and is rethrown by
later data calls. See [configuration](configuration.md#three-different-forms-of-warmup)
for exact limits and default-off behavior.

## Navigation, search and metadata

- `listFiles()` lists public files; explicit internal reads are possible in the
  local API. Do not expose that unrestricted ability directly to an untrusted client.
- `getTOC()` and `getIndex()` parse `.hhc`/`.hhk`; `getMetadata()` reads `#SYSTEM`.
  `getDefaultPage()` and navigation targets can include query/fragment suffixes.
- Read methods accept **raw archive paths**, not navigation URLs. Use listed
  paths for reads. A literal `#` in a filename is different from a URL fragment;
  do not implement navigation by blindly splitting or decoding arbitrary names.
- `search()` scans eligible text files; `searchInFile()` gives UTF-16 offsets,
  line/column and context. `fuzzySearch()` is filename subsequence matching,
  not typo-tolerant full-text ranking. Search is synchronous and not indexed.
- Per-file compressed byte size/ratio is `null` when the file shares an LZX
  stream; `compressedSizeExact` and `compressionNote` explain why.
- `exists()` returns false for a missing archive path, not for corruption,
  permissions errors or a closed archive.

## Complete read-only Node service

This **JavaScript ESM** example is intentionally text-only. Save it as an
application `.mjs` file after installing the tarball, and run it with
`node server.mjs /absolute/path/to/immutable-manual.chm`. The archive path is a
trusted startup argument, never a request parameter. Use a valid small manual;
this service rejects an oversized listing. No HTML is served as executable markup.

```js
import { createServer } from 'node:http';
import { CHMReader } from 'chmkit';

if (process.argv.length !== 3)
  throw new Error('Expected one trusted archive path');
const reader = await CHMReader.open(process.argv[2], {
  maxFileSize: 1024 * 1024,
  maxCacheBytes: 4 * 1024 * 1024,
});
let files;
try {
  files = reader.listFiles();
  if (files.length > 1000)
    throw new Error('Example service listing limit exceeded');
} catch (error) {
  reader.close();
  throw error;
}
const allowed = new Set(files);
const server = createServer((request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.method !== 'GET' || (request.url?.length ?? 0) > 4096) {
      response.writeHead(400).end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/files') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(files));
      return;
    }
    const path = url.searchParams.get('path');
    if (url.pathname !== '/text' || !path || !allowed.has(path)) {
      response.writeHead(404).end();
      return;
    }
    const mime = reader.getMimeType(path);
    if (
      !mime.startsWith('text/') &&
      !['application/json', 'application/xml'].includes(mime)
    ) {
      response.writeHead(415).end();
      return;
    }
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(reader.readText(path));
  } catch (error) {
    console.error('Archive request failed', error);
    response.writeHead(500).end('Archive operation failed');
  }
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => reader.close());
}
server.on('error', error => {
  console.error(error);
  reader.close();
  process.exitCode = 1;
});
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
server.listen(8080, '127.0.0.1');
```

Open `/files`, then use `/text?path=` with a URL-encoded **listed path**.
The server has no upload route, authentication, rate limiting, range negotiation
or CPU isolation. Keep it on loopback; a public deployment needs those policies,
request/connection deadlines, OS memory/CPU quotas and worker/process isolation.
Even loopback HTTP should not expose sensitive archives without an application
access policy. Do not generalize this example into arbitrary-path HTTP access.

## One-shot operations and extraction

`CHMKit.readFile/listFiles/readText/readHTML/getTOC/getIndex/searchContent` manage
reader lifetime for one call. `CHMKit.extract()` returns successful files and
errors; inspect the errors even if the promise resolves. For cancellation/progress
use `ExtractorOperations.extract()` and its `ExtractOptions`/`ExtractResult` types.
Directory extraction uses positioned file-backed input too: it does not first
copy the whole archive into memory. Keep the input immutable until completion.
The extractor closes its descriptor on success, error or cancellation. Input and
decompression remain synchronous, with bounded asynchronous writes; concurrency
does not mean multicore decoding. Directory metadata, per-generator decoder
workspace and output chunks still consume memory, so this is not a constant-total-
RAM guarantee.

Extraction is not transactional, does not overwrite existing files and cannot
eliminate hostile local TOCTOU races. Use a fresh private destination. See the
[CLI extraction contract](cli.md#extract-one-or-many-archives) and [security policy](../../SECURITY.md).

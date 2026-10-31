# Configuration and resource budgets

[Documentation](../index.md) · [CLI](cli.md) · [Node](node.md) · [Security](../../SECURITY.md)

Configuration loading, configuration validation and operation behavior are
separate concepts. A field being accepted does **not** make it a working global
control. Prefer explicit `ReaderOptions`, `PackFilesOptions` and `ExtractOptions`
when integrating the library; reader/packer APIs do not automatically read a
configuration file.

## CLI configuration that actually applies

The CLI loads `./chmkit.config.json` from its current working directory, or the
exact path supplied by `chmkit --config ./settings.json <command> ...`.
It loads once per invocation before the action, not during imports or help/version.
An explicit missing path or malformed configuration fails; ordinary CLI loading
is strict. CLI flags override the connected defaults below.

```json
{
  "cli": {
    "defaultOutputDir": "./extracted-new",
    "defaultOutputFile": "./manual-new.chm",
    "maxConcurrency": 2,
    "showProgress": true
  },
  "performance": {
    "chunkSize": 32768,
    "maxFileSize": 16777216
  },
  "lzx": {
    "windowSize": 65536,
    "resetInterval": 131072,
    "compressionLevel": 6
  }
}
```

| Connected field           | Consumed by                                               | Explicit override             |
| ------------------------- | --------------------------------------------------------- | ----------------------------- |
| `cli.defaultOutputDir`    | extract, batch                                            | `--output`                    |
| `cli.defaultOutputFile`   | pack                                                      | `--output`                    |
| `cli.maxConcurrency`      | extract, batch, per-archive asynchronous file I/O         | `--concurrency`               |
| `cli.showProgress`        | extract/batch progress default, only when stderr is a TTY | `--progress`, `--no-progress` |
| `performance.chunkSize`   | extract/batch write chunks                                | `--chunk-size`                |
| `performance.maxFileSize` | read/search/preview/browse materialization budget         | `--max-read-size`             |
| `lzx.windowSize`          | pack; bytes converted to `windowBits`                     | `--window-bits`               |
| `lzx.resetInterval`       | pack                                                      | `--reset-interval`            |
| `lzx.compressionLevel`    | pack                                                      | `--compression-level`         |

`blockSize` is an explicit pack flag/API option, not a recognized `lzx` config
field. Do not confuse `performance.chunkSize` with encoder block or CHM frame size.

### Removed fields

Only the fields in the table above are configuration. Earlier releases accepted
other sections (`default.*`, `format.*`, `validation.*`, `cli.defaultTempDir`,
`cli.colorOutput`, `performance.bufferSize`, `performance.compressionThreshold`)
without applying them. They have been removed rather than kept as inert
compatibility fields. A file containing them still loads: each removed key is
reported as `Unknown config key '<path>' will be ignored` on stderr and omitted
from the result. `maxMemory` is not a RAM cap, and `validateChecksums: true` is
not a CHM checksum feature. Header and range safety checks in the parser are
mandatory. Use the explicit operation options (such as writer verification) for
those behaviors.

Unknown keys warn and are omitted. Unsafe prototype keys and invalid types are
rejected. LZX window/reset values must also meet encoder constraints. Any invalid
field rejects the whole file.

## Programmatic configuration

`chmkit/config` exports `loadConfig`, `getConfig`, `resetConfigCache` and section
getters/defaults. `loadConfig({ configPath, strict: true })` returns a merged
configuration; it does not set reader/encoder options or mutate all operations.
Without a path, default search is the current working directory (not recursive
parent traversal). `searchPaths`/`configFileName` let applications choose their
own search. `getConfig(true)` reloads its cached configuration.

Non-strict file parsing errors can log and fall back to defaults; use strict
loading when a failure must stop your application. Defaults and merged nested
values are independently copied, so mutating a returned configuration does not
change later loads. JSON configuration is data, not executable JavaScript.

## Reader budgets: what is and is not bounded

| Option / limit                                | Meaning                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `maxCacheBytes` (default 8 MiB)               | Combined managed file, reconstructed-block and Node source read-ahead cache budget     |
| `maxFileSize` (default 256 MiB in reader API) | Maximum output materialized by one read, including a requested range                   |
| `cacheStrategy: 'none'` or `'lru'`            | Disable managed caches or use bounded LRU; enum-like `CacheStrategy` names also work   |
| `defaultEncoding`                             | Text fallback when explicit encoding/BOM/HTML charset/metadata are insufficient        |
| `readAhead` (default true)                    | Node file source's synchronous sequential window expansion, not a background task      |
| `adaptivePreload` (absent by default)         | Opt-in scheduled adjacent-file warmup; `{ maxFiles, maxBytes }` limits each prediction |
| Stream chunks                                 | At most 64 KiB and no larger than the reader's positive materialization budget         |

The CLI config's default `performance.maxFileSize` is separate from the direct
reader default; choose explicit budgets if consistent behavior matters.
`maxFileSize: 0` rejects nonempty reads/streams; it is not an unlimited sentinel.
Zero cache budget disables managed storage, not decoder workspace.

The cache excludes directory metadata, path indexes, LZX dictionary/workspace,
input memory copies, caller-owned results, text strings, RPC clones and runtime
allocation/GC overhead. Node file input avoids retaining the whole archive but
still parses metadata and performs synchronous physical reads. Browser/owned-memory
input retains the whole archive. `getCacheStats()` separates files/blocks/source;
`getIOStats()` on Node distinguishes physical I/O from cache activity.

Structural metadata has separate fixed safety ceilings, checked before reads:
`CHMParser.MAX_HEADER_BYTES` is 1 MiB, `MAX_DIRECTORY_BYTES` is 64 MiB, and
`MAX_METADATA_STREAM_BYTES` is 16 MiB per ControlData/ResetTable stream. A valid
but larger structure is rejected; there is no unlimited bypass. These limits do
not cap compressed Content or ordinary file size, nor do they bound the entire
JavaScript object graph or process RAM.

Streams reuse decoding state but can require prefix history from the previous
reset. Concurrent readers, streams and RPC sessions multiply non-cache workspace.
Set application quotas, not just per-reader caches.

### Three different forms of warmup

- **`preload(paths)`** synchronously reads the files you explicitly choose. It is
  not itself a predictive scheduler or memory pool.
- **`readAhead`** controls the Node file source's synchronous sequential input
  window expansion. `false` disables speculative expansion, not all source
  caching and not the separate adaptive preloader. It does nothing for memory
  input. `cacheStrategy: 'none'` disables the source window entirely.
- **`adaptivePreload: { maxFiles, maxBytes }`** enables adjacent public-file
  prediction in the local reader. It is **off by default**. `maxFiles` must be
  an integer from 1 to 32; `maxBytes` a positive safe integer. Three adjacent
  forward full-file reads (two consecutive transitions in name-sorted public
  file order) trigger consideration of following files. `readRange` and stream
  consumption do not train it.

Predicted files run one per `setTimeout(..., 0)` callback. Input/decode work
inside each callback remains synchronous on the same thread: this is neither
multicore decoding nor asynchronous filesystem I/O. Applications must yield to
the event loop for timers to run. The cumulative `maxBytes` budget conservatively
counts LZX history/reset reconstruction and compressed input spans, not just
file lengths, and is bounded by available file-cache headroom. It does not
promise a cache hit, bounded total RAM or a hard wall-clock limit. Empty, cached,
oversized or unaffordable candidates are skipped; speculation does not evict
cached files to make room.

`close()` and `clearCache()` cancel the timer/queue and reset sequence tracking.
Switching to `cacheStrategy: 'none'` also cancels prediction. A background failure
closes the archive; `getPreloadError()` retains its diagnostic even after close,
and subsequent data operations rethrow the failure rather than hiding it or
throwing an unhandled timer exception. See the [Node example](node.md#optional-adjacent-file-preloading).

These are explicit reader options, not connected CLI configuration fields.
The [Worker RPC options](worker.md#api-differences-from-the-local-reader) validate
these reader options at both endpoints. Host factories can impose stricter policy.

Directory-tree expansion is separately bounded: depth 1024, 100000 inferred
directories and 8 Mi UTF-16 path characters. `listFiles()` can still be useful
when `getFileTree()` refuses expansion. Generated TOC limits are separate again.

## Extraction, RPC and hostile workloads

Extraction also uses file-backed positioned input, not a whole-archive memory
copy. Keep the underlying file immutable until extraction finishes. Input and
decompression are synchronous; bounded asynchronous output concurrency does not
provide parallel CPU or a total RSS cap. Each output generator owns decoder
state/workspace and chunks; directory metadata and runtime overhead also remain.
Ctrl-C/AbortSignal stops scheduling and cleans up cooperatively, not in the
middle of synchronous decompression.

Worker/Electron RPC have independent payload/pending/archive limits. Validation
occurs after transport cloning, so these are not hard process-memory limits.
Client timeouts settle promises; they do not preempt synchronous parser work.
See [Worker](worker.md) and [Electron](electron.md).

For untrusted uploads, impose input/file-count/uncompressed-output quotas,
wall-clock deadlines and OS-level CPU/memory constraints in isolated workers or
processes. A V8 old-space cap alone does not bound Buffer/external memory or RSS.
Bounded fuzzing tests are regression evidence, not proof that arbitrary hostile
input cannot exhaust resources.

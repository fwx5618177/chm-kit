# Migration to the expanded API

[Documentation](../index.md) · [Changelog](../../CHANGELOG.md) · [API](../api.md)

This guide describes behavior changes in the expanded working-tree API. It does
not imply an npm release: the public `chmkit` registry endpoint currently returns
404; publication requires separate authorization. Use a matching [prebuilt tarball/artifact](downloads.md), and check its actual
version/exports rather than assuming an older download contains new subpaths.
The current source package version is 1.1.0; this is not a claim that a 1.1.0
GitHub Release exists. Library/CLI versions must match the downloaded manifest.

## Current viewer and parser compatibility

The current browser archive adds `dist/viewer/index.html` and a bundled classic
IIFE. Extract `chmkit-1.1.0-browser.tar.gz` and open that entry directly as `file:`;
no Node/npm/server/build is needed for ordinary viewing. Library ESM and module
Worker integrations still need HTTP(S). The linked historical `45a5b5f` snapshot
also says 1.1.0 but predates the viewer: check source identity/inventory, not just
the version. New-revision hosted downloads remain pending.

The unchanged official FPC 3.2.2 `fpdoc` archive now reads with narrowly validated
v3 GUID, directory quickref/leaf-hint and terminal ResetTable compatibility.
Terminal offsets are consumed and validated but are not exposed as empty frames;
`ResetTable.blockCount` and `entries` continue to describe real data frames.
Malformed counts, mixed quickrefs and invalid Content boundaries remain errors.
See [format details](format-lzx.md#strict-fpc-producer-compatibility).

## Node paths are file-backed, not snapshots

Previously opening a Node path read the archive into owned memory. The file-backed
reader now keeps an open descriptor and performs positioned **synchronous I/O**.
`open()` still returns a promise; methods and decompression remain synchronous.

```ts
const reader = await CHMReader.open(path, options);
try {
  // Read or fully consume/cancel streams here.
} finally {
  reader.close(); // now also releases the file descriptor
}
```

Do not mutate/truncate/overwrite the backing file before close. A path rename
alone is not the same as immutable file content. Code that assumed opening took
a permanent input snapshot should explicitly read bytes and use
`CHMKit.from(bytes)` / `new CHMArchive(bytes)` instead, accepting the memory cost.
Do not close immediately after returning a stream to another caller.

Cache statistics now distinguish source read-ahead, reconstructed blocks and
files. `maxCacheBytes` is their shared managed budget, not RSS. `getIOStats()`
measures physical I/O. Output/input/metadata budgets remain separate. Descriptor
identity/size/timestamp checks reject detected mutations, but are not a lock or
an immutable snapshot.

### Warmup is explicit or opt-in

`readAhead` is the Node source's synchronous sequential window expansion, enabled
by default. Setting it to false does not disable all source caching.
`preload(paths)` is explicit synchronous file warming. Neither is the new optional
`adaptivePreload: { maxFiles, maxBytes }`, which defaults off and schedules
adjacent-file warming through same-thread timers after three consecutive adjacent
full-file reads. Ranges/streams do not train prediction. Its byte budget includes
conservative reconstruction/history/input cost, not merely file lengths.

`clearCache()`, `close()` or `setCacheStrategy('none')` cancel predicted work;
`none` also disables the source window. A background failure closes the archive,
is retained by `getPreloadError()` and is rethrown by subsequent data operations.
No worker thread, asynchronous source I/O or guaranteed hit is implied.
See [configuration](configuration.md#three-different-forms-of-warmup). The Worker
RPC currently rejects these two newer local options; check its narrower
[wire allowlist](worker.md#api-differences-from-the-local-reader).

## Check entry points and default imports

| Import                                            | Runtime contract                                               |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `chmkit` on Node                                  | Node facade; default `CHMKit`; named reader/encoder/operations |
| `chmkit` with browser condition                   | Browser facade; default `CHMKit`                               |
| `chmkit/browser`                                  | Explicit browser API; default `CHMReader`                      |
| `chmkit/reader`                                   | Node reader; browser condition resolves the browser reader API |
| `chmkit/config`                                   | Node configuration loader, not a browser/global control plane  |
| `chmkit/worker`                                   | Explicit client/host RPC helpers; no Worker started on import  |
| `chmkit/electron/main`, `chmkit/electron/preload` | Separate privileged and preload helpers                        |
| `chmkit/browser-resources`                        | Browser preview resource helpers; see browser guide            |

Prefer named imports. Do not rely on a former root browser default being
`CHMReader`. Node binary reads use Buffer; browser reads use ordinary Uint8Array.
The stream API is WHATWG `ReadableStream`, not Node Readable. Remote Worker
handles instead offer async `read/list/toc/search`, not the complete local reader
surface or a remote stream API.

## Ranges, navigation and error behavior

- Ranges and range streams are strict `[start, end)` **byte offsets**. Invalid
  bounds throw; code must not expect negative indexing, clamping or character ranges.
- Navigation/default pages can preserve query/hash. Read APIs use raw archive
  paths. Resolve URLs before reads; encode literal filename `#`/`%` appropriately.
- Ambiguous case-insensitive paths are refused. `exists()` returns false only
  for absence; it does not swallow corrupt-archive/open/closed-reader errors.
- Per-file compressed size/ratio is `null` for a shared LZX stream. Update code
  that assumed a numeric per-file estimate; use `compressedSizeExact` and notes.
- Legacy pseudo-LZX Huffman helpers (`createLZXDecoder`, `readCodeLengths`,
  `buildPredefinedTree` and `LZXHuffmanDecoder` operations) retain deprecated
  signatures but throw explicit unsupported errors. Use the actual `LZXDecoder`;
  generic Huffman-tree functionality is separate and still available.

These are intentional correctness/security changes, not full behavior-level
backward compatibility.

## Writing and updating

`compressionLevel` now selects real fixed/adaptive/ALIGNED search strategies with
stored fallback. Archive bytes/size can change even when decoded content does not.
Do not use byte-identical old compressed output as a compatibility requirement.
Window/reset/block options have explicit bounds; frame size remains 32 KiB.

TOC generation can retain orphan nested pages previously omitted by `TOCBuilder`.
Flat/folder/explicit hierarchy and templates make navigation controllable; review
generated navigation on upgrade. Authored contents are not silently replaced by
generation options. Packing rejects nonportable paths and unresolved default topics.

`packTemplate()` adds whole-file Map composition: byte values replace/add files,
`null` deletes. It does not evaluate template expressions or interpolate strings;
`tocTemplate` is a different API. Input maps/buffers are not mutated, authored
navigation is preserved, and final paths/default-topic/generated-TOC references
are validated. Arbitrary links inside authored navigation/HTML are not repaired.

`updateArchive()` is a new bounded **rebuild**, not an in-place mutation or a
universal existing-CHM editor. Compiled indexes/unknown transforms can cause refusal
even for archives the reader supports. It preserves metadata rather than accepting
a new title/default topic option. See [packing/update limits](packing.md).

## CLI and configuration

`tree`, `search`, `preview`, `browse` and `batch` are actual commands, not planned
flags. Preview is a noninteractive static snapshot, not an archive web server.
Browse requires TTYs. Batch is sequential across archives. Extraction concurrency
is asynchronous output I/O, not parallel decoder CPU. Extraction now also uses
file-backed positioned input instead of a whole-archive copy. The input must
remain immutable until completion; metadata and per-output decoder/chunk workspace
still allocate memory. The descriptor is closed on errors/cancellation as well
as success.

`--config`/cwd configuration is wired to a documented subset of fields. Previously
accepted-but-unused fields do not become working controls by loading successfully.
Explicit unconnected fields warn; [the configuration table](configuration.md)
identifies effective defaults and unsupported legacy controls. Library APIs still
require explicit options; do not assume configuration discovery applies globally.

Keep machine-readable stdout separate from diagnostics. Partial extraction errors
produce a nonzero exit; successful files remain. Ctrl-C uses cooperative cleanup
and exit 130. `read --output` can overwrite ordinary files; extraction's stricter
policy must not be generalized to all file-writing APIs.

## Deployment and documentation

Do not replace a private preview with raw archive HTML in your application DOM.
Worker cancellation is not CPU preemption; Electron requires main-owned capability
factories and exact sender/frame validation. See [SECURITY.md](../../SECURITY.md).

Download compiled assets rather than building as part of consumer installation.
Actions downloads require sign-in and expire; a draft release is not a public
release. API HTML is separately downloadable as `chmkit-api-<source-sha>` from
CI; extract it and open `index.html` without building source. It is generated
output, not proof of a deployed docs site. Tag creation, protected-environment
configuration and explicit human authorization remain release prerequisites.
Current validation lives in [VALIDATION.md](../../VALIDATION.md), without copied
historical test counts or assumptions that every feature combination is covered.

## Contributor toolchain migration

Development now uses **Node 22.13+ or 24**, **pnpm 10.34.9**, ESLint 10's flat
`eslint.config.mjs`, Vitest 4.1.12 / Vite 7.3.7 and TypeDoc 0.28.20. Node 20.19
is a runtime compatibility target, not a devDependencies installation environment;
CI installs on Node 24 before switching runtimes. The consumer engine declaration
is separate and remains in `package.json`.

Native Electron acceptance now runs through `pnpm test:electron` in the same
Playwright configuration as the browsers. For contributors, explicitly install
the pinned dev-only Electron 45.1.0 binary with `pnpm exec install-electron` after
the script-disabled frozen install; no pnpm lifecycle approval is required.
`pnpm test:browser` selects `test/browser`, while `pnpm test:all` runs Vitest and
both Playwright paths. Reports moved from `test-results/browser/` to
`test-results/playwright/{results.json,html,artifacts}`. Local native execution
has passed on macOS; new hosted acceptance is separate.

Delivery tests moved to `test/delivery/*.test.mjs` as native Vitest tests. Use
`pnpm test:delivery` or the default `pnpm test`, not the removed Node test-runner
script. `pnpm test:bench` is native one-shot Vitest benchmarking, not a watcher.
`pnpm docs:build` uses `typedoc.json` to generate `dist/api/`; keep generated HTML
out of Git. See [contributing](../../CONTRIBUTING.md) for source-build workflows.

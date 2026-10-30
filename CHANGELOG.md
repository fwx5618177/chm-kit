# Changelog

User-facing changes are recorded here. Exact package version comes from
`package.json`; artifact version/source identity comes from its manifest. This
file is not evidence that a release was published. The public `chmkit` npm
registry endpoint currently returns 404, and npm publication is not planned. See [downloads](docs/guide/downloads.md)
and [migration](docs/guide/migration.md).

## Unreleased

### Added

- Node file-backed archive input with positioned synchronous reads, a bounded
  sequential source window, physical I/O statistics and explicit descriptor lifetime.
- Default-off `adaptivePreload: { maxFiles, maxBytes }` for adjacent full-file
  reads, with budgeted same-thread timer warmup, cancellation and retained
  `getPreloadError()` diagnostics. This is separate from synchronous `readAhead`.
- Reusable Worker client/host RPC with archive handles, input/output/pending
  budgets, optional buffer transfer, request cancellation/timeouts and cleanup.
- Separate Electron main/preload helpers: main-owned approved archive keys,
  sender/frame authorization, read-only path/operation grants and lifecycle cleanup.
- CLI `tree`, `search`, static `preview`, TTY `browse` and multi-archive `batch`;
  type/glob/size filtering, extraction progress, bounded I/O concurrency and
  cooperative cancellation.
- Advanced packing window/reset/block controls, folder/explicit TOC hierarchies,
  TOC templates and actual HTML Help metadata records.
- `packTemplate()` composes whole-file byte Maps using add/replace/null-delete
  overlays without mutating inputs or evaluating string template expressions.
- `updateArchive()` for supported bounded in-memory rebuilds, preserving existing
  metadata/navigation and refusing unsupported compiled structures instead of
  silently discarding them.
- Independent upstream CHM corpus, malformed-input and bounded mutation/differential
  coverage, native real-corpus benchmarks and peak-memory measurements.
- Verified consumer downloads: precompiled npm-format tarball, bundled standalone
  CLI, browser ESM/types archive, usage notes, dependency notices and SHA-256 manifest.
- User guides, migration/security/contribution policies and TypeDoc 0.28.20 API
  generation through `pnpm docs:build` / `typedoc.json`. CI provides the separate
  prebuilt `chmkit-api-<source-sha>` HTML artifact, not a hosted public website;
  application examples cover Worker and Electron.

### Changed

- Node path readers retain descriptors instead of snapshotting the full input.
  Backing content must remain immutable until `close()`; reads/decompression
  remain synchronous. Cache accounting includes source read-ahead.
- LZX writing uses actual bit-cost selection across fixed/adaptive canonical
  Huffman and ALIGNED candidates, with stored fallback. Compressed bytes/ratios
  may change; optimal or monotonically better compression is not promised.
- CLI configuration is applied to an explicit documented field subset. Accepted
  compatibility-only fields warn when provided instead of implying unsupported controls.
- Extraction uses file-backed positioned input rather than a whole-archive copy,
  reports partial errors and preserves completed files. Input/decode remain
  synchronous; concurrency controls bounded asynchronous output I/O, not parallel
  decoder CPU or total RSS. Input must remain immutable until completion.
- Contributor tooling uses pnpm 10.34.9, Node 22.13+ / 24, ESLint 10 flat config,
  Vitest 4.1.12 and Vite 7.3.7. Node 20.19 remains a runtime compatibility target,
  not a dev-tool installation environment. Delivery tests are native Vitest under
  `test/delivery/`, included by `pnpm test` and focused by `pnpm test:delivery`;
  `pnpm test:bench` runs native benchmarks once.
- Documentation leads with prebuilt downloads, not consumer builds or a nonexistent
  registry install. Source build instructions live in the contribution guide.

### Compatibility and safety notes

- The root browser-condition default is `CHMKit`; explicit `chmkit/browser` defaults
  to `CHMReader`. Prefer named imports. Browser bytes use Uint8Array, Node bytes
  use Buffer, local streams use WHATWG ReadableStream.
- Legacy pseudo-LZX Huffman helpers are deprecated and explicitly unsupported;
  use the real `LZXDecoder`. Generic Huffman functionality remains separate.
- Generated navigation retains orphan nested pages rather than dropping them;
  authored contents cannot be silently replaced by template/hierarchy options.
- Strict half-open byte ranges, missing-path-only `exists()` behavior and null
  per-file shared-stream compressed sizes must be handled by callers.
- A readable archive may not be safely updatable. Updates are rebuilds, not
  in-place patches, and do not regenerate arbitrary compiled search/topic indexes.
- Previewed HTML remains untrusted. File immutability, TOCTOU extraction limits,
  resource budgets and IPC boundaries are documented in [SECURITY.md](SECURITY.md).
- No automatic npm publication or GitHub Release publication is introduced.
  Approved release automation creates a draft only; it requires explicit
  authorization, a matching existing tag and protected-environment review. Tag
  creation/environment setup remain uncompleted prerequisites. Actions downloads
  require login and expire. Third-party test corpora remain excluded from delivered assets.

Validation commands, observed outcomes and outstanding coverage limitations live
in [VALIDATION.md](VALIDATION.md); case counts and historical commit-specific
conclusions are deliberately not duplicated here.

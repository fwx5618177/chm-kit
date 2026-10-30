# Changelog

User-facing changes are recorded here. Exact package version comes from
`package.json`; artifact version/source identity comes from its manifest. This
file is not evidence that a release was published. The public `chmkit` npm
package is not published; publication requires separate authorization. See [downloads](docs/guide/downloads.md)
and [migration](docs/guide/migration.md).

## Unreleased

### Added

- Ready-to-open local browser viewer in `chmkit-1.1.0-browser.tar.gz`:
  `dist/viewer/index.html`, a self-contained classic-IIFE `viewer.js`, and Worker
  entry/client integration files alongside browser modules/types/licenses.
  Open the viewer directly as `file:` without Node, npm, a server or a build;
  generated sample preview was verified in all three browsers with zero HTTP
  requests. Library ESM/module Worker integration still requires HTTP(S).
- Native Electron acceptance through the shared Playwright configuration, using
  exactly pinned, development-only Electron 45.1.0 and an actual installed tgz
  outside the repository. Real IPC permissions, sandbox/context-isolation
  boundaries, lifecycle and actual-window screenshots passed locally on macOS.
  `pnpm exec install-electron` explicitly installs the official binary without
  requiring pnpm lifecycle approval; consumers gain no Electron runtime dependency.
- Unmodified official Free Pascal 3.2.2 `fpdoc` corpus with independent resource,
  range and stream comparisons and preserved license/provenance/hash evidence.
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
- Consumer delivery assets: precompiled npm-format tarball, bundled standalone
  CLI, browser viewer/ESM/types archive, usage notes, dependency notices and SHA-256
  manifest. Linked verified hosted snapshots predate the new viewer changes.
- User guides, migration/security/contribution policies and TypeDoc 0.28.20 API
  generation through `pnpm docs:build` / `typedoc.json`. CI provides the separate
  prebuilt `chmkit-api-<source-sha>` HTML artifact, not a hosted public website;
  application examples cover Worker and Electron.

### Fixed

- Accept the exact evidenced FPC v3 duplicated-first-GUID pair without accepting
  arbitrary GUID duplication, corruption or extending the exception to v2.
- Validate the FPC density-2 quickref convention consistently within each
  PMGL/PMGI table, including its final exact-multiple quickref. Permit the
  evidenced overwritten first-leaf hint only with verified FPC quickrefs and
  intact chain, endpoint, leaf coverage and rooted-index checks.
- Consume and validate a single terminal ResetTable offset equal to compressed
  Content length, exposing only real nonempty frames. Preserve count, monotonic
  start, bounds and actual Content-length checks, including final partial frames.

### Changed

- One Playwright configuration now has explicit browser and native Electron
  projects with reports under `test-results/playwright/{results.json,html,artifacts}`.
  `pnpm test:browser` selects `test/browser`; `pnpm test:electron` selects its
  project; `pnpm test:all` includes both. CI adds a native macOS 15 job and gates
  delivery on all acceptance jobs; new-revision hosted results are still pending.
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
- Normal real upstream ITSF v2, GBK/UTF-16 and additional E8/window/reset corpus
  gaps remain; the FPC archive is not evidence that every producer is supported.
- No automatic npm publication or GitHub Release publication is introduced.
  Approved release automation creates a draft only; it requires explicit
  authorization, a matching existing tag and protected-environment review. Tag
  creation/environment setup remain uncompleted prerequisites. Actions downloads
  require login and expire. Third-party test corpora remain excluded from delivered assets.

Validation commands, observed outcomes and outstanding coverage limitations live
in [VALIDATION.md](VALIDATION.md); case counts and historical commit-specific
conclusions are deliberately not duplicated here.

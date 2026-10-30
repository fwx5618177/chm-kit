# Delivery checklist

This file records concrete acceptance criteria, not an open-ended promise to implement every HTML Help feature. User guides live in [docs](docs/index.md); exact commands and execution evidence live in [VALIDATION.md](VALIDATION.md).

## Implementation and engineering work

- [x] Parse ITSF v2/v3, PMGL/ENCINT, section 0/1, ControlData and reset tables with checked integer/range validation. Accept explicit v3 data base zero and a directory after payloads; do not assume one producer's section order.
- [x] Read the unchanged official FPC 3.2.2 `fpdoc` archive: exact duplicated v3 GUID pair, consistent FPC quickrefs/verified leaf hint and strictly validated terminal ResetTable offset. Compare all 138 resources plus ranges/streams to independent bytes.
- [x] Decode real LZX VERBATIM/ALIGNED/stored streams, repeated offsets, frames/resets, history and Intel E8. Bound outputs and structural allocations before reading untrusted lengths.
- [x] Encode with length-limited adaptive canonical Huffman, fixed trees, real ALIGNED blocks and stored fallback selected by actual bit cost. Expose validated window/reset/block/level options; independently extract generated variants with 7-Zip.
- [x] Generate configurable TOC hierarchy/entries/templates and actual HTML Help metadata records, preserve authored HHC/HHK, and reject unsafe/ambiguous portable paths.
- [x] Provide `packTemplate()` whole-file Map overlays and `updateArchive()` additions/replacements/deletions. Rebuild a new CHM, preserve supported metadata, and explicitly reject structures that cannot safely be rewritten. This is not an in-place binary patcher or an unspecified export-format framework.
- [x] Provide consistent Node CJS/ESM, browser-native byte APIs, all public subpath declarations and `CHMKit` facades; validate the actual delivered tarball in an isolated installed consumer.
- [x] Open and extract Node filesystem inputs through positioned reads rather than loading the full archive. Close descriptors on normal/error/cancel paths and reject changed input files, including before cache hits.
- [x] Reuse a bounded input-window buffer, account for file/block/source cache storage, preserve stream backpressure and add opt-in bounded adjacent-file background preload. Do not reclaim caller-owned outputs or advertise a general decoder-dictionary pool.
- [x] Supply reusable typed Worker client/host RPC with limits, correlation, transfer ownership, cancellation/timeout/error cleanup and retryable close. Execute the built modules in real browsers, without source-bundle fallbacks.
- [x] Supply injectable Electron main/preload adapters with sender/frame/archive/path authorization and lifecycle cleanup. Renderer code receives capabilities, never arbitrary filesystem paths or unrestricted IPC.
- [x] Expand browser preview URL/CSS imports/srcset/static SVG handling, offline CSP/sandbox isolation, cycle/resource/byte budgets and object-URL cleanup. Keep the helper's best-effort rendering limits explicit.
- [x] Add CLI `tree`, `search`, static `preview`, TTY `browse`, isolated extraction `batch`, and type/size/glob filters. Preserve exact raw/stream bytes, JSON stdout and stderr-only diagnostics/progress.
- [x] Add bounded concurrent asynchronous extraction writes, cancellation, progress callbacks and partial-result semantics without weakening exclusive-create/path/symlink safeguards.
- [x] Load CLI JSON config automatically and apply documented fields with explicit flags taking priority. Validate dangerous/unknown fields and warn about retained compatibility-only fields instead of claiming they take effect.
- [x] Use one Vitest configuration for native node/package/delivery cases and native benchmarks, plus one Playwright configuration with explicit Chromium/Firefox/WebKit and native Electron projects. Remove custom test runners and migration shims.
- [x] Expand independently sourced normal CHM corpus (PuTTY, 7-Zip, Inno, PyCHM and official FPC), immutable hashes/licenses and independently extracted resource expectations: six normal archives, 859 resources and 886 checksummed files. Add malformed/CVE inputs, deterministic bounded mutations, resource/range/stream differential checks and calibrated memory/performance cases. See the [coverage matrix](test/conformance/README.md).
- [x] Separate contributor builds from ordinary use. Generate a precompiled npm tarball, standalone Node CLI, browser viewer/ESM/types archive, dependency notices, usage, source manifest and SHA-256 inventory. Consumer install never runs build hooks or requires pnpm/TypeScript.
- [x] Ship the standalone classic-IIFE viewer in `dist/viewer/`. Open its `index.html` directly as `file:` in all three browsers and load the actual sample preview with zero HTTP requests; no Node/npm/server/build for ordinary viewers.
- [x] Upload verified prebuilt downloads and TypeDoc HTML from CI after cross-platform/browser acceptance. Keep public npm availability and actual download existence separate from workflow definitions.
- [x] Replace deprecated action runtimes and floating OS labels; pin verified official action SHAs, bootstrap the exact pnpm version and install dev tooling on a supported Node before compatibility tests. Do not suppress warning output.
- [x] Update supported ESLint/commit hooks/test/build dependencies, native flat lint configuration and the frozen lockfile. Audit against the official registry rather than an unavailable mirror audit endpoint.
- [x] Replace audit-log READMEs with user-oriented bilingual quick starts, linked API/format/lifecycle/security/configuration/migration guides, contribution policy and release notes. Generate exact API HTML from source with warnings treated as errors.
- [x] Implement a manual, fail-closed GitHub draft-release pipeline: exact existing tag/version, independent protected-environment review, full acceptance, verified hashes/source, narrow publishing permissions. Push/PR CI never publishes npm or deploys.

## Evidence and external release gates

These are deliberately not marked complete merely because the implementation exists. They require a recorded execution, independently licensed input, a real application environment or a maintainer decision.

- [x] Execute the historical hosted CI and inspect its annotations/logs and downloadable artifacts. Run [41003535243](https://github.com/fwx5618177/chm-kit/actions/runs/41003535243) at `45a5b5f` passed 14/14 jobs; all logs/annotations were reviewed and actual consumer/API downloads verified. Windows-only path/timestamp test failures and the browser build/readiness race were fixed rather than retried away. This is not new-revision evidence. See `VALIDATION.md`.
- [ ] Record the current revision's consolidated full Vitest count and hosted 15-job acceptance (9 Node + 3 browser + minimum + native Electron + dependent delivery); inspect new logs/annotations and verify actual new viewer/API downloads.
- [ ] Obtain legally redistributable **normal upstream ITSF v2**, GBK/UTF-16 and additional window/long-reset/E8 archives. Existing synthetic cases and malformed v2 inputs do not satisfy this real-corpus evidence gap.
- [x] Run the Electron example inside an actual supported Electron application: seven real Playwright cases passed locally on macOS / Electron 45.1.0 with sandbox/context isolation enabled and Node integration disabled. Install the real tarball outside the repository; exercise IPC permissions, reader lifecycle and actual-window screenshots. Hosted acceptance remains separate.
- [ ] Independently review and authorize a public release; configure protected reviewers, choose/create the tag and publish approved GitHub assets. No tag, release, npm publication or environment-permission change is performed implicitly by implementing the workflow.
- [ ] If public npm installation or a hosted API site is desired, explicitly authorize/configure that separate publication. A prebuilt Actions artifact is usable without building, but it is authenticated/expiring distribution rather than a public permanent registry/site.

No finite test suite establishes compatibility with every CHM producer or every boundary. Unspecified alternate export formats, native compiled search/window databases and a full HTML Help Workshop replacement are not silently included in these checked deliverables.

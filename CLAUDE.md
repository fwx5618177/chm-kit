# Working in CHMKit

Instructions for coding agents and maintainers. Respect the user's task scope and
file ownership first. Multiple agents may be editing this working tree; inspect
current files/status and do not revert, format or overwrite another owner's work.
Do not commit, create branches/tags, publish, dispatch releases or alter repository
permissions without explicit authorization.

## Product and documentation contract

CHMKit is a TypeScript CHM reader/writer with Node CJS/ESM, CLI, browser, Worker
and Electron integration surfaces. Keep the product user-oriented rather than
turning READMEs into an audit log. Both root READMEs should be moderate-length
entry points with equivalent guidance; put detail in `docs/guide/`.

- Prefer prebuilt tgz, standalone CLI and browser archive in quick starts.
  Consumers must not need a source build, pnpm, TypeScript or husky.
- Public npm `chmkit` currently returns 404. Do not write registry installation as
  available or suggest an older registry version exists without new evidence.
  There is no current npm publication plan.
- Do not invent public GitHub Releases or a deployed API documentation site.
  Actions artifacts require GitHub sign-in and expire. A successful local build
  is not a hosted artifact. A draft release is not a public release.
- Package/CLI versions must agree; read actual metadata instead of hard-coding
  a planned version into docs. Use manifest-based download filenames.
- `pnpm docs:build` uses TypeDoc 0.28.20 / `typedoc.json` to generate `dist/api/`.
  CI uploads it separately as `chmkit-api-<sha>`; users download/browse without a
  source build. Keep HTML out of Git and do not claim public hosting is deployed.
- `VALIDATION.md` owns exact current validation evidence; do not duplicate stale
  test counts, unverified commits or historical failures across user docs.
- Maintain `CHANGELOG.md` and the migration guide for behavior changes. Update
  `TODO.md` only within the assigned task; classify real work, do not mark a
  roadmap item complete merely because docs mention it.

## Toolchain and bounded validation

Use Node **22.13+ or 24** for development and **pnpm 10.34.9**, matching metadata
and lockfile. Node 20.19 is only a runtime compatibility test target, not a
supported dev-dependency installation environment (including commitlint). CI
installs on Node 24 before switching runtimes; do not confuse that with raising
the consumer engine floor. ESLint 10 uses flat `eslint.config.mjs`; the native
test stack is Vitest 4.1.12 / Vite 7.3.7. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test
pnpm test:delivery
pnpm exec playwright install chromium firefox webkit
pnpm test:browser
```

Start with focused `pnpm test:unit <test-path>` checks, then installed-package and
real-browser acceptance as appropriate. `pnpm test` runs Vitest node + package;
`pnpm test:package` uses an isolated consumer, and browser global setup owns a
separate build. Do not race builds on shared output. `pnpm test:all` also runs
Playwright. Node tests do not establish native browser/Electron behavior.
External `7zz`/`7z` checks explicitly skip if absent, or fail when
`CHM_REQUIRE_7Z=1`; skips are not passes. Native benchmarks use
`pnpm test:bench test/bench/real-corpus.bench.ts`, a one-shot native benchmark
run, not a watcher. Delivery tests in `test/delivery/*.test.mjs` use Vitest and
are included in `pnpm test`; `pnpm test:delivery` focuses them. Do not restore a
second Node test runner or the removed script-path test.

`pnpm build` runs the canonical `scripts/build.mjs`, accepts no partial arguments
and owns all public entry/declaration generation. It cleans its output trees,
not all of `dist/`; preserve demo/test evidence. Do not patch generated declarations.
`pnpm demo` creates actual sample/extraction/report output. Use bounded tests for
automation; do not launch indefinite dev/watch/static servers in agent tools.
Do not use `clean` to erase evidence or alter fixtures to pass formatting.

Delivery is `pnpm package:artifacts` (`pnpm build` then the packager). It stages
consumer-only metadata, removes repository hooks/dev scripts, bundles the standalone
CLI, preserves browser chunks/types and validates the real installed tarball in a
system-temp consumer outside repository ancestry. No borrowed dependencies or
consumer overrides may mask missing exports/dependencies. Dependency installation
may use the network. Keep runtime dependency notices and hashes with assets.

## Architecture and runtime boundaries

- `src/core/headers/`, `directory/`, `parser/`: binary structures, offsets,
  directory decoding and mandatory validation. Do not assume data follows the
  directory or reinterpret a legitimate explicit zero data base as missing.
- `src/core/lzx/`: real VERBATIM/ALIGNED/stored decoder, dictionary, frame/reset
  history and E8 decoding. `src/core/files/`: source abstraction and reconstruction.
- `src/reader/chm-archive.ts`: portable core over owned memory/synchronous source;
  no fs/process/logger/Node streams. `chm-reader.ts` and `file-byte-source.ts` are
  the Node positioned-file adapters.
- `src/reader/types.ts`: shared reader/search/navigation/cache shapes. Node
  `FileWithMetadata` has Buffer data; browser has Uint8Array. Source types must
  enforce that boundary rather than a post-build text replacement.
- `src/encoder/`: pure archive builder, update rebuild, LZX/canonical trees,
  metadata and navigation. Directory scan/write adapters remain separate.
- `src/browser.ts`: explicit browser reader, default `CHMReader`; root
  `browser-root.ts` defaults to `CHMKit`. Browser inputs are bytes/ArrayBuffer/Blob,
  not filesystem paths or URL strings. Internal Buffer injection must not mutate
  `globalThis.Buffer` or leak Node types into browser declarations.
- `src/worker/`: structural bounded RPC, explicit host factory and async client.
  No auto-starting worker or implicit filesystem dependency.
- `src/electron/`: separate main/preload capability boundary with injected
  structural interfaces; no mandatory Electron runtime/package declarations.
- `src/chm-kit.ts`, `convenience.ts`, `operations/`: Node facades/adapters.
  One-shot readers close internally; repeated operations reuse an explicit reader.
- `src/cli/`: Commander actions, filtering, preview, browse and config runtime.
  Help, stdout/stderr and exit status are public behavior.
- `src/core/config.ts`: safe load/merge/validation/cache, not a global control
  plane. `src/cli/runtime.ts` defines the actual connected field subset.
- `scripts/`, `.github/`: canonical build/demo/delivery/policy tooling. Node,
  package and delivery tests use native Vitest; browsers use Playwright. Do not
  add an ad hoc replacement runner or resurrect Node test-runner delivery tests.

Public subpaths include `chmkit/browser`, `reader`, `config`, `worker`,
`electron/main`, `electron/preload`, and `browser-resources`. Verify actual
`exports`, build artifacts, `files` and declarations together after integration;
source-only tests do not prove packaged availability.

## Semantics to preserve

- Node `open(path)` is async only at acquisition; file reads/parsing/decompression
  remain synchronous. Hold immutable backing content throughout descriptor life.
  `close()` releases fd/caches/stream state and is mandatory; opening is not a snapshot.
- Memory input retains a full owned copy. `maxCacheBytes` combines files/blocks/
  source read-ahead, excluding input/metadata/workspace/caller output. `maxFileSize`
  bounds one materialized read, not input, total output, CPU or process RSS.
- Local streams are WHATWG streams, strict byte `[start,end)`, with reusable decoder
  state. They can need preceding-reset history and are not asynchronous CPU workers.
  Close only after consuming/canceling streams. Avoid per-chunk reset restarts.
- `exists` returns false only for missing internal paths; corruption/open/closed
  errors propagate. Shared-LZX per-file compressed sizes/ratios are null, not estimates.
- Read APIs accept raw listed paths; navigation URLs can retain query/hash.
  Distinguish literal filename `#`/`%` from URL suffixes. Do not blindly split URLs.
- Reject nonportable writer paths, ambiguous NFC/case duplicates, conflicts and
  unresolved default topics. Preserve authored navigation; generation options must
  not silently replace it. TOC templates contain exactly one insertion marker.
- Compression levels select real fixed/adaptive/ALIGNED cost candidates plus
  stored fallback; CHM frame size stays 32768. Do not promise optimal ratios.
- `updateArchive` rebuilds supported input into new bytes, not in place. Preserve
  metadata/navigation deliberately; refuse compiled indexes/unknown transforms
  rather than silently dropping them. Readable does not imply updatable.
- `packTemplate(templateMap, overridesMap, options)` composes whole files with
  byte replacements/additions and explicit null deletions. It is not string
  interpolation, template-expression evaluation or sanitization. Inputs are not mutated.
- `readAhead` controls synchronous Node source-window expansion, not background
  file warmup. Opt-in `adaptivePreload: { maxFiles, maxBytes }` schedules adjacent
  public-file warmup after sequential full-file reads using timers on the same
  thread. It defaults off, honors cache headroom/conservative reconstruction cost,
  and is canceled by close/clearCache/cache strategy none. Failure closes the
  reader, is retained by `getPreloadError()` and rethrown by later data operations.
- Legacy pseudo-LZX helpers remain deprecated/unsupported, not fake decoders.
  Generic Huffman functionality and actual LZX decoding are separate.
- Node random reads and extraction both use file-backed positioned input, not
  whole-archive reads. Extraction combines synchronous input/decompression with
  bounded asynchronous output I/O, not multicore CPU. Keep input immutable until
  the operation closes its descriptor, including error/cancellation paths.
- Extraction rejects traversal/unsafe names/symlinks/overwrites, including ancestors.
  Preserve completed files/errors on partial failure; no total TOCTOU immunity.
  CLI read/pack output does not inherit all extraction destination protections.
- CLI JSON/raw stdout must stay clean; diagnostics/progress go to stderr. Partial
  extraction failures are nonzero; cancellation is cooperative with cleanup.
  `--stream` is raw, not JSON; batch is sequential across archives; concurrency
  limits asynchronous I/O, not parallel CPU.
- CLI config only consumes its documented subset. Never advertise `maxMemory`,
  checksum/strictness or other compatibility fields as implemented global controls.
- Worker transfers are opt-in and detach whole backing buffers. Remote handles are
  a subset of local methods. Timeouts/cancel settle calls, not synchronous CPU
  preemption. Disposal and late-open cleanup must remain correct.
- Electron requires main-owned factories, exact sender/frame validation,
  reauthorization and scoped handles; never grant renderer OS paths or raw IPC.
  Search filtering limits returned data, not hidden-resource timing/work.

## Security, licensing and release evidence

Follow `SECURITY.md`. Never render untrusted archive HTML in the host DOM.
Script-free sandbox plus restrictive CSP/resource validation is needed; sandbox
alone is not a network/privacy firewall. Resource helpers are not universal HTML/CSS
sanitizers. Use process-level quotas/isolation for hostile workloads; V8 heap limits
and payload budgets are not total RSS limits.

Third-party `test/fixtures/**` raw/expected bytes retain upstream licenses,
including GPL/LGPL. Keep all corpus, extracted derivatives and demo outputs out
of npm/browser/CLI assets. Preserve hashes/notices and `-text`/formatter exclusions.
Do not regenerate independent oracles using this library, execute unknown binaries,
or call synthetic/header-modified files unmodified real-world corpus.

Bounded fuzz/differential tests are not exhaustive proofs; early rejection may
not reach later corrupt fields. Record actual commands/platform/failures/skips in
`VALIDATION.md`; workflow definitions and source-only checks are not hosted runs.

Normal CI is read-only and never publishes. Manual release policy is in
`.github/PIPELINES.md`: existing matching tag, coherent version, full CI and
protected independent review before **draft** release creation. Tag/environment
configuration and human authorization are prerequisites, not claimed completed
setup. Do not bypass approval with direct `gh release` commands. There is no npm
publication workflow or current plan; any change requires separate authorization.
Never suppress genuine warnings or weaken meaningful tests to manufacture a clean
result.

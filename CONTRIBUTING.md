# Contributing to CHMKit

Thank you for helping improve CHM support. For ordinary use, choose a
[prebuilt download](docs/guide/downloads.md); **source builds are for contributors**.
The public `chmkit` npm package is not published; publication needs separate authorization.

## Discuss and report

Use [issues](https://github.com/fwx5618177/chm-kit/issues) for reproducible bugs,
compatibility requests and proposed features. Include the environment, actual
command/API, expected behavior, error and the smallest legally shareable input.
Do not upload private manuals or redistribute a CHM whose license is unknown.
For possible vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of
posting exploit details publicly.

Distinguish format support from real-fixture evidence. A self-roundtrip alone
cannot prove interoperability, and one producer's output cannot prove every
producer's behavior. State gaps rather than weakening checks to imply support.

## Contributor setup

Use **Node.js 22.13+ or 24** and **pnpm 10.34.9**, matching `package.json` and
the checked-in lockfile. Node 20.19 is a runtime compatibility target, **not** a
development installation environment: current dev tooling, including commitlint,
needs newer Node. CI installs devDependencies on Node 24 before switching to the
selected compatibility runtime. This does not raise the consumer `engines.node`.
From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test
```

Source installation disables dependency/repository lifecycle scripts. Hooks are
not required for builds or consumer installs. The Actions setup bootstraps the
pinned pnpm separately; see [.github/PIPELINES.md](.github/PIPELINES.md).
Optional local hooks use `pnpm hooks:install`; do not run that as a consumer step.
ESLint 10 uses the flat [`eslint.config.mjs`](eslint.config.mjs), not an eslintrc
file. Tests use Vitest 4.1.12 with Vite 7.3.7; keep dependencies lockfile-consistent.

`pnpm build` is the canonical complete build via `scripts/build.mjs`, with no
partial-build arguments. It produces Node CJS/ESM, CLI, browser modules/chunks,
the standalone classic-script viewer in `dist/viewer/`, and bundled declarations
for public entries. It cleans only its owned output trees,
not the entire `dist/`; `dist/demo/` and separate test reports are preserved.
Do not patch generated declarations to hide a wrong source-level type boundary.

## Focused validation, then acceptance

```sh
# Focused node/integration tests; choose the paths relevant to your change
pnpm test:unit test/reader
pnpm test:unit test/encoder
pnpm test:unit test/worker test/electron

# Isolated installed-package behavior, public entries, declarations and bin
pnpm test:package

# Delivery/policy tests are native Vitest tests, also included by pnpm test
pnpm test:delivery

# Install browser runtimes, then execute real-browser acceptance
pnpm exec playwright install chromium firefox webkit
pnpm test:browser

# Explicit official binary installer; no pnpm lifecycle approval required
pnpm exec install-electron
pnpm test:electron
```

Linux browser/system dependencies may require
`pnpm exec playwright install --with-deps chromium firefox webkit`.
Select an engine with `pnpm test:browser --project=chromium` (or firefox/webkit).
`pnpm test` runs Vitest's node and package projects, including `test/delivery/`.
`pnpm test:delivery` focuses that directory, including `package.test.mjs`; it is
not a separate Node test runner. `pnpm test:browser` is
`playwright test test/browser`; `pnpm test:electron` selects `--project=electron`.
The single Playwright configuration defines all four explicit projects.
`pnpm test:all` runs Vitest, then all four Playwright projects in one invocation,
so its browser and native Electron cases remain together in the same report.
JSON, HTML and attachments use `test-results/playwright/{results.json,html,artifacts}`;
focused invocations replace the previous Playwright report.
The package project's global setup owns its complete build. Playwright's
web-server command builds before launching Vite or making readiness requests;
Playwright runs `globalSetup` too late to own that prerequisite. Do not run
multiple builds against shared output concurrently.

Electron **45.1.0** is exactly pinned in devDependencies only, not a CHMKit
runtime dependency. `pnpm exec install-electron` explicitly downloads the official
native binary after script-disabled dependency installation; do not enable broad
lifecycle approval to obtain it. Native acceptance installs the real CHMKit tgz
outside the checkout and launches the example with real IPC and sandboxing.
The CI native job targets macOS 15; Linux hosts need native system libraries and
a display. Do not disable sandboxing to make a run pass.

An installed `7zz`/`7z` supplies an independent CHM oracle. Normal vendored corpus
and hash checks are offline. External-tool checks explicitly skip if unavailable;
`CHM_REQUIRE_7Z=1 pnpm test:unit test/conformance` requires the tool. A skip is not
an interoperability pass. Benchmarks use native Vitest, not another runner:

```sh
pnpm test:bench test/bench/real-corpus.bench.ts
pnpm test:unit test/bench/peak-memory.test.ts
```

`pnpm test:bench` is native one-shot `vitest bench --project node --run`, not a
watcher; its configured JSON output is `test-results/bench/vitest-benchmark.json`.
Do not turn hardware-specific timings into universal performance claims.
Bounded mutation/fuzz tests are not exhaustive coverage. Current commands,
results, failures/skips and platform evidence belong in [VALIDATION.md](VALIDATION.md).
Use the native reports under `test-results/`; do not copy old case counts into docs.

## Try repository examples

`pnpm demo` builds and runs `scripts/demo.mjs`, producing a generated sample CHM,
extracted content and a report in `dist/demo/`. It is a real workflow, not an
independent compiler oracle.

Ordinary viewer users extract the prebuilt browser archive and open
`dist/viewer/index.html` directly; no toolchain or server is needed. Contributors
can open that file after `pnpm build` too. To work on source ESM/Worker examples,
serve the repository over loopback HTTP with your preferred static server, e.g.
`python3 -m http.server 8080 --bind 127.0.0.1`, and open `/examples/browser/` or
`/examples/worker/`. Stop the server with Ctrl-C. Library ESM/module Workers
still need HTTP(S). Automated checks should use bounded tests which own their
server/browser lifecycle, not orphan background servers.
See [Electron example setup](examples/electron/README.md) for application preload
bundling. Native Electron acceptance has passed locally and in the verified
macOS 15 hosted job; structural IPC tests remain distinct from that actual runtime
evidence. See [VALIDATION.md](VALIDATION.md).

## Documentation and public API changes

Keep both root READMEs concise and equivalent. Put detailed user workflows in
[`docs/`](docs/index.md), behavior changes in [migration](docs/guide/migration.md)
and [CHANGELOG.md](CHANGELOG.md), and exact signatures in source doc comments.
Users can download CI's **`chmkit-api-<source-sha>`** artifact and browse the
prebuilt HTML without installing development tools. To regenerate as a contributor:

```sh
pnpm docs:build
```

This uses TypeDoc 0.28.20 and [`typedoc.json`](typedoc.json), generating `dist/api/`
with warnings treated as errors. It does not publish a site. See [the API guide](docs/api.md).
Generated HTML belongs in build output, not Git; do not invent a hosted URL or npm release.

When adding an entry, update the canonical build, package export conditions,
`files`, declarations, installed-package tests and runtime boundaries together.
Browser APIs must not depend on Node globals/types; Worker/Electron structural
interfaces must not require installing DOM/Node/Electron declarations merely to
consume the protocol. Entry import must not start a Worker or register IPC.

## Fixtures, licensing and safety

Follow [the licensing policy](docs/guide/licensing.md). Preserve independent oracle
bytes, source/hash/license manifests and formatter/Git exclusions. Do not normalize
fixture HTML or replace external expected output with CHMKit's own output.
All third-party test data and extracted derivatives stay out of public packages,
including GPL/LGPL fixtures. Never run unknown executables/archive scripts to
obtain a fixture. Use a trusted extractor and review redistribution rights.

Preserve strict range/path validation and error propagation. Do not remove
meaningful tests, fake decoders, suppress warnings or use catch-all success
assertions to make CI green. A local security control must not be advertised as
eliminating all TOCTOU, CPU/memory or untrusted-rendering risks.

## Produce prebuilt consumer assets

Maintainers can locally validate delivery **without publishing**:

```sh
pnpm package:artifacts
```

Outputs are in `dist/package/`: tarball, standalone CLI, browser archive, usage,
notices, manifest and checksums. The packager verifies a real npm install in an
isolated system-temp consumer, without borrowing repository dependencies or
requiring a consumer build. It may fetch runtime dependencies from the registry.
The packager strips repository-only scripts/devDependencies from staged metadata;
it does not rewrite the root package. Local dirty assets are labeled as such.

## Review and release policy

Keep changes focused; add regression tests for changed behavior and document
migration impacts. Prefer existing dependencies and native runners. Conventional
commit style is welcome, but do not commit, create a branch, tag, publish, dispatch
a release or change repository/environment permissions on another person's behalf
without explicit authorization.

The [release procedure](.github/PIPELINES.md#manual-release-assets-only) requires a
matching existing tag, coherent package/CLI version, full CI and an independently
reviewed protected environment. Do not assume the matching tag or protected
`release` environment is configured: those prerequisites and explicit human
authorization must exist before dispatch. The workflow can then create a
**draft GitHub release**; a maintainer separately decides whether to publish it.
Ordinary push/PR CI never publishes. There is no npm publishing workflow and no
implicit authorization to publish npm.

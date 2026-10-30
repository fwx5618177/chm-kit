# Validation record

Date: 2026-10-30. This records the current delivery acceptance, not an assurance of universal CHM compatibility. Git history/remote state determine commit and push status. No npm publication, GitHub Release, tag creation or deployment was performed.

## Current local acceptance

Environment: macOS / Darwin 24.6.0 arm64, Node 24.15.0, pnpm 10.34.9. Tool versions are pinned by the lockfile: Vitest 4.1.12, Vite 7.3.7, Playwright Test 1.64.1, TypeScript 5.2.2, TypeDoc 0.28.20, ESLint 10.13.0. Independent 7-Zip 26.05 is installed.

| Check                                              | Observed result                                                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen development install                         | Node 24 clean isolated install with strict engines passed; no deprecated dependency warnings                                                                            |
| `pnpm typecheck` / `pnpm lint`                     | Source, tests, scripts and configuration passed; lint requires zero warnings                                                                                            |
| `pnpm format:check` / `git diff --check`           | Passed; immutable third-party oracle bytes are excluded from formatting/whitespace normalization                                                                        |
| `pnpm test:all`                                    | **849/849 Vitest tests in 56 files**, zero failures/skips; **36/36 Playwright cases**, zero skips/flaky                                                                 |
| Minimum Node 20.10 consumer                        | **30/30 package acceptance cases**; build/runner/compiler remain on development Node, installed runtime exports/CLI/Worker roundtrip execute in a real Node 20.10 child |
| `pnpm test:bench`                                  | Five native Vitest benchmarks executed against real PuTTY data; fixed runner version, finite durations, independent expected-byte preconditions                         |
| `pnpm docs:build`                                  | Actual API HTML generated in `dist/api/`, zero TypeDoc warnings with warnings treated as errors                                                                         |
| `pnpm audit --registry=https://registry.npmjs.org` | **0 known vulnerabilities** across the dependency graph; no overrides or warning suppression                                                                            |
| `pnpm demo`                                        | Four source files byte-identical after extraction; 131,344 source bytes → **7,034 CHM bytes**; range/search/metadata/CLI JSON verified                                  |
| `node scripts/package.mjs`                         | Actual prebuilt tarball, standalone CLI, browser archive, notices, source manifest and SHA-256 inventory generated and verified                                         |

The full native reports are `test-results/vitest.json`, `test-results/package-node20.json`, and `test-results/browser/results.json`. Browser HTML/attachments are under `test-results/browser/`. Performance, RSS calibration and differential evidence are under `test-results/bench/`; timings and process peaks are machine-specific, not performance promises. These ignored outputs are generated evidence, not source fixtures.

## What the tests now establish

- Normal corpus: PuTTY 0.83, official 7-Zip 23.01 help, Inno MyProg and PyCHM variants, preserving independent provenance/licenses/hashes. The new corpus has 721 independently extracted resource expectations plus 11 libmspack malformed/CVE inputs; original PyCHM data remains immutable. See [coverage and limitations](test/conformance/README.md).
- Deterministic bounded mutations, complete resource comparisons, 200 seeded resource ranges and 50 corresponding streams, independent 7-Zip checks, output/metadata/cache/iteration limits. No unbounded fuzz worker runs in CI.
- Real fixed/adaptive/ALIGNED/stored output is checked by external extraction across writer options. The official 7-Zip file revealed and now covers valid zero data base / end-of-file directory ordering.
- File-backed reader/extractor tests include >4 GiB positioned reads, structural budget rejection before allocation, changed/truncated input, cache validation, descriptor cleanup and cancelled/failed output cleanup. Prediction/close tests use actual scheduled work and verify bounded I/O, not only option validation.
- Worker/Electron tests exercise actual client/host and injected IPC, permission rejection, limits, transfer ownership, retryable close, cancelled opens, transport failure and lifecycle disposal. Playwright consumes **built** browser/Worker/resources modules; there is no source-bundle fallback. Native Electron itself has not been run.
- Installed-package tests consume the **same staged tarball produced by the delivery packager**, outside the repository dependency ancestry. They cover CJS/ESM, all platform subpaths, plain browser bytes, templates/updates, portable declarations without DOM/Node, CLI and absent consumer lifecycle/dev tooling.
- Documentation relative links are checked by Vitest. User docs separate prebuilt consumption from contributor builds; TypeDoc derives exact signatures rather than duplicating a manually maintained API list.

## Delivery and migration

The [verified hosted downloads](docs/guide/downloads.md#verified-prebuilt-snapshot) contain `chmkit-1.1.0.tgz`, `chmkit-1.1.0-cli.cjs`, `chmkit-1.1.0-browser.tar.gz`, usage, notices, `manifest.json` and `SHA256SUMS`. Both the consumer assets and generated TypeDoc artifact were downloaded from run `41003535243`; all asset sizes/hashes, manifest/checksum inventory, exact source `45a5b5f3ba186bed283036da074e3c697931ffea`, version `1.1.0` and `dirty: false` passed verification. The downloaded standalone CLI reports `1.1.0`, and the API entry contains the generated CHMKit reference.

The hosted tarball (SHA-256 `f946d196cb21fea34943436dc982b36c38ce55c5602350cc175f06082018dad0`, identical in verified runs `41002548476` and `41003535243`) was also installed with ordinary npm, without `--ignore-scripts`, in a real system-temp consumer outside repository ancestry. It passed archive pack/read roundtrip, metadata checks for absent lifecycle/dev tooling and an independently copied standalone CLI. Consumers do not build, install pnpm/TypeScript or initialize Git hooks. Uncommitted local builds remain marked `dirty: true`; none of these assets is an npm publication or approved public release.

Source installation/development requires Node 22.13+ or 24; the library floor remains Node 20.10. Node 20.19 compatibility jobs install development dependencies on Node 24 before switching runtimes. `prepare` is absent, `pnpm hooks:install` is opt-in. The root `prepack` remains a maintainer build step; shipped tarballs omit repository lifecycle metadata.

See the [migration guide](docs/guide/migration.md) for changed compression/TOC behavior, strict path/config/error semantics, preserved error causes and file-input immutability. Fixed parser metadata ceilings are 1 MiB header, 64 MiB directory and 16 MiB per ControlData/ResetTable stream. They do not cap ordinary file/Content length or total process memory; valid larger metadata is explicitly rejected.

## Hosted CI and warnings

Historical runs `40927079982` / `40927652020` passed the earlier 532-case revision. They are **not evidence for this revision**.

The revised workflow uses verified Node-24 official action SHAs, explicit Ubuntu 24.04/macOS 15/Windows 2025 labels, current supported dependencies and an exact pnpm bootstrap. No `NODE_NO_WARNINGS`, log filtering, forced runtime override or silent fallback is used. It runs nine Node compatibility jobs, three real-browser jobs and a separate minimum-runtime installed-consumer job; a fourteenth delivery/docs job depends on all of them. See [.github/PIPELINES.md](.github/PIPELINES.md).

[Hosted run 41003535243](https://github.com/fwx5618177/chm-kit/actions/runs/41003535243), exact source `45a5b5f3ba186bed283036da074e3c697931ffea`: **14/14 jobs passed**.

| Hosted acceptance                   | Observed result                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Ubuntu 24.04 × Node 20.19 / 22 / 24 | 849/849 tests on each runtime, zero skips                                      |
| macOS 15 × Node 20.19 / 22 / 24     | 849/849 tests on each runtime, zero skips                                      |
| Windows 2025 × Node 20.19 / 22 / 24 | 848 passed plus one expected POSIX-only SIGINT skip per runtime; zero failures |
| Installed consumer × Node 20.10.0   | 30/30 passed                                                                   |
| Chromium / Firefox / WebKit         | 12/12 each; zero skips, retries or flaky results                               |
| Delivery and generated API          | Consumer assets and TypeDoc uploaded successfully; downloaded and verified     |

All 14 check runs' annotations and all 14 complete raw logs (751,594 bytes / 7,750 lines) were inspected. There were **zero warning/failure annotations**, no deprecation, unknown-config, npm warning/error or browser pre-transform/failed-import diagnostics. Three macOS **capacity notices** remain; these are GitHub infrastructure information, not hidden technical warnings.

Earlier runs found and drove real fixes: Windows ESM loaders now use `file:` URLs; the TypeScript virtual host canonicalizes separators/case; the ctime-only mutation test observes an actual filesystem timestamp change instead of assuming every same-tick write changes it; and Playwright's server command completes the build before launching Vite/readiness requests. The obsolete browser global-setup script was removed. A clean local browser-output deletion followed by Playwright also passed 36/36 with zero startup diagnostics. Logs are retained under ignored `test-results/hosted-45a5b5f/`; hosted test reports are available from the run's artifacts.

## Reproduction

Contributor-only commands (ordinary users choose [prebuilt downloads](docs/guide/downloads.md)):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium firefox webkit
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:all
pnpm test:bench
pnpm docs:build
pnpm demo
pnpm package:artifacts
pnpm audit --registry=https://registry.npmjs.org
```

For minimum-runtime acceptance, resolve an actual Node 20.10 executable, then run the package project under the development Node with `CHM_TEST_NODE` set to that executable and a distinct JSON output path. Do not try to run modern Vite on Node 20.10 or interpret a tool-engine warning as a library-runtime failure.

Browser installation, isolated consumer dependency installation and registry auditing require network access. Parsing/reading local archives does not upload their content. Build/delivery operations do not publish or deploy.

## Remaining independent evidence / authorization

[TODO.md](TODO.md) retains the genuinely unresolved gates: legally redistributable normal ITSF v2/other encoding/window/reset/E8 corpus, native Electron runtime acceptance, independent release approval/tag/environment policy, and separately authorized public npm/API-site publication. Code support, synthetic input, a protected workflow and a local artifact are not substitutes for those facts.

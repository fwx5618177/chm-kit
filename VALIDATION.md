# Validation record

Date: 2026-10-30. This records verified execution and downloaded-artifact evidence,
not universal CHM compatibility or authorization to publish a release.

## Verified hosted acceptance

[Run 41044610433](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433)
at exact source **`962ee71d52b0d1198a36c6c5d69c82a53e62caf9`**, package version
**1.1.0**: **15/15 jobs succeeded**. The matrix contains nine Node jobs,
three browser jobs, minimum-runtime acceptance, native Electron and dependent
delivery/API generation.

| Hosted check                          | Verified result                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Ubuntu 24.04 × Node 20.19 / 22 / 24   | 883/883 Vitest cases passed per job                                                          |
| macOS 15 × Node 20.19 / 22 / 24       | 883/883 Vitest cases passed per job                                                          |
| Windows 2025 × Node 20.19 / 22 / 24   | 883 total per job: 882 passed + 1 expected POSIX-only SIGINT skip; no failures               |
| Minimum Node 20.10 installed consumer | 31/31 passed                                                                                 |
| Chromium / Firefox / WebKit           | 13/13 each, 39 total; zero retries/flaky results                                             |
| Native Electron 45.1.0 / macOS 15     | 7/7 passed, real installed tgz outside the repository, IPC permissions/lifecycle/screenshots |
| Delivery and TypeDoc                  | Runtime assets and API HTML uploaded, downloaded and verified                                |

All **15 complete logs (786,857 bytes / 8,129 lines)** and all annotations were
inspected: **zero technical warnings/errors**, including esbuild, Vite, IPC, npm
and deprecation diagnostics. Infrastructure noise was present: **4 macOS
capacity notices** and **11 nonfatal cache-reservation contentions**. No warning
suppression or log filtering is used. This was not an infrastructure-noise-free run.

## Consolidated local acceptance

`pnpm test:all` passed **883/883 Vitest cases in 58 files** and **46/46 Playwright
cases** (39 browser + 7 native Electron), with zero failures/skips/flaky results.
It is `pnpm test && playwright test`: one Playwright invocation preserves all four
projects in the same report. Focused `test:browser` / `test:electron` runs replace
that report; current paths are `test-results/playwright/{results.json,html,artifacts}`.
Vitest/minimum reports are `test-results/vitest.json` and `test-results/package-node20.json`.

The actual Node 20.10 installed consumer passed **31/31**. Frozen installation,
typecheck, zero-warning lint, formatting/whitespace checks, actionlint, TypeDoc
build and the actual demo passed. The official-registry audit found **0 known
vulnerabilities**. Local environment: macOS arm64, Node 24.15.0, pnpm 10.34.9;
Vitest 4.1.12, Playwright 1.64.1, Vite 7.3.7 and independent 7-Zip 26.05.

## Verified downloaded consumer assets

- [Runtime bundle: tgz, standalone CLI and browser viewer/modules/types](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433/artifacts/12972336497)
- [Generated TypeDoc HTML](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433/artifacts/12972316614)

The downloaded manifest identifies exact source `962ee71d52b0d1198a36c6c5d69c82a53e62caf9`,
version **1.1.0**, `dirty: false`. All sizes, asset hashes, checksum inventory and
npm file inventory were verified; the API `index.html` was checked.

| Downloaded asset              | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `chmkit-1.1.0.tgz`            | `367a19b0bf8094f2147c25367bd857bb16e0d5a801854a58566f685dd1550e04` |
| `chmkit-1.1.0-browser.tar.gz` | `29af4a2f9238a352d98480e05534e230c025fc5d1e096bd11fad57002f9166f1` |
| `chmkit-1.1.0-cli.cjs`        | `b05938512175dd868bc9055d7e27ce01a6de16d36033c338b3d71379ae5ee6bc` |

The **actual downloaded browser archive**, not just build output, was extracted
and opened as `file:` in Chromium, Firefox and WebKit through Playwright. All
three loaded the sample preview with **zero HTTP requests/errors**, with actual
screenshots. It contains `dist/viewer/{index.html,viewer.js,reader.worker.js,worker-client.js}`
plus browser modules/types/licenses. The classic-IIFE viewer needs no Node/npm,
server or build; library ESM/module Worker integrations still require HTTP(S).

The **actual downloaded tgz** was installed with ordinary npm, **without
`--ignore-scripts`**, in a system-temp consumer outside repository ancestry.
Repository/dev/lifecycle metadata was absent; pack/read roundtrip and a separately
copied standalone CLI reporting **1.1.0** passed. No consumer build was required.
Actions downloads require sign-in and expire; these are not npm publications or
approved public Releases. See [downloads](docs/guide/downloads.md).

## Compatibility and security evidence

- Six normal archives, 859 independent resource expectations and 886 checksummed
  fixture files total, including 11 malformed upstream inputs. Original oracle
  bytes, provenance and licenses remain immutable and excluded from delivery.
- The unchanged official FPC 3.2.2 `fpdoc` passes all 138 resources plus ranges/
  streams. Exact v3 duplicated-first-GUID, consistent density-2 quickrefs/verified
  leaf hint and terminal ResetTable normalization retain strict corruption checks.
- Native Electron uses `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`; actual IPC permission and reader-lifecycle checks are
  distinct from injected-IPC tests. Inputs are authored integration samples, not
  new independent conformance oracles. Electron 45.1.0 remains dev-only; the
  official `pnpm exec install-electron` needs no pnpm lifecycle approval.
- Bounded mutation/differential tests, parser limits and sandbox/CSP improve
  confidence, not exhaustive safety. See [coverage](test/conformance/README.md),
  [format](docs/guide/format-lzx.md), [budgets](docs/guide/configuration.md) and [security](SECURITY.md).

## Cache follow-up — separate hosted verification pending

The working-tree follow-up replaces competing post-job saves with verified
`actions/cache/restore` and `save` v6.1.0, all-job restore and only three designated
Node-24 OS writers saving immediately after frozen install. It also emits the
actual pnpm store path by executing the installed JS entry, not a Windows `.cmd`.
These changes need their **own hosted cold-cache run**; run 41044610433 does not
verify them or prove cache contention eliminated. See [.github/PIPELINES.md](.github/PIPELINES.md).

## Reproduction and remaining gates

[Contributor setup and commands](CONTRIBUTING.md#focused-validation-then-acceptance)
cover frozen install, explicit browser/Electron binary installation and full
`pnpm test:all` acceptance; ordinary users choose the verified downloads.
Minimum-runtime checks execute the installed consumer with real Node 20.10,
not modern Vite on that runtime. Binary/dependency installs and audit need network
access; local archive parsing does not upload content. Builds do not publish.
Normal upstream v2, GBK/UTF-16 and additional E8/window/long-reset inputs, independent
public-release approval/tag/environment policy, and separately authorized npm/API-site
publication remain open in [TODO.md](TODO.md).

## Brief history

Run 41003535243 at `45a5b5f` was the earlier 14-job baseline; older runs predate
that toolchain revision. They are historical only. Run 41044610433 is the verified
viewer/FPC/native-Electron delivery recorded above, not evidence for later cache edits.

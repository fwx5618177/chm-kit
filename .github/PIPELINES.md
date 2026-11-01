# CI, prebuilt downloads and approved releases

## CI contract

`workflows/ci.yml` runs for pushes, pull requests, manual dispatches and the
release workflow's reusable-workflow call. It has read-only repository access;
it never publishes to npm, deploys, creates tags or creates releases.

- Nine Node jobs: Ubuntu **24.04 LTS x64**, **macOS 15 arm64** and **Windows
  Server 2025 x64**, each with Node **20.19.0 / 22 / 24**. Linux requires the
  independent 7-Zip CHM oracle. These are explicit OS labels, not immutable image
  snapshots: GitHub still applies image updates within the selected OS.
- Three real-browser jobs: Chromium / Firefox / WebKit on Ubuntu 24.04, using
  `pnpm test:browser` (`playwright test test/browser`).
- One native Electron job on **macOS 15**, using the exactly pinned dev-only
  Electron **45.1.0**. After the frozen script-disabled install, it runs
  `pnpm exec install-electron` (the official native-binary installer; no lifecycle
  approval needed), then `pnpm test:electron`. It installs the real CHMKit tgz
  outside the checkout and exercises the actual sandboxed example, IPC permissions,
  lifecycle and screenshots. Electron is not a consumer runtime dependency.
- Format checking and the delivery-script regression tests run in the Linux
  Node 24 job. Existing typecheck, lint, Vitest and Playwright acceptance remain.
- A separate minimum-runtime job builds on Node 24 and runs the 31 installed
  consumer cases with a real Node 20.10.0 executable. Modern development tools
  are not run on the library's minimum consumer runtime.
- The fifteenth job is delivery: it runs **only after all fourteen acceptance
  jobs pass** (9 Node + 3 browser + minimum + native Electron).
  It invokes the canonical `pnpm build`, generates TypeDoc with warnings treated
  as errors, then runs `node scripts/package.mjs`. API HTML is uploaded separately.
- Every dependency install in the source checkout uses
  `pnpm install --frozen-lockfile --ignore-scripts`. Only pnpm's actual store is
  cached, keyed by OS, architecture and `pnpm-lock.yaml`; `node_modules` and build
  outputs are not cached. The single-writer policy below has verified cold-cache
  acceptance on all three platforms.
- Toolchain order is Node 24 bootstrap → npm install of the exact `packageManager`
  pnpm version into the runner temp directory (no lifecycle scripts) → pnpm
  store cache + frozen source install on Node 24 → selected compatibility Node.
  Development tools require Node 22.13+; testing the library on Node 20.19 does
  not mean its development dependencies should be installed under Node 20.
  No root package.json/lockfile mutation, globally overwritten pnpm or duplicate
  cache ownership is needed.
- Test report uploads use `if-no-files-found: error`: a missing report is a real
  failure, not a warning to ignore. Reports are retained for 14 days; consumer
  assets for 30 days, subject to repository retention limits.

All Playwright projects share `playwright.config.ts`, with explicit browser and
Electron test directories. `pnpm test:all` is `pnpm test && playwright test`:
Vitest followed by **one invocation of all four Playwright projects**, preserving
all 46 browser/native cases under
`test-results/playwright/{results.json,html,artifacts}`. Each browser/native CI
job uploads its own report tree; focused local invocations replace the previous
report. **Run 41044610433 at `962ee71` passed all 15 jobs**; the subsequent cache
policy also passed its own 15-job run, recorded below.

## Cache policy — verified single-writer ownership

The setup replaces competing post-job saves with separate
`actions/cache/restore` and `actions/cache/save` **v6.1.0**, both pinned to
**`55cc8345863c7cc4c66a329aec7e433d2d1c52a9`**. The official release tag and both
entry points' Node-24 runtimes were verified; the actual hosted cold-cache flow
was then executed on Linux, macOS and Windows.

- **All 15 jobs restore; only three write.** The Node-24 matrix job for each of
  Ubuntu/macOS/Windows is the designated writer of its OS/architecture key. The
  remaining **12 jobs are restore-only**, including browser, minimum, Electron
  and delivery jobs. A cold-cache miss in a restore-only job is normal.
- The composite setup defaults `cache-save` to false. A designated writer saves
  only on a miss, **immediately after the successful frozen install**, before
  runtime switching/tests. It does not defer a competing save to post-job cleanup.
- Fresh keys are `pnpmstore-<OS>-<arch>-<lockhash>`, using `runner.os`,
  `runner.arch` and `hashFiles('pnpm-lock.yaml')`; old cache namespaces are not
  reused. Build output and `node_modules` remain uncached.
- `scripts/setup-pnpm.mjs` emits `store-path` using the installed pnpm **JS entry**
  executed by `process.execPath` with `store path --silent`, not a Windows `.cmd`
  shim. Restore/save use that actual validated absolute path.

[Run 41046798648](https://github.com/fwx5618177/chm-kit/actions/runs/41046798648)
at exact `4bb18ee53eb395131239185c57dad5b4cb3bc0f0` passed **15/15 jobs**.
There were **13 cold misses, two later warm hits and exactly three successful
save attempts**, all from the Node-24 owners (one per OS). All three owners
missed before saving, exercising the fresh namespace rather than merely hitting
an old cache. Twelve jobs remained restore-only. All 15 complete logs and
annotations were inspected: **zero cache reservation/save failures or technical
warning/error matches**. The earlier `962ee71` run's eleven contention messages
are absent; four macOS capacity notices still remain.

## Action versions and real warnings

Verified against official GitHub release/tag APIs and each version's `action.yml`
on **2026-10-30**. The used JavaScript actions declare `runs.using: node24`; their
runtime is independent of the Node version under compatibility test.

| Action                                     | Verified release | Pinned commit                              |
| ------------------------------------------ | ---------------- | ------------------------------------------ |
| `actions/checkout`                         | `v7.0.1`         | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node`                       | `v7.1.0`         | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact`                  | `v7.0.2`         | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| `actions/download-artifact` (release only) | `v8.0.2`         | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |
| `actions/cache/restore` (cache follow-up)  | `v6.1.0`         | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/cache/save` (cache follow-up)     | `v6.1.0`         | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |

`pnpm/action-setup v6.1.0` was also verified: its annotated tag peels to commit
`ea17c68df8912ef543352723c149a84f56e3d413`, and its runtime is Node 24. It is
**not used**: executing that official bundle locally against this repository's
pnpm 9 reproduced a new `[WARN] Detected a pnpm v10 installation layout ... pnpm
v11 expects bins in PNPM_HOME/bin` warning during its bootstrap self-downgrade.
The ordinary, pinned npm bootstrap in `scripts/setup-pnpm.mjs` avoids that path
instead of suppressing diagnostics. Its local Node 24 smoke install completed
without deprecation or layout warnings. Dependabot checks used action pins weekly.

Evidence from [hosted run 40927652020](https://github.com/fwx5618177/chm-kit/actions/runs/40927652020)
at source revision `a67ffe9`:

- Each of the twelve jobs has an annotation that the four old `@v4` actions target
  deprecated Node 20 and are being forced onto Node 24.
- The raw logs contain `DEP0040` (`punycode`) from old setup-node/upload-artifact,
  and `DEP0169` (`url.parse()`) in the old pnpm self-installer and cache/upload
  paths. Upgrading only the action runtime major would not prove the bundled
  dependencies were fixed.
- Ubuntu jobs have the notice: `ubuntu-latest` will migrate to Ubuntu 26 beginning
  October 19, 2026. Pinning Ubuntu 24.04 is the documented mitigation in
  [runner-images issue 14748](https://github.com/actions/runner-images/issues/14748).
- macOS arm64 jobs also have a **capacity/queue-time notice**. This is GitHub
  infrastructure information, not a code deprecation. It may remain with the
  explicit `macos-15` arm64 runner; do not describe the change as guaranteeing
  zero future notices or warnings from external services.

No `NODE_NO_WARNINGS`, `--no-warnings`, forced action-runtime overrides, log
filtering or warning suppression is part of the pipeline.

[Verified hosted run 41044610433](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433)
at exact source **`962ee71d52b0d1198a36c6c5d69c82a53e62caf9`** passed **15/15 jobs**.
Each Node job had 883 cases (Windows: 882 passed + one expected POSIX SIGINT skip);
minimum-runtime acceptance passed 31, each browser passed 13 without retry/flake,
and native macOS 15 / Electron 45.1.0 passed 7. All **15 complete logs (786,857
bytes / 8,129 lines)** and annotations were inspected: **zero technical
warnings/errors**, including esbuild/Vite/IPC/npm/deprecation diagnostics.
**Four macOS capacity notices and eleven nonfatal cache-reservation contentions**
were observed; they are not hidden or relabeled as a noise-free run. The later
cache-policy run above separately confirms elimination of the contention.

The actual runtime/API artifacts were downloaded; exact source, version 1.1.0,
`dirty: false`, all sizes/hashes and inventories were verified. The downloaded
browser viewer passed direct `file:` sample preview with zero HTTP requests/errors
in all three engines; ordinary npm installation of the downloaded tgz outside
the checkout, pack/read roundtrip, copied standalone CLI and API entry passed.
See [`VALIDATION.md`](../VALIDATION.md) and [downloads](../docs/guide/downloads.md#verified-prebuilt-snapshot).

Run 41003535243 at `45a5b5f` remains the historical 14-job baseline only. Later
working-tree changes require their own hosted run; local YAML validation does
not substitute for it.

## Downloadable assets: no consumer build

From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node scripts/package.mjs
```

The full build remains the single owner of public entry generation. The packager
reads `files`, `exports`, `bin`, version and runtime dependencies from the current
package metadata instead of hard-coding the Worker/Electron API names. All
canonical browser chunks and declaration files are retained. The root metadata
must list every new public output; missing export/bin targets fail packaging.

`dist/package/` contains:

| File                          | Consumer use                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `chmkit-1.1.0.tgz`            | `npm install ./chmkit-1.1.0.tgz`; compiled CJS/ESM, browser modules, CLI and declarations                                 |
| `chmkit-1.1.0-cli.cjs`        | `node chmkit-1.1.0-cli.cjs --help`; bundled npm dependencies, only Node built-ins remain external                         |
| `chmkit-1.1.0-browser.tar.gz` | Extract and open `dist/viewer/index.html` directly; also includes `dist/browser/` chunks, `dist/types/`, docs and notices |
| `chmkit-1.1.0-USAGE.md`       | Versioned installation/usage notes                                                                                        |
| `THIRD_PARTY_NOTICES.txt`     | License notices from runtime dependencies and their dependency graph; also included inside the archives                   |
| `manifest.json`               | Schema, version, source commit, dirty flag, toolchain, asset size/SHA-256 and exact npm file inventory                    |
| `SHA256SUMS`                  | SHA-256 for every asset and the manifest                                                                                  |

These are the current 1.1.0 filenames; `manifest.json` identifies the exact
version and source of a particular bundle. The browser archive now includes
`dist/viewer/{index.html,viewer.js,reader.worker.js,worker-client.js}`;
`viewer.js` is a classic self-contained IIFE for direct `file:` opening, not an
ESM entry. The actual downloaded archive from the verified `962ee71` snapshot
passed zero-HTTP/error sample preview in all three engines with screenshots.
Library ESM and module Worker use still require HTTP(S).

The npm asset's staging metadata removes repository-only scripts (including
`prepare` / `prepack`), devDependencies and package-manager/hook configuration.
The repository itself is not rewritten. `preinstall` / `install` / `postinstall`
hooks and local/git/URL runtime dependencies are rejected rather than silently
carried to consumers. Public output paths and regular files are allowlisted;
symlinks, source/test trees, fixtures, demo data, nested packages and declaration
intermediates are rejected. The official npm tarball does not need pnpm, husky,
a compiler or a consumer-side build.

The packager also installs the **actual delivered tarball** with npm in a real
system-temp consumer outside repository ancestry, without `--ignore-scripts`,
checks that development scripts/dependencies are absent, exercises installed CLI
version/help, and runs a copied standalone CLI in a separate empty directory.
The existing Vitest installed-package suite provides the broader API/type/browser
acceptance; the delivery script is not a replacement custom test runner.

Local uncommitted builds are marked `dirty: true`. They can be used for testing,
but the release workflow rejects them. SHA-256 detects corruption; it is not a
signature or a substitute for trusting the source of the manifest. Standalone
CLI downloads still require supported Node; they do not embed a Node executable.
The standalone browser viewer needs only a modern browser, not Node/npm, a
server or a local build toolchain. Library ESM/module Worker hosting still uses
HTTP(S).

CI uploads the complete directory as artifact **`chmkit-<github.sha>`**, available
under the run's **Artifacts** section. GitHub Actions artifact downloads normally
require GitHub sign-in and expire. Approved public release assets provide durable,
anonymous downloads after a maintainer publishes the draft release.

## Manual release assets only

`workflows/release.yml` has **only `workflow_dispatch`**. Do not dispatch it until
release is explicitly authorized. It is intentionally not an automatic tag/push/PR
publishing flow and has never been run as part of this implementation.

Prerequisites for a maintainer, not actions performed by this change:

1. Choose and commit the intended semantic package version and matching CLI
   version on `main`; integrate all new build entries/exports/files and lockfile
   changes before release.
2. Separately authorize/create an existing `v<version>` tag pointing to that exact
   main commit. The workflow never creates a tag and refuses mismatched tags.
3. In repository Settings → Environments, configure environment **`release`** with
   **required reviewers**, **prevent self-review**, and **administrator bypass
   disabled**. Restrict its deployment branch policy to `main`. This requires
   an eligible repository/plan and an independent reviewer. No environment or
   protection setting is created/changed by the scripts.
4. Manually dispatch **Approved release assets** on `main` with exact `version`
   and `tag`. User inputs are validated in Node and passed as process arguments,
   never interpolated into shell commands.
5. Read-only preflight checks real environment protection, exact package version
   and peeled existing tag commit. The reusable CI runs the full nine-Node,
   three-browser, minimum-runtime and native Electron acceptance matrix and produces the prebuilt
   download artifact.
6. GitHub pauses the release job for environment review. After approval, a separate
   no-dependency-install job downloads only this run's artifact, rechecks policy,
   tag and source identity, validates all asset hashes/inventory, and creates a
   **draft GitHub release** using `gh release create --verify-tag --draft`.
   Existing releases are never overwritten. Prerelease versions are marked as
   prereleases. A maintainer can inspect and publish the draft in GitHub's UI.
7. A second environment-gated job then publishes npm. Order matters: npm
   publication is irreversible, so it runs last and a failed job is re-run without
   touching the draft. It re-verifies hashes and source commit, refuses a version
   already on the registry, and uploads this run's tarball byte-for-byte.

Normal CI and builds have only `contents: read`. The approved GitHub release job
has `contents: write`; environment preflight also needs `actions: read`. The `npm`
job in the same dispatch workflow is the only npm publishing path: it is granted
`id-token: write` and nothing else, exchanges that short-lived OIDC token with npm
**trusted publishing**, and publishes with `--provenance` under `latest` (`next`
for prereleases). No npm token or secret exists in this repository. Never add npm
publishing to push/PR CI, and never fall back to a static token.

One-time prerequisite on npmjs.com, not performed by any script here: the
`chmkit` package must exist and list a **Trusted Publisher** with repository
`fwx5618177/chm-kit`, workflow `release.yml` and environment `release`. The very
first version has to be published once by a maintainer with their own 2FA-enabled
account; every later version uses the OIDC job above. `publishConfig` pins the
publish target to `registry.npmjs.org`, so a machine-wide mirror registry
(npmmirror) cannot silently receive a release; `npm login` still needs an
explicit `--registry https://registry.npmjs.org/` on such machines.

## Local verification

```sh
pnpm test:delivery
pnpm exec prettier --check .github scripts
# Optional local tool; not an npm dependency:
actionlint .github/workflows/ci.yml .github/workflows/release.yml
pnpm build
node scripts/package.mjs
```

The delivery/policy regression tests are native Vitest cases, included in `pnpm test`, and do
not call release/tag/publish APIs. Their malformed-metadata, lifecycle, path,
conditional-export, version, approval, source identity, corruption, extra-file,
checksum and symlink cases are wired into CI. Temporary consumers/audit files are
removed rather than kept as ad hoc fix scripts.

The canonical `pnpm package:artifacts` command builds and packages all public
entries, including Worker/Electron/resources. `pnpm test:delivery` selects the
same policy and metadata cases that run in the full Vitest suite. `prepare` is
absent; contributors opt into Git hooks with `pnpm hooks:install`. `prepack`
remains a maintainer build step, never a consumer installation requirement.

Keep package and CLI versions synchronized. Download documentation in both
READMEs distinguishes generated local assets, actual hosted CI artifacts and
separately approved public releases. Record new run URLs/results in
`VALIDATION.md`; do not present historical passing jobs as evidence for new code.

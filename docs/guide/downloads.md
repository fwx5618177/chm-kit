# Prebuilt downloads

[Documentation](../index.md) · [CLI](cli.md) · [Node](node.md) · [Browser](browser.md)

Choose a ready-to-open browser viewer, standalone CLI or precompiled library.
Users do not need to clone the repository or compile TypeScript. CI's delivery
job depends on Node, browser, minimum-runtime and native Electron acceptance.
The verified 1.1.0 snapshot below includes the standalone local viewer.
The public `chmkit` npm package is **not published**; publication requires separate
authorization. Import examples using `chmkit` assume you installed the downloaded
local tarball.

## Find an artifact

1. Visit [CI runs](https://github.com/fwx5618177/chm-kit/actions/workflows/ci.yml).
2. Select a successful run for the source revision you intend to use. Check that
   **Prebuilt consumer downloads** completed, not just an individual test job.
3. Sign in to GitHub and download **`chmkit-<full-source-sha>`** in **Artifacts**.
4. Unzip the Actions wrapper. Read `manifest.json`: it identifies the version,
   source commit, dirty state, toolchain, asset hashes and exact npm file inventory.

Actions downloads normally require GitHub login. The workflow requests 30-day
consumer artifact retention, subject to repository limits; expired artifacts
are not durable releases. If none are available, ask a maintainer for a verified
prebuilt artifact rather than installing an unrelated similarly named npm package.
Do not assume the current workspace has already been uploaded to Actions.

An approved GitHub Release can provide durable anonymous assets later. The
verified Actions downloads below are available now, not a public Release or tag.

### Verified prebuilt snapshot

Version **1.1.0**, exact source **`962ee71d52b0d1198a36c6c5d69c82a53e62caf9`**,
passed **15/15 jobs** in
[run 41044610433](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433)
on 2026-10-30. It includes the standalone viewer, FPC compatibility fixes and
native Electron acceptance. These are actual downloaded and verified artifacts:

- [Prebuilt local viewer, standalone CLI, npm tarball and browser modules/types](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433/artifacts/12972336497).
- [Generated TypeDoc HTML](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433/artifacts/12972316614).

The downloaded manifest reports version `1.1.0`, that exact source and
`dirty: false`; all asset sizes/hashes and checksum/npm file inventories were
verified. The **downloaded browser archive** was extracted and opened as `file:`
in Chromium, Firefox and WebKit through Playwright: sample preview passed with
zero HTTP requests/errors and screenshots. This was not only a build-output test.
The **downloaded tgz** passed ordinary npm installation without `--ignore-scripts`
in a system-temp consumer outside repository ancestry, absent repository/dev/
lifecycle metadata, with pack/read roundtrip and copied standalone CLI version
`1.1.0` verified. The API `index.html` was checked too.

This is a fixed verified snapshot, not an automatic latest-release link or proof
of later working-tree changes. GitHub sign-in/retention limits still apply; if it
expires, select another successful run above and inspect its manifest. Exact
hashes, counts and infrastructure notices are in [VALIDATION.md](../../VALIDATION.md).

## Select an asset

The commands below use the current concrete version **1.1.0**. Check your
`manifest.json` once for the exact version, source commit and asset inventory;
use its filenames if downloading a different version.

### Local browser viewer

Extract the current `chmkit-1.1.0-browser.tar.gz`, then double-click
**`dist/viewer/index.html`**. Choose a local `.chm` file or click the built-in
sample to browse files, search and preview pages. No Node, npm, source build,
Vite, bundler or HTTP server is needed for this viewer.

The archive contains:

```text
dist/viewer/index.html
dist/viewer/viewer.js          # self-contained classic IIFE, not an ESM entry
dist/viewer/reader.worker.js
dist/viewer/worker-client.js
dist/browser/                # library ESM and relative chunks
dist/types/                  # declarations
```

Keep the extracted directory intact, including licenses/notices. The viewer's
classic script works directly under `file:`; all three real-browser engines
opened the extracted downloaded viewer and loaded the generated sample preview
with **zero HTTP requests or errors**.
This measured path is not a universal privacy guarantee for every application
or arbitrary page. Restricted preview behavior and safety boundaries are in the
[browser guide](browser.md).

### Standalone command line

```sh
node chmkit-1.1.0-cli.cjs --version
node chmkit-1.1.0-cli.cjs --help
node chmkit-1.1.0-cli.cjs read manual.chm --list --format json
```

Only supported Node.js and built-ins are required; npm dependencies are bundled.
There is no embedded Node executable, GUI or Electron runtime. Use this file when
you do not want an npm installation or need an offline CLI. With this form,
replace `chmkit` in the [CLI guide](cli.md) with `node chmkit-1.1.0-cli.cjs`.

### Node library and installed CLI

```sh
npm install ./chmkit-1.1.0.tgz
npx --no-install chmkit --version
npx --no-install chmkit --help
```

The tarball contains compiled CJS/ESM, browser chunks and declarations. It does
not require pnpm, husky, TypeScript, repository hooks or an installation-time build.
`npm install` can contact the registry for runtime dependencies. For fully offline
library installation, arrange a trusted dependency cache/mirror separately; the
standalone CLI's offline behavior does not make the npm dependency graph offline.

Use `import { CHMReader } from 'chmkit'` in ESM, or
`const { CHMReader } = require('chmkit')` in CommonJS. Follow the tarball's
`engines.node`; Node.js 22/24 are recommended for new deployments.

### Browser ESM and module Worker integration

```sh
tar -xzf chmkit-1.1.0-browser.tar.gz
```

Keep `dist/browser/` intact, including its `chunks/` and relative module paths.
Serve it over HTTP(S) using your existing static host. Import
`./dist/browser/index.mjs` for the explicit browser reader or `root.mjs` for the
root facade. Declarations are in `dist/types/`; they are not browser runtime code.
A browser cannot resolve a bare `chmkit/browser` specifier without a bundler or
an import map. Unlike the standalone classic-script viewer, library ESM and
module Worker integration require HTTP(S); `file:` is not a suitable module
Worker host. The copied viewer Worker entry/client are integration files, not a
claim that module Workers run directly from disk.

See [browser integration](browser.md) and [Worker integration](worker.md).

### API reference

Download the separate **`chmkit-api-<full-source-sha>`** artifact from the same
successful CI run. It contains TypeDoc HTML, not another runtime package. Extract
the entire artifact, keep its directories intact and open `index.html` locally.
You do not need Node, pnpm or a source build to read it. If your environment
requires HTTP(S), serve that directory with your existing trusted static host.

The [verified API download](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433/artifacts/12972316614)
was downloaded and its entry checked for the exact `962ee71` snapshot. It normally
requires GitHub sign-in and requests 30-day retention; it is downloadable HTML,
not a publicly deployed API site. The [API entry map](../api.md) is readable in
the repository.

## Verify the download

After unzipping the Actions wrapper, run from the directory containing all assets:

```sh
# Linux
sha256sum -c SHA256SUMS

# macOS
shasum -a 256 -c SHA256SUMS
```

On Windows PowerShell, run `Get-FileHash -Algorithm SHA256 <asset-file>` and compare
its full digest to the corresponding `SHA256SUMS` entry. Check `manifest.json`
as well as the asset you plan to use. Preserve `THIRD_PARTY_NOTICES.txt`.

A hash detects corruption or mismatch. It is **not a signature**: an attacker
able to replace both an asset and its manifest can replace both hashes. Obtain
the entire artifact from a trusted repository/run and check its source identity.
Local builds may have `dirty: true`; those are not approved release assets.

## Release approval, not automatic publication

Normal CI does not create tags, publish npm packages, deploy a documentation site
or create releases. The manual release workflow requires an existing matching
tag, version checks, complete CI and a separately protected `release` environment
with independent review. Creating the matching tag and configuring that protected
environment are **uncompleted prerequisites**, not actions performed by this
work. When explicitly authorized and configured, the workflow creates a **draft**
release; publishing that draft is a separate maintainer decision. Running CI or
writing docs is not release authorization.

See [the maintainer release procedure](../../.github/PIPELINES.md#manual-release-assets-only).
Do not dispatch it, create a release with `gh`, or publish npm without explicit
permission. npm publication needs separate authorization and an approved
publishing flow; it is not enabled by these downloads.

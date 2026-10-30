# Prebuilt downloads

[Documentation](../index.md) · [CLI](cli.md) · [Node](node.md) · [Browser](browser.md)

CHMKit's consumer downloads are built by CI after its Node and browser acceptance
jobs succeed. Users do not need to clone the repository or compile TypeScript.
The public `chmkit` npm package is **not published**: the registry currently
returns 404, and npm publication is not planned for this work. Import examples
using `chmkit` assume you installed the downloaded
local tarball; they do not imply a registry publication.

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

An approved GitHub Release can provide durable anonymous assets later. No
particular release/tag/download URL is represented here as already existing.

### Verified prebuilt snapshot

On 2026-10-30, version **1.1.0** from source
`45a5b5f3ba186bed283036da074e3c697931ffea` passed all 14 jobs in
[run 41003535243](https://github.com/fwx5618177/chm-kit/actions/runs/41003535243).
These are actual uploaded and downloaded artifacts, not example URLs:

- [Prebuilt CLI, npm tarball and browser ESM/types](https://github.com/fwx5618177/chm-kit/actions/runs/41003535243/artifacts/12954945785).
- [Generated TypeDoc HTML](https://github.com/fwx5618177/chm-kit/actions/runs/41003535243/artifacts/12954796076).

The downloaded source manifest reports `dirty: false`; all hashes and inventory
were verified. Ordinary npm installation outside the repository and a standalone
CLI run were also verified. This is a fixed acceptance snapshot, not an automatic
latest-release link. GitHub sign-in/retention limits still apply; if it expires,
select another successful run above and inspect its manifest. Exact evidence is
in [VALIDATION.md](../../VALIDATION.md).

## Select an asset

The commands below use `VERSION` as a filename placeholder. Substitute the exact
version in **your manifest**, including any prerelease suffix.

### Standalone command line

```sh
node chmkit-VERSION-cli.cjs --version
node chmkit-VERSION-cli.cjs --help
node chmkit-VERSION-cli.cjs read manual.chm --list --format json
```

Only supported Node.js and built-ins are required; npm dependencies are bundled.
There is no embedded Node executable, GUI or Electron runtime. Use this file when
you do not want an npm installation or need an offline CLI. With this form,
replace `chmkit` in the [CLI guide](cli.md) with `node chmkit-VERSION-cli.cjs`.

### Node library and installed CLI

```sh
npm install ./chmkit-VERSION.tgz
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

### Browser ESM

```sh
tar -xzf chmkit-VERSION-browser.tar.gz
```

Keep `dist/browser/` intact, including its `chunks/` and relative module paths.
Serve it over HTTP(S) using your existing static host. Import
`./dist/browser/index.mjs` for the explicit browser reader or `root.mjs` for the
root facade. Declarations are in `dist/types/`; they are not browser runtime code.
A browser cannot resolve a bare `chmkit/browser` specifier without a bundler or
an import map. `file:` is not a suitable module Worker host.

The browser archive is a library distribution, not a promise of a packaged GUI.
See [browser integration](browser.md) and [Worker integration](worker.md).

### API reference

Download the separate **`chmkit-api-<full-source-sha>`** artifact from the same
successful CI run. It contains TypeDoc HTML, not another runtime package. Extract
the entire artifact, keep its directories intact and open `index.html` locally.
You do not need Node, pnpm or a source build to read it. If your environment
requires HTTP(S), serve that directory with your existing trusted static host.

This artifact also normally requires GitHub sign-in and requests 30-day retention.
Its existence in the workflow is not evidence that the current workspace has
already produced a successful hosted artifact. No public API website is claimed.
The [API entry map](../api.md) remains readable directly in the repository.

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
permission. No npm publication is planned. Any future decision to publish npm
needs a separately approved publishing flow; it is not enabled by these downloads.

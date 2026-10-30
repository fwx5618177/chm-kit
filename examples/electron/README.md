# Electron: approved archives, not filesystem IPC

A complete small application using the **installed CHMKit package**. Main owns
one archive selection, and a sandboxed renderer can request only the approved
`manual` key. Clicking **Read approved manual** lists files, reads the TOC,
searches for `manual`, reads the first HTML file's bytes and closes the archive.
The result is text/metadata and a hex preview, **not rendered CHM HTML**.

## Run with a prebuilt tarball

Obtain the prebuilt npm tarball identified by the artifact's `manifest.json`
(current package version: `chmkit-1.1.0.tgz`). The public npm registry is not an
installation source for this project. Copy this example into an application
outside the CHMKit checkout; you do not need to build CHMKit or run `pnpm demo`.
You supply an existing `.chm` file that you trust main to open.

For example, replace the absolute paths below with your downloaded tarball,
checkout/example location and manual:

```sh
mkdir chmkit-electron-app
cd chmkit-electron-app
npm init -y
npm install /absolute/path/to/chmkit-1.1.0.tgz
npm install --save-dev electron@45.1.0 esbuild
cp -R /absolute/path/to/chm-kit/examples/electron ./app
npx esbuild app/preload.cjs --bundle --platform=node --format=cjs --external:electron --outfile=app/preload.bundle.cjs
npx electron app/main.mjs --manual=/absolute/path/to/manual.chm
```

Installing Electron downloads its native runtime. Bundling here builds **your
application's preload**, not CHMKit. The only external preload module is Electron's
built-in `electron`; sandboxed preloads cannot resolve arbitrary package files
at runtime. Rebundle after changing the preload or updating CHMKit.

Keep the example's nonblocking ESM startup: it starts asynchronous work without
top-level awaiting `app.whenReady()`. Holding entry-module evaluation open while
waiting for readiness can stall Electron before it creates a browser window.

`main.mjs` requires exactly one absolute `--manual=...` startup argument. Missing
or relative selections exit with a usage error. This trusted launcher argument
is never read from renderer input, a query parameter or archive navigation.
The file must remain immutable while open. A failed open displays a generic
error; after main's selected file becomes available, click again to retry.

The app imports only public entries:

- `chmkit`: `CHMReader` in main.
- `chmkit/electron/main`: main-side handler registration.
- `chmkit/electron/preload`: the plain, frozen renderer API bundled into preload.

## Boundary and lifetime

The window uses `sandbox: true`, `contextIsolation: true` and
`nodeIntegration: false`. Main validates the actual webContents, top frame and
exact local page URL, and reauthorizes the approved key on each operation.
`/private/` paths and raw `.hhc`/`.hhk` navigation sources are excluded from the
public-file grant; raw navigation could otherwise disclose restricted topic
names or paths. No raw IPC, arbitrary filesystem open, channel selection or test
controls are exposed through `window.manual`.

The UI closes each successful read, preload requests disposal on `pagehide`,
and the main handler owns navigation/destruction cleanup. Application shutdown
awaits handler disposal. Renderer navigation and new windows are blocked. These
policies are an integration example, not CPU/memory isolation for hostile CHMs.
Never insert archive markup into the host DOM; an actual HTML viewer needs a
separate script-free sandbox, restrictive CSP and validated resources/navigation.

See the [Electron guide](../../docs/guide/electron.md) for API usage, limitations
and the repository's native acceptance contract.

## Repository acceptance

The shared Playwright configuration's `electron` project is the maintainer entry:

```sh
pnpm exec playwright test --project=electron
```

It requires the repository's dev-only Electron binary and existing Playwright /
esbuild tools. Its shared webServer builds CHMKit first. The native suite then
packages that build, installs the real tarball outside the checkout, copies this
application and bundles its preload against the installed package. It does not
require a registry publication, a demo archive or a source build by consumers.
Screenshot attachments show the actual Electron window's metadata and byte
preview, not untrusted HTML rendering. Native results must come from executing
that project; the injected-IPC Vitest tests alone are not native evidence.

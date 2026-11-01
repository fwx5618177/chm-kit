# Electron: approved archives, not filesystem IPC

[Documentation](../index.md) · [Complete application example](../../examples/electron/) ·
[Security](../../SECURITY.md)

Import main-process registration from `chmkit/electron/main` and preload helpers
from `chmkit/electron/preload`. These entries use structural interfaces and do
not install Electron or download an Electron binary. Your application supplies
its runtime, preload packaging, window lifecycle and authorization policy.

## Start from the installed package

```sh
npm install chmkit
npm install --save-dev electron@45.1.0 esbuild
```

Copy [the complete example](../../examples/electron/) to `app/` in your
application, then bundle its sandboxed preload and launch with a main-trusted
archive selection:

```sh
npx esbuild app/preload.cjs --bundle --platform=node --format=cjs --external:electron --outfile=app/preload.bundle.cjs
npx electron app/main.mjs --manual=/absolute/path/to/manual.chm
```

Use your existing, approved `.chm` file. No CHMKit source build, pnpm or
`pnpm demo` is needed by a consumer. Electron installation downloads a native
binary; esbuild compiles only the application's preload. The main example
requires exactly one absolute `--manual=...` startup argument and exits with a
usage error for missing/relative selections. Never derive that argument from an
untrusted renderer. Keep an open archive's backing file immutable.

The button performs open/list/TOC/search/read/close and displays metadata plus a
hex preview using `textContent`. If acquisition fails, the UI shows a sanitized
error and permits retry. **It does not render archive HTML.**

## Main process

Use a trusted startup-selected file and exact window/frame checks. Never pass a
renderer-provided path, URL or option object into a filesystem factory.

```ts
import { CHMReader } from 'chmkit';
import { registerElectronArchiveHandler } from 'chmkit/electron/main';

// ipcMain, window, trustedPageURL and immutableManualPath are owned by your app.
const handler = registerElectronArchiveHandler({
  ipcMain,
  archives: new Map([
    [
      'manual',
      {
        open: () =>
          CHMReader.open(immutableManualPath, {
            maxFileSize: 8 * 1024 * 1024,
            maxCacheBytes: 2 * 1024 * 1024,
          }),
        allowPath: path =>
          !path.startsWith('/private/') && !/\.hh[ck]$/i.test(path),
        operations: ['read', 'list', 'toc'],
      },
    ],
  ]),
  validateSender: event =>
    event.sender === window.webContents &&
    event.senderFrame?.parent === null &&
    event.senderFrame.url === trustedPageURL,
  authorizeArchive: (event, key) =>
    event.sender === window.webContents && key === 'manual',
  limits: { maxOutputBytes: 8 * 1024 * 1024 },
  maxSessions: 8,
});
// Await handler.dispose() as part of application shutdown.
```

This policy fragment belongs in a `BrowserWindow` configured with
`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
The [example main](../../examples/electron/main.mjs) supplies window creation,
trusted argument selection, navigation/new-window denial and shutdown wiring.
`allowPath` further filters public paths; it is not a path canonicalizer. Raw
`.hhc`/`.hhk` navigation sources are withheld because their contents can name
restricted topics even when the parsed TOC is filtered. The complete example
also enables search; the narrower fragment above does not.

## Preload and renderer

```ts
// preload — bundle in your application's sandboxed-preload pipeline
import { contextBridge, ipcRenderer } from 'electron';
import { createElectronRendererApi } from 'chmkit/electron/preload';

contextBridge.exposeInMainWorld(
  'manuals',
  createElectronRendererApi(ipcRenderer),
);
```

```js
// renderer — only plain functions and opaque handles cross contextBridge
const handle = await window.manuals.open('manual');
try {
  const files = await window.manuals.list(handle);
  if (files[0]) {
    const bytes = await window.manuals.read(handle, files[0]);
    console.log(bytes.byteLength);
  }
  console.log(await window.manuals.toc(handle));
} finally {
  await window.manuals.close(handle);
}
```

Read paths are raw archive paths from `list()`, not OS paths or complete
navigation URLs. Call `window.manuals.dispose()` when the trusted renderer no
longer needs its session. Keep the low-level proxy and raw `ipcRenderer`
**private to preload**. Do not expose a caller-selected channel or generic
`invoke()` bridge. A sandboxed preload cannot arbitrarily require relative
package files at runtime; bundle your application's preload, leaving only
Electron's built-in module external.

## Authorization and lifetime contract

- `validateSender` and `authorizeArchive` are required and fail closed. Validate
  actual webContents identity, exact frame URL and top-frame status; checking
  origin alone is normally insufficient. Authorization is rechecked on use, so
  an application can revoke a grant.
- Renderer opens use an approved ASCII key such as `manual`, not an OS path.
  Factories are snapshotted from main-owned configuration. Do not indirectly
  consult mutable renderer-controlled globals inside the factory.
- Handles are scoped to one sender object and frame identity/URL. Cross-frame
  reuse is refused. Navigation, renderer process exit, sender destruction,
  `releaseSender()` and handler disposal release affected sessions/readers.
- Read grants use exact public paths snapshotted at open. Internal resources,
  aliases/traversal and unlisted paths are not granted. TOC targets not exactly
  in the grant, including external URLs and query/hash-bearing targets, are
  omitted. This conservative policy is not a full navigation resolver.
- Limit operations to what the application needs. Search results are filtered
  **after** the trusted adapter searches; this restricts returned data, not
  hidden-file scan timing/CPU. Disable search or provide a restricted adapter
  for stronger confidentiality. Filtering can reduce the returned result count.
- The default channel is `chmkit:archive:v1`; configure it in main/preload only.
  Registration does not remove another handler to make room. Use distinct
  namespaced channels for separate service instances.

## Limits and failure handling

The shared RPC protocol bounds requests, responses, pending calls and archives.
Main-side parser/filesystem errors become generic archive errors; stack/cause
and local-path diagnostics are not sent to renderer. Electron contextBridge can
strip custom Error properties, so do not depend on `error.code` surviving that
additional bridge. Log privileged diagnostics only in trusted main-side code.

The lower-level preload proxy supports AbortSignal and timeouts; the plain
renderer API intentionally does not transmit Signals or functions. Cancellation
settles local calls and cleans late opens but **cannot preempt synchronous CPU**.
The IPC helper does not move parsing off the main thread. Large/untrusted inputs
need an application-owned worker/process, immutable file staging and OS quotas.
Bounds are checked after Electron clones the invocation, not before allocation.

This example displays text, not executable CHM HTML. A viewer needs script-free
sandboxing, restrictive CSP, validated resources/navigation and no privileged IPC
inside the untrusted frame. See [browser safety](browser.md).

## Native acceptance for maintainers

Use the shared Playwright configuration, not a second runner or a separately
started server:

```sh
pnpm exec install-electron
pnpm test:electron
```

The repository setup supplies `@playwright/test`, exactly pinned dev-only
`electron@45.1.0`, and the existing esbuild. After
`pnpm install --frozen-lockfile --ignore-scripts`, `pnpm exec install-electron`
explicitly runs Electron's official binary installer. No pnpm lifecycle approval
is necessary. The download requires network access; Electron is not a CHMKit
production dependency and consumers of the library do not install it. A Linux CI host needs the native
runtime's system libraries and a display such as Xvfb; no `--no-sandbox` workaround
is configured by this suite. The single shared `playwright.config.ts` owns the
`electron` project matching `test/electron/**/native.spec.ts` and the
canonical-build webServer. `pnpm test:browser` selects `test/browser`, while
`pnpm test:all` runs all four Playwright projects in one invocation, preserving
browser and Electron evidence together. Reports use
`test-results/playwright/{results.json,html,artifacts}`; focused invocations
replace the previous Playwright report.

The native suite's contract is:

1. After that build, invoke `scripts/package.mjs` once in `beforeAll` per worker
   (again if Playwright restarts a worker on retry). Do not build concurrently
   with the other Playwright projects or fall back to source modules.
2. Install the actual `dist/package/chmkit-1.1.0.tgz` in a system-temp consumer
   outside repository ancestry using npm with lifecycle scripts disabled. Copy
   the real example unchanged, resolve only installed public package entries,
   and bundle only the application preload during setup. Neither package
   symlinks nor a repository `NODE_PATH` supply runtime code.
3. Launch the native executable returned by `require('electron')` through
   Playwright's `_electron`. Exercise the real UI and contextBridge/IPC transport:
   list/TOC/search, exact UTF-8/binary/ranged bytes, close, independent handles,
   forbidden keys and paths, sanitized acquisition failure and retry.
4. Check configured sandbox/isolation preferences and the absence of renderer
   Node globals/raw IPC. Reject another native window at the same URL and the
   approved window at a different frame URL. These are real sender/frame-URL
   checks, not exhaustive hostile-subframe or sandbox-escape tests.
5. Observe successful real-reader closes in a **main-only test bootstrap** for
   explicit close, dispose, normal reload and application quit. Inspect listener
   removal, stale handles and fresh-preload recovery. No privileged test API is
   added to the renderer. These observations are not an OS descriptor-count
   oracle or evidence of renderer-crash handling.
6. Attach an actual main-window screenshot showing metadata/hex bytes, never
   label it untrusted HTML rendering. Bound installation, launch, IPC, capture
   and shutdown; quit each app and remove the temporary consumers on both test
   success and failure, with process termination as a teardown fallback.

Inputs are small, authored synthetic archives made by the installed public
writer. This tests native integration, not an independent CHM conformance
oracle. `test/electron/electron.test.ts` remains the injected-IPC Vitest suite;
it alone cannot establish native Electron behavior. **Seven native Playwright
cases passed locally and in the macOS 15 hosted job with Electron 45.1.0**,
including actual-window screenshots, with sandbox/context isolation enabled and
Node integration off. [Run 41044610433](https://github.com/fwx5618177/chm-kit/actions/runs/41044610433)
passed all 15 jobs at exact source `962ee71d52b0d1198a36c6c5d69c82a53e62caf9`.
This establishes that runtime/platform, not other Electron/OS versions or later
working-tree changes. See [VALIDATION.md](../../VALIDATION.md) for the evidence boundary.

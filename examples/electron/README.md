# Electron: approved archives, not filesystem IPC

The helper has **no Electron dependency**. `src/electron/main.ts` consumes structural `ipcMain`/sender interfaces; `src/electron/preload.ts` consumes only an injectable `invoke()` interface. Unit tests use structured-clone IPC doubles and are **not native Electron execution evidence**.

## Run in your Electron application

After the shared build/export integration adds `dist/{esm/electron.mjs,cjs/electron.js}`:

1. Run `pnpm demo` from the repository root to generate `dist/demo/sample.chm` (or change the fixed **main-owned** archive selection in `main.mjs`).
2. Bundle the preload for Electron's sandboxed environment:

   ```sh
   pnpm exec esbuild examples/electron/preload.cjs --bundle --platform=node --format=cjs --external:electron --outfile=examples/electron/preload.bundle.cjs
   ```

3. Use your application's installed Electron runtime to launch `examples/electron/main.mjs`. For example, if Electron is already available in your application, run `electron /absolute/path/to/chm-kit/examples/electron/main.mjs`. This repository intentionally does not install Electron or download its binary.

`main.mjs`, `preload.cjs`, `renderer.js` and `index.html` form a complete minimal example. The main process chooses `manual -> fixed sample.chm factory`. The renderer can only request `manual`, then operate on an opaque preload handle. No caller-controlled path/URL is passed to `CHMReader.open()`. Reader paths are **raw archive paths returned by `list()`**, never OS paths or complete navigation URLs.

When consuming the package, import `registerElectronArchiveHandler` from `chmkit/electron/main` and `createElectronRendererApi` from `chmkit/electron/preload`. A combined `chmkit/electron` entry is also available in source. The build owner must wire these subpaths before package imports work.

## Security contract

- Require `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. Bundle the preload; a sandboxed preload cannot arbitrarily `require()` relative package files at runtime. Keep `ipcRenderer` and `createElectronArchiveProxy()` private to preload; expose only `createElectronRendererApi()`'s frozen plain function surface via `contextBridge`.
- `validateSender` is **required**, synchronous and fail-closed. Check the actual allowed `webContents` object, exact frame URL and top-frame status. An origin-only check is usually insufficient. Unknown/null/dead frames are rejected. `authorizeArchive` is also required and rechecked for open and subsequent operations, allowing application policy revocation.
- Only approved main-owned factories run. Keys are limited to 1–64 ASCII letters/digits/underscore/hyphen, starting with a letter/digit. Paths, URLs and extra open fields are rejected. A key not in the snapshotted factory map is rejected. Do not write a factory that indirectly trusts renderer input through application globals.
- Capabilities belong to one sender object and frame identity/URL. Cross-sender/frame handle use is rejected. Navigation or renderer-process exit invalidates sender sessions and closes their readers, as does sender destruction. `releaseSender()` and handler `dispose()` offer explicit cleanup. Install one proxy/API per preload/frame/channel; client disposal releases that frame's session.
- Read access is restricted to exact public paths snapshotted from `listFiles()` at open. Internal resources and aliases/traversal are not granted. `allowPath` further narrows visible paths. `operations` can grant only `read`, `list`, `toc`, and/or `search`; close/dispose remain cleanup operations. Listings/search results are filtered; TOC targets not exactly in the grant are omitted (including external URLs and query/hash-bearing targets). Custom adapters can implement richer trusted navigation resolution. Filtering restricted search results can yield fewer than `maxResults`, because the core search limit applies before filtering.
- Search still runs inside the trusted archive adapter before filtering. The grant limits **returned data**, not timing side channels or work spent scanning hidden files. For stricter isolation, disable search for that grant or supply a capability-restricted adapter. Keep parser work off the main thread if untrusted large archives could block the UI; this IPC adapter does not move CPU work to another process.
- Channel is fixed by main/preload configuration, starts with `chmkit:`, and cannot be selected by renderer API calls. Registration never removes another handler to make room; Electron rejects duplicate handlers. `dispose()` unregisters only its registered channel and drains all owned sessions. Configure different channels for different service instances.
- Typed requests, ids, bounded input validation, conservative output limits and serialized `{name,message,code}` errors are shared with the Worker adapter. Main parser/filesystem errors are replaced with a generic error; no stack, cause, custom field or local filesystem diagnostic crosses IPC. Electron's `contextBridge` may strip custom properties from thrown Errors; do not rely on `error.code` surviving that additional bridge, although preload can inspect it.
- The lower-level preload proxy supports request AbortSignals and timeouts (default 30 seconds). The plain renderer bridge intentionally does not transport AbortSignal/functions. Aborting/timing out discards late results and closes late opens, but cannot preempt synchronous CHM parsing. `dispose()` rejects local pending calls immediately and waits for graceful host cleanup. Transport failure rejects all pending requests; remote cleanup is best effort if IPC is already gone. Sender lifecycle cleanup remains authoritative.
- Bounds apply after Electron has cloned the incoming invocation, not to total process memory/CPU. Apply trusted `ReaderOptions` in factories. Async factories must eventually settle for graceful cleanup to finish. Use process-level limits/isolation for hostile workloads.
- CHM HTML is untrusted. This example only writes text/metadata to `textContent`; it never renders archive markup. A viewer needs a sandbox without scripts/same-origin, restrictive CSP and validated resource/navigation handling. Block unexpected navigation/new windows; do not grant raw IPC to an untrusted iframe.

## Maintainer build handoff

Export `src/electron/index.ts` as `chmkit/electron`, and separate `src/electron/main.ts` / `src/electron/preload.ts` as `chmkit/electron/main` / `chmkit/electron/preload`. Emit CJS/ESM and `.d.cts`/`.d.mts` declarations for each. Their public declarations must remain structural and must not reference the `electron` package, DOM globals or Node types. No dependency/package change is needed for Electron itself. Source tests cannot prove the final export map; rerun isolated consumer/package tests after shared build wiring.

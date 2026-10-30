# Electron: approved archives, not filesystem IPC

[Documentation](../index.md) · [Complete application example](../../examples/electron/) ·
[Security](../../SECURITY.md)

Import main-process registration from `chmkit/electron/main` and preload helpers
from `chmkit/electron/preload`. These entries use structural interfaces and do
not install Electron or download an Electron binary. Your application supplies
its runtime, preload packaging, window lifecycle and authorization policy.

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
        allowPath: path => !path.startsWith('/private/'),
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

This policy fragment belongs in an application with a `BrowserWindow` configured
with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
The [complete example](../../examples/electron/main.mjs) supplies window creation,
fixed archive selection, navigation/new-window denial and shutdown wiring.
`allowPath` is an additional filter over public paths, not a path canonicalizer.

## Preload and renderer

```ts
// preload — bundle this in your application's sandboxed-preload pipeline
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
    console.log(bytes.byteLength); // refuses materialization above the trusted reader budget
  }
  console.log(await window.manuals.toc(handle));
} finally {
  await window.manuals.close(handle);
}
```

Call `window.manuals.dispose()` when the trusted renderer no longer needs its
session. Keep the low-level proxy and raw `ipcRenderer` **private to preload**.
Do not expose a caller-selected channel or generic `invoke()` bridge. A sandboxed
preload cannot arbitrarily require relative package files at runtime; bundle your
application's preload, leaving Electron's built-in module external.

The full [main/preload/renderer/HTML example](../../examples/electron/) is a
starting point, not a native Electron validation claim. Its setup instructions
involve **application** preload bundling; consumers still do not rebuild CHMKit.

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

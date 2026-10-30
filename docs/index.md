# CHMKit documentation

Open a local CHM in the prebuilt viewer, run the CLI, or integrate the library.
Choose a [prebuilt download](guide/downloads.md) for your workflow.
[English quick start](../README.md) · [中文快速开始](../README_zh.md).
The guides use English prose with runnable examples; both READMEs describe the
same APIs and safety boundaries.

## Choose your workflow

| Goal                                                         | Guide                                    |
| ------------------------------------------------------------ | ---------------------------------------- |
| Open the local viewer; download, install and verify assets   | [Prebuilt downloads](guide/downloads.md) |
| Explore, search, preview, extract or pack from a terminal    | [CLI](guide/cli.md)                      |
| Reuse readers, stream bytes, integrate a Node service        | [Node.js](guide/node.md)                 |
| Read local files and handle untrusted HTML/resources         | [Browser](guide/browser.md)              |
| Move parsing off the browser UI thread                       | [Worker](guide/worker.md)                |
| Expose approved archive capabilities to an Electron renderer | [Electron](guide/electron.md)            |
| Create archives, customize navigation, rebuild updates       | [Packing](guide/packing.md)              |
| Understand effective configuration and memory limits         | [Configuration](guide/configuration.md)  |
| Upgrade callers and understand changed behavior              | [Migration](guide/migration.md)          |
| Understand ITSF, DataSpace, LZX frames and resets            | [CHM/LZX format](guide/format-lzx.md)    |
| Find signatures and exported types                           | [API reference](api.md)                  |

## Examples

- [Local viewer](guide/downloads.md#local-browser-viewer): extract the current
  browser archive and open `dist/viewer/index.html`; no Node/npm/server required.
- [Browser source example](../examples/browser/): local file selection and navigation.
- [Module Worker](../examples/worker/): client, worker entry and disposal.
- [Electron](../examples/electron/): main-owned archive, sandboxed preload and renderer.
- [Node HTTP integration](guide/node.md#complete-read-only-node-service): text-only,
  fixed-archive service with explicit limits and shutdown.

The standalone viewer is already bundled for direct `file:` opening. Library
ESM/module Worker examples use HTTP(S) and built modules; adapt imports to the
installed tarball or extracted browser modules. Electron applications supply
their own Electron runtime and application/preload packaging. The linked
[historical hosted snapshot](guide/downloads.md#verified-prebuilt-snapshot)
predates the standalone viewer; current-revision hosted delivery is pending.

## Trust, compatibility and maintenance

Read [SECURITY.md](../SECURITY.md) before exposing uploaded archives, previews or
IPC. [Licensing](guide/licensing.md) distinguishes MIT implementation code from
third-party test data. Current executions and platform evidence belong in
[VALIDATION.md](../VALIDATION.md), not in hard-coded documentation test counts.

[Changelog](../CHANGELOG.md) · [Contributing](../CONTRIBUTING.md) ·
[CI and release policy](../.github/PIPELINES.md).

Generated TypeDoc HTML is available as the separate **`chmkit-api-<source-sha>`**
CI artifact; download and open `index.html` without building CHMKit. It is not a
publicly hosted documentation site or checked-in HTML. The [API page](api.md)
explains how the prebuilt reference and source guides fit together.

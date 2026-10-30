# API reference

[Documentation](index.md) · [Node](guide/node.md) · [Browser](guide/browser.md) ·
[Migration](guide/migration.md)

The API reference is generated **from TypeScript source using TypeDoc**. This
page is the source-controlled entry map; generated HTML is build output and must
not be committed. A generated reference is not evidence that a public website
has been deployed or an npm package has been published.

## Open the generated reference

Download **`chmkit-api-<full-source-sha>`** from a successful [CI run](https://github.com/fwx5618177/chm-kit/actions/workflows/ci.yml),
extract the entire artifact and open its `index.html`. Keep the asset directories
beside it. GitHub sign-in is normally required; the workflow requests 30-day
retention. This is prebuilt HTML: **readers do not need to build the source**.
Use the matching source revision's entry map and guides below when browsing GitHub.
See [downloads](guide/downloads.md#api-reference) for details.

For contributors, `pnpm docs:build` uses TypeDoc 0.28.20 and
[`typedoc.json`](../typedoc.json) to generate `dist/api/`, treating warnings as
errors. After generation, open `dist/api/index.html` locally. That generated
file is absent in a source-only checkout; no GitHub Pages/public-site URL is
claimed. Contributors may
serve the generated directory through a trusted static host, but public hosting
is a separate approval/deployment action. Do not generate HTML into `docs/` or
commit it. See [contributor setup](../CONTRIBUTING.md).

## Public entry map

| Entry                      | Main exports / purpose                                                                                           | Guide                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `chmkit`                   | `CHMKit`, `CHMReader`, `CHMArchive`, `packFiles`, `packTemplate`, `updateArchive`, parser/encoder/operation APIs | [Node](guide/node.md), [packing](guide/packing.md) |
| `chmkit/reader`            | Node `CHMReader`, `FileWithMetadata`                                                                             | [Reader lifecycle](guide/node.md)                  |
| `chmkit/browser`           | Browser `CHMReader`, `CHMKit`, `packFiles`, `packTemplate`, `updateArchive`, reader types                        | [Browser](guide/browser.md)                        |
| `chmkit/config`            | `loadConfig`, `getConfig`, section/default getters, cache reset                                                  | [Effective configuration](guide/configuration.md)  |
| `chmkit/worker`            | `WorkerArchiveClient`, `createWorkerClient`, `createWorkerArchiveHost`, `RemoteArchive`, RPC types/limits/errors | [Worker](guide/worker.md)                          |
| `chmkit/electron/main`     | `registerElectronArchiveHandler`, approved-archive/sender policy types                                           | [Electron](guide/electron.md)                      |
| `chmkit/electron/preload`  | `createElectronRendererApi`, private lower-level proxy, renderer API types                                       | [Electron](guide/electron.md)                      |
| `chmkit/browser-resources` | `ArchivePathResolver`, `createArchivePreview`, `rewriteArchiveCSS`, `parseArchiveSrcset`, preview limits/types   | [Preview resources](guide/browser.md)              |

The root default is `CHMKit` in Node and under browser export conditions;
the explicit browser subpath defaults to `CHMReader`. Types/conditional exports
are versioned with the package. Verify the actual installed tarball if a new
subpath is missing; a source file existing alone does not establish export wiring.
`chmkit/package.json` exposes installed metadata for version/engine inspection.

## Reader method families

- **Lifetime/input:** `CHMReader.open`, memory construction/`CHMKit.from`,
  `isOpen`, `close`; Node `getFilePath`/`getIOStats`.
- **Discovery:** `listFiles`, `listDirectories`, `getFileTree`, `glob`, `exists`.
- **Reading:** `readFile`, `readText`, `readHTML`, `readJSON`, `readImage`,
  `readCSS`, `readJS`, `readRange`, `createReadStream`, `readMultiple`, `readWithMetadata`.
- **Metadata/navigation:** `getFileInfo`, size/ratio/MIME accessors, `getMetadata`,
  `getTOC`, `getIndex`, `getDefaultPage`, `getHomePage`, `getNavigationLinks`.
- **Search:** `search`, `searchInFile`, `findFiles`, filename `fuzzySearch`.
- **Managed caches:** `preload`, `clearCache`, `getCacheStats`, `setCacheStrategy`;
  optional `ReaderOptions.adaptivePreload` / `AdaptivePreloadOptions` and
  `getPreloadError` for scheduled adjacent-file warmup. Node source `readAhead`
  is a separate synchronous window setting. See [resource accounting](guide/configuration.md).

Local methods are synchronous except opening/stream consumption; remote Worker
handles are asynchronous and expose only a subset. Generated signatures describe
the method shapes, while guides explain lifecycle/budget/security semantics.

## Learn the source model

[Source architecture](guide/source.md) maps public APIs to portable core and
runtime adapters. [CHM/LZX](guide/format-lzx.md) explains transport/history rather
than duplicating every exported field. Generated docs and source types remain
the authority for exact signatures; [VALIDATION.md](../VALIDATION.md) records
what was actually run, not what a signature alone implies works on every platform.

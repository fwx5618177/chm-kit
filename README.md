# CHMKit

Open local Microsoft HTML Help (`.chm`) files in a browser, explore them from a
terminal, or integrate a TypeScript reader/writer into your application.
Read, search, preview, extract and create archives without uploading your files.

**English** | [中文](README_zh.md) · [Documentation](docs/index.md) ·
[API reference](docs/api.md) · [Migration](docs/guide/migration.md)

## Get started — choose your channel

| Download                      | Use it for                                                       | Requirements                                          |
| ----------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `chmkit-1.1.0-browser.tar.gz` | Ready-to-open local viewer, plus browser modules/types           | Modern browser; no Node, npm or server for the viewer |
| `chmkit-1.1.0-cli.cjs`        | Inspect, search, extract and pack from a terminal                | Node.js 20.10+; no npm install                        |
| `chmkit-1.1.0.tgz`            | Node library, installed CLI, browser/Worker/Electron integration | Node.js and npm for installation                      |

Get the **`chmkit-<commit-sha>`** artifact from a successful
[CI run](https://github.com/fwx5618177/chm-kit/actions/workflows/ci.yml), or a
maintainer-provided prebuilt bundle, and unzip it. These examples use the current
version **1.1.0**; check `manifest.json` for the version and source of your download.
Keep its notices and [verify checksums](docs/guide/downloads.md#verify-the-download).

The [verified hosted snapshot](docs/guide/downloads.md#verified-prebuilt-snapshot)
is an older 1.1.0 revision **without the standalone viewer**; hosted acceptance and
uploads for the new revision are still pending. Actions downloads require GitHub
sign-in and expire. The npm package is **not published**; npm publication or a
public release requires separate authorization. [Download details](docs/guide/downloads.md).

### Open the local viewer

Extract `chmkit-1.1.0-browser.tar.gz`, then double-click **`dist/viewer/index.html`**.
Select your `.chm` file or try the built-in sample to browse, search and preview it.
Keep the extracted directory intact. No Node, npm, source checkout, build or local
server is needed. Direct `file:` opening and sample preview were verified in
Chromium, Firefox and WebKit with **zero HTTP requests**.

The viewer uses a restricted, script-free preview; some CHM page features may be
omitted. Library ESM and module Worker integrations still use HTTP(S).
[Browser guide](docs/guide/browser.md).

### Run the standalone CLI

```sh
node chmkit-1.1.0-cli.cjs --help
node chmkit-1.1.0-cli.cjs info manual.chm --json
node chmkit-1.1.0-cli.cjs tree manual.chm --depth 2
node chmkit-1.1.0-cli.cjs search manual.chm "installation" --type html --json
node chmkit-1.1.0-cli.cjs extract manual.chm --output ./manual-new --preserve-structure
```

Supply your own `manual.chm`. For internal paths, first list the archive instead
of assuming that it contains `/index.html`.

### Install the prebuilt library

```sh
npm install ./chmkit-1.1.0.tgz
npx --no-install chmkit --help
```

The tarball already includes CJS, ESM, browser modules, CLI and TypeScript
declarations. Installation does not build the package or run repository hooks.
It can access npm to fetch runtime dependencies. Both `chmkit` and `chm` name the
same installed CLI. For offline CLI use, choose the standalone file instead.

Keep `SHA256SUMS`, `manifest.json` and `THIRD_PARTY_NOTICES.txt` with your download.
[Verify checksums](docs/guide/downloads.md#verify-the-download) before running it.

## Node.js: open once, read many times

```ts
import { CHMReader } from 'chmkit';

const reader = await CHMReader.open('manual.chm', {
  maxCacheBytes: 8 * 1024 * 1024,
  maxFileSize: 16 * 1024 * 1024,
});
try {
  console.log(reader.getMetadata(), reader.getTOC());
  const page = reader.listFiles('**/*.html')[0];
  if (page) {
    console.log(reader.readHTML(page));
    const end = Math.min(128, reader.getFileSize(page));
    console.log(reader.readRange(page, 0, end)); // Buffer, [0, end)
  }
  console.log(reader.search('installation', { maxResults: 10 }));
} finally {
  reader.close(); // releases caches AND the open file descriptor
}
```

`open(path)` is asynchronous; parsing, positioned file reads and decompression
are **synchronous** once opened and can block the event loop. The file must stay
immutable until `close()`. This is file-backed reading, not an automatic async
filesystem/CPU worker. Extraction also uses file-backed input with bounded async
output, not a whole-archive read or multicore decoder. Default-off `adaptivePreload`
uses same-thread timers, separately from synchronous `readAhead`; see the
[Node guide](docs/guide/node.md) and [budgets](docs/guide/configuration.md).

For owned memory, use `CHMKit.from(bytes)` or `new CHMArchive(bytes)`. For one-shot
operations, `CHMKit.readFile()`, `listFiles()` and `searchContent()` close their
internal reader automatically. Reuse an explicit reader for repeated operations.

## Browser and application integrations

```ts
import { CHMReader } from 'chmkit/browser';

// A File selected by <input type="file"> is a Blob; no upload is needed.
const reader = await CHMReader.open(file, {
  maxFileSize: 16 * 1024 * 1024,
});
try {
  console.log(reader.listFiles(), reader.getTOC());
} finally {
  reader.close();
}
```

Browser input is `Uint8Array`, `ArrayBuffer` or `Blob`, **not** a path/URL string.
Binary results are plain `Uint8Array`; streams are WHATWG `ReadableStream` in
both runtimes. Browser memory input is retained separately from the cache budget.

- **Local viewer:** open `dist/viewer/index.html` directly from the extracted
  browser archive. For **library integration without a bundler**, retain all
  chunks and import `./dist/browser/index.mjs` over HTTP(S).
- **Worker:** `chmkit/worker` provides a client/host pair, bounded RPC, optional
  transfers and cleanup. See [Worker guide](docs/guide/worker.md) and
  [complete example](examples/worker/).
- **Electron:** `chmkit/electron/main` and `chmkit/electron/preload` expose approved
  archive capabilities, not renderer-controlled filesystem access. See the
  [Electron guide](docs/guide/electron.md) and [example](examples/electron/).
- **Preview resources:** see [browser rendering and resources](docs/guide/browser.md).
  Reading HTML is not sanitizing or rendering it safely.

Never insert archive HTML into the host DOM. Use a script-free sandbox,
restrictive CSP and validated resource/navigation handling. Sandbox alone is
not a network firewall. [Security policy and integration limits](SECURITY.md).

## Create and update archives

```ts
import { packFiles } from 'chmkit';
import { writeFile } from 'node:fs/promises';

const bytes = packFiles(
  new Map([['index.html', Buffer.from('<title>Manual</title><h1>Hello</h1>')]]),
  { title: 'Manual', defaultTopic: 'index.html', compressionLevel: 6 },
);
await writeFile('generated-new.chm', bytes, { flag: 'wx' });
```

Packing supports stored/fixed/adaptive/ALIGNED cost selection, window/reset/block
options, HTML Help metadata and custom TOC hierarchies/templates. Authored
`.hhc`/`.hhk` navigation is preserved. `packTemplate()` overlays whole-file Maps;
it does not interpolate strings. `updateArchive()` rebuilds supported
archives into new bytes; it is **not in-place editing** and refuses structures
it cannot safely preserve. [Packing and update guide](docs/guide/packing.md).

## Compatibility and next steps

CHMKit supports ITSF v2/v3 structures and LZX VERBATIM, ALIGNED and stored blocks,
including frame/reset history and Intel E8 decoding. The official Free Pascal
3.2.2 `fpdoc` archive now reads unchanged against independently extracted bytes.
Real-input gaps remain for normal v2, GBK/UTF-16 and additional E8/window/reset
variants; support is not a guarantee for every producer. Search scans supported
text resources rather than every producer's compiled search database.

See [format and compatibility](docs/guide/format-lzx.md),
[resource budgets](docs/guide/configuration.md), [security](SECURITY.md) and
[current validation evidence](VALIDATION.md) for integration limits. Prebuilt
[TypeDoc HTML](docs/api.md) is a separate `chmkit-api-<commit-sha>` CI artifact.

- [CLI reference](docs/guide/cli.md): tree, search, read, preview, browse, batch, pack
- [Configuration and budgets](docs/guide/configuration.md)
- [Migration guide](docs/guide/migration.md) · [Changelog](CHANGELOG.md)
- [Contributing and source builds](CONTRIBUTING.md) · [Agent instructions](CLAUDE.md)

## License

CHMKit code is [MIT](LICENSE). Third-party test corpora retain their own licenses
(including GPL/LGPL) and **must not enter npm or browser/CLI downloads**.
Downloaded bundles include runtime dependency notices; see
[licensing and corpus policy](docs/guide/licensing.md).

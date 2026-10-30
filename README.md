# CHMKit

Read, search, extract and create Microsoft HTML Help (`.chm`) archives with
TypeScript. Use a prebuilt CLI, integrate the Node.js library, or read local
archives in a browser without uploading them.

**English** | [中文](README_zh.md) · [Documentation](docs/index.md) ·
[API reference](docs/api.md) · [Migration](docs/guide/migration.md)

## Get started — no build required

**The public npm registry currently returns 404 for `chmkit`.** A registry install
is not an available distribution channel, and npm publication is not planned.
Use the precompiled downloads below; no source checkout, pnpm or compiler is needed.
A [verified 1.1.0 snapshot with direct download links](docs/guide/downloads.md#verified-prebuilt-snapshot)
is available; GitHub sign-in and artifact retention limits apply.

1. Open [GitHub Actions](https://github.com/fwx5618177/chm-kit/actions/workflows/ci.yml)
   and select a successful **CI** run for the revision you want.
2. Download its **`chmkit-<commit-sha>`** artifact from **Artifacts** and unzip it.
   GitHub normally requires **sign-in**; artifacts expire and a run without a
   completed packaging job has no consumer download.
3. Read `manifest.json` and the included versioned `USAGE.md`. Replace `VERSION`
   in the commands below with that manifest's version, not a guessed release.

No existing public GitHub Release is assumed here. A maintainer-approved release
can later provide durable anonymous downloads; see [delivery details](docs/guide/downloads.md).

| Download                        | Choose this when…                      | Requirements                                        |
| ------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `chmkit-VERSION-cli.cjs`        | You want to inspect/extract/pack files | Supported Node.js; no npm install                   |
| `chmkit-VERSION.tgz`            | You need the library or installed CLI  | Node.js and npm; runtime dependencies are installed |
| `chmkit-VERSION-browser.tar.gz` | You want browser ESM and declarations  | Modern browser and HTTP(S) static hosting           |

Use Node.js 22.13+ or 24 for development; Node 20.19 is a runtime compatibility
target, not a supported dev-dependency installation environment. Consumer runtime
requirements are in the download's `engines.node`. The CLI embeds neither Node nor Electron.
Download **`chmkit-api-<commit-sha>`** from the same CI run to browse generated
[TypeDoc reference](docs/api.md) without a source build; it is not a publicly hosted site.

### Run the standalone CLI

```sh
node chmkit-VERSION-cli.cjs --help
node chmkit-VERSION-cli.cjs info manual.chm --json
node chmkit-VERSION-cli.cjs tree manual.chm --depth 2
node chmkit-VERSION-cli.cjs search manual.chm "installation" --type html --json
node chmkit-VERSION-cli.cjs extract manual.chm --output ./manual-new --preserve-structure
```

Supply your own `manual.chm`. For internal paths, first list the archive instead
of assuming that it contains `/index.html`.

### Install the prebuilt library

```sh
npm install ./chmkit-VERSION.tgz
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

- **No bundler:** extract the browser archive, keep all relative chunks, and
  import `./dist/browser/index.mjs` over HTTP(S).
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

## Scope and next steps

CHMKit reads standard ITSF v2/v3 structures and LZX VERBATIM, ALIGNED and stored
blocks, with frame/reset history and Intel E8 decoding. It is not a complete
HTML Help Workshop replacement, a universal CHM compatibility guarantee, or an
optimal compressor. Full-text search scans supported text resources; it does
not consume every producer's compiled search database.

Cache limits are managed-cache budgets, **not total RAM limits**. Ranges can
need decoding from a preceding reset. Extraction rejects traversal, unsafe names,
symlinks and overwrites, but cannot eliminate every hostile local TOCTOU race.
Independent fixtures and bounded mutation tests improve confidence, not prove
exhaustive coverage. See [format/LZX](docs/guide/format-lzx.md) and
[current validation evidence](VALIDATION.md).

- [CLI reference](docs/guide/cli.md): tree, search, read, preview, browse, batch, pack
- [Configuration and budgets](docs/guide/configuration.md)
- [Migration guide](docs/guide/migration.md) · [Changelog](CHANGELOG.md)
- [Contributing and source builds](CONTRIBUTING.md) · [Agent instructions](CLAUDE.md)

## License

CHMKit code is [MIT](LICENSE). Third-party test corpora retain their own licenses
(including GPL/LGPL) and **must not enter npm or browser/CLI downloads**.
Downloaded bundles include runtime dependency notices; see
[licensing and corpus policy](docs/guide/licensing.md).

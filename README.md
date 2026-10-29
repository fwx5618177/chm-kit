# CHMKit

Read, inspect, extract and create Microsoft HTML Help (`.chm`) archives in TypeScript. Includes a Node.js CLI, CommonJS/ESM APIs and a separate browser entry point.

**English** | [中文](README_zh.md)

[Validation records and demo evidence](VALIDATION.md) (repository checkout; not included in the npm artifact). Current results must come from a fresh run of the commands below; historical results are not evidence for the current runners.

## Status and scope

This repository is under development. **No npm release was made for this revision**; the registry version may not include these changes. Use a local build or locally packed tarball to try this checkout.

Implemented:

- Standard ITSF v2/v3 headers, ITSP/PMGL directories, section-0 resources, section-1 Content streams, LZXC ControlData and reset tables.
- Real LZX VERBATIM, ALIGNED and uncompressed/stored decoding, with sliding-window matches, frame/reset handling and Intel E8 translation.
- CHM writing with VERBATIM LZ77/fixed-Huffman compression and per-frame stored fallback; `compression: false` writes user content without LZX compression.
- File trees, TOC (`.hhc`), index (`.hhk`), `#SYSTEM` metadata, text/content search, byte ranges, WHATWG streams and bounded LRU caching.
- Text decoding with explicit encodings, BOM/HTML charset detection and language-based fallback, including GBK.
- Filesystem-free browser APIs using byte/Blob sources, `Uint8Array` results and `ReadableStream<Uint8Array>`.

This is **not a promise to read every CHM**, a replacement for every HTML Help Workshop feature, or an optimal-ratio LZX compressor. Adaptive Huffman-tree selection and ALIGNED **encoding** remain future work; ALIGNED **decoding** is implemented. Unsupported or malformed structures should fail, not produce fabricated content. See [TODO.md](TODO.md) for implemented audit fixes versus the longer-term roadmap.

### Behavior changes in this revision

- Legacy pseudo-LZX Huffman helpers (`Huffman.createLZXDecoder`, `readCodeLengths`, `buildPredefinedTree` and `LZXHuffmanDecoder` operations) are deprecated and throw an explicit unsupported/not-supported error instead of pretending to decode LZX. Use the real `LZXDecoder`; generic Huffman tree APIs remain available.
- `TOCBuilder` now retains nested pages that have no matching parent instead of dropping them. Generated navigation can therefore change.
- The root `chmkit` browser condition now preserves `CHMKit` as its default export; the explicit `chmkit/browser` default remains `CHMReader`.

These are intentional behavior changes, not a claim of full backward compatibility. Update callers of the legacy helpers and check default imports and generated TOCs when upgrading.

## Build and try it locally

The Node runtime requirement is **Node.js >= 20.10.0**. For development, use Node 20.19+ (or Node 22/24) and pnpm 9.0.0; CI uses these newer development runtimes rather than treating the minimum runtime as the build-tool baseline.

From the `chm-kit` repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/cjs/cli/index.js --help
pnpm demo
```

`pnpm build` runs only `node scripts/build.mjs`: a complete build of Node CJS/ESM, CLI, browser bundles and declarations, with no partial-build arguments. It clears only `dist/{cjs,esm,browser,types,declarations}`, preserving `dist/demo/` and other evidence directories.

`pnpm demo` builds the project and runs the real sample workflow in `scripts/demo.mjs`, generating inspectable artifacts under `dist/demo/`, including `sample.chm`, `extracted/` and `report.json`. Compare the extracted files with the generated source content and inspect the report rather than relying only on a successful command exit. The two maintained scripts are the complete build and this demo; tests use native runners.

To test the installable package locally:

```sh
pnpm test:package
```

This builds once through the package project's `globalSetup`, packs a tarball, and installs it in a consumer under the real system temporary directory, outside the repository's ancestor dependency chain. It checks package entry points, declarations, CLI and contents without dependency overrides or borrowing repository dependencies. `@types/node` is a regular package dependency for Node declarations, not a consumer-side workaround. Installation may access the package registry if dependencies are not cached.

After installing a locally generated tarball, both `chmkit` and `chm` name the same CLI. The examples below use `node dist/cjs/cli/index.js` without relying on a global install or the registry version.

## CLI

```sh
# Archive information; JSON stays machine-readable on stdout
node dist/cjs/cli/index.js info dist/demo/sample.chm --json

# List files, or read the archive's navigation as structured JSON
node dist/cjs/cli/index.js read dist/demo/sample.chm --list --format json
node dist/cjs/cli/index.js read dist/demo/sample.chm --toc --format json
node dist/cjs/cli/index.js read dist/demo/sample.chm --index --format json

# Replace /index.html with a path returned by --list for other archives
node dist/cjs/cli/index.js read dist/demo/sample.chm /index.html

node dist/cjs/cli/index.js read dist/demo/sample.chm /index.html --range 0:16 --format raw --output first-16.bin
node dist/cjs/cli/index.js read dist/demo/sample.chm /index.html --stream --output page.html

# Fresh output directory: extraction never overwrites existing files
node dist/cjs/cli/index.js extract dist/demo/sample.chm --output ./extracted-new --preserve-structure
node dist/cjs/cli/index.js extract dist/demo/sample.chm --output ./html-new --filter "**/*.html" --preserve-structure

# Pack a directory you provide
node dist/cjs/cli/index.js pack ./docs --output help.chm --title "User Manual" --default-topic index.html
node dist/cjs/cli/index.js pack ./docs --output help-stored.chm --no-compression
```

Important behavior:

- `read` accepts exactly one of an internal file path, `--list`, `--toc` or `--index`. Run `read --help` for the supported options; planned interactive/search/batch flags are not implemented.
- Ranges are **byte offsets `[start, end)`**, not character positions. They must be within the selected file. A range can split a multibyte character; use `--format raw` for byte-preserving output.
- `--format text` decodes content; `--format json` wraps a file's decoded content and metadata. `--toc/--index --format json` returns structured navigation, whereas text/raw returns the `.hhc`/`.hhk` source.
- `--stream` emits **original bytes**, even with the default text format. `--stream --range` delegates to the same stateful, frame-by-frame reader stream, without restarting reset decoding for each chunk. It supports `--output`, but not JSON. `--list` does not support raw/range/stream output.
- Text/JSON defaults to UTF-8 at the CLI; use `--encoding GBK` (or another supported label) when needed. The reader API additionally offers automatic encoding detection.
- Errors go to stderr and produce a nonzero exit code, including **partial extraction failures**. Successfully extracted files are retained; extraction is not transactional.
- Without `--preserve-structure`, CLI extraction flattens filenames. Name collisions fail rather than overwrite; preserve structure for normal manuals.

## Node.js API

Use named imports from `chmkit` after installing the local tarball. Inside this checkout, import `./dist/esm/index.mjs` instead. CommonJS consumers can use `require('chmkit')`.

### Open once, read many times

```ts
import { CHMReader, CacheStrategy } from 'chmkit';

const reader = await CHMReader.open('help.chm', {
  maxCacheBytes: 8 * 1024 * 1024,
  maxFileSize: 64 * 1024 * 1024,
  cacheStrategy: CacheStrategy.LRU,
  // defaultEncoding: 'GBK', // fallback when metadata/charset is insufficient
});

try {
  console.log(reader.listFiles('**/*.html'));
  console.log(reader.getFileTree());
  console.log(reader.getMetadata(), reader.getTOC(), reader.getIndex());

  const page = reader.listFiles('**/*.html')[0]; // raw archive path, not a navigation URL
  if (page) {
    console.log(reader.readHTML(page));
    const size = reader.getFileSize(page);
    const bytes = reader.readRange(page, 0, Math.min(128, size)); // Buffer
    console.log(bytes, reader.getFileInfo(page));

    const stream = reader.createReadStream(page, 0, Math.min(128, size)); // WHATWG stream
    for await (const chunk of stream) console.log(chunk.byteLength);
  }

  console.log(
    reader.search('manual', { pattern: '**/*.html', maxResults: 10 }),
  );
  console.log(reader.getCacheStats());
} finally {
  reader.close(); // keep open until stream consumption has finished
}
```

Opening a filesystem path is asynchronous. Once open, archive operations are synchronous; stream consumption is asynchronous. Binary reads return `Buffer` on Node. `readMultiple()` returns a `Map`; `readWithMetadata()` includes the bytes and file information, with Node's public `FileWithMetadata` using `Buffer` data. Paths are normalized and looked up case-insensitively; ambiguous duplicate paths are rejected. Normal listings exclude CHM internal resources; explicit internal reads are available. `exists` returns `false` only for a missing internal path; malformed-archive and other errors propagate rather than becoming `false`.

Node and browser readers support `createReadStream(path, start = 0, end?)` with strict half-open byte bounds `[start, end)`; omitted `end` means EOF. `getDefaultPage()` and navigation `local` retain query/hash suffixes. File-reading APIs take raw archive paths (as returned by `listFiles()`), not complete URLs; viewers must resolve navigation targets first, as the browser demo does.

For in-memory Node input, use `new CHMArchive(bytes, options)` from `chmkit`, or `CHMKit.from(bytes, options)`. `CHMKit.open(path, options)` opens the Node reader. `chmkit/reader` is the Node reader subpath.

### One-shot operations and packing

```ts
import { CHMKit, packFiles } from 'chmkit';
import { writeFile } from 'node:fs/promises';

const files = await CHMKit.listFiles('help.chm');
if (files.length) console.log(await CHMKit.readFile('help.chm', files[0]));
console.log(await CHMKit.getTOC('help.chm'));
console.log(await CHMKit.searchContent('help.chm', 'manual'));

// Directory-based Node operations
await CHMKit.pack('./docs', 'help.chm', { title: 'User Manual' });
const result = await CHMKit.extract('help.chm', './fresh-output', {
  preserveStructure: true,
});
if (result.errors.length) throw new Error(result.errors.join('\n'));

// Pure in-memory packing; no input directory required
const archive = packFiles(
  new Map([
    ['index.html', Buffer.from('<title>Manual</title><h1>Hello</h1>')],
    ['assets/style.css', Buffer.from('body { font-family: sans-serif; }')],
  ]),
  { title: 'Manual', defaultTopic: 'index.html', compression: true },
);
await writeFile('generated.chm', archive);
```

The Node facade also exposes `parse`, `getInfo`, `readText`, `readHTML`, `exists`, `getIndex`, `readRange`, `readMultiple` and `exportFiles`; compatibility names include `list`, `get`, `search` and `extractAll`. Reuse an open reader for repeated operations instead of repeatedly parsing the same archive with one-shot calls.

Packing preserves supplied `.hhc`/`.hhk` files. When absent, it generates basic navigation from HTML files and their `<title>` values, percent-encoding path segments (including literal `#`/`%`), not inferring a full document hierarchy. `packFiles` rejects non-portable paths (Windows device names, control/forbidden characters, reserved CHM paths and UNC paths), NFC-normalized case-insensitive duplicates and file/directory conflicts. A nonempty `defaultTopic` must target an existing archive file.

## Browser API and demo

Use the explicit `chmkit/browser` entry with your bundler; its default export is `CHMReader`. Bundlers that honor the `browser` export condition resolve root `chmkit` imports to a browser facade whose default export is `CHMKit`, matching the Node root's facade name. Both expose named browser APIs; the defaults are intentionally different. Do not import Node's config, CLI or filesystem adapters into the browser.

```ts
import { CHMReader, packFiles } from 'chmkit/browser';

// A File selected by <input type="file"> is a Blob and can be passed directly.
const response = await fetch('/manual.chm');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const reader = await CHMReader.open(await response.arrayBuffer());
try {
  console.log(reader.listFiles(), reader.getTOC());
  const page = reader.listFiles('**/*.html')[0]; // raw archive path, not a navigation URL
  if (page) {
    const bytes: Uint8Array = reader.readFile(page);
    const stream: ReadableStream<Uint8Array> = reader.createReadStream(page);
    console.log(bytes, await new Response(stream).arrayBuffer());

    // Preview only inside a sandbox; never insert archive HTML into the host DOM.
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', ''); // no allow-scripts or allow-same-origin
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = reader.readHTML(page);
    document.body.append(frame);
  }
} finally {
  reader.close();
}

const packed: Uint8Array = packFiles(
  new Map([
    [
      'index.html',
      new TextEncoder().encode('<title>Browser manual</title>Hello'),
    ],
  ]),
  { title: 'Browser manual' },
);
console.log(packed);
```

Browser `CHMReader.open()` accepts **`Uint8Array`, `ArrayBuffer` or `Blob`**, not a filesystem path or URL string. Fetch a URL yourself. Binary reads and packing return plain `Uint8Array`; streams are WHATWG streams. Browser `FileWithMetadata` uses `Uint8Array` data, with Node/browser types separated at source level rather than patched in generated declarations. There is no browser directory extraction or Node `Buffer` requirement in the public API. The internal adapter in `src/browser-buffer.ts` is an injected build dependency, not a global `Buffer` shim or mutation of `globalThis`.

For the bundled interactive demo, run these commands manually from the repository root:

```sh
pnpm build
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://127.0.0.1:8080/examples/browser/**, choose a local CHM, browse its file tree/TOC and preview a page. Stop the static server with Ctrl+C. To use the generated sample, run `pnpm demo` before starting the server and select `dist/demo/sample.chm`. The server is for local development, not a deployment mechanism.

**Preview safety:** CHM HTML is untrusted. Keep scripts disabled in a sandboxed iframe, do not add `allow-scripts` or `allow-same-origin`, and never use the host page's `innerHTML` for archive content. Sandboxing alone does not block all external resource requests; apply an appropriate restrictive CSP and validate/rewrite archive links and resources in a real viewer. The minimal API snippet above does not implement a resource resolver or network isolation.

## Configuration and resource limits

The Node-only `chmkit/config` API can discover `chmkit.config.json` in the current working directory, validate it and merge it with defaults. **It is not currently an automatic settings layer for CLI commands, the encoder or `CHMReader`.** Loading configuration does not activate concurrency, progress-bar, memory or checksum controls in those operations.

```ts
import { getConfig, loadConfig, resetConfigCache } from 'chmkit/config';

console.log(getConfig());
console.log(loadConfig({ searchPaths: ['./settings'] }));
resetConfigCache();
```

Use actual method options to control behavior: `ReaderOptions` (`maxCacheBytes`, `maxFileSize`, `cacheStrategy`, `defaultEncoding`), packing options (`title`, `defaultTopic`, `compression`) and extraction options (`filter`, `preserveStructure`, `verbose`). Unknown configuration keys are warned about and ignored; invalid files fall back to defaults with diagnostics. Do not interpret a successfully loaded config object as proof that an operation consumes its fields.

Resource and correctness boundaries:

- The archive input is loaded into memory and copied by the reader. Range/stream APIs avoid materializing an entire **output file**, not the entire input archive. Range streams decode the necessary history prefix from the nearest preceding reset, so prefix work is not zero. Sequential LZX stream working memory is dictionary + physical frame + chunk, independent of reset-group size; input, caches and caller-retained outputs are separate.
- `maxCacheBytes` bounds reader-owned file and reconstructed-block caches, not total process memory or caller-owned outputs. `maxFileSize` limits a single materialized read; use ranges/streams for larger outputs. Search may read complete candidate text files.
- `listDirectories()` / `getFileTree()` enforce directory-expansion caps: depth 1024, 100,000 inferred directories and 8 × 1024 × 1024 cumulative directory-path characters (not UTF-8 bytes). Exceeding a cap throws; raw `listFiles()` still lists deeply nested files without expanding their parents.
- `CHMFile.compressedSize` and reader per-file compressed sizes/ratios are `null` for shared LZX streams: exact per-file physical sizes are **unknown**, not fabricated from neighboring offsets.
- Extraction rejects traversal/unsafe portable filenames, collisions, existing output files and symlink components, including output-root ancestors. On macOS, aliases such as `/tmp` are symlinks: use a verified real path such as `/private/tmp` or a fresh real directory under the checkout. Do not extract into a directory concurrently modified by an untrusted process; filesystem checks are not a complete OS security boundary.

## Tests, cases and evidence

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test                         # vitest run: node + package projects
pnpm test:unit                    # vitest run --project node; no prebuild needed
pnpm test:package                 # vitest run --project package; globalSetup builds once
pnpm exec playwright install chromium firefox webkit
pnpm test:browser                 # playwright test: all three engines by default
pnpm test:browser --project=chromium # or --project=firefox / --project=webkit
pnpm test:all                     # pnpm test && pnpm test:browser
pnpm demo                        # regenerate observable CHM/extraction artifacts
```

`vitest.config.mts` is the sole Vitest configuration, defining `node` and `package` projects. Node CLI tests run the TypeScript source in `tsx` subprocesses and need no prebuilt CLI. `pnpm test:watch` runs `vitest --project node` for interactive use. `playwright.config.ts` is the sole real-browser configuration; its `globalSetup` builds once for the entire browser run, independently of the package project's setup. Node tests do not substitute for real browser execution.

Lint covers source, tests and runner configuration files. Formatting checks exclude fixtures through `.prettierignore`; do not reformat golden/oracle files. Keep `test/support/`, independent test helpers, real fixtures and golden/oracle expectations: they are maintained test infrastructure, not temporary patches, and are excluded from the published package.

On Linux, Playwright may require `pnpm exec playwright install --with-deps chromium firefox webkit`. Install `7zz` or `7z` separately to rerun the independent CHM interoperability oracle. When unavailable, external-tool checks are skipped; offline fixture/hash/decoder tests still run. Do not report skipped oracle checks as successful interoperability runs.

| Case                              | What it demonstrates                                                                   | Evidence / limitation                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Generated sample                  | Pack, inspect/read and extract actual content                                          | `dist/demo/sample.chm`, `dist/demo/extracted/`, `dist/demo/report.json`; a self-round-trip alone is not independent compatibility proof |
| Unmodified PyCHM fixture          | Real ALIGNED-Huffman CHM, nested TOC, mixed sections and byte-exact reads              | [Provenance, licenses and oracle](test/fixtures/pychm-example/README.md), pinned hashes and 7-Zip-extracted expected bytes              |
| LZX conformance and encoder cases | VERBATIM/ALIGNED/stored blocks, matches, frames/resets, E8 and generated output        | Synthetic cases complement the real fixture; they do not prove every producer/edge case                                                 |
| Independent 7-Zip checks          | External tool validates/extracts CHM and compares bytes                                | Requires `7zz`/`7z`; CI installs it on Ubuntu                                                                                           |
| Browser execution                 | Real Chromium, Firefox and WebKit: browser API/pack, Worker, preview and safety checks | `pnpm test:browser`; JSON: `test-results/browser/results.json`; HTML: `test-results/browser/html/`                                      |
| Packed consumer                   | CJS/ESM, type entry points, binaries and package contents                              | `pnpm test:package`; fixture data must not be included in the tarball                                                                   |

Vitest writes its native JSON report to `test-results/vitest.json` for the projects selected in that run. Playwright writes native JSON to `test-results/browser/results.json`, HTML to `test-results/browser/html/`, and per-test/project attachments, screenshots (including the demo capture) and retained traces under `test-results/browser/artifacts/`. These are outside `dist` and are not deleted by the build.

Inspect actual command output and freshly generated reports for counts, skips and failures; no fixed test count or blanket compatibility percentage is claimed here. Keep historical validation results separate from current runner results. The real PyCHM sample is small and single-frame: it does not by itself establish real-world multi-frame/reset or ITSF v2 coverage.

[CI](.github/workflows/ci.yml) targets Node 20.19/22/24 on **Ubuntu, macOS and Windows**, plus a separate Ubuntu **Chromium/Firefox/WebKit matrix**. Workflow commands and report uploads must follow the native entry points and paths above; matrix browser jobs select their engine with `--project`. A workflow definition alone is not validation evidence. [The hosted run for `0274c2c`](https://github.com/fwx5618177/chm-kit/actions/runs/40927079982) passed all 12 matrix jobs; see [VALIDATION.md](VALIDATION.md) for the recorded results. Check each subsequent commit's own CI status. CI has read-only repository permissions and does not publish to npm or deploy anything.

## License

CHMKit code is [MIT](LICENSE). The independently sourced PyCHM fixture and its extracted expected files are **GPL-2.0-or-later**, with upstream notices and the license preserved in `test/fixtures/pychm-example/`. They are test-only data and are excluded from the npm package; do not relabel or redistribute them as MIT.

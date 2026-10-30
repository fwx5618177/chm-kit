# Browser reading and bounded preview resources

[Documentation](../index.md) · [Worker](worker.md) · [Security](../../SECURITY.md)

## Use the local viewer

Extract the current **`chmkit-1.1.0-browser.tar.gz`** and double-click
**`dist/viewer/index.html`**. Choose a local `.chm`, or try the generated sample,
to browse, search and preview pages. Keep the directory intact. The prebuilt
`viewer.js` is a self-contained classic IIFE: ordinary viewers need **no Node,
npm, build or local server**. Chromium, Firefox and WebKit have each opened this
`file:` entry and loaded the sample preview with zero HTTP requests.

The [download guide](downloads.md) distinguishes current bundle contents from
the older verified hosted snapshot, which does not include this viewer. New
hosted delivery is pending. The viewer retains the script-free sandbox, CSP,
resource limits and cleanup described below; it is a restricted static preview,
not full HTML Help browser compatibility.

## Integrate the library

Install the [prebuilt tarball](downloads.md) into your application, or serve the
extracted `dist/browser/` modules over HTTP(S). Library ESM and module Workers
still require HTTP(S), unlike the standalone viewer's classic script.
`chmkit/browser` defaults to `CHMReader`; root `chmkit` under the browser condition
defaults to `CHMKit`. Prefer named imports. Do not import Node config/filesystem
adapters into browser code.

## Open a local file or fetched bytes

```ts
import { CHMReader } from 'chmkit/browser';

async function listLocal(file: File) {
  if (file.size > 32 * 1024 * 1024) throw new Error('Application input limit');
  const reader = await CHMReader.open(file, {
    maxFileSize: 8 * 1024 * 1024,
    maxCacheBytes: 2 * 1024 * 1024,
  });
  try {
    return { files: reader.listFiles(), toc: reader.getTOC() };
  } finally {
    reader.close();
  }
}
```

A selected File is a Blob and need not be uploaded. For URLs, explicitly fetch,
check the HTTP response, enforce application download quotas and pass bytes;
`open()` does not accept a URL/path string. Reading a Blob materializes its complete
ArrayBuffer. Browser binary reads/packing return plain Uint8Array, not Buffer;
streams are WHATWG streams. Memory input is copied/retained separately from
managed caches. For large parsing/search work, use the [Worker helper](worker.md).

The local browser reader also supports default-off `adaptivePreload` and
`getPreloadError()`. Its timers run synchronous decoding on the browser thread,
not in an implicit Worker. Node's `readAhead` source-window option has no effect
on browser memory input. See [warmup and failure semantics](configuration.md#three-different-forms-of-warmup);
the Worker RPC has a narrower option/method surface.

For direct ESM hosting, replace package imports with relative URLs such as
`./dist/browser/index.mjs` and `./dist/browser/resources.mjs`. Keep chunks and
relative paths intact. Bare specifiers need a bundler/import map. The download
contains both the local viewer and reusable library modules/types; it does not
automatically deploy your application.

## Raw paths versus archive URLs

`chmkit/browser-resources` exports `ArchivePathResolver`:

```ts
import { ArchivePathResolver } from 'chmkit/browser-resources';

const resolver = new ArchivePathResolver([
  '/guide/index.html',
  '/guide/topic#1.html',
  '/guide/100%.html',
]);
console.log(resolver.resolve('/guide/topic#1.html', '/', 'raw'));
console.log(
  resolver.resolve('topic%231.html#section', '/guide/index.html', 'url'),
);
```

A result contains `{ path, query, fragment }`, with `path` a canonical **raw listed
path**. `raw` never decodes or splits a filename. `url` resolves relative to a base,
decodes once per segment and separates query/fragment. `auto` prefers the longest
existing raw filename before URL fallback; use explicit modes whenever the
source's semantics are known. External schemes, protocol-relative URLs, traversal
above root, encoded separators and invalid escapes are rejected. Only known
listed resources resolve; `undefined` means blocked or missing.

Use raw mode for file-list buttons, URL mode for HTML references. CHM default/TOC
metadata can require deliberate compatibility handling rather than a blanket
`split('#')`/`decodeURIComponent()` applied to every name.

## Construct a preview and release it

The DOM-only `createArchivePreview()` builds a bounded, restricted preview using
in-archive resources. Its input is a raw archive path, not a navigation URL.
This example accepts a selected File and an **application-owned** iframe:

```ts
import { CHMReader } from 'chmkit/browser';
import { createArchivePreview } from 'chmkit/browser-resources';

async function mountManual(file: File, frame: HTMLIFrameElement) {
  if (file.size > 32 * 1024 * 1024) throw new Error('Application input limit');
  const reader = await CHMReader.open(file, {
    maxFileSize: 8 * 1024 * 1024,
    maxCacheBytes: 2 * 1024 * 1024,
  });
  let preview: ReturnType<typeof createArchivePreview> | undefined;
  try {
    const path = reader.listFiles('**/*.html')[0];
    if (!path) throw new Error('No HTML page');
    preview = createArchivePreview(reader, path, {
      limits: { maxResources: 64, maxBytes: 8 * 1024 * 1024 },
    });
    frame.setAttribute('sandbox', '');
    frame.referrerPolicy = 'no-referrer';
    frame.src = preview.createObjectURL();
    console.log(preview.stats, preview.links);
  } catch (error) {
    preview?.dispose();
    reader.close();
    throw error;
  }
  return () => {
    frame.removeAttribute('src');
    preview?.dispose();
    reader.close();
  };
}
```

Call the returned cleanup before replacing/removing the preview and on page exit.
`createObjectURL()` owns one HTML Blob URL; `dispose()` revokes it and prevents
reuse. The preview embeds resources as data URLs for opaque sandbox compatibility.
Do not paste `preview.html` into the host document; retain the empty sandbox and
restrictive CSP. If your host CSP controls frames, permit the owned Blob frame
explicitly without widening the untrusted document's network policy.

The helper processes permitted HTML elements/attributes, archive stylesheets,
recursive CSS `@import`/`url()` references, responsive image candidates and a
restricted SVG subset. It removes executable/unsupported elements and external
references. It does **not** make a general-purpose standards-complete HTML/CSS
sanitizer, CSS parser or arbitrary web page renderer. Unsupported syntax/features
may be omitted; CSP and sandbox remain independent required boundaries.

Cross-page anchor targets become `preview.links` for the **trusted host UI** to
present as text-only buttons. Same-document fragments can remain local. The
opaque sandbox cannot call privileged host code; do not enable scripts/same-origin
to make cross-page navigation work. Resolve a selected trusted link, dispose the
old preview, and create the next one explicitly. Query strings do not select
different resource bytes within the archive.

## Limits and failure behavior

Default preview budgets: 128 resources, 2048 references, depth 8, 16 MiB input
resource bytes, 24 MiB expanded/output budget and 20000 DOM nodes. Options must be
positive safe integers; recursion has an independent maximum. Repeated expanded
references can spend the output budget even when resource bytes are cached.
Cycle/missing/unsupported references are blocked; budget overruns can throw
`PreviewLimitError`. Build a replacement before discarding your last usable UI
state if graceful failure matters.

Preview accounting is not a hard browser memory cap. DOM parsing, source text,
base64 expansion, reader caches and caller-held bytes have extra costs. Some
intermediate budgets conservatively count string lengths; final HTML also has
an encoded-byte check. Apply reader/input quotas as well. A custom reader adapter
must implement trustworthy read/size/encoding methods; optional `getFileSize()`
lets the helper reject oversized input before reading it.

`rewriteArchiveCSS()` can be used separately for bounded archive CSS rewriting;
SVG processing/preview construction still require browser DOM APIs.
`parseArchiveSrcset()` is a bounded candidate parser, not a promise of every
future HTML image-selection feature. Rendering does not belong in a plain
Worker lacking DOM APIs; keep read RPC and host preview responsibilities separate.

## Privacy and examples

The helper does not fetch missing resources. That does not make every application
network-free: your own fetches, external navigation, hosting and any bypass of
CSP/sandbox determine exposure. Do not advertise local parsing alone as complete
privacy isolation. Never automatically open external links or extracted files.

The [browser example](../../examples/browser/) is the source of the prebuilt
viewer: local selection, generated sample, search/navigation and explicit
preview/URL cleanup. Its source ESM page is a contributor integration example;
ordinary users open the bundled `dist/viewer/index.html` instead. The
[Worker example](../../examples/worker/) shows remote reads separately over
HTTP(S). Execution evidence and browser coverage are recorded in
[VALIDATION.md](../../VALIDATION.md), not inferred from these files existing.

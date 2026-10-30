# Browser preview and native module Worker

This demo keeps archive markup out of the host DOM. The iframe has `sandbox=""` and `referrerpolicy="no-referrer"`: **never add `allow-scripts` or `allow-same-origin`**. Its generated document installs a restrictive CSP before archive markup. Resource embedding is archive-only; no helper fetches a network URL.

## Build handoff / serving

The shared build owner must emit these filesystem-free modules:

| Source                     | Browser artifact / intended subpath                       |
| -------------------------- | --------------------------------------------------------- |
| `src/browser.ts`           | `dist/browser/index.mjs` / `chmkit/browser`               |
| `src/worker/index.ts`      | `dist/browser/worker.mjs` / `chmkit/worker`               |
| `src/browser-resources.ts` | `dist/browser/resources.mjs` / `chmkit/browser-resources` |

Add corresponding declarations and package export entries; do not make a browser resources entry depend on the Node root. `src/browser.ts` should also wrap `updateArchive` so every result, including the no-change fast path, is a **plain `Uint8Array`**, not a Buffer. Its core Node implementation returns Buffer and should not be re-exported unchanged into the browser facade.

After those outputs exist, run `pnpm build`, manually serve the repository (for example `python3 -m http.server 8080 --bind 127.0.0.1`), and open `/examples/browser/`. Stop the server with Ctrl+C. Native module Workers require HTTP(S), not `file:` URLs.

## Resource helper

```ts
import {
  ArchivePathResolver,
  createArchivePreview,
} from 'chmkit/browser-resources';

// A reader from chmkit/browser satisfies this structural, filesystem-free interface.
const paths = new ArchivePathResolver(reader.listFiles());
const target = paths.resolve(
  reader.getDefaultPage() ?? '/index.html',
  '/',
  'auto',
);
if (!target) throw new Error('Missing/unsafe archive topic');
const preview = createArchivePreview(reader, target.path, {
  limits: { maxResources: 128, maxBytes: 16 * 1024 * 1024 },
});
frame.setAttribute('sandbox', '');
frame.referrerPolicy = 'no-referrer';
frame.src = preview.createObjectURL() + target.fragment;
// When replacing the page, closing the archive, or leaving the viewer:
frame.removeAttribute('src');
preview.dispose(); // idempotent; revokes the one owned HTML blob URL
```

The full `viewer.js` implements this lifecycle, including archive switching and pagehide. It also exposes `preview.links` as trusted host buttons via `textContent` rather than granting an opaque sandbox access to the parent.

### Paths and links

- Use **`raw`** for file-list paths: literal `#`, `%`, and `?` remain filename characters. No URL decoding or suffix splitting occurs.
- Use **`url`** for HTML/CSS references: decode exactly once, by path segment; query and fragment are separate from archive bytes. Encoded separators, controls, backslashes, schemes, protocol-relative URLs and traversal above the archive root are rejected. Paths are matched case-insensitively against the actual listing, and canonical raw filenames are returned.
- **`auto`** is for legacy/default/TOC targets that may already contain raw filenames: the longest actual raw filename takes priority before URL interpretation. This ambiguity cannot be solved universally by guessing; application call sites must choose the correct mode.
- Resources with different queries still reference the same archive bytes; fragments are safely encoded for embedding (including SVG target fragments). Query strings remain available in link metadata but do not execute in the scriptless preview.
- Same-page fragment links stay inside the sandbox. Cross-page links have their `href` removed and appear in `#document-links`, where the host resolves/opens the canonical archive path. External links, `ping`, targets, forms, scripts and nested browsing contexts are not enabled.

### HTML, CSS and SVG scope

- Parsing uses an inert template, **not `DOMParser(text/html)`**, so an untrusted image cannot make even a same-origin request before sanitization. Only a conservative static HTML/attribute allowlist survives. Meta refresh/CSP/base, scripts, event handlers, forms, frames, objects, custom elements, inline SVG/MathML and unsupported active surfaces are removed. A trusted UTF-8 declaration is added after decoding, so Chinese/other Unicode previews are not corrupted by removal of archive meta tags.
- Linked stylesheets, style blocks and style attributes use a bounded CSS lexer. It handles quoted/unquoted and escaped `url()`, nested relative `@import`, import modifiers, CSS comments, common string-URL functions such as `image-set()`, and local fragment references. Imports are recursively rewritten to data CSS and retain their media/layer/supports suffix. Cycles or excessive dependency depth become empty resources.
- `img`/`picture`/`source` support width/density `srcset` candidates, including URLs containing commas; this is not a naive comma split. Incoming data/blob/network URLs are not accepted as a bypass. Only helper-generated, MIME-allowlisted image/font/CSS data URLs reach the preview.
- SVG image files are XML-parsed off-document and restricted to static geometry/text/gradient/clip/mask/pattern content. Scripts, foreign objects, animations, external images/use targets, event handlers and XML base/doctype/entities are removed or rejected. Only local `use` fragments remain. This is intentionally not full-fidelity SVG rendering.
- Resources are data URLs, not parent-origin blob URLs: opaque sandbox origins cannot reliably dereference the latter without weakening isolation. The helper owns only the final HTML blob URL, caches resource encodings, and revokes its HTML URL once on disposal.

**This is a best-effort static viewer, not a standards-complete HTML/CSS sanitizer, a general browser, or a proof against every future rendering feature.** Unknown/malformed CSS may be dropped or rendered differently. Do not remove the CSP/sandbox because rewriting appears to succeed. Its security model combines conservative rewriting with `default-src 'none'`, `script-src/connect-src/frame-src/object-src/media-src 'none'`, data-only images/fonts/styles, `base-uri 'none'`, and `form-action 'none'`. Network blocking and active-content behavior are tested on actual Chromium/Firefox/WebKit, not inferred from Node mocks.

### Budgets and ownership

Defaults: 128 materialized resources (including root HTML), 2048 references, dependency depth 8 (configurable up to a hard ceiling of 32), 16 MiB logical source bytes, 24 MiB expanded/serialized output, 20000 DOM nodes, 100000 listed paths with 8 MiB cumulative path characters, 8192 code units per reference, and 128 candidates / 64 KiB per srcset. CSS function nesting has a separate hard bound of 32. Repeated cached references still consume the expansion/reference budget; cyclic import graphs cannot expand indefinitely.

The reader's `getFileSize` preflights bytes when available. Budget errors fail closed before creating an object URL. Counts are conservative, not exact total-memory accounting: DOM parsing, core reader input/cache, base64 construction and browser decoding have their own working memory, and parsing necessarily happens before the DOM node count can be checked. These limits are not CPU preemption or process-level isolation. Configure trusted reader limits and process isolation for hostile large workloads. The reader/adapter must return consistent byte/text/size data.

## Reusable Worker, no hand-written messages

`reader.worker.js` installs the real library host:

```js
import { CHMReader } from 'chmkit/browser';
import { serveWorker } from 'chmkit/worker';
serveWorker(self, (bytes, options) => new CHMReader(bytes, options));
```

`worker-client.js` exports `createReaderWorker()`, which creates the module Worker and calls `createWorkerClient()`. Usage:

```js
const client = createReaderWorker();
const archive = await client.open(await file.arrayBuffer(), {
  transferInput: true,
});
try {
  const [files, toc] = await Promise.all([archive.list(), archive.toc()]);
  console.log(toc, await archive.search('manual'));
  if (files[0])
    console.log(await archive.read(files[0], { transferResult: true }));
} finally {
  try {
    await archive.close();
  } finally {
    await client.dispose();
  }
}
```

Transfer-input opt-in detaches the **entire backing ArrayBuffer**, including sibling views. Transferred output owns a fresh buffer, never a cache or Buffer slab. AbortSignals/timeouts reject the caller and discard/close late results; they cannot interrupt synchronous parsing/decompression. `delayed.worker.js` demonstrates an asynchronous factory and a one-archive budget for lifecycle regression tests. See `../worker/README.md` for the fuller ownership contract. Native Electron is not needed for this browser demo; injected Electron unit tests are not evidence of running Electron itself.

## Validation

```sh
pnpm exec vitest run --project node --reporter=default test/reader/browser-resources.test.ts test/worker test/electron
pnpm exec playwright test test/browser/browser.spec.ts --workers=3
```

The Playwright config runs **Chromium, Firefox and WebKit**. Tests use actual module Workers and the library protocol for concurrent open/read/list/TOC/search/range, transferable bytes, cancellation, timeout, malformed archives, native Worker errors and disposal. Preview cases cover nested CSS imports/cycles, srcset, unsafe SVG, no remote or same-origin probes, query/fragment/percent/raw filenames, Unicode and object URL cleanup. The incremental-update case deliberately requires the actual browser `updateArchive` export and asserts plain Uint8Array results; it must not be papered over by a Node Buffer re-export or a test-only replacement.

While the separate build owner is adding the new Worker/resources outputs, `test/browser/support.ts` can explicitly serve source-entry bundles **in memory**, annotated `source-entry-bundle` in Playwright reports. This does not claim package-export correctness and does not replace the browser `updateArchive` entry. Once build artifacts exist, tests consume those artifacts instead. For strict post-integration validation, forbid that fallback:

```sh
CHMKIT_REQUIRE_PLATFORM_BUILD=1 pnpm exec playwright test test/browser/browser.spec.ts --workers=3
```

No dependency installation, publishing, native Electron execution or cross-platform CI success is implied by these commands being documented.

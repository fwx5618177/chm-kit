# Packing and rebuilding archives

[Documentation](../index.md) · [Format/LZX](format-lzx.md) · [Migration](migration.md)

`packFiles()` takes a `ReadonlyMap<string, Uint8Array>` and produces a complete
in-memory archive. Node returns `Buffer`; `chmkit/browser` returns `Uint8Array`.
No external HTML Help compiler is required. This is not a streaming writer or a
replacement for every HTML Help Workshop compilation feature.

## Build a manual with navigation and metadata

```ts
import { packFiles } from 'chmkit';
import { writeFile } from 'node:fs/promises';

const files = new Map([
  ['index.html', Buffer.from('<title>Manual</title><h1>Welcome</h1>')],
  [
    'guide/setup.html',
    Buffer.from('<title>Setup</title><h1 id="install">Install</h1>'),
  ],
  ['guide/topic#1.html', Buffer.from('<title>First topic</title><p>Hello</p>')],
]);
const bytes = packFiles(files, {
  title: 'User Manual',
  defaultTopic: 'index.html',
  languageId: 0x409,
  compressionLevel: 6,
  windowBits: 16,
  resetInterval: 128 * 1024,
  blockSize: 8 * 1024,
  htmlHelp: {
    compiler: 'My documentation pipeline',
    compiledFile: 'manual.chm',
    defaultFont: 'Arial,10,0',
  },
  tocEntries: [
    { name: 'Welcome', local: 'index.html' },
    {
      name: 'Guide',
      children: [
        { name: 'Setup', local: 'guide/setup.html#install' },
        { name: 'First topic', local: 'guide/topic%231.html' },
      ],
    },
  ],
  tocTemplate:
    '<!doctype html><html><head><meta charset="utf-8"></head><body><ul>{{entries}}</ul></body></html>',
});
await writeFile('manual-new.chm', bytes, { flag: 'wx' });
```

This writes actual `#SYSTEM` records and LCIDs, not just an uncompiled `.hhp`
file pretending to be runtime metadata. `htmlHelp.extraRecords` can preserve
application-defined record bytes but cannot override named/language records.
Strings emitted by this writer are UTF-8; setting `languageId` does not transcode
caller-supplied HTML bytes or create legacy-encoded metadata.

### Paths and navigation

- Map keys are raw archive paths. A single leading slash is the CHM namespace,
  not an OS root. Nonportable names, reserved CHM paths, Windows devices, UNC,
  forbidden/control characters, case-insensitive NFC duplicates and file/directory
  conflicts are rejected. Directory entries must have empty content.
- `defaultTopic` and TOC `local` are **archive-relative URLs**. Encode literal
  filename `#`/`%` by segment; query/fragment suffixes have URL semantics. A nonempty
  topic must refer to an existing file, not an external URL or missing resource.
- Existing authored `.hhc`/`.hhk` files are preserved. `contentsFile`/`indexFile`
  select a particular existing resource; they do not create an empty one.
- Without authored navigation, flat generation is the default. Use
  `tocHierarchy: 'folders'` to infer folder groups, or `tocEntries` for explicit
  headings/children. This is not semantic chapter inference from HTML headings.
- `tocTemplate` is a complete trusted HTML wrapper with **exactly one**
  `{{entries}}` insertion point. Generated entry labels/targets are escaped;
  the template itself is trusted author content, not a sanitizer.
- Do not combine existing contents with generation options: `tocEntries`,
  `tocTemplate` or `tocHierarchy` cannot replace it and cause an explicit error.
  Edit the authored file instead. Generated hierarchy has bounded depth/entry
  count and rejects cycles.

## Reuse a whole-file byte template

`packTemplate(templateFiles, overrides, options)` composes Maps before packing.
Each override adds/replaces an **entire file**, or uses `null` to delete it. It is
not a string template engine: no placeholders, scripts or expressions are
interpreted. This differs from `tocTemplate`'s single `{{entries}}` insertion.

```ts
import { packTemplate, CHMArchive } from 'chmkit';
import { writeFile } from 'node:fs/promises';

const template = new Map<string, Uint8Array>([
  ['index.html', Buffer.from('<title>Base</title><h1>Base manual</h1>')],
  ['style.css', Buffer.from('body { font-family: sans-serif; }')],
  ['obsolete.txt', Buffer.from('Remove in the next edition')],
]);
const overrides = new Map<string, Uint8Array | null>([
  ['index.html', Buffer.from('<title>Product A</title><h1>Product A</h1>')],
  ['guide.html', Buffer.from('<title>Guide</title><p>Getting started</p>')],
  ['obsolete.txt', null],
]);
const bytes = packTemplate(template, overrides, {
  title: 'Product A',
  defaultTopic: 'index.html',
  tocHierarchy: 'flat',
});
const archive = new CHMArchive(bytes);
try {
  console.log(archive.listFiles());
  if (archive.exists('/obsolete.txt')) throw new Error('Deletion failed');
} finally {
  archive.close();
}
await writeFile('product-a-new.chm', bytes, { flag: 'wx' });
```

Neither input map nor its buffers are mutated. Canonically equivalent replacement
paths retain the template's original spelling; ambiguous aliases, unsafe paths,
missing deletions and nonempty-directory deletions fail. Normal pack validation
still applies to final paths, selected navigation files, the default topic and
generated TOC targets. Links inside authored navigation/HTML are not globally
validated or repaired: override those files explicitly if deleting their targets,
and do not pass generation options alongside an authored contents file.
This composition API does not sanitize HTML. It returns Buffer on Node and
Uint8Array from `chmkit/browser`; `CHMKit.packTemplate` is also available.

## Compression controls

| Option             | Accepted values / behavior                                                    |
| ------------------ | ----------------------------------------------------------------------------- |
| `compression`      | Default true; false writes user content in section 0 without an LZX transport |
| `compressionLevel` | Integer 0–9; default 6                                                        |
| `windowBits`       | Integer 15–21: 32 KiB through 2 MiB dictionary                                |
| `resetInterval`    | Power-of-two multiple of 32768 bytes, up to 256 MiB; default 32768            |
| `blockSize`        | Power of two from 256 through 32768 bytes; default 32768                      |

Level 0 uses stored LZX blocks if compression is enabled; it is **not the same
container layout** as `compression: false`. Level 1 considers fixed VERBATIM;
2–3 also consider adaptive VERBATIM; 4–9 also consider ALIGNED. Higher levels
search deeper bounded match chains. Candidates are selected by actual encoded
cost against stored fallback; enabling a level does not force that block type.
No monotonic ratio or optimal-compression guarantee is made.

Larger windows/reset groups can improve reuse but raise workspace or random-read
prefix work. Smaller blocks adapt more locally at the cost of tree/header overhead.
CHM physical frames remain **32768 bytes**, regardless of encoder block size.
Options are validated even with compression disabled; invalid ignored-looking
values are not silently accepted. See [format/LZX](format-lzx.md).

Directory users can call `CHMKit.pack(inputDir, outputPath, options)`, inspecting
its `{ success, message }` result, or use `chmkit pack`. Filesystem writing is
separate from pure memory packing; use fresh output names and explicit application
policy. Packing is not a general filesystem sandbox or atomic publication service.

## Update supported archives into new bytes

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { updateArchive } from 'chmkit';

const original = await readFile('manual.chm');
const updated = updateArchive(
  original,
  new Map([
    ['index.html', Buffer.from('<title>Manual</title><h1>Revised</h1>')],
    ['notes.txt', Buffer.from('Added in this edition')],
  ]),
  { compressionLevel: 6 },
);
await writeFile('manual-updated.chm', updated, { flag: 'wx' });
```

`changes` uses bytes to add/replace a public resource and `null` to delete an
existing resource. A missing deletion, ambiguous update path or deletion of a
nonempty explicit directory is an error. Original input bytes are not mutated.

This is a **transactional in-memory rebuild**, not an in-place binary patch:
transport streams, directory layout and compressed bytes are reconstructed.
An empty change map with no effective options returns a byte copy (option values
of `undefined` do not force a rebuild). Existing public bytes,
authored navigation, `#SYSTEM` records, supported opaque metadata, LCIDs and
timestamp are preserved as applicable; physical layout/ITSF version/compression
bytes need not remain identical. Compression settings can change explicitly.

Only compression/window/reset/block options are accepted by `UpdateArchiveOptions`.
Metadata options such as `title` are refused rather than silently ignored.
`#SYSTEM` contents/index/default references must still resolve. Updating a page
does not regenerate authored TOC/index links; edit those resources explicitly
when needed. Arbitrary links inside authored HTML are not globally validated.

### Deliberate refusals

The updater cannot safely regenerate compiled HTML Help topic/search/window
structures (`#TOPICS`, `#URLTBL`, `#FIftiMain`, `$...` and related resources),
unknown DataSpace transforms, nonstandard transport metadata or extended LZX
ControlData, unsupported sections or ambiguous/nonportable content. It refuses such archives rather than dropping metadata or reporting
success with stale compiled indexes. Legacy-encoded `#SYSTEM` navigation that
cannot be validated safely is also refused. A readable CHM is not necessarily
an updatable CHM.

The reconstruction safety limits are 256 MiB for existing reconstructed content
and 256 MiB for resulting payloads plus preserved metadata. Changes are preflighted
as a batch, so deleting and adding files does not depend on map iteration order.
These are not total input/output/RSS limits: input, copies, decoder workspace
and serialization also allocate memory. `packFiles`/`packTemplate` are separate
in-memory builders, not a way to inherit the updater's safety budget. Apply your
own quotas before calling any builder. It offers no
filesystem replace/rollback operation; validate and publish the resulting file
under your application's own atomic-write and backup policy.

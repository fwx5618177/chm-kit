# Command-line guide

[Documentation](../index.md) · [Downloads](downloads.md) · [Configuration](configuration.md)

Examples use `chmkit` after installing the prebuilt tarball. For a local install,
use `npx --no-install chmkit`; for the standalone download, use
`node chmkit-VERSION-cli.cjs`. `chm` is an alias of the installed command.
Use your own `manual.chm` and paths returned by its file list.

```sh
chmkit --help
chmkit read --help
chmkit info manual.chm --json
chmkit read manual.chm --list --format json
chmkit tree manual.chm --depth 2 --json
```

## Search and filter

```sh
chmkit search manual.chm "installation" --type html,txt --limit 10 --json
chmkit search manual.chm "index" --names --case-sensitive
chmkit tree manual.chm --filter "**/*.html" --max-size 2MiB
chmkit read manual.chm --list --type "image/*" --min-size 1KiB --format json
```

`--filter` (glob), `--type` (comma-separated extension or MIME), `--min-size` and
`--max-size` intersect. Size limits are inclusive uncompressed sizes. Sizes accept
bytes, decimal KB/MB/GB and binary KiB/MiB/GiB; quote globs so your shell does not
expand them. MIME is inferred from filenames, not a content-security verdict.
For `read`, these filters only apply to `--list`; `-f` there means `--format`.

Content search is literal, skips binary MIME types and returns matching files,
not a persistent search index. `--limit` bounds matching files (`0` returns none);
`--max-matches` bounds matches per file. `--whole-word` uses Unicode word boundaries;
`--encoding` selects decoding. `--names` is a filename substring search and cannot
combine with `--whole-word` or `--encoding`. `--max-read-size 16MiB` bounds a
materialized source file, not archive size or CPU time.

## Read bytes, text or navigation

```sh
# First verify that this archive has /index.html.
chmkit read manual.chm /index.html
chmkit read manual.chm /index.html --encoding GBK --format json
chmkit read manual.chm /index.html --range 0:16 --format raw --output first.bin
chmkit read manual.chm /index.html --stream --output page.html
chmkit read manual.chm --toc --format json
chmkit read manual.chm --index --format json
```

Choose exactly one file path, `--list`, `--toc` or `--index`.
`--range start:end` is a strict half-open **byte** interval `[start, end)`; it must
fit the file and can split multibyte characters. `--format raw` preserves bytes;
text/JSON defaults to UTF-8 unless `--encoding` is set. File JSON wraps decoded
content and metadata. TOC/index JSON contains structured navigation; text/raw
returns authored `.hhc`/`.hhk` source.

`--stream` always emits original bytes, regardless of the default text format.
It supports range/output, not JSON. `--list` does not accept raw/range/stream.
`read --output` writes ordinary caller-selected files and **can overwrite them**;
it does not inherit extraction's exclusive-create/no-symlink policy.

## Extract one or many archives

```sh
chmkit extract manual.chm --output ./manual-new --preserve-structure --json
chmkit extract manual.chm --output ./html-new --preserve-structure --type html --concurrency 4 --chunk-size 65536 --progress
chmkit batch first.chm second.chm --output ./batch-new --preserve-structure --json
```

- Prefer a fresh private output directory. Without `--preserve-structure`, names
  are flattened; collisions fail. Existing destinations are never overwritten.
- Unsafe portable names, traversal, conflicting destinations and symlinks are
  rejected, including output-root ancestors. On macOS, use real paths rather
  than symlink aliases such as `/tmp`. Do not extract into directories a hostile
  local process can concurrently mutate; see [TOCTOU limits](../../SECURITY.md).
- Input is file-backed, with synchronous positioned reads and decompression;
  the whole archive is not first copied into memory. Keep the underlying file
  immutable throughout extraction, not just its pathname stable. The descriptor
  is closed on success, error or cancellation.
- `--concurrency` limits asynchronous output I/O, **not parallel decoder CPU**.
  `--chunk-size` is an integer byte count for each worker's write chunks.
  Directory metadata and per-generator decoder/chunk workspace still consume
  memory; concurrency is not a total RAM limit.
- Batch processes archives sequentially, with per-archive I/O concurrency.
  Outputs use numbered sanitized subdirectories such as `1-first/`. It consumes
  explicit input arguments; it does not implement its own filesystem globbing.
- Ctrl-C stops scheduling, drains work and attempts to remove incomplete files.
  Successfully completed files remain. Extraction is not an all-or-nothing transaction.
- JSON results include success lists and errors (batch returns one result per
  processed archive). Partial errors must not be interpreted as complete success.

## Preview or browse

```sh
chmkit preview manual.chm /index.html --output ./preview-new.html
chmkit browse manual.chm
```

`preview` writes a **static, noninteractive snapshot**, not a web server. It does
not launch a browser or bundle archive assets. HTML/text appears inside an inert,
script-free sandbox with restrictive CSP; external resources and interaction are
disabled, so styling/images/links may not work. Output creation is exclusive and
rejects symlink ancestors; its parent directory must already exist. Without
`--output`, generated HTML goes to stdout. Still treat archive content as untrusted.

`browse` requires stdin and stderr TTYs. Commands are `list [glob]`, `read <path>`,
`info <path>`, `search <text>`, `help`, `quit`. Its interface goes to stderr, not
stdout. Text display escapes terminal controls and truncates reads to 64 KiB;
it is not a binary terminal viewer. Automation should use tree/search/read.

## Create an archive

Prepare an `html-manual/` directory containing `index.html` first:

```sh
chmkit pack ./html-manual --output manual.chm --title "Manual" --default-topic index.html
chmkit pack ./html-manual --output tuned.chm --compression-level 6 --window-bits 16 --reset-interval 131072 --block-size 8192
chmkit pack ./html-manual --output stored.chm --no-compression
```

See [packing](packing.md) for what the compression knobs mean. TOC templates and
advanced metadata are API options, not additional CLI flags. Pack output is an
ordinary file-writing operation; choose a fresh name and do not assume extraction's
no-overwrite protections apply.

## Configuration and automation contract

```sh
chmkit --config ./chmkit.config.json search manual.chm "installation" --json
```

An explicit configuration is strict; otherwise the CLI looks in the current
working directory. CLI flags override connected defaults. The exact
[field-to-operation mapping](configuration.md) matters: accepted legacy fields
are not all implemented controls, and the CLI warns for unconnected ones.

Machine-readable stdout remains separate from stderr diagnostics/progress.
Ordinary errors and partial extraction failures exit nonzero (normally `1`);
extraction cancellation uses `130`. A JSON result alone is not proof of success:
check the exit status and `errors`/`cancelled`. Usage errors are also nonzero.

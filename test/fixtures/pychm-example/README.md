# Unmodified real-world aligned-Huffman CHM fixture

## Provenance and license

- Project: [PyCHM](https://github.com/dottedmag/pychm).
- Pinned revision: `9db50a881aa19649da100e5168d45401ee8f694b`.
- Original path: `tests/integration/example.chm`.
- [Exact download](https://raw.githubusercontent.com/dottedmag/pychm/9db50a881aa19649da100e5168d45401ee8f694b/tests/integration/example.chm).
- Git blob SHA-1: `a77d0a403edfc5644dc0219d2418a87f152c686e`.
- Archive SHA-256: `729ecdc2a8c29e9672b0162d07fb01910882ce012bd5f7f1d72ac87f2df9ca54`.
- Size: **10,842 bytes**. The archive is copied verbatim: no header edits,
  recompression, repairs, or conversion from another ITSF version.

The upstream repository's [LICENSE](https://github.com/dottedmag/pychm/blob/9db50a881aa19649da100e5168d45401ee8f694b/LICENSE)
explicitly states **GPLv2 or later**. Its notice is preserved verbatim in
`LICENSE.upstream`; the complete upstream GPLv2 text is preserved in `COPYING`.
These third-party test data and their extracted copies retain
**GPL-2.0-or-later**, not this project's MIT license. Keep these notices and the
license with redistributed copies. The test harness is independent of PyCHM.

Upstream copyright notices:

```text
Copyright (C) 2003-2006 Rubens Ramos <rubensr@users.sourceforge.net>
Copyright (C) 2014,2019 Misha Gusarov <dottedmag@dottedmag.net>
```

The fixture was introduced by Mikhail Gusarov in commit
[`64d4ef6a096e020a2e3f27295ffa9f7f44c256d3`](https://github.com/dottedmag/pychm/commit/64d4ef6a096e020a2e3f27295ffa9f7f44c256d3).
That commit tests exception propagation from a Python enumeration callback; it
is **not** a corrupt archive or an archive exploit. Upstream's subsequent
`test_enumerate.py` and `test_retrieve.py` use this same file for normal listing
and content retrieval. They independently identify the three user documents
and their lengths (566, 170, and 181 bytes).

The editable HTML and HHC document contents are all retained byte-for-byte in
`expected/`, along with the compiler-generated internal files. Upstream does
not provide the original HHP compilation project, and this fixture does not
claim reproducible compilation from an original project. The HHC identifies
Microsoft HTML Help Workshop 4.1 as its generator.

The libmspack CHM regression directory was checked first. It currently provides
malformed/CVE and ENCINT-boundary archives, not a suitable normal compressed
CHM, so none of those were repaired or represented as a production sample.

## Independent extraction oracle

The checked-in `expected/` tree was produced solely by **7-Zip (z) 26.05
(arm64)**, not by CHMKit, using:

```sh
7zz t example.chm
7zz x -y -oexpected example.chm
```

Both commands completed with `Everything is Ok`: 14 files, 3 directories,
17,336 extracted bytes. `manifest.json` and `SHA256SUMS` record SHA-256 digests
of the archive and every extracted file, including the zero-byte `#ITBITS`.
Three normal user documents are present:

| Document                           | Bytes |
| ---------------------------------- | ----: |
| `/Documents/Table of Contents.hhc` |   566 |
| `/page 1.html`                     |   170 |
| `/page 2.html`                     |   181 |

CHMKit's parser and `LZXDecoder.decodeFrames()` were then used independently to
decode the Content stream. **All 14 exposed files, including all three user
documents and all 11 internal files, matched the 7-Zip output byte-for-byte.**
No FileReconstructor behavior is needed by this regression test.

## Format coverage and limits

- Standard ITSF v3 (`0x60`) and ITSP (`0x54`), with real GUIDs and PMGL quickrefs.
- Auxiliary header section 0 starts at 96, whereas the data section starts at
  4,300. The compressed Content stream starts at **8,702**, not at either of
  those section bases.
- ControlData v2: 65,536-byte window and reset interval.
- ResetTable: one frame, 2,092 compressed bytes, 13,068 uncompressed bytes.
- The first LZX block is **type 2 (aligned Huffman)**, not a type-3 raw block.
- Mixed section 0 / section 1 resources, space-containing filenames, a nested
  TOC path, and a zero-byte section-0 resource.

This small fixture does **not** establish multi-frame, multi-reset, verbatim
Huffman, or ITSF v2 coverage. Those require separate independently sourced
fixtures; changing this archive's header is not a substitute.

## Running the offline test

From `chm-kit`:

```sh
pnpm test:unit test/core/real-chm.test.ts
```

The normal tests use vendored data and require no network access or download.
If `7zz` (or `7z`) is installed, an additional bounded test reruns integrity
checking and extraction into a temporary directory, compares every output
against both the checked-in oracle and CHMKit, and removes that directory.
Only that additional external-tool test is skipped when 7-Zip is unavailable.
The fixture, hashes, and offline decoder tests remain mandatory.

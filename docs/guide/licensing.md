# Licensing and test-corpus policy

[Documentation](../index.md) · [License](../../LICENSE) · [Contributing](../../CONTRIBUTING.md)

## Implementation and runtime downloads

CHMKit implementation code is MIT. Keep [LICENSE](../../LICENSE) with redistributed
copies. Runtime dependencies retain their own licenses; the delivery packager
collects license texts into `THIRD_PARTY_NOTICES.txt` for dependencies and their
runtime dependency graph. This notice accompanies the standalone CLI and archives.
It does not replace the license text or attribution requirements of embedded data.

A downloaded npm-format tarball is not the same thing as an npm registry
publication. Both have license obligations; only the former is currently offered
through the artifact pipeline.

## Third-party fixtures are not blanket MIT

`test/fixtures/pychm-example/` contains GPL-2.0-or-later PyCHM data.
`test/fixtures/upstream-chm/` contains independently sourced PuTTY, 7-Zip,
Inno Setup, PyCHM and libmspack fixtures with their corresponding MIT, permissive,
LGPL or GPL notices. Raw CHMs, extracted oracle bytes, notices and derived copies
retain their upstream terms. Review each fixture's README and manifest:

- [Original PyCHM fixture](../../test/fixtures/pychm-example/README.md)
- [Expanded independent corpus](../../test/fixtures/upstream-chm/README.md)

These resources are **test-only** and must not enter the npm tarball, browser
archive, standalone CLI, generated documentation attachments or demo downloads.
Do not use vendored fixture pages as product screenshots/sample content without
reviewing their license. A demo that extracts data can create licensed derivatives;
those outputs remain excluded from delivery.

## Adding or refreshing evidence

A new independent fixture needs a verifiable source URL, exact version/commit
where applicable, raw-byte SHA-256, license/notice and expected-output provenance.
A corresponding source release does not establish that a binary is reproducibly
built from that source; describe precisely what is pinned.

Use a trusted independent oracle for expected bytes. Never regenerate expected
files with CHMKit just to silence a mismatch. Do not change headers and present
the result as an unmodified real-world sample. Label generated/modified cases
synthetic. Unknown redistribution rights are a reason to exclude a sample, not
to omit its attribution.

Preserve fixture bytes exactly, including CRLF, NUL and binary resources. Keep
fixture `-text` Git attributes and formatter exclusions. Do not execute archive
contents or open malformed/CVE samples in a desktop viewer. Offline tests should
use the checked-in corpus rather than downloading arbitrary inputs during install.

The public delivery allowlist excludes source/tests/fixtures and intermediate
outputs. Installed-package and delivery checks must verify the **actual tarball**,
not just the repository's declared `files` list. Follow
[CI/release policy](../../.github/PIPELINES.md) before distributing new assets.

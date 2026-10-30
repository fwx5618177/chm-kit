# Security policy

CHM files can contain malformed binary structures, unexpectedly expensive
compressed data, executable HTML/JavaScript, external URLs and private content.
Parsing an archive is not the same as trusting its author or safely rendering it.

## Report a vulnerability

Prefer GitHub's [private vulnerability reporting](https://github.com/fwx5618177/chm-kit/security/advisories/new)
**if enabled for this repository**. This link is not a claim that reporting is
configured or that a dedicated security response team exists. If unavailable,
open a minimal issue asking the maintainer for a private reporting channel;
do not include weaponized input, private documents, credentials or exploit details
in a public issue. No response-time or coordinated-disclosure SLA is promised.

Privately include the affected version/source identity, runtime/platform, minimal
reproduction, expected/observed impact and legally shareable input or a safe
synthetic reproducer. Preserve original bytes and hashes. Do not execute CHM
content or open malformed/CVE fixtures in a desktop viewer to reproduce a parser bug.

## Supported versions and updates

There is no promised long-term backport matrix. Check the latest maintained
source and [validation record](VALIDATION.md), then reproduce on a matching
verified prebuilt artifact. The public `chmkit` npm endpoint currently returns
404, and npm publication is not planned for this work; an unrelated registry
package or stale artifact is not a security update.
A draft release is not a public release. See [downloads](docs/guide/downloads.md).

## Untrusted HTML and resource privacy

- Never put archive HTML into the host application's `innerHTML`, `document.write`
  or privileged renderer document. Reading/decoding HTML does not sanitize it.
- Preview in an iframe with an empty sandbox, without `allow-scripts` or
  `allow-same-origin`. Use restrictive CSP to block scripts, objects, forms,
  unapproved frames and network access. Do not grant Node or raw IPC to that frame.
- A sandbox **alone is not a network firewall**. CSS imports, images/fonts,
  external navigation and other resources can disclose IP/referrer/document data.
  Validate/rewrite resource and navigation targets; reject external or unsupported
  schemes unless an explicit application policy allows them.
- Archive names containing literal `#`/`%` differ from URL query/fragment syntax.
  Resolve/canonicalize safely; a string prefix check or indiscriminate decoding
  is not adequate resource authorization. Revoke created object URLs when done.
- CLI `preview` is a static, inert snapshot with restrictive CSP, not a fully
  interactive viewer or a resource bundle. Do not remove its boundaries to make
  arbitrary scripts/styles work. More complex viewers need their own threat model.

A local file selection need not upload anything. The core reader does not need a
network service to parse bytes; your fetches, static host, application code and
external document resources determine network exposure. Dependency installation
and Actions downloads are separate network operations. Do not claim a browser
integration is private merely because parsing occurs locally.

## Node file lifetime and filesystem operations

Node `CHMReader.open(path)` holds a descriptor with synchronous positioned I/O.
Keep the **underlying file immutable throughout that descriptor's lifetime**, not
just its pathname stable. Concurrent writes/truncation can invalidate parsed
metadata and read assumptions. Stage uploads in a private immutable location,
limit their size, and close readers/streams explicitly. No file lock or immutable
snapshot is guaranteed. Descriptor identity, size and timestamp checks occur at
read boundaries (including cache hits) and close/refuse detected mutations; they
do not remove concurrent-write races or the immutability requirement. Memory
input is an alternative with a full-copy cost.

Directory extraction is file-backed as well: keep its source immutable throughout
the operation. The extractor validates the source around reads/writes and commit,
and closes the descriptor on success, error or cancellation. Avoid treating a
long-running extraction as a permanent snapshot of a mutable upload.

Extraction rejects traversal, unsafe portable names, conflicting destinations,
symlinks (including ancestors) and overwrites. It rechecks paths and uses exclusive
creation. These checks reduce risk but **cannot eliminate all hostile local TOCTOU
races** across portable path-based filesystem APIs. Extract only into a private
directory that untrusted local processes cannot mutate. Use real paths rather
than aliases such as macOS `/tmp`; do not weaken safety checks for convenience.

Extraction is not transactional: successful files can remain after an error or
cancellation. Inspect errors and attempt application cleanup under your own policy.
`read --output`, pack and ordinary file-writing APIs do not all inherit extraction's
exclusive-create policy; treat output destinations as trusted application input.
Do not run extracted scripts or silently open the result in a privileged viewer.

## Resource exhaustion and cancellation

`maxCacheBytes` bounds managed caches, not total RAM. `maxFileSize` limits a single
materialized output, not compressed input, aggregate output or total CPU.
Metadata/path expansion, dictionaries, memory input, text decoding, RPC cloning,
caller-held results and concurrent sessions have separate costs. Streaming avoids
whole-result materialization only if the caller does not retain every chunk.
Random ranges may require decompression from a preceding reset. File-backed
extraction avoids the whole-input copy, but directory metadata and per-generator
decoder/chunk workspace remain; bounded output concurrency is not a RAM cap.

Optional `adaptivePreload` is default-off adjacent-file warming via timers.
Its `maxFiles`/`maxBytes` and cache headroom bound speculative candidates/cost,
not total CPU or RSS. Timer callbacks still execute synchronous input/decode
on the same thread. This is separate from `readAhead`, the Node source's
synchronous sequential window expansion, and explicit synchronous `preload()`.
Cache clearing, disabling or close cancels predicted work. A background failure
closes the archive, is retained by `getPreloadError()` and is rethrown by later
data calls; applications enabling prediction should inspect/report that diagnostic.
Do not treat "background" as CPU isolation or exception-free successful decoding.

Node reads, parsing and decompression are synchronous. AbortSignals/RPC timeouts
settle local calls and support cooperative cleanup; they do not preempt a running
synchronous decoder/search. Worker/Electron payload limits are checked after
transport cloning, not before allocation. Terminating an owned worker/process is
a stronger deadline mechanism, with its own cleanup implications.

For hostile uploads, impose input, file-count, expanded-output and concurrency
quotas, wall-clock deadlines, process isolation and OS CPU/memory restrictions.
A V8 heap cap is not a hard Buffer/external-memory/RSS cap. Neither configuration
`maxMemory` nor checksum-related legacy fields provide undocumented protections.
See [effective configuration](docs/guide/configuration.md).

## Electron capability boundaries

Require `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
Validate the exact webContents and trusted top-frame URL; recheck archive
authorization on every use. Only main-owned factories may choose OS paths.
Expose the frozen plain-function renderer API, not raw ipcRenderer or arbitrary
channels. Capabilities are sender/frame scoped and invalidated on lifecycle changes.

Path/result filtering limits returned data, not timing or work spent scanning
hidden content. Disable search or implement a capability-restricted adapter for
stronger isolation. IPC does not move decoder CPU out of Electron main; add an
application-owned worker/process. Keep privileged errors and local paths out of
renderer diagnostics. See [Electron integration](docs/guide/electron.md).

## Supply chain, evidence and publication

Obtain assets/manifests from a trusted source and verify SHA-256. Checksums are
integrity checks, not signatures. Review provenance and third-party notices.
Normal CI has no publish permission. A matching existing tag and independently
reviewed protected `release` environment are prerequisites for the manual draft
release workflow; tag/environment setup and authorization have not been completed
by this work. Publishing GitHub Releases requires explicit maintainer approval;
documentation changes are not that authorization. No npm publication is planned,
and no public API documentation hosting is implied by its CI artifact.

Independent corpus, differential extraction and bounded mutation/fuzz tests are
valuable regression evidence, **not exhaustive fuzzing or a formal security proof**.
An early parser rejection does not establish coverage of every later malformed
field. Preserve fixture licenses and keep test corpora out of downloads/npm.
Current execution evidence belongs in [VALIDATION.md](VALIDATION.md), not a claim
that every future archive or feature combination is safe.

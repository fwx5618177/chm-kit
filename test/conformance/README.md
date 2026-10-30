# Independent CHM conformance tests

These tests exercise unmodified upstream archives, independent resource-byte
oracles, bounded deterministic mutations, and interoperability with an installed
7-Zip. A successful chm-kit round trip is never treated as an independent oracle.

## Run

From the repository root, with the development dependencies installed:

```sh
CHM_REQUIRE_7Z=1 pnpm exec vitest run --project node test/conformance test/bench/peak-memory.test.ts --reporter=default --reporter=json --outputFile.json=test-results/bench/conformance-vitest.json
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm exec eslint test/conformance test/bench --ext .ts
pnpm exec prettier --check test/conformance test/bench
```

Use a trusted installed `7zz`/`7z`, or set `CHM_7Z` to its executable path. Without
`CHM_REQUIRE_7Z=1`, only external-tool tests explicitly skip when it is absent;
pinned-oracle correctness and resource-limit tests still run. With that variable,
a missing tool is a failure. No tests download or execute bundled programs.

Reports and temporary extraction directories go under ignored
`test-results/bench/`; temporary directories are removed in `finally` blocks.
Do not check generated JSON or native runner reports into test source directories.
The checked-in fixture manifest and SHA256SUMS are provenance/oracle metadata,
not benchmark reports. See [native benchmarks and memory methodology](../bench/README.md).

## Corpus and oracle provenance

The test-only [fixture README](../fixtures/upstream-chm/README.md),
`manifest.json`, license notices and `SHA256SUMS` preserve exact origins and
hashes. The five normal CHMs provide **721 independently extracted resources**;
11 additional upstream inputs are malformed. Together the fixture tree is about
4 MB. Existing `pychm-example` data is separate and is not regenerated here.

| Upstream                       | Pinned source commit                                                                                                                                      | License of retained data      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| PuTTY 0.83 release manual      | [d2c178c49a0ae6fa9ef75ca84fb3c9d0d675ea85](https://git.tartarus.org/?p=simon/putty.git;a=commit;h=d2c178c49a0ae6fa9ef75ca84fb3c9d0d675ea85)               | MIT                           |
| 7-Zip 23.01 release help       | [5b39dc76f1bc82f941d5c800ab9f34407a06b53a](https://github.com/ip7z/7zip/tree/5b39dc76f1bc82f941d5c800ab9f34407a06b53a)                                    | LGPL-2.1-or-later             |
| Inno Setup example             | [2527da77ff7983514f535d19391a748c5d898336](https://github.com/jrsoftware/issrc/tree/2527da77ff7983514f535d19391a748c5d898336)                             | Inno Setup permissive license |
| PyCHM combined / combined2     | [9db50a881aa19649da100e5168d45401ee8f694b](https://github.com/dottedmag/pychm/tree/9db50a881aa19649da100e5168d45401ee8f694b)                              | GPL-2.0-or-later              |
| libmspack malformed/CVE inputs | [55d501976171397ccd5d5a7a1ca7da065b1d9a06](https://github.com/kyz/libmspack/tree/55d501976171397ccd5d5a7a1ca7da065b1d9a06/libmspack/test/test_files/chmd) | LGPL-2.1-or-later             |

Release source commits identify the corresponding releases, not reproducible
builds or Git blobs of release binaries. The manifest separately records actual
official download URLs, binary SHA-256 and raw Git blob hashes where applicable.
The official 7-Zip installer was only opened as an archive by the trusted
installed 7zz to obtain help/license data; it was never executed or retained.

`expected/` was extracted with **7-Zip 26.05**, not chm-kit. Integrity tests verify
all pinned bytes, notice digests and resource digests. Fresh `7zz t`/`x` tests
additionally compare the full resource set, lengths and bytes of every normal
archive. Six writer differentials (three seeds, compression on/off) compare
7-Zip's decode of library-produced CHMs to bytes constructed **before** invoking
the writer: Unicode HTML, portable unusual paths, empty resources, random binary,
multi-frame repetitive data and explicitly synthetic GBK bytes.

Offline oracle maintenance, only when deliberately reviewing fixture changes:

```sh
python3 test/conformance/refresh-oracles.py
```

This stdlib Python/7-Zip tool checks pinned input/notice hashes before extraction,
performs no network access and imports no chm-kit code. It rewrites only the new
fixture expected bytes and manifest. Tool-version changes affect manifest hashes;
never regenerate expected bytes from the implementation to silence a failure.

## Coverage matrix

| Dimension               | Positive evidence                                                                                                                                | Remaining gap / qualification                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Real ITSF v3 layouts    | All five normal archives; complete resource equality                                                                                             | No claim about every producer/version                                                                        |
| Explicit data base 0    | Official 7-Zip: directory `[107024,115300)` at EOF, content offset 314, data base 0                                                              | Data need not follow directory; per-entry source bounds still apply                                          |
| Multi-frame and reset   | PuTTY: 82 frames / 41 reset groups, 64 KiB window/reset                                                                                          | No real large/long-reset positive archive                                                                    |
| Different window        | 7-Zip: 128 KiB window/reset, 12 frames / 3 reset groups                                                                                          | No real other window sizes or LZXC v1                                                                        |
| Producer combinations   | Halibut vs HHA 4.74.8702, one-frame and multi-PMGL/PMGI directory layouts                                                                        | No established FPC/chmcmd sample                                                                             |
| LZX block forms         | VERBATIM-first PuTTY/Inno/7-Zip, ALIGNED-first PyCHM                                                                                             | First-block observations do not classify every block; no new real E8-enabled positive sample                 |
| HTML decoding           | Actual US-ASCII, UTF-8, Windows-1252; charset is not inferred solely from LCID                                                                   | No real GBK/UTF-16; generated writer GBK is synthetic                                                        |
| **Normal real ITSF v2** | **Not available**                                                                                                                                | Upstream malformed v2 structures are not positive interoperability evidence; synthetic v2 is not substituted |
| Upstream malformed      | 11 pinned libmspack CVE/ENCINT samples                                                                                                           | Early structural rejection does not prove execution reached the named later corrupt field                    |
| Deterministic mutations | 52 fixed Inno-based cases including 32 seeded bit flips                                                                                          | Small regression campaign, not exhaustive fuzzing or all-producer mutation coverage                          |
| Seeded legal ranges     | 40 samples per archive, 10 also streamed; seed `0x7a11c026 + archiveIndex`, at most 8192 bytes/range                                             | Fixed smoke sampling, not a statistical confidence estimate; separate from explicit boundary tests           |
| Reader limits           | Frame/reset boundary ranges, full/range streams, file-size/range rejection, <=1 KiB chunks under a 1 KiB materialization limit, cache accounting | Owned complete archive input is separate from output/cache limits                                            |
| Performance / memory    | Five native Vitest benchmarks plus calibrated, GC-aware isolated read/range/stream workloads                                                     | Coarse guards, not universal performance thresholds or isolated dictionary-memory measurements               |

## Bounded failure testing

`bounded-mutations.test.ts` uses xorshift32 seed `0xc41f2026`:

- Eight truncations; corrupt header/directory/control fields; an invalid LZX
  block-type-zero payload that must reject during decoding.
- Four valid timestamp-only controls that must reproduce every independent
  expected resource, plus 32 seeded single-bit mutations across metadata and
  compressed payload.
- Eleven libmspack cases reject with nonempty typed parser errors. The upstream
  XOR-obfuscated sample is decoded only in memory.

Every parser campaign runs in a child with a **15-second SIGKILL deadline**,
128 MiB V8 old-space cap and 2 MiB IPC-output cap. Harness limits are 96 cases,
32 KiB input/case, 32 requested resources, 128 listed paths, 512 KiB per-file
materialization, 256 KiB aggregate output/case and zero managed cache. Budget
violations, OOM, malformed/missing result records, signals and timeouts fail the
test; they are not accepted as ordinary parser rejection.

For mutations not mandated to reject, mutually successful decodes compare every
resource hash/length with fresh 7-Zip extraction. At least four valid controls
must be compared. DUT-accepted/oracle-rejected cases are recorded separately and
never counted as successful comparisons. This is not a symmetric acceptance
policy comparison: DUT-rejected mutations are not independently decoded.
External mutation calls have 5-second SIGKILL deadlines, capped output and a
40-second aggregate oracle budget after the isolated DUT campaign. Normal/writer
7-Zip checks have 15-second per-process SIGKILL deadlines. All campaigns have
fixed case counts; no retry-until-pass loop exists.

Stream helpers require positive bounded chunks, exact EOF, a byte-derived finite
pull budget, a five-second asynchronous drain deadline and a one-second maximum
cancel deadline. Harness tests deliberately stall reads and cancellation to
verify those failures. These timers cannot preempt synchronous JavaScript;
child-process deadlines protect isolated mutation/memory workloads. Native
in-process conformance/bench runs should additionally use a CI job/process timeout.
A V8 old-space cap is **not** an OS-enforced RSS/Buffer/external-memory limit.

## Immutable bytes and redistribution

- Preserve fixture `-text`, immutable-fixture whitespace attributes and formatter
  exclusion. Upstream CRLF/trailing whitespace, notices, HTML, NULs and binary
  resources must not be normalized to satisfy formatting or whitespace checks.
- All corpus and extracted derivatives are **test-only and excluded from npm**,
  especially GPL PyCHM data. Preserve each upstream license; the package's MIT
  license does not relicense third-party fixtures. Verify the final package
  allow-list independently when packaging.
- Correctness results and benchmark artifacts describe the source revision and
  environment actually executed, not a historical clean checkout. Rerun after
  source integration; generated reports are intentionally not versioned.

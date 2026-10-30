# Native real-corpus benchmarks and peak memory

`real-corpus.bench.ts` uses Vitest's native `bench()` API, not a custom runner
or a synthetic CHM round trip. Runner/project discovery is configured centrally;
these files do not create or rewrite runner configuration.

## Run

From the repository root with the development dependencies installed:

```sh
pnpm exec vitest bench --project node --run test/bench/real-corpus.bench.ts --outputJson=test-results/bench/vitest-benchmark.json --reporter=default
pnpm exec vitest run --project node test/bench/peak-memory.test.ts --reporter=default --reporter=json --outputFile.json=test-results/bench/memory-vitest.json
```

All generated reports, including the memory test's `peak-memory.json`, belong in
ignored **`test-results/bench/`**, never alongside source files or checked into
Git. A run overwrites its report; inspect timestamps and environment before
comparing results. Native `.bench.ts` files run in benchmark mode; the memory
`.test.ts` also runs through ordinary Node test discovery. No checked-in latency
or RSS snapshot is a portable baseline.

The five native timing cases use 250 ms sampling / 100 ms warmup, with at least
five measured and two warmup iterations per case. Stream drains have explicit
byte/pull limits, five-second asynchronous deadlines and bounded cancellation.
Native timing budgets cannot interrupt a synchronous library hang, so configure
a finite CI job/process timeout in addition to the native benchmark settings.
The separate memory parent kills stalled children even during synchronous work.

## Real workload

The input is the unmodified official PuTTY 0.83 manual (MIT), archive SHA-256
`3508241b8284fa643a69e6cbbde1a8273748c0d9ad4312be70cb90f26a474ac3`.
It is 367239 bytes with 82 physical LZX frames / 41 reset groups, a 64 KiB
window and a multi-PMGL/PMGI directory. `/index.hhk` is 178202 bytes and crosses
multiple frames and resets. All 579 archive resources have independent 7-Zip
byte oracles; setup checks full and range bytes/streams before timing. Source
commit URLs, licenses and oracle provenance are in
[the fixture README](../fixtures/upstream-chm/README.md).

The native workloads are:

1. New owned-byte reader, directory parsing, existence check and close.
2. Full materialized `/index.hhk` read.
3. Late `[70000,74096)` 4096-byte range, including necessary reset history.
4. Full WHATWG stream, drained without retaining chunks.
5. Late range WHATWG stream, 4096 bytes, without accumulating chunks.

Cache is disabled, including reconstructed blocks. Reusing the reader separates
read/range/stream timings from archive-open costs. “Cold” means no managed
decoded/file cache, **not** cold disk/OS cache: input is already in memory.
Streams include harness chunk/deadline checks; do not interpret these numbers as
bare decoder throughput. The different-size workloads are not equivalent, and
streaming does not bypass complete owned archive input.

## GC-aware memory measurement

`peak-memory.test.ts` runs four fresh Node processes: one calibration, then one
for each read/range/stream mode. Each child has a **20-second SIGKILL deadline**,
128 MiB V8 old-space cap and 64 KiB IPC-output cap. The test has a finite
90-second overall budget. No external executable is downloaded or run.

The calibration process touches a fixed 32 MiB Buffer and records sampled RSS
alongside Node's OS high-water reading. It is separate so that its allocation
cannot contaminate real-workload lifetime peaks. Unit-contract tests cover the
same KiB-to-byte conversion for Linux/macOS/Windows labels; live calibration
verifies **only the OS where that report ran**, not three-platform execution.
Invalid, nonfinite, zero and unsafe maxRSS values fail rather than silently
falling back to a sample.

Each real workload:

- Forces exactly two GC calls before its baseline and two after closing the
  reader and leaving the workload scope. It records before/after snapshots;
  there is no GC inside the 12 measured operations or retry-until-low-RSS loop.
- Reads, ranges or streams the same real resource 12 times. Full/range digests
  and streaming SHA-256 must match independent expected data. Outputs are not
  accumulated; streaming hashes and discards chunks.
- Records archive digest/size, resource size, output count, elapsed time,
  zero-cache accounting, operation/chunk-boundary samples and OS peak RSS.
- Enforces coarse guards: peak RSS below 512 MiB; post-GC retained heap growth
  below 64 MiB; external and array-buffer growth each below 32 MiB. These guard
  crash/runaway regressions on small fixtures, not a public memory guarantee or
  a proof that no allocation can escape an instantaneous hard limit.

### Units and interpretation

[Node's `process.resourceUsage()` contract](https://nodejs.org/docs/latest-v20.x/api/process.html#processresourceusage)
returns `maxRSS` in **KiB** through libuv, including Darwin and Windows. Multiply
by 1024 once. Do **not** apply the raw Darwin libc `getrusage()` byte convention
to this already-normalized Node API. `process.memoryUsage()` returns bytes.
Calibration allows 16 MiB of counter/sampling tolerance and a generous ratio
bound to detect gross unit errors without requiring exact agreement or an exact
32 MiB RSS increase.

- OS peak is process-lifetime high-water: Node/tsx/imports, metadata, complete
  inputs, reader ownership, decoder and allocations all contribute.
- Forced GC does **not** reset that high-water and need not return RSS to its
  baseline. Retained deltas may be negative; the test does not demand RSS reclaim.
- Heap/external/array-buffer/RSS samples are not exact intra-operation peaks.
  The retention checks are coarse evidence after a finite workload, not a leak
  detector or isolated decoder-working-set measurement.
- V8 old-space 128 MiB is **not** a hard limit on Buffers/external memory/RSS.
  The 512 MiB assertion detects excess after completion; an OS/container limit
  is needed for an allocation-time hard RSS ceiling.
- Different children have different loader/GC baselines. Subtracting workload
  rows does not isolate dictionary memory or prove asymptotic bounds.

Use controlled, comparable environments/revisions for performance work. Large
archives, long reset groups, browser workers, filesystem random access and
memory-pool optimizations need separate evidence. See
[conformance coverage and limitations](../conformance/README.md).

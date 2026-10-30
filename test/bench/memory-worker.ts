import { createHash } from 'node:crypto';
import { CHMArchive, CacheStrategy } from '../../src/reader/chm-archive';
import { drainStream } from '../conformance/bounded-stream';
import {
  fixtureBytes,
  normalArchives,
  oracleBytes,
  sha256,
} from '../conformance/corpus';
import { forceGc, maxRssBytes } from './memory-metrics';

const archive = normalArchives.find(a => a.file === 'putty-0.83.chm')!;
const file = archive.files.find(f => f.name === '/index.hhk')!;
const iterations = 12;

function touchedAllocation() {
  const allocation = Buffer.alloc(32 * 1024 * 1024, 0xa5);
  const touched = process.memoryUsage();
  const touchedMaxRssKiB = process.resourceUsage().maxRSS;
  if (allocation[0] !== 0xa5 || allocation[allocation.length - 1] !== 0xa5)
    throw new Error('Memory calibration allocation was not touched');
  return { allocationBytes: allocation.length, touched, touchedMaxRssKiB };
}

async function workload(mode: string, baseline: NodeJS.MemoryUsage) {
  // Only the range digest escapes; do not retain an extra full oracle in the
  // measured workload or construct expected data with the library under test.
  const rangeDigest = sha256(oracleBytes(file).subarray(70_000, 74_096));
  const input = fixtureBytes(archive.file);
  const reader = new CHMArchive(input, {
    cacheStrategy: CacheStrategy.None,
    maxCacheBytes: 0,
  });
  const sampled = { ...baseline };
  const sample = () => {
    const usage = process.memoryUsage();
    for (const key of [
      'rss',
      'heapUsed',
      'heapTotal',
      'external',
      'arrayBuffers',
    ] as const)
      sampled[key] = Math.max(sampled[key], usage[key]);
  };
  sample();
  const start = performance.now();
  let total = 0;
  try {
    for (let iteration = 0; iteration < iterations; iteration++) {
      if (mode === 'read') {
        const bytes = reader.readFile(file.name);
        if (sha256(bytes) !== file.sha256)
          throw new Error('Memory read oracle mismatch');
        total += bytes.length;
        sample();
      } else if (mode === 'range') {
        const bytes = reader.readRange(file.name, 70_000, 74_096);
        if (bytes.length !== 4096 || sha256(bytes) !== rangeDigest)
          throw new Error('Memory range oracle mismatch');
        total += bytes.length;
        sample();
      } else {
        const hash = createHash('sha256');
        total += await drainStream(
          reader.createReadStream(file.name),
          file.length,
          {
            onChunk(chunk) {
              hash.update(chunk);
              sample();
            },
          },
        );
        if (hash.digest('hex') !== file.sha256)
          throw new Error('Memory stream oracle mismatch');
      }
    }
    return {
      iterations,
      archive: archive.file,
      archiveSha256: archive.sha256,
      archiveBytes: input.length,
      file: file.name,
      fileBytes: file.length,
      totalOutputBytes: total,
      elapsedMs: performance.now() - start,
      sampledMemoryHighWaterBytes: sampled,
      managedCacheBytes: reader.getCacheStats().bytes,
    };
  } finally {
    reader.close();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!['calibrate', 'read', 'range', 'stream'].includes(mode))
    throw new Error(`Unknown memory workload: ${mode}`);
  const baselineBeforeGc = process.memoryUsage();
  forceGc();
  const baselineAfterGc = process.memoryUsage();
  const baselineMaxRssKiB = process.resourceUsage().maxRSS;
  maxRssBytes(baselineMaxRssKiB);
  let result;
  if (mode === 'calibrate') {
    const touched = touchedAllocation();
    forceGc();
    const osPeakRssKiB = process.resourceUsage().maxRSS;
    result = {
      mode,
      platform: process.platform,
      before: baselineAfterGc,
      baselineMaxRssKiB,
      ...touched,
      afterGc: process.memoryUsage(),
      osPeakRssKiB,
      osPeakRssBytes: maxRssBytes(osPeakRssKiB),
    };
  } else {
    const measured = await workload(mode, baselineAfterGc);
    // workload() has returned and closed its reader; its input/output references
    // do not escape. GC is deliberately outside the 12 measured operations.
    const afterCloseBeforeGc = process.memoryUsage();
    forceGc();
    const afterCloseAfterGc = process.memoryUsage();
    const osPeakRssKiB = process.resourceUsage().maxRSS;
    result = {
      mode,
      ...measured,
      gcCallsPerCheckpoint: 2,
      baselineBeforeGc,
      baselineAfterGc,
      baselineMaxRssKiB,
      afterCloseBeforeGc,
      afterCloseAfterGc,
      osPeakRssKiB,
      osPeakRssBytes: maxRssBytes(osPeakRssKiB),
    };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(error => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

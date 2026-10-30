import { spawnSync } from 'node:child_process';
import { cpus, release } from 'node:os';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { writeReport } from '../conformance/artifacts';
import {
  maxRssBytes,
  type CalibrationResult,
  type MemoryResult,
} from './memory-metrics';

const MiB = 1024 * 1024;

function finiteMetrics(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `Nonfinite metric: ${value}`).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) finiteMetrics(item);
  }
}

function childResult<T>(mode: string): T {
  const child = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--max-old-space-size=128',
      '--import',
      'tsx',
      resolve(__dirname, 'memory-worker.ts'),
      mode,
    ],
    {
      cwd: resolve(__dirname, '../..'),
      timeout: 20_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
    },
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  const result = JSON.parse(child.stdout) as T;
  finiteMetrics(result);
  return result;
}

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`Node maxRSS KiB normalization contract (${platform}, not raw libc units)`, () => {
    // Unit-contract cases, not a claim that this machine ran three OSes.
    expect(maxRssBytes(96 * 1024)).toBe(96 * MiB);
    for (const invalid of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])
      expect(() => maxRssBytes(invalid)).toThrow(/Invalid Node maxRSS/);
  });
}

test('isolated real-corpus GC retention and calibrated OS peak RSS', () => {
  // Calibration is a separate process: its 32 MiB touch must not contaminate
  // the process-lifetime peak of any real workload.
  const calibration = childResult<CalibrationResult>('calibrate');
  expect(calibration.mode).toBe('calibrate');
  expect(calibration.platform).toBe(process.platform);
  expect(calibration.allocationBytes).toBe(32 * MiB);
  expect(calibration.touchedMaxRssKiB).toBeGreaterThanOrEqual(
    calibration.baselineMaxRssKiB,
  );
  expect(calibration.osPeakRssKiB).toBeGreaterThanOrEqual(
    calibration.touchedMaxRssKiB,
  );
  expect(calibration.osPeakRssBytes).toBe(
    maxRssBytes(calibration.osPeakRssKiB),
  );
  // Allow sampling/counter timing and platform accounting differences; detect
  // zero/invalid readings and 1024x unit mistakes without demanding RSS reclaim.
  expect(
    maxRssBytes(calibration.touchedMaxRssKiB) + 16 * MiB,
  ).toBeGreaterThanOrEqual(calibration.touched.rss);
  expect(maxRssBytes(calibration.touchedMaxRssKiB)).toBeLessThan(
    calibration.touched.rss * 8,
  );
  expect(calibration.osPeakRssBytes).toBeLessThan(512 * MiB);

  const workloads: MemoryResult[] = [];
  for (const mode of ['read', 'range', 'stream']) {
    const result = childResult<MemoryResult>(mode);
    expect(result.mode).toBe(mode);
    expect(result.iterations).toBe(12);
    expect(result.fileBytes).toBe(178202);
    expect(result.gcCallsPerCheckpoint).toBe(2);
    expect(result.totalOutputBytes).toBe(
      result.iterations * (mode === 'range' ? 4096 : result.fileBytes),
    );
    expect(result.osPeakRssKiB).toBeGreaterThanOrEqual(
      result.baselineMaxRssKiB,
    );
    expect(result.osPeakRssBytes).toBe(maxRssBytes(result.osPeakRssKiB));
    expect(result.osPeakRssBytes + 16 * MiB).toBeGreaterThanOrEqual(
      result.sampledMemoryHighWaterBytes.rss,
    );
    expect(result.osPeakRssBytes).toBeLessThan(512 * MiB);
    expect(
      result.afterCloseAfterGc.heapUsed - result.baselineAfterGc.heapUsed,
    ).toBeLessThan(64 * MiB);
    for (const key of ['external', 'arrayBuffers'] as const) {
      expect(
        result.afterCloseAfterGc[key] - result.baselineAfterGc[key],
      ).toBeLessThan(32 * MiB);
    }
    expect(result.managedCacheBytes).toBe(0);
    expect(result.elapsedMs).toBeGreaterThan(0);
    workloads.push(result);
  }
  writeReport('peak-memory.json', {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    cpu: cpus()[0]?.model,
    limits: {
      childDeadlineMs: 20_000,
      oldSpaceMiB: 128,
      osPeakGuardBytes: 512 * MiB,
      retainedHeapGuardBytes: 64 * MiB,
      retainedExternalGuardBytes: 32 * MiB,
    },
    notes: [
      'Node/libuv maxRSS is KiB on Linux/macOS/Windows; normalized bytes = raw * 1024.',
      'Live calibration applies only to the recorded OS; other OS unit cases are contract tests.',
      'OS peak is process-lifetime and includes Node/tsx, metadata, owned inputs and decoder.',
      'GC does not reset OS peak or guarantee RSS return; retention deltas are coarse guards.',
      'Two forced GC calls before baseline and after close; none inside the 12 operations.',
      'heap/external/arrayBuffers/RSS samples at operation/chunk boundaries are NOT exact peaks.',
      'V8 old-space cap is NOT a hard Buffer/external/RSS cap; streams do not retain chunks.',
    ],
    calibration,
    workloads,
  });
}, 90_000);

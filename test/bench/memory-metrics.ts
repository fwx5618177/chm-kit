// Node/libuv normalizes maxRSS to KiB, including Darwin and Windows.
// This is NOT the platform-specific unit of a direct libc getrusage() call.
export function maxRssBytes(rawKiB: number): number {
  const bytes = rawKiB * 1024;
  if (
    !Number.isSafeInteger(rawKiB) ||
    rawKiB <= 0 ||
    !Number.isSafeInteger(bytes)
  )
    throw new Error(`Invalid Node maxRSS (KiB): ${rawKiB}`);
  return bytes;
}

export function forceGc(): void {
  if (!global.gc) throw new Error('Memory worker requires --expose-gc');
  // Two fixed passes allow finalization/external accounting to settle without
  // retrying until an arbitrary RSS target (which GC cannot guarantee).
  global.gc();
  global.gc();
}

export interface MemoryResult {
  mode: string;
  iterations: number;
  fileBytes: number;
  totalOutputBytes: number;
  osPeakRssKiB: number;
  osPeakRssBytes: number;
  baselineMaxRssKiB: number;
  managedCacheBytes: number;
  elapsedMs: number;
  gcCallsPerCheckpoint: number;
  baselineBeforeGc: NodeJS.MemoryUsage;
  baselineAfterGc: NodeJS.MemoryUsage;
  afterCloseBeforeGc: NodeJS.MemoryUsage;
  afterCloseAfterGc: NodeJS.MemoryUsage;
  sampledMemoryHighWaterBytes: NodeJS.MemoryUsage;
}

export interface CalibrationResult {
  mode: 'calibrate';
  platform: string;
  allocationBytes: number;
  before: NodeJS.MemoryUsage;
  touched: NodeJS.MemoryUsage;
  afterGc: NodeJS.MemoryUsage;
  baselineMaxRssKiB: number;
  touchedMaxRssKiB: number;
  osPeakRssKiB: number;
  osPeakRssBytes: number;
}

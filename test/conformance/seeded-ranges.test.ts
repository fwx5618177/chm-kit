import { expect, test } from 'vitest';
import { CHMArchive, CacheStrategy } from '../../src/reader/chm-archive';
import { writeReport } from './artifacts';
import {
  consumeStream,
  fixtureBytes,
  normalArchives,
  oracleBytes,
  seededRandom,
} from './corpus';

const seed = 0x7a11c026;
const reports: unknown[] = [];

for (const [index, archive] of normalArchives.entries()) {
  test(`seeded resource/range differential against pinned 7-Zip bytes: ${archive.file}`, async () => {
    const random = seededRandom(seed + index);
    const reader = new CHMArchive(fixtureBytes(archive.file), {
      cacheStrategy: CacheStrategy.None,
      maxCacheBytes: 0,
    });
    const samples: {
      name: string;
      start: number;
      end: number;
      stream: boolean;
    }[] = [];
    let totalBytes = 0;
    try {
      for (let sample = 0; sample < 40; sample++) {
        const file = archive.files[random() % archive.files.length]!;
        const expected = oracleBytes(file);
        const start = random() % (file.length + 1);
        const end =
          start + (random() % (Math.min(8192, file.length - start) + 1));
        const stream = sample % 4 === 0;
        expect(reader.readRange(file.name, start, end), file.name).toEqual(
          expected.subarray(start, end),
        );
        if (stream)
          await consumeStream(
            reader.createReadStream(file.name, start, end),
            expected.subarray(start, end),
          );
        samples.push({ name: file.name, start, end, stream });
        totalBytes += end - start;
      }
      expect(samples).toHaveLength(40);
      expect(samples.filter(s => s.stream)).toHaveLength(10);
      expect(totalBytes).toBeLessThanOrEqual(40 * 8192);
      expect(reader.getCacheStats().bytes).toBe(0);
    } finally {
      reader.close();
    }
    reports.push({
      archive: archive.file,
      sha256: archive.sha256,
      seed: seed + index,
      totalBytes,
      samples,
    });
    writeReport('seeded-ranges.json', {
      measuredAt: new Date().toISOString(),
      policy:
        'Fixed seeded smoke sampling, not a statistical confidence estimate. Oracle is pinned independent 7-Zip extraction, not DUT output.',
      archives: reports,
    });
  });
}

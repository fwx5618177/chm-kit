import { afterAll, beforeAll, bench, describe } from 'vitest';
import { CHMArchive, CacheStrategy } from '../../src/reader/chm-archive';
import { drainStream } from '../conformance/bounded-stream';
import {
  consumeStream,
  fixtureBytes,
  normalArchives,
  oracleBytes,
} from '../conformance/corpus';

const archive = normalArchives.find(a => a.file === 'putty-0.83.chm')!;
const file = archive.files.find(f => f.name === '/index.hhk')!;
const input = fixtureBytes(archive.file);
const expected = oracleBytes(file);
const options = { cacheStrategy: CacheStrategy.None, maxCacheBytes: 0 };
const reader = new CHMArchive(input, options);
const rangeStart = 70_000;
const rangeEnd = rangeStart + 4096;
const settings = {
  time: 250,
  warmupTime: 100,
  iterations: 5,
  warmupIterations: 2,
};

beforeAll(async () => {
  if (!reader.readFile(file.name).equals(expected))
    throw new Error('Benchmark fixture does not match independent oracle');
  await consumeStream(reader.createReadStream(file.name), expected);
  const expectedRange = expected.subarray(rangeStart, rangeEnd);
  if (!reader.readRange(file.name, rangeStart, rangeEnd).equals(expectedRange))
    throw new Error('Benchmark range does not match independent oracle');
  await consumeStream(
    reader.createReadStream(file.name, rangeStart, rangeEnd),
    expectedRange,
  );
});
afterAll(() => reader.close());

describe('real PuTTY 0.83: 82 frames / 41 reset groups / no managed cache', () => {
  bench(
    'open owned bytes + parse directory',
    () => {
      const opened = new CHMArchive(input, options);
      try {
        if (!opened.exists(file.name))
          throw new Error('Missing benchmark file');
      } finally {
        opened.close();
      }
    },
    settings,
  );

  bench(
    'cold full read: 178202-byte /index.hhk',
    () => {
      const bytes = reader.readFile(file.name);
      if (bytes.length !== expected.length) throw new Error('Short full read');
    },
    settings,
  );

  bench(
    'cold late 4096-byte range (necessary reset history included)',
    () => {
      const bytes = reader.readRange(file.name, rangeStart, rangeEnd);
      if (bytes.length !== rangeEnd - rangeStart)
        throw new Error('Short range');
    },
    settings,
  );

  bench(
    'full WHATWG stream: drain without retaining chunks',
    async () => {
      await drainStream(reader.createReadStream(file.name), expected.length);
    },
    settings,
  );

  bench(
    'late range WHATWG stream: drain 4096 bytes',
    async () => {
      await drainStream(
        reader.createReadStream(file.name, rangeStart, rangeEnd),
        rangeEnd - rangeStart,
      );
    },
    settings,
  );
});

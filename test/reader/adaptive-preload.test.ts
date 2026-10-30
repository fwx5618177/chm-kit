import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHMReader } from '../../src/reader/chm-reader';
import { CHMArchive } from '../../src/reader/chm-archive';
import { FileReconstructor } from '../../src/core/files/file-reconstructor';
import { packFiles } from '../../src/encoder/archive-builder';
import type { ReaderOptions } from '../../src/reader/types';

let root: string;
const readers: CHMReader[] = [];
const files = new Map(
  Array.from({ length: 8 }, (_, index) => [
    `${String(index + 1).padStart(2, '0')}.bin`,
    Buffer.alloc(128, index + 1),
  ]),
);

beforeEach(() => {
  root = mkdtempSync('test/reader/adaptive-');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  for (const reader of readers.splice(0)) reader.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

async function open(
  options: ReaderOptions = {},
  compression = false,
): Promise<CHMReader> {
  const path = join(root, `input-${readers.length}.chm`);
  writeFileSync(path, packFiles(files, { compression }));
  const reader = await CHMReader.open(path, {
    maxCacheBytes: 32768,
    readAhead: false,
    ...options,
  });
  readers.push(reader);
  return reader;
}

function train(reader: CHMReader): void {
  for (const path of ['01.bin', '02.bin', '03.bin'])
    assert.deepEqual(reader.readFile(path), files.get(path));
}

test('disabled by default; neither explicit preload nor range/stream access trains a predictor', async () => {
  const disabled = await open();
  train(disabled);
  assert.equal(vi.getTimerCount(), 0);
  const reader = await open({
    adaptivePreload: { maxFiles: 2, maxBytes: 4096 },
  });
  reader.preload(['01.bin', '02.bin', '03.bin']);
  for (const path of ['01.bin', '02.bin', '03.bin'])
    reader.readRange(path, 0, 1);
  const stream = reader.createReadStream('04.bin').getReader();
  await stream.read();
  await stream.cancel();
  assert.equal(vi.getTimerCount(), 0);
  reader.readFile('04.bin');
  assert.equal(
    vi.getTimerCount(),
    0,
    'explicit preload did not train foreground adjacency',
  );
});

for (const compression of [false, true]) {
  describe(`background adjacent preload (compression=${compression})`, () => {
    test('requires two forward transitions, yields once per file, and produces real file-cache hits', async () => {
      const reader = await open(
        { adaptivePreload: { maxFiles: 2, maxBytes: 8192 } },
        compression,
      );
      reader.readFile('01.bin');
      assert.equal(vi.getTimerCount(), 0);
      reader.readFile('02.bin');
      assert.equal(vi.getTimerCount(), 0);
      reader.readFile('03.bin');
      assert.equal(vi.getTimerCount(), 1);
      assert.equal(reader.getCacheStats().files.entries, 3);
      const before = reader.getIOStats()!;
      vi.advanceTimersToNextTimer();
      assert.equal(reader.getCacheStats().files.entries, 4);
      assert.equal(
        vi.getTimerCount(),
        1,
        'remaining work gets a separate timer',
      );
      if (!compression)
        assert.equal(reader.getIOStats()!.bytesRead - before.bytesRead, 128);
      vi.runAllTimers();
      assert.equal(
        vi.getTimerCount(),
        0,
        'background accesses never train recursive predictions',
      );
      assert.equal(reader.getCacheStats().files.entries, 5);
      assert.ok(
        reader.getCacheStats().bytes <= reader.getCacheStats().maxBytes,
      );
      const hits = reader.getCacheStats().files.hits;
      const io = reader.getIOStats();
      const output = reader.readFile('04.bin');
      assert.deepEqual(output, files.get('04.bin'));
      assert.equal(reader.getCacheStats().files.hits, hits + 1);
      assert.deepEqual(reader.getIOStats(), io);
      output.fill(0);
      assert.deepEqual(
        reader.readFile('04.bin'),
        files.get('04.bin'),
        'preload storage is not caller-owned',
      );
    });
  });
}

test('maxFiles and cumulative maxBytes bound each batch without evicting foreground files', async () => {
  const reader = await open({
    adaptivePreload: { maxFiles: 2, maxBytes: 128 },
  });
  train(reader);
  const before = reader.getIOStats()!;
  vi.runAllTimers();
  assert.equal(reader.getCacheStats().files.entries, 4);
  assert.equal(reader.getIOStats()!.bytesRead - before.bytesRead, 128);
  const hits = reader.getCacheStats().files.hits;
  reader.readFile('01.bin');
  reader.readFile('04.bin');
  assert.equal(
    reader.getCacheStats().files.hits,
    hits + 2,
    'foreground files were retained',
  );
  const misses = reader.getCacheStats().files.misses;
  reader.readFile('05.bin');
  assert.equal(
    reader.getCacheStats().files.misses,
    misses + 1,
    'file beyond maxBytes was not warmed',
  );

  const full = await open({
    maxCacheBytes: 512,
    adaptivePreload: { maxFiles: 2, maxBytes: 4096 },
  });
  train(full);
  assert.equal(
    vi.getTimerCount(),
    0,
    'insufficient file-cache headroom suppresses warmup',
  );
  assert.equal(full.getCacheStats().files.entries, 3);
  assert.ok(full.getCacheStats().bytes <= 512);
});

test('compressed admission counts complete required reset/history, not merely tiny file sizes', async () => {
  const reader = await open(
    { adaptivePreload: { maxFiles: 2, maxBytes: 128 } },
    true,
  );
  train(reader);
  assert.equal(
    vi.getTimerCount(),
    0,
    '128-byte output is not a 128-byte LZX reconstruction',
  );
});

for (const action of ['close', 'clear', 'none'] as const) {
  test(`${action} cancels pending timers, releases storage and prevents further speculative I/O`, async () => {
    const reader = await open({
      adaptivePreload: { maxFiles: 3, maxBytes: 4096 },
    });
    train(reader);
    assert.equal(vi.getTimerCount(), 1);
    const before = reader.getIOStats();
    if (action === 'close') reader.close();
    else if (action === 'clear') reader.clearCache();
    else reader.setCacheStrategy('none');
    assert.equal(vi.getTimerCount(), 0);
    vi.runAllTimers();
    assert.deepEqual(reader.getIOStats(), before);
    assert.equal(reader.getCacheStats().bytes, 0);
    if (action !== 'close') {
      reader.readFile('04.bin');
      assert.equal(
        vi.getTimerCount(),
        0,
        'cancellation resets adjacency history',
      );
    }
  });
}

test('cancellation between background files stops the next timer before another disk read', async () => {
  const reader = await open({
    adaptivePreload: { maxFiles: 3, maxBytes: 4096 },
  });
  train(reader);
  vi.advanceTimersToNextTimer();
  assert.equal(reader.getCacheStats().files.entries, 4);
  assert.equal(vi.getTimerCount(), 1);
  const io = reader.getIOStats();
  reader.close();
  vi.runAllTimers();
  assert.deepEqual(reader.getIOStats(), io);
});

test('random foreground jumps discard pending predictions; cache none never schedules', async () => {
  const reader = await open({
    adaptivePreload: { maxFiles: 3, maxBytes: 4096 },
  });
  train(reader);
  assert.equal(vi.getTimerCount(), 1);
  reader.readFile('07.bin');
  assert.equal(vi.getTimerCount(), 0);
  const disabled = await open({
    cacheStrategy: 'none',
    adaptivePreload: { maxFiles: 3, maxBytes: 4096 },
  });
  train(disabled);
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(disabled.getCacheStats().bytes, 0);
});

test('file mutation while queued closes input, clears every cache, and exposes background failure', async () => {
  const reader = await open({
    adaptivePreload: { maxFiles: 3, maxBytes: 4096 },
  });
  train(reader);
  const io = reader.getIOStats();
  truncateSync(reader.getFilePath(), 0);
  vi.runAllTimers();
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(reader.isOpen(), false);
  assert.equal(reader.getCacheStats().bytes, 0);
  assert.deepEqual(
    reader.getIOStats(),
    io,
    'validation prevents payload reads after mutation',
  );
  assert.match(
    reader.getPreloadError()!.message,
    /Adaptive preload failed.*input changed/,
  );
  assert.throws(() => reader.readFile('04.bin'), /Adaptive preload failed/);
});

test('decoder/I/O errors are retained and rethrown, not swallowed or raised as unhandled timer exceptions', async () => {
  const reader = await open({
    adaptivePreload: { maxFiles: 3, maxBytes: 4096 },
  });
  train(reader);
  const original = FileReconstructor.prototype.reconstructRange;
  vi.spyOn(FileReconstructor.prototype, 'reconstructRange').mockImplementation(
    function (this: FileReconstructor, ...args) {
      if (args[0] === '/04.bin')
        throw new Error('injected warm decode failure');
      return original.apply(this, args);
    },
  );
  assert.doesNotThrow(() => vi.runAllTimers());
  assert.equal(reader.isOpen(), false);
  assert.equal(reader.getCacheStats().bytes, 0);
  assert.equal(vi.getTimerCount(), 0);
  assert.match(
    reader.getPreloadError()!.message,
    /04.bin.*injected warm decode failure/,
  );
  assert.throws(() => reader.listFiles(), /injected warm decode failure/);
});

test('invalid adaptive options reject without creating timers; options are copied', async () => {
  const packed = packFiles(files, { compression: false });
  for (const adaptivePreload of [
    null,
    true,
    [],
    {},
    { maxFiles: 0, maxBytes: 1 },
    { maxFiles: 33, maxBytes: 1 },
    { maxFiles: 1, maxBytes: 0 },
    { maxFiles: 1.5, maxBytes: 1 },
    { maxFiles: 1, maxBytes: Infinity },
  ])
    assert.throws(
      () => new CHMArchive(packed, { adaptivePreload } as ReaderOptions),
      /adaptivePreload/,
    );
  assert.equal(vi.getTimerCount(), 0);
  const config = { maxFiles: 1, maxBytes: 128 };
  const reader = await open({ adaptivePreload: config });
  config.maxFiles = 32;
  config.maxBytes = 8192;
  train(reader);
  vi.runAllTimers();
  assert.equal(reader.getCacheStats().files.entries, 4);
});

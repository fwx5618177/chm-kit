import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { CHMKit, CHMReader, packFiles } from '../../src';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { FileReconstructor } from '../../src/core/files/file-reconstructor';
import { BitReader } from '../../src/utils/io/bit-reader';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { reencodeArchive } from '../encoder/archive-fixtures';

const bytes = Buffer.from(
  Array.from({ length: 131075 }, (_, index) => index % 256),
);
function fixture(compression = true) {
  const archive = packFiles(
    new Map([
      ['index.html', Buffer.from('<title>中文</title>边界条件')],
      ['bytes.bin', bytes],
      ['empty.bin', Buffer.alloc(0)],
    ]),
    { compression },
  );
  return { archive, parsed: new CHMParser().parse(new BitReader(archive)) };
}

for (const compression of [false, true]) {
  test(`range boundaries and reconstruction content (compression=${compression})`, () => {
    const { archive, parsed } = fixture(compression);
    const reader = new BitReader(archive);
    const reconstructor = new FileReconstructor(parsed);
    assert.deepEqual(
      reconstructor.reconstructFile('BYTES.BIN', reader).data,
      bytes,
    );
    for (const [start, end] of [
      [0, 0],
      [0, 1],
      [32767, 32769],
      [65535, 98305],
      [bytes.length - 1, bytes.length],
      [bytes.length, bytes.length],
    ])
      assert.deepEqual(
        reconstructor.reconstructRange('/bytes.bin', reader, start, end),
        bytes.subarray(start, end),
      );
    for (const [start, end] of [
      [NaN, 1],
      [0.5, 1],
      [-1, 0],
      [2, 1],
      [0, bytes.length + 1],
      [0, Infinity],
    ])
      assert.throws(
        () => reconstructor.reconstructRange('/bytes.bin', reader, start, end),
        /range/i,
      );
    const empty = reconstructor.reconstructFile('/empty.bin', reader);
    assert.deepEqual(empty.data, Buffer.alloc(0));
    assert.equal(reconstructor.validateFile(empty), true);
    assert.equal(
      reconstructor.validateFile({ ...empty, originalSize: 1 }),
      false,
    );
    assert.throws(
      () => reconstructor.reconstructFiles(['/empty.bin', '/missing'], reader),
      /未找到/,
    );
  });
}

test('range output budget, block cache isolation and LRU eviction', () => {
  const { archive, parsed } = fixture();
  const reader = new BitReader(archive);
  const reconstructor = new FileReconstructor(parsed, {
    maxCacheBytes: 32768,
    maxOutputBytes: 4,
  });
  assert.throws(
    () => reconstructor.reconstructFile('/bytes.bin', reader),
    /maxOutputBytes/,
  );
  const first = reconstructor.reconstructRange('/bytes.bin', reader, 0, 4);
  first.fill(99);
  assert.deepEqual(
    reconstructor.reconstructRange('/bytes.bin', reader, 0, 4),
    bytes.subarray(0, 4),
  );
  assert.ok(reconstructor.getCacheStats().hits > 0);
  reconstructor.reconstructRange('/bytes.bin', reader, 65536, 65540);
  assert.equal(reconstructor.getCacheStats().entries, 1);
  assert.ok(reconstructor.getCacheStats().bytes <= 32768);
  reconstructor.setCacheLimit(0);
  assert.equal(reconstructor.getCacheStats().bytes, 0);
  reconstructor.clearCache();
  assert.equal(reconstructor.getCacheStats().hits, 0);
  for (const value of [-1, NaN, 0.5, Infinity])
    assert.throws(() => reconstructor.setCacheLimit(value));
});

test('real aligned-Huffman CHM reconstructs all physical sections and empty internal resource', () => {
  const archive = readFileSync('test/fixtures/pychm-example/example.chm');
  const parsed = new CHMParser().parse(new BitReader(archive));
  const reconstructor = new FileReconstructor(parsed);
  const manifest = JSON.parse(
    readFileSync('test/fixtures/pychm-example/manifest.json', 'utf8'),
  ) as { files: { name: string; expectedFile: string }[] };
  for (const file of manifest.files) {
    const expected = readFileSync(
      `test/fixtures/pychm-example/${file.expectedFile}`,
    );
    assert.deepEqual(
      reconstructor.reconstructFile(file.name, new BitReader(archive)).data,
      expected,
      file.name,
    );
    for (const end of [0, Math.min(7, expected.length), expected.length])
      assert.deepEqual(
        reconstructor.reconstructRange(
          file.name,
          new BitReader(archive),
          0,
          end,
        ),
        expected.subarray(0, end),
      );
  }
});

test('every truncated prefix is rejected, including compressed-content truncation', () => {
  const { archive } = fixture();
  for (let length = 0; length < archive.length; length += 17)
    assert.throws(
      () => new CHMParser().parse(new BitReader(archive.subarray(0, length))),
      `truncation ${length}`,
    );
  assert.throws(() =>
    new CHMParser().parse(new BitReader(archive.subarray(0, -1))),
  );
});

test('deterministic hostile LZX input never hangs or produces unbounded output', () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  };
  const config = {
    signature: 'LZXC',
    version: 2,
    windowSize: 32768,
    resetInterval: 32768,
    cacheSize: 0,
    unknown: 0,
  };
  for (let index = 0; index < 512; index++) {
    const input = Buffer.from(Array.from({ length: random() % 80 }, random));
    const decoder = new LZXDecoder(config);
    let output: Buffer;
    try {
      output = decoder.decode(new BitReader(input), 128);
    } catch (error) {
      assert.ok(error instanceof Error);
      continue;
    }
    assert.equal(output.length, 128);
  }
});

test('Intel E8 filtering uses the padded physical frame tail, not logical stream length', () => {
  const { parsed } = fixture();
  const bits: number[] = [];
  const put = (value: number, count: number) => {
    for (let bit = count - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1);
  };
  put(1, 1);
  put(0, 16);
  put(4096, 16);
  put(3, 3);
  put(32768, 24);
  while (bits.length % 16) bits.push(0);
  const header = Buffer.alloc(bits.length / 8);
  for (let index = 0; index < bits.length; index += 16) {
    let word = 0;
    for (let bit = 0; bit < 16; bit++) word = word * 2 + bits[index + bit]!;
    header.writeUInt16LE(word, index / 8);
  }
  const offsets = Buffer.alloc(12);
  [0, 4, 8].forEach(offset => offsets.writeUInt32LE(1, offset));
  const data = Buffer.alloc(32768);
  data[95] = 0xe8;
  data.writeInt32LE(500, 96);
  const archive = Buffer.concat([header, offsets, data]);
  parsed.directory.entries = new Map([
    [
      '/intel.bin',
      {
        name: '/intel.bin',
        section: 1,
        isCompressed: true,
        offset: 0,
        length: 100,
      },
    ],
  ]);
  parsed.contentOffset = 0;
  parsed.resetTable = {
    version: 2,
    blockCount: 1,
    entrySize: 8,
    tableOffset: 40,
    uncompressedLength: 100,
    compressedLength: archive.length,
    blockSize: 32768,
    entries: [{ compressedLength: 0, uncompressedLength: 100 }],
  };
  const reconstructor = new FileReconstructor(parsed);
  const result = reconstructor.reconstructFile(
    '/intel.bin',
    new BitReader(archive),
  );
  assert.equal(result.data[95], 0xe8);
  assert.equal(result.data.readInt32LE(96), 405);
  assert.equal(result.compressedSize, null);
  assert.deepEqual(
    reconstructor.reconstructRange(
      '/intel.bin',
      new BitReader(archive),
      90,
      100,
    ),
    result.data.subarray(90),
  );
  for (const chunkSize of [1, 3, 95, 96, 100, 65536]) {
    const streaming = new FileReconstructor(parsed, { maxCacheBytes: 0 });
    const chunks = [
      ...streaming.iterateFileChunks(
        '/intel.bin',
        new BitReader(archive),
        chunkSize,
      ),
    ];
    assert.deepEqual(Buffer.concat(chunks), result.data);
    assert.ok(chunks.every(chunk => chunk.length <= chunkSize));
  }
  for (const [start, end] of [
    [0, 0],
    [93, 96],
    [95, 97],
    [96, 97],
    [97, 99],
    [98, 100],
    [100, 100],
  ]) {
    trackDecoding((calls, instances) => {
      const chunks = [
        ...new FileReconstructor(parsed, {
          maxCacheBytes: 0,
        }).iterateFileChunks(
          '/intel.bin',
          new BitReader(archive),
          2,
          start,
          end,
        ),
      ];
      assert.deepEqual(Buffer.concat(chunks), result.data.subarray(start, end));
      assert.deepEqual(
        calls,
        start === end ? [] : [{ frame: 0, size: LZXDecoder.FRAME_SIZE }],
      );
      assertDecoderReleased(instances);
    });
  }
  parsed.resetTable.compressedLength--;
  trackDecoding((_calls, instances) => {
    assert.throws(
      () =>
        new FileReconstructor(parsed)
          .iterateFileChunks('/intel.bin', new BitReader(archive), 1, 96, 97)
          .next(),
      /Truncated/,
      'a one-byte range must validate the entire last physical frame',
    );
    assertDecoderReleased(instances);
  });
  parsed.resetTable.compressedLength++;
  const entry = parsed.directory.entries.get('/intel.bin')!;
  entry.offset = 97;
  entry.length = 3;
  assert.deepEqual(
    Buffer.concat([
      ...new FileReconstructor(parsed).iterateFileChunks(
        '/intel.bin',
        new BitReader(archive),
        2,
      ),
    ]),
    result.data.subarray(97, 100),
    'a file beginning inside an E8 operand still uses the entire physical frame',
  );
});

test('Node facade aliases, memory packing and portable source reading', async () => {
  const reader = CHMKit.from(
    CHMKit.packFiles(
      new Map([['index.html', Buffer.from('<title>中文</title>你好')]]),
    ),
  );
  assert.equal(reader.readText('/index.html'), '<title>中文</title>你好');
  assert.equal(reader.getTOC()[0]!.name, '中文');
  reader.close();
  assert.equal(CHMKit.list, CHMKit.listFiles);
  assert.equal(CHMKit.get, CHMKit.readFile);
  assert.equal(CHMKit.search, CHMKit.searchContent);
  assert.equal(CHMKit.extractAll, CHMKit.extract);
  await assert.rejects(CHMKit.exists('README.md', '/any'));
  const path = 'test/fixtures/pychm-example/example.chm';
  assert.equal((await CHMKit.getTOC(path)).length, 2);
  assert.equal((await CHMKit.getIndex(path)).length, 0);
  const opened = await CHMKit.open(path);
  try {
    assert.ok(opened instanceof CHMReader);
  } finally {
    opened.close();
  }
  const names = await CHMKit.listFiles(path);
  assert.equal(names.length, 3);
  assert.equal((await CHMKit.readMultiple(path, names)).size, 3);
  assert.equal((await CHMKit.readRange(path, '/page 1.html', 0, 7)).length, 7);
});

const FRAME = LZXDecoder.FRAME_SIZE;
type DecoderState = {
  readFrame(
    input: unknown,
    size: number,
    frame: number,
    prefix?: boolean,
  ): Buffer;
  historySize: number;
  mainTree: unknown;
  window: { data: Buffer };
};
function trackDecoding(
  run: (
    calls: { frame: number; size: number }[],
    instances: Set<DecoderState>,
  ) => void,
): void {
  const prototype = LZXDecoder.prototype as unknown as DecoderState;
  const original = prototype.readFrame;
  const calls: { frame: number; size: number }[] = [];
  const instances = new Set<DecoderState>();
  prototype.readFrame = function (input, size, frame, prefix) {
    calls.push({ frame, size });
    instances.add(this);
    return original.call(this, input, size, frame, prefix);
  };
  try {
    run(calls, instances);
  } finally {
    prototype.readFrame = original;
  }
}
function assertDecoderReleased(instances: Set<DecoderState>): void {
  for (const instance of instances) {
    assert.equal(instance.historySize, 0);
    assert.equal(instance.mainTree, null);
    assert.ok(instance.window.data.every(byte => byte === 0));
  }
}
function streamFixture(
  payload: Buffer,
  resetInterval: number,
  prefix = Buffer.alloc(0),
  suffix = Buffer.alloc(0),
) {
  const archive = reencodeArchive(
    packFiles(
      new Map([
        ['0-prefix.bin', prefix],
        ['1-payload.bin', payload],
        ['2-suffix.bin', suffix],
        ['toc.hhc', Buffer.alloc(0)],
        ['index.hhk', Buffer.alloc(0)],
      ]),
    ),
    { resetInterval },
  );
  const parsed = new CHMParser().parse(new BitReader(archive));
  const entry = parsed.directory.entries.get('/1-payload.bin')!;
  return { archive, parsed, entry };
}

test('oversized reset groups stream each physical frame once with small or disabled caches', () => {
  const payload = Buffer.alloc(8 * 1024 * 1024, 65);
  const { archive, parsed, entry } = streamFixture(payload, payload.length);
  for (const maxCacheBytes of [0, 4 * 1024 * 1024]) {
    const reconstructor = new FileReconstructor(parsed, {
      maxCacheBytes,
      maxOutputBytes: 65536,
    });
    const reader = new BitReader(archive);
    reader.setPosition(7, 3);
    trackDecoding((calls, instances) => {
      const iterator = reconstructor.iterateFileChunks(
        entry.name,
        reader,
        65536,
      );
      assert.deepEqual(calls, []);
      const originalAlloc = Buffer.alloc;
      const allocations: number[] = [];
      const chunks: Buffer[] = [];
      Buffer.alloc = (size, ...rest) => {
        allocations.push(size);
        assert.ok(size <= 65536, `reset-sized allocation: ${size}`);
        return originalAlloc(size, ...rest);
      };
      try {
        const first = iterator.next().value!;
        chunks.push(first);
        assert.equal(
          calls.length,
          2,
          'first pull must not decode the reset suffix',
        );
        for (const chunk of iterator) {
          assert.ok(chunk.length > 0 && chunk.length <= 65536);
          chunks.push(chunk);
        }
      } finally {
        Buffer.alloc = originalAlloc;
        iterator.return(undefined);
      }
      assert.deepEqual(Buffer.concat(chunks), payload);
      const start =
        (Math.floor(entry.offset / payload.length) * payload.length) / FRAME;
      const end = Math.ceil((entry.offset + entry.length) / FRAME);
      assert.deepEqual(
        calls,
        Array.from({ length: end - start }, (_, i) => ({
          frame: start + i,
          size: FRAME,
        })),
      );
      assert.equal(instances.size, 1);
      assert.ok(allocations.length > 0);
      assertDecoderReleased(instances);
      assert.equal(reconstructor.getCacheStats().entries, 0);
      assert.equal(reconstructor.getCacheStats().bytes, 0);
      assert.equal(reader.position, 7);
      assert.equal(reader.bitPosition, 3);
    });
  }
});

test('stream seeks to the nearest reset, skips history prefix once and never decodes file suffix', () => {
  const reset = FRAME * 8;
  const prefix = Buffer.alloc(reset + FRAME + 17, 0x31);
  const payload = Buffer.from(
    Array.from({ length: FRAME * 2 + 53 }, (_, i) => i % 251),
  );
  const { archive, parsed, entry } = streamFixture(
    payload,
    reset,
    prefix,
    Buffer.alloc(reset, 0x32),
  );
  const reconstructor = new FileReconstructor(parsed, {
    maxCacheBytes: 0,
    maxOutputBytes: 1024,
  });
  trackDecoding((calls, instances) => {
    const iterator = reconstructor.iterateFileChunks(
      entry.name,
      new BitReader(archive),
      65536,
    );
    const chunks: Buffer[] = [iterator.next().value!];
    assert.deepEqual(
      calls.map(call => call.frame),
      [8, 9],
    );
    for (const chunk of iterator) {
      assert.ok(chunk.length <= 1024, 'maxOutputBytes is a per-chunk ceiling');
      chunks.push(chunk);
    }
    assert.deepEqual(Buffer.concat(chunks), payload);
    assert.deepEqual(
      calls.map(call => call.frame),
      [8, 9, 10, 11],
    );
    assertDecoderReleased(instances);
  });
});

for (const compression of [false, true]) {
  test(`iterator chunks obey output budgets and own their bytes (compression=${compression})`, () => {
    const { archive, parsed } = fixture(compression);
    for (const chunkSize of [1, FRAME - 1, FRAME, FRAME + 1, 65536]) {
      const reconstructor = new FileReconstructor(parsed, {
        maxCacheBytes: 0,
        maxOutputBytes: 1023,
      });
      const iterator = reconstructor.iterateFileChunks(
        '/bytes.bin',
        new BitReader(archive),
        chunkSize,
      );
      const first = iterator.next().value!;
      const saved = Buffer.from(first);
      first.fill(99);
      const rest = [...iterator];
      assert.ok(
        rest.every(
          chunk =>
            chunk.length > 0 && chunk.length <= Math.min(chunkSize, 1023),
        ),
      );
      assert.deepEqual(Buffer.concat([saved, ...rest]), bytes);
      assert.deepEqual(
        [
          ...reconstructor.iterateFileChunks(
            '/empty.bin',
            new BitReader(archive),
            chunkSize,
          ),
        ],
        [],
      );
    }
    if (!compression) {
      parsed.header.itsf.version = 2;
      parsed.header.itsf.unknown4 = 0;
      assert.deepEqual(
        Buffer.concat([
          ...new FileReconstructor(parsed).iterateFileChunks(
            '/bytes.bin',
            new BitReader(archive),
            FRAME,
          ),
        ]),
        bytes,
      );
    }
  });
}

test('exact file/frame/reset/chunk boundaries neither duplicate nor prefetch a frame', () => {
  for (const length of [FRAME - 1, FRAME, FRAME + 1, FRAME * 2, FRAME * 4]) {
    const payload = Buffer.alloc(length, 0x5a);
    const { archive, parsed, entry } = streamFixture(
      payload,
      FRAME * 2,
      Buffer.alloc(FRAME * 2),
      Buffer.alloc(FRAME * 2),
    );
    for (const chunkSize of [FRAME, FRAME + 7, FRAME * 2]) {
      trackDecoding((calls, instances) => {
        const chunks = [
          ...new FileReconstructor(parsed, {
            maxCacheBytes: 0,
          }).iterateFileChunks(entry.name, new BitReader(archive), chunkSize),
        ];
        assert.deepEqual(
          chunks.map(chunk => chunk.length),
          Array.from({ length: Math.ceil(length / chunkSize) }, (_, i) =>
            Math.min(chunkSize, length - i * chunkSize),
          ),
        );
        assert.deepEqual(Buffer.concat(chunks), payload);
        assert.deepEqual(
          calls.map(call => call.frame),
          Array.from({ length: Math.ceil(length / FRAME) }, (_, i) => 2 + i),
        );
        assertDecoderReleased(instances);
      });
    }
  }
});

test('iterator validates chunk sizes, missing files, sections, zero budgets and stream bounds lazily', () => {
  const { archive, parsed } = fixture();
  const reader = new BitReader(archive);
  const reconstructor = new FileReconstructor(parsed);
  for (const chunkSize of [
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const iterator = reconstructor.iterateFileChunks(
      '/empty.bin',
      reader,
      chunkSize,
    );
    assert.throws(() => iterator.next(), /chunkSize/);
    assert.equal(iterator.next().done, true);
  }
  assert.throws(
    () => reconstructor.iterateFileChunks('/missing', reader, 1).next(),
    /未找到/,
  );
  const zero = new FileReconstructor(parsed, { maxOutputBytes: 0 });
  assert.deepEqual([...zero.iterateFileChunks('/empty.bin', reader, 1)], []);
  assert.throws(
    () => zero.iterateFileChunks('/bytes.bin', reader, 1).next(),
    /maxOutputBytes/,
  );
  const entry = parsed.directory.entries.get('/bytes.bin')!;
  entry.section = 2;
  assert.throws(
    () => reconstructor.iterateFileChunks(entry.name, reader, 1).next(),
    /Unsupported/,
  );
  entry.section = 1;
  entry.length = parsed.resetTable.uncompressedLength + 1;
  assert.throws(
    () => reconstructor.iterateFileChunks(entry.name, reader, 1).next(),
    /exceeds LZX stream/,
  );
  entry.length = 1;
  for (const reset of [0, -FRAME, FRAME + 1, NaN]) {
    parsed.header.lzxc.resetInterval = reset;
    assert.throws(
      () => reconstructor.iterateFileChunks(entry.name, reader, 1).next(),
      /reset interval/,
    );
  }
});

test('streaming a very large declared reset is bounded by frames, not reset bytes', () => {
  const payload = Buffer.alloc(FRAME * 2 + 5, 65);
  const { archive, parsed, entry } = streamFixture(
    payload,
    LZXDecoder.MAX_OUTPUT_SIZE * 2,
  );
  const reconstructor = new FileReconstructor(parsed, { maxCacheBytes: 0 });
  trackDecoding((calls, instances) => {
    const chunks = [
      ...reconstructor.iterateFileChunks(
        entry.name,
        new BitReader(archive),
        1024,
      ),
    ];
    assert.deepEqual(Buffer.concat(chunks), payload);
    assert.deepEqual(
      calls,
      [0, 1, 2].map(frame => ({ frame, size: FRAME })),
    );
    assertDecoderReleased(instances);
  });
  assert.throws(
    () =>
      reconstructor.reconstructRange(entry.name, new BitReader(archive), 0, 1),
    /excessively large/,
  );
});

test('stream cancellation/return and consumer break release decoder without decoding more frames', () => {
  const { archive, parsed, entry } = streamFixture(
    Buffer.alloc(FRAME * 4, 65),
    FRAME * 4,
  );
  for (const mode of ['return', 'break', 'throw']) {
    trackDecoding((calls, instances) => {
      const reconstructor = new FileReconstructor(parsed, { maxCacheBytes: 0 });
      const iterator = reconstructor.iterateFileChunks(
        entry.name,
        new BitReader(archive),
        7,
      );
      assert.deepEqual(calls, []);
      if (mode === 'break') {
        for (const chunk of iterator) {
          assert.equal(chunk.length, 7);
          break;
        }
      } else {
        assert.equal(iterator.next().value!.length, 7);
        assert.equal(calls.length, 1);
        if (mode === 'return') iterator.return(undefined);
        else
          assert.throws(
            () => iterator.throw(new Error('consumer failed')),
            /consumer failed/,
          );
      }
      assert.equal(calls.length, 1);
      assert.equal(iterator.next().done, true);
      assertDecoderReleased(instances);
      assert.equal(reconstructor.getCacheStats().entries, 0);
      const unstarted = reconstructor.iterateFileChunks(
        entry.name,
        new BitReader(archive),
        7,
      );
      unstarted.return(undefined);
      assert.equal(calls.length, 1);
    });
  }
});

test('interleaved file iterators have independent decoder state and cancellation', () => {
  const payload = Buffer.alloc(FRAME * 2 + 19, 65);
  const { archive, parsed, entry } = streamFixture(payload, FRAME * 4);
  const reconstructor = new FileReconstructor(parsed, { maxCacheBytes: 0 });
  trackDecoding((calls, instances) => {
    const first = reconstructor.iterateFileChunks(
      entry.name,
      new BitReader(archive),
      7,
    );
    const second = reconstructor.iterateFileChunks(
      entry.name,
      new BitReader(archive),
      1024,
    );
    assert.deepEqual(first.next().value, payload.subarray(0, 7));
    const initial = second.next().value!;
    assert.equal(instances.size, 2);
    first.return(undefined);
    const [closed, active] = [...instances];
    assert.equal(closed!.historySize, 0);
    assert.ok(active!.historySize > 0);
    assert.deepEqual(Buffer.concat([initial, ...second]), payload);
    assert.deepEqual(
      calls.map(call => call.frame),
      [0, 0, 1, 2],
    );
    assertDecoderReleased(instances);
  });
});

test('later compressed frame/offset errors surface only on demand and release decoder', () => {
  for (const corruptOffsets of [false, true]) {
    const { archive, parsed, entry } = streamFixture(
      Buffer.alloc(FRAME * 3, 65),
      FRAME * 4,
    );
    if (corruptOffsets) {
      parsed.resetTable.entries[2]!.compressedLength =
        parsed.resetTable.entries[1]!.compressedLength;
    } else {
      const from =
        parsed.contentOffset + parsed.resetTable.entries[1]!.compressedLength;
      const to =
        parsed.contentOffset + parsed.resetTable.entries[2]!.compressedLength;
      archive.fill(0, from, to);
    }
    trackDecoding((calls, instances) => {
      const reconstructor = new FileReconstructor(parsed, { maxCacheBytes: 0 });
      const iterator = reconstructor.iterateFileChunks(
        entry.name,
        new BitReader(archive),
        FRAME,
      );
      assert.equal(iterator.next().value!.length, FRAME);
      assert.equal(calls.length, 1);
      assert.throws(
        () => iterator.next(),
        corruptOffsets ? /frame offsets/ : /Zero-length/,
      );
      assertDecoderReleased(instances);
      assert.equal(iterator.next().done, true);
      assert.equal(reconstructor.getCacheStats().entries, 0);
    });
  }
});

for (const compression of [false, true]) {
  test(`stream ranges use strict file-relative boundaries and per-chunk budgets (compression=${compression})`, () => {
    const { archive, parsed } = fixture(compression);
    const reader = new BitReader(archive);
    reader.setPosition(7, 3);
    const reconstructor = new FileReconstructor(parsed, {
      maxCacheBytes: 0,
      maxOutputBytes: 257,
    });
    const ranges: [number, number | undefined][] = [
      [0, 0],
      [0, 1],
      [17, 17],
      [FRAME - 8, FRAME + 12],
      [FRAME, FRAME * 2],
      [FRAME * 2 - 6, FRAME * 2 + 14],
      [FRAME * 2, FRAME * 2],
      [bytes.length - 1, undefined],
      [bytes.length, undefined],
      [bytes.length, bytes.length],
    ];
    for (const [start, end] of ranges) {
      for (const chunkSize of [1, 17, FRAME, FRAME + 7]) {
        const chunks = [
          ...reconstructor.iterateFileChunks(
            '/bytes.bin',
            reader,
            chunkSize,
            start,
            end,
          ),
        ];
        const expected = bytes.subarray(start, end);
        const limit = Math.min(chunkSize, 257);
        assert.deepEqual(Buffer.concat(chunks), expected);
        assert.deepEqual(
          chunks.map(chunk => chunk.length),
          Array.from({ length: Math.ceil(expected.length / limit) }, (_, i) =>
            Math.min(limit, expected.length - i * limit),
          ),
        );
      }
    }
    assert.equal(reader.position, 7);
    assert.equal(reader.bitPosition, 3);
    trackDecoding((calls, instances) => {
      const zero = new FileReconstructor(parsed, { maxOutputBytes: 0 });
      const unavailable = new BitReader(Buffer.alloc(0));
      assert.deepEqual(
        [...zero.iterateFileChunks('/bytes.bin', unavailable, 1, bytes.length)],
        [],
      );
      assert.deepEqual(
        [...zero.iterateFileChunks('/empty.bin', unavailable, 1, 0, 0)],
        [],
      );
      assert.deepEqual(calls, []);
      assert.equal(instances.size, 0);
      assert.throws(
        () => zero.iterateFileChunks('/bytes.bin', reader, 1, 1, 2).next(),
        /maxOutputBytes/,
      );
    });
  });

  test(`invalid stream ranges match reconstructRange errors before decoding (compression=${compression})`, () => {
    const { archive, parsed } = fixture(compression);
    const reader = new BitReader(archive);
    const reconstructor = new FileReconstructor(parsed);
    const ranges: [number, number | undefined][] = [
      [-1, 0],
      [2, 1],
      [0, bytes.length + 1],
      [bytes.length + 1, undefined],
      [NaN, 1],
      [0.5, 1],
      [0, NaN],
      [0, Infinity],
      [Infinity, Infinity],
      [0, Number.MAX_SAFE_INTEGER + 1],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ];
    trackDecoding((calls, instances) => {
      for (const [start, end] of ranges) {
        const expected = {
          name: 'RangeError',
          message: `Invalid file range [${start}, ${end ?? bytes.length}) for /bytes.bin`,
        };
        assert.throws(
          () =>
            reconstructor.reconstructRange('/bytes.bin', reader, start, end),
          expected,
        );
        const iterator = reconstructor.iterateFileChunks(
          '/bytes.bin',
          reader,
          7,
          start,
          end,
        );
        assert.throws(() => iterator.next(), expected);
        assert.equal(iterator.next().done, true);
      }
      assert.throws(
        () =>
          reconstructor.iterateFileChunks('/empty.bin', reader, 7, 0, 1).next(),
        RangeError,
      );
      assert.throws(
        () =>
          reconstructor
            .iterateFileChunks('/bytes.bin', reader, 0, bytes.length)
            .next(),
        /chunkSize/,
      );
      assert.deepEqual(calls, []);
      assert.equal(instances.size, 0);
    });
  });
}

test('stored stream ranges do not require the unread file suffix, including ITSF v2', () => {
  const { archive, parsed } = fixture(false);
  const entry = parsed.directory.entries.get('/bytes.bin')!;
  const start = FRAME + 13;
  const end = start + 9;
  const absoluteEnd = parsed.header.itsf.unknown4 + entry.offset + end;
  const reader = new BitReader(archive.subarray(0, absoluteEnd));
  for (const version of [2, 3]) {
    parsed.header.itsf.version = version;
    trackDecoding((calls, instances) => {
      const chunks = [
        ...new FileReconstructor(parsed, {
          maxOutputBytes: 4,
        }).iterateFileChunks(entry.name, reader, 65536, start, end),
      ];
      assert.deepEqual(
        chunks.map(chunk => chunk.length),
        [4, 4, 1],
      );
      assert.deepEqual(Buffer.concat(chunks), bytes.subarray(start, end));
      assert.deepEqual(calls, []);
      assert.equal(instances.size, 0);
    });
  }
});

test('ranged streams decode only the nearest reset history through the requested physical end', () => {
  const reset = FRAME * 4;
  const payload = Buffer.alloc(FRAME * 32 + 29);
  for (let i = 0; i < payload.length; i++)
    payload[i] = (i * 17 + (i >>> 15) * 7) & 255;
  const { archive, parsed, entry } = streamFixture(
    payload,
    reset,
    Buffer.alloc(FRAME + 19),
    Buffer.alloc(reset),
  );
  const ranges: [number, number][] = [
    [FRAME * 9 + 7, FRAME * 11 + 30],
    [FRAME * 11 - 19, FRAME * 12 - 19],
    [FRAME * 10 - 19, FRAME * 11 - 19],
  ];
  for (const maxCacheBytes of [0, FRAME * 2]) {
    for (const [start, end] of ranges) {
      const absoluteStart = entry.offset + start;
      const firstFrame = (Math.floor(absoluteStart / reset) * reset) / FRAME;
      const endFrame = Math.ceil((entry.offset + end) / FRAME);
      const reconstructor = new FileReconstructor(parsed, {
        maxCacheBytes,
        maxOutputBytes: 113,
      });
      const source = reconstructor as unknown as {
        readCompressedFrame(index: number, reader: BitReader): Uint8Array;
      };
      const original = source.readCompressedFrame;
      const requested: number[] = [];
      source.readCompressedFrame = function (index, reader) {
        assert.ok(
          index >= firstFrame && index < endFrame,
          `unexpected compressed frame ${index}`,
        );
        requested.push(index);
        return original.call(this, index, reader);
      };
      trackDecoding((calls, instances) => {
        const iterator = reconstructor.iterateFileChunks(
          entry.name,
          new BitReader(archive),
          FRAME,
          start,
          end,
        );
        assert.equal(calls.length, 0);
        assert.equal(requested.length, 0);
        const first = iterator.next().value!;
        const firstPullEnd = Math.ceil((absoluteStart + first.length) / FRAME);
        assert.deepEqual(
          calls.map(call => call.frame),
          Array.from(
            { length: firstPullEnd - firstFrame },
            (_, i) => firstFrame + i,
          ),
        );
        const chunks = [first, ...iterator];
        assert.deepEqual(Buffer.concat(chunks), payload.subarray(start, end));
        assert.ok(chunks.every(chunk => chunk.length <= 113));
        const expected = Array.from(
          { length: endFrame - firstFrame },
          (_, i) => firstFrame + i,
        );
        assert.deepEqual(requested, expected);
        assert.deepEqual(
          calls,
          expected.map(frame => ({ frame, size: FRAME })),
        );
        assert.equal(reconstructor.getCacheStats().entries, 0);
        assertDecoderReleased(instances);
      });
    }
  }
});

test('range early cancellation pays the history prefix once and skips earlier resets and later file data', () => {
  const reset = FRAME * 8;
  const payload = Buffer.alloc(FRAME * 96 + 5);
  for (let i = 0; i < payload.length; i++)
    payload[i] = (i * 17 + (i >>> 15) * 7) & 255;
  const { archive, parsed, entry } = streamFixture(
    payload,
    reset,
    Buffer.alloc(7),
  );
  const start = reset * 5 + FRAME * 3 + 6;
  const end = start + FRAME * 5 + 19;
  const reconstructor = new FileReconstructor(parsed, {
    maxCacheBytes: 0,
    maxOutputBytes: 11,
  });
  trackDecoding((calls, instances) => {
    const iterator = reconstructor.iterateFileChunks(
      entry.name,
      new BitReader(archive),
      17,
      start,
      end,
    );
    const first = iterator.next().value!;
    assert.deepEqual(first, payload.subarray(start, start + 11));
    assert.deepEqual(
      calls.map(call => call.frame),
      [40, 41, 42, 43],
    );
    assert.deepEqual(
      iterator.next().value,
      payload.subarray(start + 11, start + 22),
    );
    assert.equal(calls.length, 4, 'smaller chunks must not replay history');
    iterator.return(undefined);
    assert.equal(iterator.next().done, true);
    assert.equal(calls.length, 4, 'cancellation must not decode the remainder');
    assertDecoderReleased(instances);
  });
  trackDecoding((calls, instances) => {
    const chunks = [
      ...reconstructor.iterateFileChunks(
        entry.name,
        new BitReader(archive),
        17,
        start,
        end,
      ),
    ];
    assert.deepEqual(Buffer.concat(chunks), payload.subarray(start, end));
    assert.deepEqual(
      calls.map(call => call.frame),
      [40, 41, 42, 43, 44, 45, 46, 47, 48],
    );
    assertDecoderReleased(instances);
  });
});

test('ranged E8 decoding uses complete physical tails and reset-local origins, not range/file origins', () => {
  function storedFrame(data: Buffer, reset: boolean, intelSize = 4096): Buffer {
    const bits: number[] = [];
    const put = (value: number, count: number) => {
      for (let bit = count - 1; bit >= 0; bit--)
        bits.push(Math.floor(value / 2 ** bit) & 1);
    };
    if (reset) {
      put(1, 1);
      put(Math.floor(intelSize / 65536), 16);
      put(intelSize & 65535, 16);
    }
    put(3, 3);
    put(FRAME, 24);
    while (bits.length % 16) bits.push(0);
    const header = Buffer.alloc(bits.length / 8 + 12);
    for (let offset = 0; offset < bits.length; offset += 16) {
      let word = 0;
      for (let bit = 0; bit < 16; bit++) word = word * 2 + bits[offset + bit]!;
      header.writeUInt16LE(word, offset / 8);
    }
    for (const offset of [0, 4, 8])
      header.writeUInt32LE(1, bits.length / 8 + offset);
    return Buffer.concat([header, data]);
  }
  const data = Array.from({ length: 3 }, (_, i) => {
    const frame = Buffer.alloc(FRAME, 0x90);
    frame[95] = 0xe8;
    frame.writeInt32LE(i === 2 ? -95 : 500, 96);
    frame[FRAME - 10] = 0xe8;
    frame.writeInt32LE(500, FRAME - 9);
    return frame;
  });
  const frames = [
    storedFrame(data[0]!, true),
    storedFrame(data[1]!, false),
    storedFrame(data[2]!, true, 8192),
  ];
  const archive = Buffer.concat(frames);
  const expected = Buffer.concat(data);
  expected.writeInt32LE(405, 96);
  expected.writeInt32LE(500 - FRAME - 95, FRAME + 96);
  expected.writeInt32LE(8192 - 95, FRAME * 2 + 96);
  const { parsed } = fixture();
  const fileOffset = 7;
  const name = '/intel-range.bin';
  parsed.directory.entries = new Map([
    [
      name,
      {
        name,
        section: 1,
        isCompressed: true,
        offset: fileOffset,
        length: FRAME * 3 - fileOffset,
      },
    ],
  ]);
  parsed.header.lzxc.resetInterval = FRAME * 2;
  parsed.contentOffset = 0;
  parsed.resetTable = {
    version: 2,
    blockCount: 3,
    entrySize: 8,
    tableOffset: 40,
    uncompressedLength: FRAME * 3,
    compressedLength: archive.length,
    blockSize: FRAME,
    entries: [0, frames[0]!.length, frames[0]!.length + frames[1]!.length].map(
      compressedLength => ({ compressedLength, uncompressedLength: FRAME }),
    ),
  };
  const ranges: [number, number][] = [
    [FRAME + 95, FRAME + 98],
    [FRAME * 2 - 12, FRAME * 2 - 5],
    [FRAME * 2 + 96, FRAME * 2 + 99],
    [FRAME * 2 - 2, FRAME * 2 + 100],
  ];
  for (const [absoluteStart, absoluteEnd] of ranges) {
    trackDecoding((calls, instances) => {
      const chunks = [
        ...new FileReconstructor(parsed, {
          maxCacheBytes: 0,
        }).iterateFileChunks(
          name,
          new BitReader(archive),
          2,
          absoluteStart - fileOffset,
          absoluteEnd - fileOffset,
        ),
      ];
      assert.deepEqual(
        Buffer.concat(chunks),
        expected.subarray(absoluteStart, absoluteEnd),
      );
      const firstFrame = Math.floor(absoluteStart / (FRAME * 2)) * 2;
      const endFrame = Math.ceil(absoluteEnd / FRAME);
      assert.deepEqual(
        calls,
        Array.from({ length: endFrame - firstFrame }, (_, i) => ({
          frame: firstFrame + i,
          size: FRAME,
        })),
      );
      assertDecoderReleased(instances);
    });
  }
});

test('a short prefix range succeeds despite a corrupt unread compressed suffix', () => {
  const { archive, parsed, entry } = streamFixture(
    Buffer.alloc(FRAME * 8, 65),
    FRAME * 8,
  );
  const corrupt =
    parsed.contentOffset + parsed.resetTable.entries[1]!.compressedLength;
  archive.fill(
    0,
    corrupt,
    parsed.contentOffset + parsed.resetTable.compressedLength,
  );
  trackDecoding((calls, instances) => {
    const chunks = [
      ...new FileReconstructor(parsed, { maxCacheBytes: 0 }).iterateFileChunks(
        entry.name,
        new BitReader(archive),
        1,
        13,
        16,
      ),
    ];
    assert.deepEqual(Buffer.concat(chunks), Buffer.from('AAA'));
    assert.deepEqual(calls, [{ frame: 0, size: FRAME }]);
    assertDecoderReleased(instances);
  });
});

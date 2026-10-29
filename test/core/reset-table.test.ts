import { test } from 'vitest';
import { deepStrictEqual as equal, ok, throws } from 'node:assert/strict';
import { ResetTableProcessor } from '../../src/core/lzx/reset-table';
import { BitReader } from '../../src/utils/io/bit-reader';

type Options = {
  tableOffset?: number;
  compressedLength?: number;
  uncompressedLength?: number;
};
function createResetTableBuffer(
  offsets = [0, 1000, 2500],
  options: Options = {},
): Buffer {
  const tableOffset = options.tableOffset ?? 0x28;
  const buf = Buffer.alloc(tableOffset + offsets.length * 8);
  buf.writeUInt32LE(2, 0);
  buf.writeUInt32LE(offsets.length, 4);
  buf.writeUInt32LE(8, 8);
  buf.writeUInt32LE(tableOffset, 12);
  buf.writeBigUInt64LE(
    BigInt(
      options.uncompressedLength ??
        (offsets.length === 0 ? 0 : (offsets.length - 1) * 0x8000 + 123),
    ),
    0x10,
  );
  buf.writeBigUInt64LE(
    BigInt(options.compressedLength ?? (offsets.length === 0 ? 0 : 4000)),
    0x18,
  );
  buf.writeBigUInt64LE(0x8000n, 0x20);
  offsets.forEach((offset, i) =>
    buf.writeBigUInt64LE(BigInt(offset), tableOffset + i * 8),
  );
  return buf;
}
function parse(buf = createResetTableBuffer()): ResetTableProcessor {
  const processor = new ResetTableProcessor();
  processor.parseResetTable(new BitReader(buf));
  return processor;
}

test('ResetTable: standard LE header, uint64 cumulative offsets and frame lengths', () => {
  const processor = parse();
  const table = processor.getResetTable()!;
  equal(table.version, 2);
  equal(table.blockCount, 3);
  equal(table.entrySize, 8);
  equal(table.tableOffset, 0x28);
  equal(table.blockSize, 0x8000);
  equal(table.compressedLength, 4000);
  equal(table.uncompressedLength, 2 * 0x8000 + 123);
  equal(table.entries, [
    { compressedLength: 0, uncompressedLength: 0x8000 },
    { compressedLength: 1000, uncompressedLength: 0x8000 },
    { compressedLength: 2500, uncompressedLength: 123 },
  ]);
  ok(processor.validate());
});

test('ResetTable: tableOffset is relative to the table start and may include padding', () => {
  const buf = createResetTableBuffer(undefined, { tableOffset: 64 });
  buf.fill(0xcc, 40, 64);
  const reader = new BitReader(
    Buffer.concat([Buffer.alloc(7, 0xaa), buf, Buffer.from('tail')]),
  );
  reader.setPosition(7);
  const processor = new ResetTableProcessor();
  equal(processor.parseResetTable(reader).entries[1]!.compressedLength, 1000);
  equal(reader.position, 7 + buf.length);
  equal(processor.calculateBlockOffset(0), 0);
  equal(processor.calculateBlockOffset(1), 1000);
  equal(processor.calculateBlockOffset(2), 2500);
});

test('ResetTable: preserves uint64 high words in compressed offsets and lengths', () => {
  const processor = parse(
    createResetTableBuffer([0, 0x100000123], {
      compressedLength: Number.MAX_SAFE_INTEGER,
    }),
  );
  equal(processor.calculateBlockOffset(1), 0x100000123);
  equal(processor.getResetTable()!.compressedLength, Number.MAX_SAFE_INTEGER);
  equal(processor.findBlockByOffset(0x100000122), 0);
  equal(processor.findBlockByOffset(0x100000123), 1);
  equal(processor.findBlockByOffset(Number.MAX_SAFE_INTEGER - 1), 1);
});

test('ResetTable: uncompressed lengths above 4GiB are not truncated', () => {
  const uncompressedLength = 0x100000001;
  const offsets = Array.from(
    { length: Math.ceil(uncompressedLength / 0x8000) },
    (_, i) => i,
  );
  const processor = parse(
    createResetTableBuffer(offsets, {
      uncompressedLength,
      compressedLength: offsets.length,
    }),
  );
  equal(processor.getResetTable()!.uncompressedLength, uncompressedLength);
  equal(processor.getBlockCount(), 131073);
  equal(processor.getBlockInfo(131072)!.uncompressedLength, 1);
});

test('ResetTable: an empty stream has zero frames and zero lengths', () => {
  const processor = parse(createResetTableBuffer([]));
  ok(processor.validate());
  equal(processor.getBlockCount(), 0);
  equal(processor.getBlockInfo(0), null);
  equal(processor.findBlockByOffset(0), -1);
  throws(() => processor.calculateBlockOffset(0));
  ok(!processor.getStatistics().includes('NaN'));
  throws(() => parse(createResetTableBuffer([], { compressedLength: 1 })));
  throws(() => parse(createResetTableBuffer([], { uncompressedLength: 1 })));
});

test('ResetTable: finds compressed byte ranges with an exclusive final boundary', () => {
  const processor = parse();
  for (const [offset, index] of [
    [0, 0],
    [999, 0],
    [1000, 1],
    [2499, 1],
    [2500, 2],
    [3999, 2],
    [4000, -1],
    [5000, -1],
    [-1, -1],
    [0.5, -1],
    [NaN, -1],
    [Infinity, -1],
  ])
    equal(processor.findBlockByOffset(offset!), index);
});

test('ResetTable: getBlockInfo and index APIs reject non-integer/invalid indices', () => {
  const processor = parse();
  equal(processor.getBlockCount(), 3);
  equal(processor.getBlockSize(), 0x8000);
  equal(processor.getBlockInfo(1), {
    compressedLength: 1000,
    uncompressedLength: 0x8000,
  });
  for (const index of [-1, 3, 0.5, NaN, Infinity]) {
    equal(processor.getBlockInfo(index), null);
    throws(() => processor.calculateBlockOffset(index));
  }
});

test('ResetTable: statistics use header totals, never sum cumulative offsets', () => {
  const stats = parse().getStatistics();
  ok(stats.includes('总块数: 3'));
  ok(stats.includes('块大小: 32.00 KB'));
  ok(stats.includes('总压缩大小: 3.91 KB'));
  ok(stats.includes('总未压缩大小: 64.12 KB'));
  ok(stats.includes('压缩率: 6.09%'));
});

test('ResetTable: rejects bad version, entry size, table offset, frame size and counts', () => {
  for (const [offset, value] of [
    [0, 99],
    [8, 4],
    [12, 39],
    [12, 1000],
    [32, 0],
    [32, 0x10000],
    [4, 0],
    [4, 2],
    [4, 4],
    [4, 0xffffffff],
  ]) {
    const buf = createResetTableBuffer();
    buf.writeUInt32LE(value!, offset!);
    throws(() => parse(buf));
  }
  const bigEndian = createResetTableBuffer();
  bigEndian.writeUInt32BE(2, 0);
  throws(() => parse(bigEndian));
});

test('ResetTable: rejects nonzero first, descending, duplicate and out-of-stream offsets', () => {
  for (const offsets of [
    [1],
    [0, 2500, 1000],
    [0, 1000, 1000],
    [0, 1000, 4000],
    [0, 1000, 4001],
  ])
    throws(() => parse(createResetTableBuffer(offsets)), /cumulative/);
});

test('ResetTable: every uint64 rejects values outside the safe integer range', () => {
  for (const offset of [16, 24, 32, 40, 48, 56]) {
    const buf = createResetTableBuffer();
    buf.writeBigUInt64LE(0x20000000000000n, offset);
    throws(() => parse(buf), /safe/);
  }
});

test('ResetTable: all header/table truncations fail and clear previous state', () => {
  const buf = createResetTableBuffer();
  const processor = parse();
  for (let length = 0; length < buf.length; length++) {
    throws(() =>
      processor.parseResetTable(new BitReader(buf.subarray(0, length))),
    );
    equal(processor.getResetTable(), null);
    ok(!processor.validate());
  }
});

test('ResetTable: accessors return deep copies; reset clears all state', () => {
  const processor = parse();
  const table = processor.getResetTable()!;
  table.entries[0]!.compressedLength = 50;
  table.entries.pop();
  const block = processor.getBlockInfo(0)!;
  block.compressedLength = 99;
  equal(processor.getBlockInfo(0)!.compressedLength, 0);
  equal(processor.getBlockCount(), 3);
  ok(processor.validate());
  processor.reset();
  ok(!processor.validate());
  equal(processor.getBlockCount(), 0);
  equal(processor.getBlockSize(), 0);
  equal(processor.getResetTable(), null);
  equal(processor.findBlockByOffset(0), -1);
  equal(processor.getBlockInfo(0), null);
  throws(() => processor.calculateBlockOffset(0));
  equal(processor.getStatistics(), '重置表未初始化');
});

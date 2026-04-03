import { test } from 'uvu';
import { equal, ok, throws } from 'uvu/assert';
import { ResetTableProcessor } from '../../src/core/lzx/reset-table';
import { BitReader } from '../../src/utils/io/bit-reader';

// BitReader.read(32) reads 32 bits MSB-first (big-endian byte order)
// So we must write values as big-endian
function createResetTableBuffer(
  blockCount: number,
  entries: Array<{ comp: number; uncomp: number }>,
): Buffer {
  const buf = Buffer.alloc(28 + entries.length * 8);
  let offset = 0;

  buf.writeUInt32BE(2, offset); // version
  offset += 4;
  buf.writeUInt32BE(blockCount, offset); // blockCount
  offset += 4;
  buf.writeUInt32BE(8, offset); // entrySize
  offset += 4;
  buf.writeUInt32BE(100, offset); // tableOffset
  offset += 4;
  buf.writeUInt32BE(10000, offset); // uncompressedLength
  offset += 4;
  buf.writeUInt32BE(5000, offset); // compressedLength
  offset += 4;
  buf.writeUInt32BE(0x8000, offset); // blockSize
  offset += 4;

  for (const entry of entries) {
    buf.writeUInt32BE(entry.comp, offset);
    offset += 4;
    buf.writeUInt32BE(entry.uncomp, offset);
    offset += 4;
  }

  return buf;
}

test('ResetTableProcessor should parse valid reset table', () => {
  const entries = [
    { comp: 1000, uncomp: 2000 },
    { comp: 1500, uncomp: 3000 },
  ];
  const buf = createResetTableBuffer(2, entries);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  const table = processor.parseResetTable(reader);

  equal(table.version, 2);
  equal(table.blockCount, 2);
  equal(table.entrySize, 8);
  equal(table.blockSize, 0x8000);
  equal(table.entries.length, 2);
  equal(table.entries[0]!.compressedLength, 1000);
  equal(table.entries[0]!.uncompressedLength, 2000);
});

test('ResetTableProcessor should throw on invalid version', () => {
  const buf = Buffer.alloc(28);
  buf.writeUInt32BE(99, 0); // Invalid version (big-endian for BitReader)
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  throws(() => processor.parseResetTable(reader));
});

test('ResetTableProcessor.getBlockInfo should return entry', () => {
  const entries = [
    { comp: 1000, uncomp: 2000 },
    { comp: 1500, uncomp: 3000 },
  ];
  const buf = createResetTableBuffer(2, entries);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);

  const block = processor.getBlockInfo(0);
  ok(block !== null);
  equal(block!.compressedLength, 1000);

  const block2 = processor.getBlockInfo(1);
  equal(block2!.compressedLength, 1500);

  equal(processor.getBlockInfo(5), null);
  equal(processor.getBlockInfo(-1), null);
});

test('ResetTableProcessor.getBlockCount should return count', () => {
  const buf = createResetTableBuffer(3, [
    { comp: 100, uncomp: 200 },
    { comp: 150, uncomp: 300 },
    { comp: 200, uncomp: 400 },
  ]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);

  equal(processor.getBlockCount(), 3);
});

test('ResetTableProcessor.getBlockSize should return size', () => {
  const buf = createResetTableBuffer(1, [{ comp: 100, uncomp: 200 }]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);

  equal(processor.getBlockSize(), 0x8000);
});

test('ResetTableProcessor.validate should check structure', () => {
  const buf = createResetTableBuffer(2, [
    { comp: 100, uncomp: 200 },
    { comp: 150, uncomp: 300 },
  ]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);
  ok(processor.validate());
});

test('ResetTableProcessor.validate should fail for uninitialized', () => {
  const processor = new ResetTableProcessor();
  ok(!processor.validate());
});

test('ResetTableProcessor.calculateBlockOffset should compute offsets', () => {
  const buf = createResetTableBuffer(2, [
    { comp: 100, uncomp: 200 },
    { comp: 150, uncomp: 300 },
  ]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);

  const offset0 = processor.calculateBlockOffset(0);
  equal(offset0, 100); // tableOffset

  const offset1 = processor.calculateBlockOffset(1);
  equal(offset1, 200); // tableOffset + first block compressed length
});

test('ResetTableProcessor.findBlockByOffset should find correct block', () => {
  const buf = createResetTableBuffer(2, [
    { comp: 100, uncomp: 200 },
    { comp: 150, uncomp: 300 },
  ]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);

  equal(processor.findBlockByOffset(100), 0); // Start of first block
  equal(processor.findBlockByOffset(150), 0); // Middle of first block
  equal(processor.findBlockByOffset(200), 1); // Start of second block
  equal(processor.findBlockByOffset(500), -1); // Beyond all blocks
});

test('ResetTableProcessor.getStatistics should return stats string', () => {
  const buf = createResetTableBuffer(1, [{ comp: 100, uncomp: 200 }]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);

  const stats = processor.getStatistics();
  ok(stats.includes('1'));
  ok(stats.includes('32'));
});

test('ResetTableProcessor.reset should clear state', () => {
  const buf = createResetTableBuffer(1, [{ comp: 100, uncomp: 200 }]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);
  ok(processor.validate());

  processor.reset();
  ok(!processor.validate());
  equal(processor.getBlockCount(), 0);
});

test('ResetTableProcessor.getResetTable should return copy', () => {
  const buf = createResetTableBuffer(1, [{ comp: 100, uncomp: 200 }]);
  const reader = new BitReader(buf);

  const processor = new ResetTableProcessor();
  processor.parseResetTable(reader);

  const table = processor.getResetTable();
  ok(table !== null);
  equal(table!.blockCount, 1);
});

test('ResetTableProcessor.getResetTable should return null when uninitialized', () => {
  const processor = new ResetTableProcessor();
  equal(processor.getResetTable(), null);
});

test.run();

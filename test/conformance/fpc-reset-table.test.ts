import { expect, test } from 'vitest';
import { ResetTableProcessor } from '../../src/core/lzx/reset-table';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { CacheStrategy, CHMArchive } from '../../src/reader/chm-archive';
import { BitReader } from '../../src/utils/io/bit-reader';
import {
  consumeStream,
  fixtureBytes,
  normalArchives,
  oracleBytes,
} from './corpus';

const archive = normalArchives.find(a => a.file === 'fpc-3.2.2-fpdoc.chm')!;
const input = fixtureBytes(archive.file);

function layout() {
  const parsed = new CHMParser().parse(new BitReader(input));
  const reset = [...parsed.directory.entries.values()].find(e =>
    e.name.endsWith('/ResetTable'),
  )!;
  return {
    parsed,
    offset: parsed.header.itsf.unknown4 + reset.offset,
    length: reset.length,
  };
}

function parse(bytes: Buffer) {
  return new CHMParser().parse(new BitReader(bytes));
}

test('FPC: 16 immutable raw ResetTable offsets normalize to exactly 15 nonempty frames', () => {
  const { parsed, offset, length } = layout();
  const raw = input.subarray(offset, offset + length);
  expect(raw.readUInt32LE(4)).toBe(16);
  expect(raw.readBigUInt64LE(length - 8)).toBe(68542n);
  expect(archive.observed).toMatchObject({
    frameCount: 15,
    resetTableEntryCount: 16,
    terminalResetOffset: 68542,
  });
  expect(parsed.resetTable.blockCount).toBe(15);
  expect(parsed.resetTable.entries).toHaveLength(15);
  expect(parsed.resetTable.entries[14]).toEqual({
    compressedLength: 68150,
    uncompressedLength: 2011,
  });
  expect(
    parsed.resetTable.entries.reduce((n, e) => n + e.uncompressedLength, 0),
  ).toBe(460763);

  const reader = new BitReader(raw);
  const processor = new ResetTableProcessor();
  expect(processor.parseResetTable(reader)).toEqual(parsed.resetTable);
  expect(reader.position).toBe(168);
  expect(processor.getBlockInfo(15)).toBeNull();
  expect(() => processor.calculateBlockOffset(15)).toThrow();
  expect(processor.findBlockByOffset(68541)).toBe(14);
  expect(processor.findBlockByOffset(68542)).toBe(-1);
});

test('FPC: malformed real-archive terminal offsets, counts and frame starts reject', () => {
  const { offset, length } = layout();
  for (const value of [0n, 68150n, 68541n, 68543n, 0x20000000000000n]) {
    const bad = Buffer.from(input);
    bad.writeBigUInt64LE(value, offset + length - 8);
    expect(() => parse(bad)).toThrow(/terminal|safe/);
  }
  for (const count of [0, 14, 17, 0xffffffff]) {
    const bad = Buffer.from(input);
    bad.writeUInt32LE(count, offset + 4);
    expect(() => parse(bad)).toThrow(/count/);
  }
  for (const [index, value] of [
    [0, 1],
    [1, 0],
    [14, 68542],
  ]) {
    const bad = Buffer.from(input);
    bad.writeBigUInt64LE(BigInt(value!), offset + 40 + index! * 8);
    expect(() => parse(bad)).toThrow(/cumulative/);
  }
});

test('FPC: a matching declared length and terminal cannot override actual Content bounds', () => {
  const { offset, length } = layout();
  for (const value of [68541n, 68543n]) {
    const bad = Buffer.from(input);
    bad.writeBigUInt64LE(value, offset + 24);
    bad.writeBigUInt64LE(value, offset + length - 8);
    expect(() => parse(bad)).toThrow(
      /compressed length does not match Content/,
    );
  }
});

test('FPC: final partial-frame reads, cold ranges and streams match independent resource bytes', async () => {
  const finalFrameStart = 14 * 32768;
  const selected = archive.files.filter(
    f =>
      f.section === 1 && f.length > 0 && f.offset + f.length > finalFrameStart,
  );
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.some(f => f.offset + f.length === 460763)).toBe(true);
  const reader = new CHMArchive(input, {
    cacheStrategy: CacheStrategy.None,
    maxCacheBytes: 0,
  });
  try {
    for (const file of selected) {
      const expected = oracleBytes(file);
      expect(reader.readFile(file.name), file.name).toEqual(expected);
      const boundary = Math.max(0, finalFrameStart - file.offset);
      const ranges = [
        [Math.max(0, boundary - 19), Math.min(file.length, boundary + 43)],
        [Math.max(0, file.length - 97), file.length],
        [file.length, file.length],
      ];
      for (const [start, end] of ranges) {
        expect(reader.readRange(file.name, start!, end!), file.name).toEqual(
          expected.subarray(start, end),
        );
        await consumeStream(
          reader.createReadStream(file.name, start, end),
          expected.subarray(start, end),
        );
      }
      await consumeStream(reader.createReadStream(file.name), expected);
    }
    expect(reader.getCacheStats().bytes).toBe(0);
  } finally {
    reader.close();
  }
});

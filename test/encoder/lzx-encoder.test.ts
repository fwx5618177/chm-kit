import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { LZXEncoder, LZX_FRAME_SIZE } from '../../src/encoder/lzx-encoder';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { ResetTableProcessor } from '../../src/core/lzx/reset-table';
import { BitReader } from '../../src/utils/io/bit-reader';
import { CHMHeaderBuilder } from '../../src/encoder/builders/header-builder';
import { allBytes } from './archive-fixtures';

for (const resetFrames of [1, 2, 3]) {
  test(`stored LZX is lossless for all bytes and reset interval ${resetFrames} frames`, () => {
    const resetInterval = resetFrames * LZX_FRAME_SIZE;
    const encoder = new LZXEncoder({ resetInterval, compressionLevel: 0 });
    const header = CHMHeaderBuilder.createLZXCHeader({ resetInterval });
    for (const length of [0, 1, 2, 255, 32767, 32768, 32769, 65537, 131075]) {
      const input = allBytes(length);
      const result = encoder.compress(input);
      const paddedLength = Math.ceil(length / LZX_FRAME_SIZE) * LZX_FRAME_SIZE;
      const parsedTable = new ResetTableProcessor().parseResetTable(
        new BitReader(result.resetTable),
      );
      assert.equal(parsedTable.blockCount, paddedLength / LZX_FRAME_SIZE);
      const decoded = new LZXDecoder(header).decode(
        new BitReader(result.compressedData),
        paddedLength,
      );
      assert.deepEqual(decoded.subarray(0, length), input);
      assert.deepEqual(
        decoded.subarray(length),
        Buffer.alloc(paddedLength - length),
      );
      assert.equal(result.uncompressedSize, length);
      assert.equal(result.compressedSize, result.compressedData.length);
      assert.equal(result.resetTable.readUInt32LE(0), 2);
      assert.equal(
        result.resetTable.readUInt32LE(4),
        paddedLength / LZX_FRAME_SIZE,
      );
      assert.equal(result.resetTable.readUInt32LE(8), 8);
      assert.equal(result.resetTable.readUInt32LE(12), 0x28);
      assert.equal(result.resetTable.readBigUInt64LE(16), BigInt(length));
      assert.equal(
        result.resetTable.readBigUInt64LE(24),
        BigInt(result.compressedSize),
      );
      assert.equal(
        result.resetTable.readBigUInt64LE(32),
        BigInt(LZX_FRAME_SIZE),
      );
      let previous = -1;
      for (let frame = 0; frame < paddedLength / LZX_FRAME_SIZE; frame++) {
        const offset = Number(
          result.resetTable.readBigUInt64LE(40 + frame * 8),
        );
        assert.ok(offset > previous && offset < result.compressedSize);
        assert.equal(offset % 2, 0);
        const words =
          result.compressedData
            .readUInt16LE(offset)
            .toString(2)
            .padStart(16, '0') +
          result.compressedData
            .readUInt16LE(offset + 2)
            .toString(2)
            .padStart(16, '0');
        const intel = frame % resetFrames === 0;
        if (intel) assert.equal(words[0], '0');
        assert.equal(parseInt(words.slice(intel ? 1 : 0, intel ? 4 : 3), 2), 3);
        assert.equal(result.compressedData.readUInt32LE(offset + 4), 1);
        assert.equal(result.compressedData.readUInt32LE(offset + 8), 1);
        assert.equal(result.compressedData.readUInt32LE(offset + 12), 1);
        previous = offset;
      }
      if (length)
        assert.ok(
          result.compressedSize > length,
          'stored LZX must not claim size reduction',
        );
      else assert.equal(result.compressedSize, 0);
      // All state is per compress() call, including Intel header and offsets.
      assert.deepEqual(encoder.compress(input), result);
    }
  });
}

test('odd stored block padding precedes the final zero-fill block', () => {
  const result = new LZXEncoder({ compressionLevel: 0 }).compress(
    Buffer.from([0x80, 0xe8, 0xff]),
  );
  const data = result.compressedData;
  assert.deepEqual(data.subarray(16, 19), Buffer.from([0x80, 0xe8, 0xff]));
  assert.equal(data[19], 0);
  assert.equal(data.readUInt16LE(20) >>> 13, 3);
  assert.equal(data.length % 2, 0);
});

test('reject invalid LZX sizes rather than emitting nonstandard streams', () => {
  for (const resetInterval of [0, -1, 100, 32769, Number.NaN]) {
    assert.throws(() => new LZXEncoder({ resetInterval }), /resetInterval/);
  }
  for (const windowSize of [0, 16384, 49152, 0x400000]) {
    assert.throws(() => new LZXEncoder({ windowSize }), /windowSize/);
  }
  const encoder = new LZXEncoder({ windowSize: 0x10000, compressionLevel: 9 });
  assert.deepEqual(encoder.getConfig(), {
    windowSize: 0x10000,
    resetInterval: 0x8000,
    compressionLevel: 9,
  });
});

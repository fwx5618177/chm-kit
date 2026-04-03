import { test } from 'uvu';
import { equal, ok } from 'uvu/assert';
import { LZXEncoder } from '../../src/encoder/lzx-encoder';

test('LZXEncoder should compress data', () => {
  const encoder = new LZXEncoder();
  const input = Buffer.from('Hello, World! Hello, World!', 'utf-8');
  const result = encoder.compress(input);

  ok(result.compressedData.length > 0);
  ok(result.resetTable.length > 0);
  equal(result.uncompressedSize, input.length);
  ok(result.compressedSize > 0);
});

test('LZXEncoder should produce reset table', () => {
  const encoder = new LZXEncoder();
  const input = Buffer.from('Test data for compression', 'utf-8');
  const result = encoder.compress(input);

  // Reset table should start with version 2
  equal(result.resetTable.readUInt32LE(0), 2);
  // Entry size should be 8
  equal(result.resetTable.readUInt32LE(8), 8);
});

test('LZXEncoder should handle empty input', () => {
  const encoder = new LZXEncoder();
  const input = Buffer.alloc(0);
  const result = encoder.compress(input);

  equal(result.uncompressedSize, 0);
  equal(result.compressedSize, 0);
});

test('LZXEncoder should find matches in repeated data', () => {
  const encoder = new LZXEncoder();
  // Repeated pattern should compress better
  const repeated = Buffer.from(
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'utf-8',
  );
  const result = encoder.compress(repeated);

  ok(result.compressedData.length > 0);
  equal(result.uncompressedSize, repeated.length);
});

test('LZXEncoder getConfig should return configuration', () => {
  const encoder = new LZXEncoder({ windowSize: 0x10000, compressionLevel: 9 });
  const config = encoder.getConfig();

  equal(config.windowSize, 0x10000);
  equal(config.compressionLevel, 9);
});

test('LZXEncoder should use default config', () => {
  const encoder = new LZXEncoder();
  const config = encoder.getConfig();

  equal(config.windowSize, 0x8000);
  equal(config.resetInterval, 0x8000);
  equal(config.compressionLevel, 6);
});

test('LZXEncoder should handle large input with multiple blocks', () => {
  const encoder = new LZXEncoder({ resetInterval: 100 });
  const input = Buffer.alloc(500, 0x42); // 500 bytes of 'B'
  const result = encoder.compress(input);

  // Should have multiple reset table entries
  const blockCount = result.resetTable.readUInt32LE(4);
  ok(blockCount >= 5, `Expected >= 5 blocks, got ${blockCount}`);
});

test.run();

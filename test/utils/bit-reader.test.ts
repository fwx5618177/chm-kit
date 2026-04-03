import { test } from 'uvu';
import { equal, throws, ok } from 'uvu/assert';
import { BitReader } from '../../src/utils/io/bit-reader';

test('BitReader should read 8 bits as a byte', () => {
  const buffer = Buffer.from([0xab]);
  const reader = new BitReader(buffer);
  equal(reader.read(8), 0xab);
});

test('BitReader should read individual bits', () => {
  // 0b10110000 = 0xB0
  const buffer = Buffer.from([0xb0]);
  const reader = new BitReader(buffer);
  equal(reader.read(1), 1);
  equal(reader.read(1), 0);
  equal(reader.read(1), 1);
  equal(reader.read(1), 1);
  equal(reader.read(1), 0);
  equal(reader.read(1), 0);
  equal(reader.read(1), 0);
  equal(reader.read(1), 0);
});

test('BitReader should read across byte boundaries', () => {
  // 0xFF 0x00 -> 11111111 00000000
  const buffer = Buffer.from([0xff, 0x00]);
  const reader = new BitReader(buffer);
  // Read 4 bits from first byte: 1111
  equal(reader.read(4), 0x0f);
  // Read 8 bits across boundary: 1111 0000
  equal(reader.read(8), 0xf0);
});

test('BitReader should peek without advancing position', () => {
  const buffer = Buffer.from([0xab]);
  const reader = new BitReader(buffer);
  equal(reader.peek(8), 0xab);
  equal(reader.peek(8), 0xab); // Same value
  equal(reader.read(8), 0xab); // Now consume
});

test('BitReader should skip bits', () => {
  const buffer = Buffer.from([0xab, 0xcd]);
  const reader = new BitReader(buffer);
  reader.skip(8);
  equal(reader.read(8), 0xcd);
});

test('BitReader should align to byte boundary', () => {
  const buffer = Buffer.from([0xff, 0xab]);
  const reader = new BitReader(buffer);
  reader.read(3); // Read 3 bits
  reader.align(); // Skip to next byte
  equal(reader.read(8), 0xab);
});

test('BitReader should report hasMore correctly', () => {
  const buffer = Buffer.from([0xab]);
  const reader = new BitReader(buffer);
  ok(reader.hasMore());
  reader.read(8);
  ok(!reader.hasMore());
});

test('BitReader should throw on end of buffer', () => {
  const buffer = Buffer.from([0xab]);
  const reader = new BitReader(buffer);
  reader.read(8);
  throws(() => reader.read(1));
});

test('BitReader should throw on invalid bits count', () => {
  const buffer = Buffer.from([0xab]);
  const reader = new BitReader(buffer);
  throws(() => reader.read(0));
  throws(() => reader.read(33));
});

test('BitReader setPosition should work', () => {
  const buffer = Buffer.from([0x11, 0x22, 0x33]);
  const reader = new BitReader(buffer);
  reader.read(8); // Skip first byte
  reader.setPosition(0);
  equal(reader.read(8), 0x11);
  reader.setPosition(2);
  equal(reader.read(8), 0x33);
});

test('BitReader getPosition should return correct state', () => {
  const buffer = Buffer.from([0xab, 0xcd]);
  const reader = new BitReader(buffer);
  reader.read(3);
  const pos = reader.getPosition();
  equal(pos.byte, 0);
  equal(pos.bit, 3);
});

test('BitReader remainingBytes should be correct', () => {
  const buffer = Buffer.from([0x11, 0x22, 0x33]);
  const reader = new BitReader(buffer);
  equal(reader.remainingBytes(), 3);
  reader.read(8);
  equal(reader.remainingBytes(), 2);
});

test('BitReader should read 16-bit values', () => {
  const buffer = Buffer.from([0xab, 0xcd]);
  const reader = new BitReader(buffer);
  equal(reader.read(16), 0xabcd);
});

test('BitReader should read 32-bit values', () => {
  const buffer = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  const reader = new BitReader(buffer);
  equal(reader.read(32), 1);
});

test.run();

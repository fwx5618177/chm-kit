import { test } from 'vitest';
import { deepStrictEqual as equal, throws, ok } from 'node:assert/strict';
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

for (const method of ['read', 'peek'] as const) {
  test(`BitReader ${method} rejects invalid counts atomically`, () => {
    const reader = new BitReader(Buffer.from([0xab, 0xcd]));
    reader.read(3);
    const position = reader.getPosition();
    for (const bits of [-1, 0, NaN, Infinity, -Infinity, 1.5, 33]) {
      throws(() => reader[method](bits));
      equal(reader.getPosition(), position);
    }
    equal(reader.read(5), 0x0b);
  });

  test(`BitReader ${method} fails atomically on truncated reads`, () => {
    const reader = new BitReader(Buffer.from([0xab, 0xcd]));
    reader.skip(3);
    throws(() => reader[method](14), /End of buffer/);
    equal(reader.getPosition(), { byte: 0, bit: 3 });
    equal(reader.read(13), 0x0bcd);
    throws(() => reader[method](1));
    equal(reader.getPosition(), { byte: 2, bit: 0 });
  });

  test(`BitReader ${method} returns unsigned 32-bit values`, () => {
    for (const value of [0x80000000, 0xabcdef01, 0xffffffff]) {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(value);
      const reader = new BitReader(buffer);
      equal(reader[method](32), value);
    }
    const reader = new BitReader(Buffer.from([0x7f, 0xff, 0xff, 0xff, 0x80]));
    reader.skip(1);
    equal(reader[method](32), 0xffffffff);
  });
}

test('BitReader skip validates counts and bounds without changing state', () => {
  const reader = new BitReader(Buffer.from([0xab, 0xcd]));
  reader.skip(3);
  for (const bits of [
    -1,
    NaN,
    Infinity,
    1.5,
    14,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    throws(() => reader.skip(bits));
    equal(reader.getPosition(), { byte: 0, bit: 3 });
  }
  reader.skip(0);
  equal(reader.getPosition(), { byte: 0, bit: 3 });
  reader.skip(13);
  equal(reader.getPosition(), { byte: 2, bit: 0 });
  reader.skip(0);
  throws(() => reader.skip(1));
});

test('BitReader setPosition rejects invalid positions atomically, including EOF bits', () => {
  const reader = new BitReader(Buffer.from([0xab]));
  reader.setPosition(0, 3);
  for (const [byte, bit] of [
    [-1, 0],
    [2, 0],
    [NaN, 0],
    [Infinity, 0],
    [0.5, 0],
    [0, -1],
    [0, 8],
    [0, NaN],
    [0, Infinity],
    [0, 0.5],
    [1, 1],
  ]) {
    throws(() => reader.setPosition(byte, bit));
    equal(reader.getPosition(), { byte: 0, bit: 3 });
  }
  reader.setPosition(1, 0);
  equal(reader.remainingBytes(), 0);
  ok(!reader.hasMore());
  const empty = new BitReader(Buffer.alloc(0));
  empty.setPosition(0);
  empty.skip(0);
  throws(() => empty.setPosition(0, 1));
  throws(() => empty.read(1));
});

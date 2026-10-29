import { test } from 'vitest';
import { deepStrictEqual as equal, ok, throws } from 'node:assert/strict';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { LZXBitReader } from '../../src/core/lzx/lzx-bit-reader';
import { BitReader } from '../../src/utils/io/bit-reader';
import type { LZXCHeader } from '../../src/core/types';

const header: LZXCHeader = {
  signature: 'LZXC',
  version: 2,
  resetInterval: 0x8000,
  windowSize: 0x8000,
  cacheSize: 0,
  unknown: 0,
};
// Intel flag 0; type 3; length 4; word alignment; three LE offsets; raw ABCD.
const rawABCD = Buffer.from('0030400001000000010000000100000041424344', 'hex');

test('valid configuration and status', () => {
  const decoder = new LZXDecoder(header);
  ok(decoder.validate());
  ok(decoder.getStatus().includes('32768'));
  equal(LZXDecoder.ALIGNED_NUM_ELEMENTS, 8);
});

test('word reader consumes LE words in MSB order, including 32-bit unsigned values', () => {
  const reader = new LZXBitReader(Uint8Array.from([0x34, 0x12, 0xcd, 0xab]));
  equal(reader.read(4), 1);
  equal(reader.read(12), 0x234);
  equal(reader.read(16), 0xabcd);
  equal(reader.remainingBytes, 0);
  equal(new LZXBitReader(Buffer.alloc(4, 0xff)).read(32), 0xffffffff);
  equal(reader.read(0), 0);
});

test('word reader rejects truncated words and invalid reads', () => {
  throws(() => new LZXBitReader(Uint8Array.from([0xff])).read(1), /Truncated/);
  const reader = new LZXBitReader(Buffer.alloc(4));
  for (const bits of [-1, 33, NaN, 0.5]) throws(() => reader.read(bits));
  reader.read(1);
  throws(() => reader.readRaw(1), /Unaligned/);
});

test('uncompressed alignment discards a whole word when already aligned', () => {
  const reader = new LZXBitReader(Uint8Array.from([0, 0, 0x34, 0x12, 0xab]));
  reader.read(16);
  reader.alignUncompressed();
  equal(reader.readRaw(1), Uint8Array.from([0xab]));
});

test('compatibility decode returns exact raw bytes and advances the caller reader', () => {
  const reader = new BitReader(Buffer.concat([Buffer.from([0x99]), rawABCD]));
  reader.position = 1;
  equal(new LZXDecoder(header).decode(reader, 4), Buffer.from('ABCD'));
  equal(reader.position, rawABCD.length + 1);
  equal(reader.bitPosition, 0);
});

test('frame entry point accepts Uint8Array and reset is public', () => {
  const decoder = new LZXDecoder(header);
  equal(
    decoder.decodeFrames([new Uint8Array(rawABCD)], 4),
    Buffer.from('ABCD'),
  );
  decoder.reset();
  equal(decoder.decodeFrames([rawABCD], 4), Buffer.from('ABCD'));
  equal(decoder.decodeFrames([], 0), Buffer.alloc(0));
  equal(decoder.decode(new BitReader(Buffer.alloc(0)), 0), Buffer.alloc(0));
});

test('every truncation of the stored fixture fails rather than returning zeroes', () => {
  for (let length = 0; length < rawABCD.length; length++) {
    throws(() =>
      new LZXDecoder(header).decodeFrames([rawABCD.subarray(0, length)], 4),
    );
  }
});

test('invalid sizes are rejected before allocation or decompression', () => {
  const decoder = new LZXDecoder(header);
  for (const size of [
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER,
    LZXDecoder.MAX_OUTPUT_SIZE + 1,
  ]) {
    throws(() => decoder.decode(new BitReader(rawABCD), size), /output size/);
    throws(() => decoder.decodeFrames([], size), /output size/);
  }
});

test('invalid windows and non-frame reset intervals fail at construction', () => {
  for (const windowSize of [0, 16384, 32769, 4194304, Infinity]) {
    throws(() => new LZXDecoder({ ...header, windowSize }));
  }
  for (const resetInterval of [0, -32768, 32769, 1.5, NaN]) {
    throws(() => new LZXDecoder({ ...header, resetInterval }));
  }
});

test('frame count, absolute reset index, and caller bit alignment are validated', () => {
  const decoder = new LZXDecoder({ ...header, resetInterval: 65536 });
  throws(() => decoder.decodeFrames([], 4), /frame count/);
  throws(() => decoder.decodeFrames([rawABCD, rawABCD], 4), /frame count/);
  for (const start of [-1, 1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) {
    throws(() => decoder.decodeFrames([rawABCD], 4, start), /startFrame/);
  }
  equal(decoder.decodeFrames([rawABCD], 4, 2), Buffer.from('ABCD'));
  const reader = new BitReader(rawABCD);
  reader.read(1);
  throws(() => decoder.decode(reader, 4), /byte-aligned/);
});

test('word reader EOF is atomic, preserving buffered bits and raw bytes', () => {
  const reader = new LZXBitReader(Uint8Array.from([0x34, 0x12, 0xab]));
  equal(reader.read(4), 1);
  throws(() => reader.read(16), /Truncated/);
  equal(reader.position, 2);
  equal(reader.read(12), 0x234);
  reader.alignFrame();
  throws(() => reader.readRaw(2), /Truncated/);
  equal(reader.readRaw(1), Uint8Array.from([0xab]));
});

test('failed compatibility decode rolls back caller cursor and can be retried', () => {
  const d = new LZXDecoder(header);
  const reader = new BitReader(
    Buffer.concat([Buffer.from([0x99]), rawABCD.subarray(0, 19)]),
  );
  reader.position = 1;
  for (let attempt = 0; attempt < 2; attempt++) {
    throws(() => d.decode(reader, 4), /Truncated/);
    equal(reader.position, 1);
    equal(reader.bitPosition, 0);
    ok(d.getStatus().includes('当前位置: 0'));
  }
  reader.buffer = Buffer.concat([Buffer.from([0x99]), rawABCD]);
  equal(d.decode(reader, 4), Buffer.from('ABCD'));
  equal(reader.position, rawABCD.length + 1);
  reader.setPosition(1);
  equal(d.decode(reader, 4), Buffer.from('ABCD'));
});

test('decodeFrames errors clear state without mutating input, and allow reuse', () => {
  const d = new LZXDecoder(header);
  const original = Buffer.from(rawABCD);
  equal(d.decodeFrames([rawABCD], 4), Buffer.from('ABCD'));
  throws(() => d.decodeFrames([rawABCD.subarray(0, 19)], 4), /Truncated/);
  ok(d.getStatus().includes('当前位置: 0'));
  equal(d.decodeFrames([rawABCD], 4), Buffer.from('ABCD'));
  throws(() => d.decodeFrames([rawABCD], 4, 0, 3), /lastFrameSize/);
  ok(d.getStatus().includes('当前位置: 0'));
  equal(d.decodeFrames([rawABCD], 4, 0, 4), Buffer.from('ABCD'));
  equal(rawABCD, original);
});

test('physical last-frame length is validated independently of prefix size', () => {
  const d = new LZXDecoder(header);
  for (const size of [-1, 0, 2, 32769, 3.5, NaN, Infinity]) {
    throws(() => d.decodeFrames([rawABCD], 3, 0, size), /lastFrameSize/);
  }
  equal(d.decodeFrames([rawABCD], 3, 0, 4), Buffer.from('ABC'));
  throws(() => d.decodeFrames([rawABCD.subarray(0, 19)], 3, 0, 4), /Truncated/);
  throws(() => d.decodeFrames([], 0, 0, 1), /lastFrameSize/);
  equal(d.decodeFrames([], 0, 0, 0), Buffer.alloc(0));
});

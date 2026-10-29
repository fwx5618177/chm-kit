import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  CHMHeaderBuilder,
  encodeEncInt,
} from '../../src/encoder/builders/header-builder';

const GUIDS =
  '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec';

test('ITSF v3 uses GUIDs and 64-bit standard offsets, not legacy fields at 0x20', () => {
  const header = CHMHeaderBuilder.createITSFHeader({
    directoryOffset: 120,
    directoryLength: 4180,
    timestamp: 0x12345678,
    languageId: 0x804,
  });
  const data = CHMHeaderBuilder.serializeITSFHeader(header);
  assert.equal(data.length, 96);
  assert.equal(data.toString('ascii', 0, 4), 'ITSF');
  assert.equal(data.readUInt32LE(4), 3);
  assert.equal(data.readUInt32LE(8), 96);
  assert.equal(data.readUInt32BE(16), 0x12345678);
  assert.equal(data.readUInt32LE(20), 0x804);
  assert.equal(data.subarray(24, 56).toString('hex'), GUIDS);
  assert.equal(data.readBigUInt64LE(56), 96n);
  assert.equal(data.readBigUInt64LE(64), 24n);
  assert.equal(data.readBigUInt64LE(72), 120n);
  assert.equal(data.readBigUInt64LE(80), 4180n);
  assert.equal(data.readBigUInt64LE(88), 4300n);
  assert.ok(CHMHeaderBuilder.validateHeader(header));
});

test('ITSF offsets are not truncated to 32 bits', () => {
  const data = CHMHeaderBuilder.serializeITSFHeader(
    CHMHeaderBuilder.createITSFHeader({
      directoryOffset: 0x100000078,
      directoryLength: 4180,
    }),
  );
  assert.equal(data.readBigUInt64LE(72), 0x100000078n);
  assert.equal(data.readBigUInt64LE(88), 0x1000010ccn);
});

test('ITSP describes a leaf-only chain with explicit chunk count and directory GUID', () => {
  const header = CHMHeaderBuilder.createITSPHeader({ numChunks: 7 });
  const data = CHMHeaderBuilder.serializeITSPHeader(header);
  assert.equal(data.length, 84);
  assert.equal(data.toString('ascii', 0, 4), 'ITSP');
  assert.equal(data.readUInt32LE(8), 84);
  assert.equal(data.readUInt32LE(12), 10);
  assert.equal(data.readUInt32LE(16), 4096);
  assert.equal(data.readUInt32LE(20), 2);
  assert.equal(data.readUInt32LE(24), 1);
  assert.equal(data.readInt32LE(28), -1);
  assert.equal(data.readUInt32LE(32), 0);
  assert.equal(data.readUInt32LE(36), 6);
  assert.equal(data.readUInt32LE(44), 7);
  assert.equal(
    data.subarray(52, 68).toString('hex'),
    '6a92025d2e21d0119df900a0c922e6ec',
  );
  assert.ok(CHMHeaderBuilder.validateHeader(header));
});

test('ControlData has a DWORD count, LZXC signature and frame-valued v2 sizes', () => {
  const header = CHMHeaderBuilder.createLZXCHeader({
    resetInterval: 0x10000,
    windowSize: 0x20000,
  });
  const data = CHMHeaderBuilder.serializeLZXCHeader(header);
  assert.equal(data.length, 28);
  assert.equal(data.readUInt32LE(0), 6);
  assert.equal(data.toString('ascii', 4, 8), 'LZXC');
  assert.equal(data.readUInt32LE(8), 2);
  assert.equal(data.readUInt32LE(12), 2);
  assert.equal(data.readUInt32LE(16), 4);
  assert.ok(CHMHeaderBuilder.validateHeader(header));
});

test('ENCINT preserves large safe integers and uses MSB-first seven-bit groups', () => {
  assert.deepEqual(encodeEncInt(0), Buffer.from([0]));
  assert.deepEqual(encodeEncInt(127), Buffer.from([127]));
  assert.deepEqual(encodeEncInt(128), Buffer.from([0x81, 0]));
  for (const value of [
    0,
    1,
    128,
    16384,
    0xffffffff,
    0x100000000,
    Number.MAX_SAFE_INTEGER,
  ]) {
    const decoded = [...encodeEncInt(value)].reduce(
      (result, byte) => result * 128 + (byte & 127),
      0,
    );
    assert.equal(decoded, value);
  }
  assert.throws(() => encodeEncInt(-1));
  assert.throws(() => encodeEncInt(1.5));
  assert.throws(() => encodeEncInt(Number.MAX_SAFE_INTEGER + 1));
});

test('validation does not accept a signature alone', () => {
  const header = CHMHeaderBuilder.createITSFHeader({
    directoryOffset: 120,
    directoryLength: 4180,
  });
  assert.equal(
    CHMHeaderBuilder.validateHeader({ ...header, directoryLength: -1 }),
    false,
  );
  assert.equal(
    CHMHeaderBuilder.validateHeader({ ...header, headerLength: 32 }),
    false,
  );
  assert.equal(
    CHMHeaderBuilder.validateHeader({
      ...CHMHeaderBuilder.createITSPHeader(),
      chunkSize: 0,
    }),
    false,
  );
  assert.equal(
    CHMHeaderBuilder.validateHeader({
      ...CHMHeaderBuilder.createLZXCHeader(),
      windowSize: 123,
    }),
    false,
  );
});

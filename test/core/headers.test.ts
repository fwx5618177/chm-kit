import { test } from 'vitest';
import { deepStrictEqual as equal, ok, throws } from 'node:assert/strict';
import { ITSFHeaderParser } from '../../src/core/headers/itsf-header';
import { ITSPHeaderParser } from '../../src/core/headers/itsp-header';
import { LZXCHeaderParser } from '../../src/core/headers/lzxc-header';
import { BitReader } from '../../src/utils/io/bit-reader';

function createITSFBuffer(version = 3): Buffer {
  const buf = Buffer.alloc(version === 2 ? 0x58 : 0x60);
  buf.write('ITSF');
  buf.writeUInt32LE(version, 4);
  buf.writeUInt32LE(buf.length, 8);
  buf.writeUInt32LE(1, 12);
  buf.writeUInt32BE(0x87654321, 16);
  buf.writeUInt32LE(0x409, 20);
  Buffer.from(
    '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec',
    'hex',
  ).copy(buf, 0x18);
  buf.writeBigUInt64LE(96n, 0x38);
  buf.writeBigUInt64LE(24n, 0x40);
  buf.writeBigUInt64LE(220n, 0x48);
  buf.writeBigUInt64LE(4096n, 0x50);
  if (version === 3) buf.writeBigUInt64LE(4316n, 0x58);
  return buf;
}

function createITSPBuffer(): Buffer {
  const buf = Buffer.alloc(0x54);
  buf.write('ITSP');
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(buf.length, 8);
  buf.writeUInt32LE(10, 12);
  buf.writeUInt32LE(4096, 16);
  buf.writeUInt32LE(2, 20);
  buf.writeUInt32LE(2, 24);
  buf.writeUInt32LE(1, 28);
  buf.writeUInt32LE(0, 32);
  buf.writeUInt32LE(0, 36);
  buf.writeUInt32LE(0xffffffff, 40);
  buf.writeUInt32LE(2, 44);
  buf.writeUInt32LE(0x409, 48);
  Buffer.from('6a92025d2e21d0119df900a0c922e6ec', 'hex').copy(buf, 52);
  return buf;
}

function createLZXCBuffer(version = 2): Buffer {
  const buf = Buffer.alloc(version === 1 ? 24 : 28);
  buf.writeUInt32LE(buf.length / 4 - 1, 0);
  buf.write('LZXC', 4);
  buf.writeUInt32LE(version, 8);
  buf.writeUInt32LE(version === 2 ? 2 : 0x10000, 12);
  buf.writeUInt32LE(version === 2 ? 2 : 0x10000, 16);
  buf.writeUInt32LE(1, 20);
  return buf;
}

for (const version of [2, 3]) {
  test(`ITSF v${version}: real GUIDs, header offsets and exact cursor`, () => {
    const buf = createITSFBuffer(version);
    const reader = new BitReader(Buffer.concat([buf, Buffer.from('tail')]));
    const header = ITSFHeaderParser.parse(reader);
    equal(header.signature, 'ITSF');
    equal(header.version, version);
    equal(header.headerLength, version === 2 ? 0x58 : 0x60);
    equal(header.timestamp, 0x87654321);
    equal(header.languageId, 0x409);
    equal(header.unknown2, 96);
    equal(header.unknown3, 24);
    equal(header.directoryOffset, 220);
    equal(header.directoryLength, 4096);
    equal(header.unknown4, version === 3 ? 4316 : 0);
    equal(reader.position, buf.length);
    ok(ITSFHeaderParser.validate(header));
    ok(ITSFHeaderParser.getSummary(header).includes('ITSF'));
  });
}

test('ITSF: accepts the exact FPC v3 duplicated-first-GUID variant', () => {
  const buf = createITSFBuffer();
  buf.copy(buf, 0x28, 0x18, 0x28);
  const reader = new BitReader(Buffer.concat([buf, Buffer.from('tail')]));
  equal(
    ITSFHeaderParser.parse(reader),
    ITSFHeaderParser.parse(new BitReader(createITSFBuffer())),
  );
  equal(reader.position, buf.length);
});

test('ITSF: rejects reversed, duplicated-second, zero and unknown GUID pairs', () => {
  const first = Buffer.from('10fd017caa7bd0119e0c00a0c922e6ec', 'hex');
  const second = Buffer.from('11fd017caa7bd0119e0c00a0c922e6ec', 'hex');
  const unknown = Buffer.from(first);
  unknown[15] ^= 1;
  for (const version of [2, 3]) {
    for (const [left, right] of [
      [second, first],
      [second, second],
      [Buffer.alloc(16), second],
      [first, Buffer.alloc(16)],
      [first, unknown],
      [unknown, second],
      [unknown, unknown],
    ]) {
      const buf = createITSFBuffer(version);
      left!.copy(buf, 0x18);
      right!.copy(buf, 0x28);
      throws(() => ITSFHeaderParser.parse(new BitReader(buf)), /ITSF GUID/);
    }
  }
  // The upstream evidence is v3 only; do not extend the exception to v2.
  const v2 = createITSFBuffer(2);
  first.copy(v2, 0x28);
  throws(() => ITSFHeaderParser.parse(new BitReader(v2)), /ITSF GUID/);
});

test('ITSF: rejects every other single-bit GUID corruption, including FPC tails', () => {
  for (const fpc of [false, true]) {
    const valid = createITSFBuffer();
    if (fpc) valid.copy(valid, 0x28, 0x18, 0x28);
    for (let offset = 0x18; offset < 0x38; offset++) {
      for (let bit = 0; bit < 8; bit++) {
        // These two accepted pairs differ by exactly this bit.
        if (offset === 0x28 && bit === 0) continue;
        const bad = Buffer.from(valid);
        bad[offset] ^= 1 << bit;
        throws(() => ITSFHeaderParser.parse(new BitReader(bad)), /ITSF GUID/);
      }
    }
  }
});

test('ITSF: rejects signatures, versions, both bad GUIDs and short version headers', () => {
  for (const [offset, value] of [
    [0, 0],
    [4, 9],
    [0x18, 0],
    [0x28, 0],
    [8, 0x58],
  ]) {
    const buf = createITSFBuffer();
    buf[offset!] = value!;
    throws(() => ITSFHeaderParser.parse(new BitReader(buf)));
  }
  const header = ITSFHeaderParser.parse(new BitReader(createITSFBuffer()));
  ok(!ITSFHeaderParser.validate({ ...header, signature: 'XXXX' }));
});

test('ITSF: every truncation fails, including absent v3 data-offset bytes', () => {
  for (const version of [2, 3]) {
    const buf = createITSFBuffer(version);
    for (let length = 0; length < buf.length; length++) {
      throws(() =>
        ITSFHeaderParser.parse(new BitReader(buf.subarray(0, length))),
      );
    }
  }
});

test('ITSF: preserves uint64 high words and the largest safe integer', () => {
  const buf = createITSFBuffer();
  buf.writeBigUInt64LE(0x100000123n, 0x38);
  buf.writeBigUInt64LE(0n, 0x40);
  buf.writeBigUInt64LE(0x100000456n, 0x48);
  buf.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER), 0x58);
  const header = ITSFHeaderParser.parse(new BitReader(buf));
  equal(header.unknown2, 0x100000123);
  equal(header.directoryOffset, 0x100000456);
  equal(header.unknown4, Number.MAX_SAFE_INTEGER);
});

test('ITSF: rejects every unsafe uint64 and overflowing range sum', () => {
  for (const offset of [0x38, 0x40, 0x48, 0x50, 0x58]) {
    const buf = createITSFBuffer();
    buf.writeBigUInt64LE(0x20000000000000n, offset);
    throws(() => ITSFHeaderParser.parse(new BitReader(buf)), /safe/);
  }
  const header = ITSFHeaderParser.parse(new BitReader(createITSFBuffer()));
  for (const changes of [
    { unknown2: Number.MAX_SAFE_INTEGER, unknown3: 1 },
    { directoryOffset: Number.MAX_SAFE_INTEGER, directoryLength: 84 },
    { directoryOffset: -1 },
    { directoryLength: NaN },
    { unknown4: -1 },
    { unknown2: 1.5 },
    { directoryOffset: 10 },
  ])
    ok(!ITSFHeaderParser.validate({ ...header, ...changes }));
});

test('ITSF: accepts explicit v3 zero/early data bases without inventing directory ordering', () => {
  const header = ITSFHeaderParser.parse(new BitReader(createITSFBuffer()));
  for (const unknown4 of [0, 96, 220, 4316]) {
    ok(ITSFHeaderParser.validate({ ...header, unknown4 }));
  }
});

test('ITSP: parses actual 0x54 layout including PMGL indices and unsigned sentinel', () => {
  const reader = new BitReader(createITSPBuffer());
  const header = ITSPHeaderParser.parse(reader);
  equal(header.signature, 'ITSP');
  equal(header.version, 1);
  equal(header.chunkSize, 4096);
  equal(header.density, 2);
  equal(header.depth, 2);
  equal(header.rootIndex, 1);
  equal(header.firstPMGI, 0);
  equal(header.lastPMGI, 0);
  equal(header.unknown2, 0xffffffff);
  equal(reader.position, 84);
  ok(ITSPHeaderParser.validate(header));
  ok(ITSPHeaderParser.getSummary(header).includes('PMGL'));
});

test('ITSP: supports root -1 when there is no index', () => {
  const buf = createITSPBuffer();
  buf.writeInt32LE(-1, 28);
  buf.writeUInt32LE(1, 24);
  equal(ITSPHeaderParser.parse(new BitReader(buf)).rootIndex, -1);
});

test('ITSP: rejects bad GUID, sizes, density, depth and index bounds', () => {
  for (const [offset, value] of [
    [4, 2],
    [8, 83],
    [16, 21],
    [20, 32],
    [24, 0],
    [24, 3],
    [28, 2],
    [32, 1],
    [36, 2],
    [44, 0],
    [52, 0],
  ]) {
    const buf = createITSPBuffer();
    buf.writeUInt32LE(value!, offset!);
    throws(() => ITSPHeaderParser.parse(new BitReader(buf)));
  }
  const buf = createITSPBuffer();
  for (let length = 0; length < buf.length; length++)
    throws(() =>
      ITSPHeaderParser.parse(new BitReader(buf.subarray(0, length))),
    );
});

for (const version of [1, 2]) {
  test(`ControlData v${version}: DWORD length prefix and normalized byte units`, () => {
    const buf = createLZXCBuffer(version);
    const reader = new BitReader(Buffer.concat([buf, Buffer.from('tail')]));
    const header = LZXCHeaderParser.parse(reader);
    equal(header.signature, 'LZXC');
    equal(header.version, version);
    equal(header.windowSize, 0x10000);
    equal(header.resetInterval, 0x10000);
    equal(header.cacheSize, 1);
    equal(header.unknown, 0);
    equal(reader.position, buf.length);
    ok(LZXCHeaderParser.validate(header));
    ok(LZXCHeaderParser.getSummary(header).includes('LZXC'));
  });
}

test('ControlData: rejects missing/invalid length prefix, version, window and reset interval', () => {
  const buf = createLZXCBuffer();
  throws(() => LZXCHeaderParser.parse(new BitReader(buf.subarray(4))));
  for (const [offset, value] of [
    [0, 5],
    [0, 7],
    [4, 0],
    [8, 3],
    [12, 0],
    [16, 0],
    [16, 3],
    [16, 0x8000],
  ]) {
    const bad = Buffer.from(buf);
    bad.writeUInt32LE(value!, offset!);
    throws(() => LZXCHeaderParser.parse(new BitReader(bad)));
  }
  const v1 = createLZXCBuffer(1);
  v1.writeUInt32LE(0x8001, 12);
  throws(() => LZXCHeaderParser.parse(new BitReader(v1)));
  for (let length = 0; length < buf.length; length++)
    throws(() =>
      LZXCHeaderParser.parse(new BitReader(buf.subarray(0, length))),
    );
});

test('ControlData: valid LZX windows are 32KB through 2MB only', () => {
  equal(
    LZXCHeaderParser.getSupportedWindowSizes(),
    [0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000],
  );
  equal(LZXCHeaderParser.getWindowSizeString(0x8000), '32KB');
  equal(LZXCHeaderParser.getWindowSizeString(0x100000), '1MB');
  equal(LZXCHeaderParser.getWindowSizeString(512), '512B');
});

test('Headers: sequential reads consume exact lengths and reject bit-misalignment', () => {
  const reader = new BitReader(
    Buffer.concat([createITSFBuffer(), createITSPBuffer(), createLZXCBuffer()]),
  );
  equal(ITSFHeaderParser.parse(reader).signature, 'ITSF');
  equal(ITSPHeaderParser.parse(reader).signature, 'ITSP');
  equal(LZXCHeaderParser.parse(reader).signature, 'LZXC');
  equal(reader.position, reader.buffer.length);
  for (const [parser, data] of [
    [ITSFHeaderParser, createITSFBuffer()],
    [ITSPHeaderParser, createITSPBuffer()],
    [LZXCHeaderParser, createLZXCBuffer()],
  ] as const) {
    const bad = new BitReader(data);
    bad.bitPosition = 1;
    throws(() => parser.parse(bad), /alignment/);
  }
});

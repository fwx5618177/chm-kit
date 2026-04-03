import { test } from 'uvu';
import { equal, ok } from 'uvu/assert';
import { ITSFHeaderParser } from '../../src/core/headers/itsf-header';
import { ITSPHeaderParser } from '../../src/core/headers/itsp-header';
import { LZXCHeaderParser } from '../../src/core/headers/lzxc-header';
import { BitReader } from '../../src/utils/io/bit-reader';
import type { ITSFHeader, ITSPHeader, LZXCHeader } from '../../src/core/types';

// Helper to create a minimal ITSF header buffer
function createITSFBuffer(): Buffer {
  const buf = Buffer.alloc(96);
  buf.write('ITSF', 0, 4, 'ascii');
  buf.writeUInt32LE(3, 4); // version
  buf.writeUInt32LE(96, 8); // headerLength
  buf.writeUInt32LE(0, 12); // unknown1
  buf.writeUInt32LE(Math.floor(Date.now() / 1000), 16); // timestamp
  buf.writeUInt32LE(0x409, 20); // languageId
  buf.writeUInt32LE(0, 24); // unknown2
  buf.writeUInt32LE(0, 28); // unknown3
  buf.writeUInt32LE(220, 32); // directoryOffset
  buf.writeUInt32LE(4096, 36); // directoryLength
  buf.writeUInt32LE(0, 40); // unknown4
  return buf;
}

// Helper to create a minimal ITSP header buffer
function createITSPBuffer(): Buffer {
  const buf = Buffer.alloc(84);
  buf.write('ITSP', 0, 4, 'ascii');
  buf.writeUInt32LE(1, 4); // version
  buf.writeUInt32LE(84, 8); // headerLength
  buf.writeUInt32LE(0, 12); // unknown1
  buf.writeUInt32LE(4096, 16); // chunkSize
  buf.writeUInt32LE(2, 20); // density
  buf.writeUInt32LE(2, 24); // depth
  buf.writeUInt32LE(0, 28); // rootIndex
  buf.writeUInt32LE(0, 32); // firstPMGI
  buf.writeUInt32LE(0, 36); // lastPMGI
  buf.writeUInt32LE(0, 40); // unknown2
  return buf;
}

// Helper to create a minimal LZXC header buffer
function createLZXCBuffer(): Buffer {
  const buf = Buffer.alloc(40);
  buf.write('LZXC', 0, 4, 'ascii');
  buf.writeUInt32LE(2, 4); // version
  buf.writeUInt32LE(0x8000, 8); // resetInterval
  buf.writeUInt32LE(0x8000, 12); // windowSize
  buf.writeUInt32LE(0, 16); // cacheSize
  buf.writeUInt32LE(0, 20); // unknown
  return buf;
}

test('ITSFHeaderParser should parse valid ITSF header', () => {
  const buf = createITSFBuffer();
  const reader = new BitReader(buf);
  const header = ITSFHeaderParser.parse(reader);
  equal(header.signature, 'ITSF');
  equal(header.version, 3);
  equal(header.headerLength, 96);
  equal(header.languageId, 0x409);
  equal(header.directoryOffset, 220);
  equal(header.directoryLength, 4096);
});

test('ITSFHeaderParser should validate correct header', () => {
  const header: ITSFHeader = {
    signature: 'ITSF',
    version: 3,
    headerLength: 96,
    unknown1: 0,
    timestamp: 0,
    languageId: 0x409,
    unknown2: 0,
    unknown3: 0,
    directoryOffset: 220,
    directoryLength: 4096,
    unknown4: 0,
  };
  ok(ITSFHeaderParser.validate(header));
});

test('ITSFHeaderParser should reject invalid signature', () => {
  const header: ITSFHeader = {
    signature: 'XXXX',
    version: 3,
    headerLength: 96,
    unknown1: 0,
    timestamp: 0,
    languageId: 0x409,
    unknown2: 0,
    unknown3: 0,
    directoryOffset: 220,
    directoryLength: 4096,
    unknown4: 0,
  };
  ok(!ITSFHeaderParser.validate(header));
});

test('ITSFHeaderParser.getSummary should return string', () => {
  const header: ITSFHeader = {
    signature: 'ITSF',
    version: 3,
    headerLength: 96,
    unknown1: 0,
    timestamp: 1000000,
    languageId: 0x409,
    unknown2: 0,
    unknown3: 0,
    directoryOffset: 220,
    directoryLength: 4096,
    unknown4: 0,
  };
  const summary = ITSFHeaderParser.getSummary(header);
  ok(summary.length > 0);
  ok(summary.includes('ITSF'));
});

test('ITSPHeaderParser should parse valid ITSP header', () => {
  const buf = createITSPBuffer();
  const reader = new BitReader(buf);
  const header = ITSPHeaderParser.parse(reader);
  equal(header.signature, 'ITSP');
  equal(header.version, 1);
  equal(header.chunkSize, 4096);
  equal(header.density, 2);
  equal(header.depth, 2);
});

test('ITSPHeaderParser should validate correct header', () => {
  const header: ITSPHeader = {
    signature: 'ITSP',
    version: 1,
    headerLength: 84,
    unknown1: 0,
    chunkSize: 4096,
    density: 2,
    depth: 2,
    rootIndex: 0,
    firstPMGI: 0,
    lastPMGI: 0,
    unknown2: 0,
  };
  ok(ITSPHeaderParser.validate(header));
});

test('LZXCHeaderParser should parse valid LZXC header', () => {
  const buf = createLZXCBuffer();
  const reader = new BitReader(buf);
  const header = LZXCHeaderParser.parse(reader);
  equal(header.signature, 'LZXC');
  equal(header.version, 2);
  equal(header.windowSize, 0x8000);
  equal(header.resetInterval, 0x8000);
});

test('LZXCHeaderParser should validate correct header', () => {
  const header: LZXCHeader = {
    signature: 'LZXC',
    version: 2,
    resetInterval: 0x8000,
    windowSize: 0x8000,
    cacheSize: 0,
    unknown: 0,
  };
  ok(LZXCHeaderParser.validate(header));
});

test('LZXCHeaderParser.getSummary should return formatted string', () => {
  const header: LZXCHeader = {
    signature: 'LZXC',
    version: 2,
    resetInterval: 0x8000,
    windowSize: 0x8000,
    cacheSize: 0,
    unknown: 0,
  };
  const summary = LZXCHeaderParser.getSummary(header);
  ok(summary.length > 0);
  ok(summary.includes('LZXC'));
});

test('Headers should parse from combined buffer', () => {
  // Simulate reading all three headers sequentially
  const combined = Buffer.concat([
    createITSFBuffer(),
    createITSPBuffer(),
    createLZXCBuffer(),
  ]);
  const reader = new BitReader(combined);

  const itsf = ITSFHeaderParser.parse(reader);
  equal(itsf.signature, 'ITSF');

  const itsp = ITSPHeaderParser.parse(reader);
  equal(itsp.signature, 'ITSP');

  const lzxc = LZXCHeaderParser.parse(reader);
  equal(lzxc.signature, 'LZXC');
});

test.run();

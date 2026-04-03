import { test } from 'uvu';
import { equal, ok } from 'uvu/assert';
import { CHMHeaderBuilder } from '../../src/encoder/builders/header-builder';

test('createITSFHeader should create valid header', () => {
  const header = CHMHeaderBuilder.createITSFHeader({
    directoryOffset: 220,
    directoryLength: 4096,
  });

  equal(header.signature, 'ITSF');
  equal(header.version, 3);
  equal(header.headerLength, 96);
  equal(header.directoryOffset, 220);
  equal(header.directoryLength, 4096);
  equal(header.languageId, 0x409);
});

test('createITSFHeader should accept custom options', () => {
  const header = CHMHeaderBuilder.createITSFHeader({
    directoryOffset: 300,
    directoryLength: 8192,
    languageId: 0x804,
  });

  equal(header.languageId, 0x804);
});

test('createITSPHeader should create valid header', () => {
  const header = CHMHeaderBuilder.createITSPHeader();

  equal(header.signature, 'ITSP');
  equal(header.version, 1);
  equal(header.headerLength, 84);
  equal(header.chunkSize, 4096);
});

test('createLZXCHeader should create valid header', () => {
  const header = CHMHeaderBuilder.createLZXCHeader({
    resetInterval: 0x10000,
    windowSize: 0x10000,
  });

  equal(header.signature, 'LZXC');
  equal(header.version, 2);
  equal(header.resetInterval, 0x10000);
  equal(header.windowSize, 0x10000);
});

test('serializeITSFHeader should produce 96-byte buffer', () => {
  const header = CHMHeaderBuilder.createITSFHeader({
    directoryOffset: 220,
    directoryLength: 4096,
  });
  const buf = CHMHeaderBuilder.serializeITSFHeader(header);

  equal(buf.length, 96);
  equal(buf.subarray(0, 4).toString('ascii'), 'ITSF');
  equal(buf.readUInt32LE(4), 3); // version
});

test('serializeITSPHeader should produce 84-byte buffer', () => {
  const header = CHMHeaderBuilder.createITSPHeader();
  const buf = CHMHeaderBuilder.serializeITSPHeader(header);

  equal(buf.length, 84);
  equal(buf.subarray(0, 4).toString('ascii'), 'ITSP');
});

test('serializeLZXCHeader should produce 40-byte buffer', () => {
  const header = CHMHeaderBuilder.createLZXCHeader();
  const buf = CHMHeaderBuilder.serializeLZXCHeader(header);

  equal(buf.length, 40);
  equal(buf.subarray(0, 4).toString('ascii'), 'LZXC');
});

test('calculateHeaderSize should sum all header sizes', () => {
  const size = CHMHeaderBuilder.calculateHeaderSize(100);
  equal(size, 96 + 84 + 40 + 100); // ITSF + ITSP + LZXC + resetTable
});

test('validateHeader should accept valid headers', () => {
  const itsf = CHMHeaderBuilder.createITSFHeader({
    directoryOffset: 220,
    directoryLength: 4096,
  });
  ok(CHMHeaderBuilder.validateHeader(itsf));

  const itsp = CHMHeaderBuilder.createITSPHeader();
  ok(CHMHeaderBuilder.validateHeader(itsp));

  const lzxc = CHMHeaderBuilder.createLZXCHeader();
  ok(CHMHeaderBuilder.validateHeader(lzxc));
});

test('serializeDirectory should serialize entries', () => {
  const entries = [
    {
      name: 'test.html',
      isCompressed: true,
      offset: 0,
      length: 100,
      section: 1,
    },
  ];
  const buf = CHMHeaderBuilder.serializeDirectory(entries);
  ok(buf.length > 0);
});

test('serialized headers should round-trip', () => {
  const original = CHMHeaderBuilder.createITSFHeader({
    directoryOffset: 500,
    directoryLength: 2048,
  });
  const buf = CHMHeaderBuilder.serializeITSFHeader(original);

  // Read back
  equal(buf.subarray(0, 4).toString('ascii'), 'ITSF');
  equal(buf.readUInt32LE(4), 3);
  equal(buf.readUInt32LE(32), 500); // directoryOffset
  equal(buf.readUInt32LE(36), 2048); // directoryLength
});

test.run();

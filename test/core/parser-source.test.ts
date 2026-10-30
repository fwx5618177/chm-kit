import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { CHMParserFactory } from '../../src/core/parser/parser-factory';
import {
  MemoryByteSource,
  requireSourceRange,
  type ByteSource,
} from '../../src/core/files/byte-source';
import { BitReader } from '../../src/utils/io/bit-reader';
import { packFiles } from '../../src/encoder/archive-builder';
import { FileReconstructor } from '../../src/core/files/file-reconstructor';

const VIRTUAL_SIZE = 5 * 1024 * 1024 * 1024;
const STORAGE = '::DataSpace/Storage/MSCompressed/';
const CONTROL = `${STORAGE}ControlData`;
const CONTENT = `${STORAGE}Content`;
const RESET = `${STORAGE}Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable`;

type VirtualOptions = {
  size?: number;
  headerLength?: number;
  directoryLength?: number;
  directoryOffset?: number;
  base?: number;
  compressed?: boolean;
  controlLength?: number;
  resetLength?: number;
  contentLength?: number;
  rawOffset?: number;
  rawLength?: number;
  allowPayload?: boolean;
};

function enc(value: number): Buffer {
  let rest = BigInt(value);
  const bytes = [Number(rest & 127n)];
  while ((rest >>= 7n) > 0) bytes.unshift(Number(rest & 127n) | 128);
  return Buffer.from(bytes);
}

/** Independent tiny metadata backing a huge virtual input; never allocate its declared sizes. */
function virtualArchive(options: VirtualOptions = {}) {
  const size = options.size ?? VIRTUAL_SIZE;
  const base = options.base ?? 8192;
  const directoryOffset = options.directoryOffset ?? 128;
  const directory = Buffer.alloc(84 + 4096);
  const header = Buffer.alloc(96);
  header.write('ITSF');
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(options.headerLength ?? header.length, 8);
  Buffer.from(
    '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec',
    'hex',
  ).copy(header, 24);
  header.writeBigUInt64LE(96n, 56);
  header.writeBigUInt64LE(24n, 64);
  header.writeBigUInt64LE(BigInt(directoryOffset), 72);
  header.writeBigUInt64LE(
    BigInt(options.directoryLength ?? directory.length),
    80,
  );
  header.writeBigUInt64LE(BigInt(base), 88);
  directory.write('ITSP');
  directory.writeUInt32LE(1, 4);
  directory.writeUInt32LE(84, 8);
  directory.writeUInt32LE(10, 12);
  directory.writeUInt32LE(4096, 16);
  directory.writeUInt32LE(2, 20);
  directory.writeUInt32LE(1, 24);
  directory.writeInt32LE(-1, 28);
  directory.writeUInt32LE(0xffffffff, 40);
  directory.writeUInt32LE(1, 44);
  Buffer.from('6a92025d2e21d0119df900a0c922e6ec', 'hex').copy(directory, 52);
  const control = Buffer.from(
    '060000004c5a58430200000002000000020000000100000000000000',
    'hex',
  );
  const contentLength = options.contentLength ?? 20 * 1024 * 1024;
  const reset = Buffer.alloc(48);
  reset.writeUInt32LE(2, 0);
  reset.writeUInt32LE(1, 4);
  reset.writeUInt32LE(8, 8);
  reset.writeUInt32LE(40, 12);
  reset.writeBigUInt64LE(32768n, 16);
  reset.writeBigUInt64LE(BigInt(contentLength), 24);
  reset.writeBigUInt64LE(32768n, 32);
  const entries = options.compressed
    ? [
        { name: CONTENT, offset: 256, length: contentLength },
        {
          name: CONTROL,
          offset: 0,
          length: options.controlLength ?? control.length,
        },
        {
          name: RESET,
          offset: 64,
          length: options.resetLength ?? reset.length,
        },
      ]
    : [
        {
          name: '/large.bin',
          offset: options.rawOffset ?? 0,
          length: options.rawLength ?? size - base,
        },
      ];
  entries.sort((a, b) =>
    a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1,
  );
  const leaf = directory.subarray(84);
  leaf.write('PMGL');
  leaf.writeInt32LE(-1, 12);
  leaf.writeInt32LE(-1, 16);
  let position = 20;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const record = Buffer.concat([
      enc(name.length),
      name,
      enc(0),
      enc(entry.offset),
      enc(entry.length),
    ]);
    record.copy(leaf, position);
    position += record.length;
  }
  leaf.writeUInt32LE(leaf.length - position, 4);
  leaf.writeUInt16LE(entries.length, leaf.length - 2);
  const reads: Array<{ offset: number; length: number }> = [];
  const source: ByteSource = {
    size,
    read(offset, length) {
      reads.push({ offset, length });
      requireSourceRange(source, offset, length, 'virtual test input');
      assert.ok(
        length <= directory.length,
        `unexpected large source read: ${length}`,
      );
      if (offset === 0 && (length === 12 || length === header.length))
        return header.subarray(0, length);
      if (offset === directoryOffset && length === directory.length)
        return directory;
      if (options.compressed && offset === base && length === control.length)
        return control;
      if (options.compressed && offset === base + 64 && length === reset.length)
        return reset;
      assert.ok(
        options.allowPayload && length <= 32,
        `unexpected payload read at ${offset}`,
      );
      return Buffer.alloc(length, offset % 256);
    },
  };
  return {
    source,
    reads,
    header,
    directory,
    base,
    directoryOffset,
    control,
    reset,
  };
}

for (const headerLength of [CHMParser.MAX_HEADER_BYTES + 1, 0xffffffff]) {
  test(`ITSF metadata budget rejects ${headerLength} declared bytes before a large source read`, () => {
    const built = virtualArchive({ headerLength });
    assert.throws(() => new CHMParser().parseSource(built.source), {
      name: 'RangeError',
      message: /ITSF header: metadata budget exceeded/,
    });
    assert.deepEqual(built.reads, [{ offset: 0, length: 12 }]);
  });
}

for (const directoryLength of [
  CHMParser.MAX_DIRECTORY_BYTES + 1,
  VIRTUAL_SIZE - 128,
]) {
  test(`directory budget rejects ${directoryLength} declared bytes without fetching the directory/payload`, () => {
    const built = virtualArchive({ directoryLength });
    assert.throws(() => new CHMParser().parseSource(built.source), {
      name: 'RangeError',
      message: /ITSF directory: metadata budget exceeded/,
    });
    assert.deepEqual(built.reads, [
      { offset: 0, length: 12 },
      { offset: 0, length: 96 },
    ]);
  });
}

for (const stream of ['controlLength', 'resetLength'] as const) {
  test(`${stream} is bounded before reading its declared data, independently of total input size`, () => {
    const built = virtualArchive({
      compressed: true,
      [stream]: CHMParser.MAX_METADATA_STREAM_BYTES + 1,
    });
    assert.throws(() => new CHMParser().parseSource(built.source), {
      name: 'RangeError',
      message: new RegExp(
        `${stream === 'controlLength' ? 'ControlData' : 'ResetTable'}: metadata budget exceeded`,
      ),
    });
    const expected = [
      { offset: 0, length: 12 },
      { offset: 0, length: 96 },
      { offset: built.directoryOffset, length: built.directory.length },
    ];
    if (stream === 'resetLength')
      expected.push({ offset: built.base, length: built.control.length });
    assert.deepEqual(built.reads, expected);
  });
}

test('large compressed Content is only range-validated, never subject to the 16-MiB metadata stream budget', () => {
  const built = virtualArchive({ compressed: true });
  const parsed = new CHMParser().parseSource(built.source);
  assert.ok(
    parsed.resetTable.compressedLength > CHMParser.MAX_METADATA_STREAM_BYTES,
  );
  assert.equal(parsed.contentOffset, built.base + 256);
  assert.deepEqual(built.reads, [
    { offset: 0, length: 12 },
    { offset: 0, length: 96 },
    { offset: built.directoryOffset, length: built.directory.length },
    { offset: built.base, length: built.control.length },
    { offset: built.base + 64, length: built.reset.length },
  ]);
});

test('5-GiB section-0 input still supports small random ranges beyond 4 GiB', () => {
  const built = virtualArchive({ allowPayload: true });
  const parsed = new CHMParser().parseSource(built.source);
  const start = 4 * 1024 * 1024 * 1024 + 7;
  const end = start + 16;
  const output = new FileReconstructor(parsed, {
    maxCacheBytes: 0,
    maxOutputBytes: 32,
  }).reconstructRange('/large.bin', built.source, start, end);
  assert.deepEqual(output, Buffer.alloc(16, (built.base + start) % 256));
  assert.deepEqual(built.reads, [
    { offset: 0, length: 12 },
    { offset: 0, length: 96 },
    { offset: built.directoryOffset, length: built.directory.length },
    { offset: built.base + start, length: 16 },
  ]);
});

test('explicit v3 base zero and a directory ending at EOF remain legal under metadata budgets', () => {
  const built = virtualArchive({
    base: 0,
    rawOffset: 96,
    rawLength: 3,
    directoryOffset: VIRTUAL_SIZE - (84 + 4096),
    allowPayload: true,
  });
  const parsed = new CHMParser().parseSource(built.source);
  assert.equal(parsed.header.itsf.unknown4, 0);
  assert.equal(parsed.contentOffset, 0);
  assert.deepEqual(
    new FileReconstructor(parsed).reconstructRange('/large.bin', built.source),
    Buffer.alloc(3, 96),
  );
});

test('invalid source sizes and unsafe/EOF ranges fail before reads, not as allocation-budget errors', () => {
  for (const size of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const reads: number[] = [];
    assert.throws(
      () =>
        new CHMParser().parseSource({
          size,
          read(offset) {
            reads.push(offset);
            throw new Error('must not read invalid input');
          },
        }),
      /truncated or out of bounds/,
    );
    assert.deepEqual(reads, []);
  }
  const overflow = virtualArchive({
    directoryOffset: Number.MAX_SAFE_INTEGER - 100,
  });
  assert.throws(
    () => new CHMParser().parseSource(overflow.source),
    /invalid range/,
  );
  assert.deepEqual(overflow.reads, [
    { offset: 0, length: 12 },
    { offset: 0, length: 96 },
  ]);
  const entryOverflow = virtualArchive({
    size: Number.MAX_SAFE_INTEGER,
    rawOffset: Number.MAX_SAFE_INTEGER - 1,
    rawLength: 0,
  });
  assert.throws(
    () => new CHMParser().parseSource(entryOverflow.source),
    /invalid or unsafe range/,
  );
  assert.equal(entryOverflow.reads.length, 3);
  const truncated = virtualArchive({ directoryOffset: VIRTUAL_SIZE - 100 });
  assert.throws(
    () => new CHMParser().parseSource(truncated.source),
    /truncated or out of bounds/,
  );
  assert.equal(truncated.reads.length, 2);
});

for (const compression of [false, true]) {
  test(`ByteSource parsing is identical and never reads Content/user payload (compression=${compression})`, () => {
    const packed = packFiles(
      new Map([['large.bin', Buffer.alloc(256 * 1024, 97)]]),
      { compression },
    );
    const memory = new MemoryByteSource(packed);
    const reads: Array<{ offset: number; length: number }> = [];
    const source: ByteSource = {
      size: memory.size,
      read(offset, length) {
        reads.push({ offset, length });
        return memory.read(offset, length);
      },
    };
    const expected = new CHMParser().parse(new BitReader(packed));
    assert.deepEqual(new CHMParser().parseSource(source), expected);
    const allowed = [
      { offset: 0, length: 12 },
      { offset: 0, length: expected.header.itsf.headerLength },
      {
        offset: expected.header.itsf.directoryOffset,
        length: expected.header.itsf.directoryLength,
      },
    ];
    if (compression)
      for (const entry of expected.directory.entries.values())
        if (/ControlData$|ResetTable$/.test(entry.name))
          allowed.push({
            offset: expected.header.itsf.unknown4 + entry.offset,
            length: entry.length,
          });
    assert.deepEqual(reads, allowed);
    assert.deepEqual(
      CHMParserFactory.createWithOptions({
        strictValidation: true,
      }).parseSource(source),
      expected,
    );
    const truncated = { ...source, size: packed.length - 1 };
    assert.throws(
      () => new CHMParser().parseSource(truncated),
      /out of bounds/,
    );
  });
}

test('source sizes/ranges are validated independently of buffer availability', () => {
  const memory = new MemoryByteSource(Buffer.from('abc'));
  assert.deepEqual(memory.read(3, 0), Buffer.alloc(0));
  for (const [offset, length] of [
    [-1, 0],
    [1, -1],
    [1.5, 1],
    [0, NaN],
    [Number.MAX_SAFE_INTEGER, 1],
    [3, 1],
  ])
    assert.throws(() => memory.read(offset, length));
  const packed = packFiles(new Map(), { compression: false });
  const source = new MemoryByteSource(packed);
  for (const size of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      new CHMParser().parseSource({ size, read: source.read.bind(source) }),
    );
});

import { test } from 'vitest';
import { deepStrictEqual as equal, ok, throws } from 'node:assert/strict';
import { DirectoryParser } from '../../src/core/directory/directory-parser';
import { BitReader } from '../../src/utils/io/bit-reader';
import type {
  CHMDirectory,
  ITSPHeader,
  DirectoryEntry,
} from '../../src/core/types';

function enc(value: number | bigint): Buffer {
  let remaining = BigInt(value);
  const bytes = [Number(remaining & 127n)];
  while ((remaining >>= 7n) > 0) bytes.unshift(Number(remaining & 127n) | 128);
  return Buffer.from(bytes);
}

function entry(
  name: string | Buffer,
  section = 0,
  offset: number | bigint = 100,
  length = 50,
): Buffer {
  const bytes = typeof name === 'string' ? Buffer.from(name) : name;
  return Buffer.concat([
    enc(bytes.length),
    bytes,
    enc(section),
    enc(offset),
    enc(length),
  ]);
}

function chunk(
  records: Buffer[],
  leaf = true,
  previous = -1,
  next = -1,
  density = 2,
): Buffer {
  const result = Buffer.alloc(512, 0xee);
  result.write(leaf ? 'PMGL' : 'PMGI');
  const header = leaf ? 20 : 8;
  if (leaf) {
    result.writeUInt32LE(0, 8);
    result.writeInt32LE(previous, 12);
    result.writeInt32LE(next, 16);
  }
  let offset = header;
  for (let i = 0; i < records.length; i++) {
    if (i > 0 && i % (1 + 2 ** density) === 0)
      result.writeUInt16LE(
        offset - header,
        result.length - 2 - (i / (1 + 2 ** density)) * 2,
      );
    records[i]!.copy(result, offset);
    offset += records[i]!.length;
  }
  result.writeUInt32LE(result.length - offset, 4);
  result.writeUInt16LE(records.length, result.length - 2);
  return result;
}

function header(overrides: Partial<ITSPHeader> = {}): ITSPHeader {
  return {
    signature: 'ITSP',
    version: 1,
    headerLength: 84,
    unknown1: 10,
    chunkSize: 512,
    density: 2,
    depth: 1,
    rootIndex: -1,
    firstPMGI: 0,
    lastPMGI: 0,
    unknown2: 0xffffffff,
    ...overrides,
  };
}

function parse(
  chunks: Buffer[],
  overrides: Partial<ITSPHeader> = {},
): CHMDirectory {
  return DirectoryParser.parse(
    new BitReader(Buffer.concat(chunks)),
    header(overrides),
    chunks.length,
  );
}

function sampleEntry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    name: '/index.html',
    isCompressed: false,
    offset: 0,
    length: 100,
    section: 0,
    ...overrides,
  };
}

test('DirectoryParser: actually parses PMGL ENCINT entries, UTF-8 names and empty files', () => {
  const directory = parse([
    chunk([
      entry('a', 0, 100, 50),
      entry('/中文.html', 1, 0x100000123, 1234),
      entry('/empty', 0, 0, 0),
    ]),
  ]);
  equal(directory.entries.get('a'), {
    name: 'a',
    isCompressed: false,
    offset: 100,
    length: 50,
    section: 0,
  });
  equal(directory.entries.get('/中文.html'), {
    name: '/中文.html',
    isCompressed: true,
    offset: 0x100000123,
    length: 1234,
    uncompressedLength: 1234,
    section: 1,
  });
  equal(directory.entries.get('/empty')!.length, 0);
  ok(DirectoryParser.validate(directory));
});

test('DirectoryParser: empty PMGL is a valid empty archive, not a malformed entry', () => {
  const directory = parse([chunk([])]);
  equal(directory.entries.size, 0);
  ok(DirectoryParser.validate(directory));
});

test('DirectoryParser: multiple PMGL chunks and a real PMGI index are parsed', () => {
  const first = chunk([entry('/a')], true, -1, 1);
  const second = chunk([entry('/b', 1)], true, 0, -1);
  const index = chunk(
    [
      Buffer.concat([enc(2), Buffer.from('/a'), enc(0)]),
      Buffer.concat([enc(2), Buffer.from('/b'), enc(1)]),
    ],
    false,
  );
  const directory = parse([first, second, index], {
    lastPMGI: 1,
    depth: 2,
    rootIndex: 2,
  });
  equal(Array.from(directory.entries.keys()), ['/a', '/b']);
  ok(DirectoryParser.validate(directory));
  equal(parse([first, second], { lastPMGI: 1 }).entries.size, 2);
});

test('DirectoryParser: quickrefs and free-space junk are never interpreted as records', () => {
  const records = Array.from({ length: 7 }, (_, i) => entry(`/file${i}`));
  const data = chunk(records, true, -1, -1, 0);
  equal(parse([data], { density: 0 }).entries.size, 7);
  data.writeUInt16LE(0xffff, data.length - 4);
  throws(() => parse([data], { density: 0 }), /quickref/);
});

test('DirectoryParser: duplicate names, including case collisions across PMGLs, fail', () => {
  throws(() => parse([chunk([entry('/same'), entry('/same')])]), /重复/);
  throws(
    () =>
      parse(
        [
          chunk([entry('/SAME')], true, -1, 1),
          chunk([entry('/same')], true, 0),
        ],
        { lastPMGI: 1 },
      ),
    /重复/,
  );
});

test('DirectoryParser: rejects invalid section, empty/NUL/invalid UTF-8 names', () => {
  for (const record of [
    entry('/bad', 2),
    entry(''),
    entry('bad\0name'),
    entry(Buffer.from([0xc0, 0xaf])),
    entry(Buffer.from([0xff])),
  ]) {
    throws(() => parse([chunk([record])]));
  }
});

test('DirectoryParser: ENCINT supports MAX_SAFE_INTEGER and rejects numeric/range overflow', () => {
  const valid = parse([
    chunk([entry('/large', 0, Number.MAX_SAFE_INTEGER, 0)]),
  ]);
  equal(valid.entries.get('/large')!.offset, Number.MAX_SAFE_INTEGER);
  for (const record of [
    entry('/overflow', 0, 0x20000000000000n),
    entry('/sum-overflow', 0, Number.MAX_SAFE_INTEGER, 1),
    Buffer.from([0x80, 0x01, 0x61, 0, 0, 0]),
    Buffer.alloc(9, 0x81),
  ])
    throws(() => parse([chunk([record])]), /ENCINT|range/);
});

test('DirectoryParser: fields cannot extend into free space or into the next chunk', () => {
  for (const record of [
    Buffer.from([0x80]),
    Buffer.from([30, 0x61]),
    Buffer.from([1, 0x61]),
    Buffer.from([1, 0x61, 0]),
    Buffer.from([1, 0x61, 0, 0]),
    Buffer.from([1, 0x61, 0, 0, 0x80]),
  ]) {
    throws(() => parse([chunk([record])]));
  }
  const first = chunk([entry('/good')], true, -1, 1);
  const bad = chunk([Buffer.from([0x81])], true, 0);
  throws(() => parse([first, bad], { lastPMGI: 1 }), /boundary/);
});

test('DirectoryParser: rejects invalid free-space bounds, entry counts, signatures and EOF', () => {
  for (const freeSpace of [0, 1, 493, 0xffffffff]) {
    const data = chunk([entry('/a')]);
    data.writeUInt32LE(freeSpace, 4);
    throws(() => parse([data]));
  }
  for (const count of [0, 2, 0xffff]) {
    const data = chunk([entry('/a')]);
    data.writeUInt16LE(count, data.length - 2);
    throws(() => parse([data]));
  }
  const data = chunk([entry('/a')]);
  data.write('NOPE');
  throws(() => parse([data]), /签名/);
  throws(
    () => DirectoryParser.parse(new BitReader(Buffer.alloc(0)), header(), 1),
    /bounds/,
  );
  throws(
    () =>
      DirectoryParser.parse(
        new BitReader(chunk([]).subarray(0, 511)),
        header(),
        1,
      ),
    /bounds/,
  );
  for (const count of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER])
    throws(() =>
      DirectoryParser.parse(new BitReader(chunk([])), header(), count),
    );
});

test('DirectoryParser: validates PMGL links instead of silently omitting leaves', () => {
  for (const data of [
    chunk([entry('/a')], true, 0),
    chunk([entry('/a')], true, -1, 0),
    chunk([entry('/a')], true, -1, 9),
    chunk([entry('/a')], true, -1, -2),
  ])
    throws(() => parse([data]), /chain/);
  throws(
    () => parse([chunk([entry('/a')]), chunk([entry('/b')])], { lastPMGI: 1 }),
    /unlinked/,
  );
  throws(() => parse([chunk([])], { firstPMGI: 1, lastPMGI: 1 }));
});

test('DirectoryParser: malformed PMGI fields, children, duplicates and cycles fail', () => {
  const leaf = chunk([entry('/a')]);
  const indexRecord = (name: string, child: number) =>
    Buffer.concat([
      enc(Buffer.byteLength(name)),
      Buffer.from(name),
      enc(child),
    ]);
  for (const records of [
    [],
    [Buffer.from([0x80])],
    [indexRecord('/a', 2)],
    [indexRecord('/a', 1)],
    [indexRecord('/a', 0), indexRecord('/a', 0)],
  ]) {
    throws(() =>
      parse([leaf, chunk(records, false)], { rootIndex: 1, depth: 2 }),
    );
  }
  const index1 = chunk([indexRecord('/a', 2)], false);
  const index2 = chunk([indexRecord('/a', 1)], false);
  throws(
    () => parse([leaf, index1, index2], { rootIndex: 1, depth: 3 }),
    /cycle|depth/,
  );
  throws(
    () =>
      parse([leaf, chunk([indexRecord('/a', 0)], false)], { rootIndex: -1 }),
    /root/,
  );
});

test('DirectoryParser.validate: checks every entry, not just one valid item', () => {
  const good = sampleEntry();
  ok(
    DirectoryParser.validate({
      entries: new Map([[good.name, good]]),
      rootPath: '/',
    }),
  );
  for (const overrides of [
    { offset: -1 },
    { length: -1 },
    { length: Infinity },
    { offset: 0.1 },
    { section: 2 },
    { isCompressed: true },
    { uncompressedLength: 101 },
    { offset: Number.MAX_SAFE_INTEGER, length: 1 },
  ]) {
    const bad = sampleEntry({ ...overrides, name: '/bad' });
    ok(
      !DirectoryParser.validate({
        entries: new Map([
          [good.name, good],
          [bad.name, bad],
        ]),
        rootPath: '/',
      }),
    );
  }
  ok(
    !DirectoryParser.validate({
      entries: new Map([['wrong-key', good]]),
      rootPath: '/',
    }),
  );
});

test('DirectoryParser.getSummary: file counts and byte/KB/MB sizes', () => {
  const directory = parse([
    chunk([
      entry('/index.html', 1, 0, 5000),
      entry('/style.css', 0, 5000, 2000),
    ]),
  ]);
  const summary = DirectoryParser.getSummary(directory);
  ok(summary.includes('总文件数: 2'));
  ok(summary.includes('压缩文件数: 1'));
  ok(summary.includes('未压缩文件数: 1'));
  ok(summary.includes('KB'));
  ok(
    DirectoryParser.getSummary(
      parse([chunk([entry('/large', 0, 0, 2 * 1024 * 1024)])]),
    ).includes('2.00 MB'),
  );
  ok(DirectoryParser.getSummary(parse([chunk([])])).includes('0 字节'));
});

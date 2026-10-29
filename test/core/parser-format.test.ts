import { test } from 'vitest';
import { deepStrictEqual as equal, ok, throws } from 'node:assert/strict';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { BitReader } from '../../src/utils/io/bit-reader';

const STORAGE = '::DataSpace/Storage/MSCompressed/';
const CONTENT = `${STORAGE}Content`;
const CONTROL = `${STORAGE}ControlData`;
const RESET = `${STORAGE}Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable`;
type Entry = { name: string; section: number; offset: number; length: number };
type Options = {
  version?: number;
  compressed?: boolean;
  split?: boolean;
  control?: Buffer;
  reset?: Buffer;
  omit?: string[];
  modify?: (entries: Entry[]) => Entry[];
};

function enc(value: number): Buffer {
  let rest = BigInt(value);
  const bytes = [Number(rest & 127n)];
  while ((rest >>= 7n) > 0) bytes.unshift(Number(rest & 127n) | 128);
  return Buffer.from(bytes);
}

function pmgl(entries: Entry[], previous = -1, next = -1): Buffer {
  const result = Buffer.alloc(512, 0xee);
  result.write('PMGL');
  result.writeUInt32LE(0, 8);
  result.writeInt32LE(previous, 12);
  result.writeInt32LE(next, 16);
  let offset = 20;
  entries.forEach((entry, i) => {
    if (i > 0 && i % 5 === 0)
      result.writeUInt16LE(offset - 20, 510 - (i / 5) * 2);
    const name = Buffer.from(entry.name);
    const record = Buffer.concat([
      enc(name.length),
      name,
      enc(entry.section),
      enc(entry.offset),
      enc(entry.length),
    ]);
    record.copy(result, offset);
    offset += record.length;
  });
  result.writeUInt32LE(512 - offset, 4);
  result.writeUInt16LE(entries.length, 510);
  return result;
}

// A real-format hand-built CHM: auxiliary HS0, ITSP, PMGL(s), optional
// directory/data gap, section-0 ControlData + ResetTable + compressed Content.
// The Content bytes are opaque here: these are format-parser, not LZX tests.
function fixture(options: Options = {}) {
  const version = options.version ?? 3;
  const compressed = options.compressed ?? true;
  const headerLength = version === 2 ? 88 : 96;
  const directoryOffset = 128;
  const control =
    options.control ??
    Buffer.from(
      '060000004c5a58430200000002000000020000000100000000000000',
      'hex',
    );
  const reset = options.reset ?? Buffer.alloc(56);
  if (!options.reset) {
    reset.writeUInt32LE(2, 0);
    reset.writeUInt32LE(2, 4);
    reset.writeUInt32LE(8, 8);
    reset.writeUInt32LE(40, 12);
    reset.writeBigUInt64LE(0x8003n, 16);
    reset.writeBigUInt64LE(37n, 24);
    reset.writeBigUInt64LE(0x8000n, 32);
    reset.writeBigUInt64LE(0n, 40);
    reset.writeBigUInt64LE(20n, 48);
  }
  let entries: Entry[] = compressed
    ? [
        { name: CONTROL, section: 0, offset: 0, length: control.length },
        { name: RESET, section: 0, offset: 32, length: reset.length },
        { name: CONTENT, section: 0, offset: 128, length: 37 },
        { name: '/index.html', section: 1, offset: 0, length: 12 },
        { name: '/empty', section: 0, offset: 165, length: 0 },
      ]
    : [
        { name: '/raw', section: 0, offset: 0, length: 3 },
        { name: '/empty', section: 0, offset: 3, length: 0 },
      ];
  entries = entries.filter(entry => !options.omit?.includes(entry.name));
  if (options.modify) entries = options.modify(entries);
  entries.sort((a, b) =>
    a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1,
  );
  const midpoint = Math.ceil(entries.length / 2);
  const chunks = options.split
    ? [
        pmgl(entries.slice(0, midpoint), -1, 1),
        pmgl(entries.slice(midpoint), 0),
      ]
    : [pmgl(entries)];
  const directoryLength = 84 + 512 * chunks.length;
  const directoryEnd = directoryOffset + directoryLength;
  const dataBase = directoryEnd + (version === 3 ? 37 : 0);
  const buffer = Buffer.alloc(dataBase + (compressed ? 165 : 3));
  buffer.write('ITSF');
  buffer.writeUInt32LE(version, 4);
  buffer.writeUInt32LE(headerLength, 8);
  buffer.writeUInt32LE(1, 12);
  buffer.writeUInt32LE(0x409, 20);
  Buffer.from(
    '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec',
    'hex',
  ).copy(buffer, 24);
  buffer.writeBigUInt64LE(BigInt(headerLength), 56);
  buffer.writeBigUInt64LE(24n, 64);
  buffer.writeBigUInt64LE(BigInt(directoryOffset), 72);
  buffer.writeBigUInt64LE(BigInt(directoryLength), 80);
  if (version === 3) buffer.writeBigUInt64LE(BigInt(dataBase), 88);
  buffer.writeUInt32LE(0x1fe, headerLength);
  buffer.writeBigUInt64LE(BigInt(buffer.length), headerLength + 8);
  const itsp = buffer.subarray(directoryOffset, directoryOffset + 84);
  itsp.write('ITSP');
  itsp.writeUInt32LE(1, 4);
  itsp.writeUInt32LE(84, 8);
  itsp.writeUInt32LE(10, 12);
  itsp.writeUInt32LE(512, 16);
  itsp.writeUInt32LE(2, 20);
  itsp.writeUInt32LE(1, 24);
  itsp.writeInt32LE(-1, 28);
  itsp.writeUInt32LE(0, 32);
  itsp.writeUInt32LE(chunks.length - 1, 36);
  itsp.writeUInt32LE(0xffffffff, 40);
  itsp.writeUInt32LE(chunks.length, 44);
  itsp.writeUInt32LE(0x409, 48);
  Buffer.from('6a92025d2e21d0119df900a0c922e6ec', 'hex').copy(itsp, 52);
  chunks.forEach((chunk, index) =>
    chunk.copy(buffer, directoryOffset + 84 + index * 512),
  );
  if (compressed) {
    control.copy(buffer, dataBase);
    reset.copy(buffer, dataBase + 32);
    buffer.fill(0x5a, dataBase + 128);
  } else buffer.write('raw', dataBase);
  return {
    buffer,
    dataBase,
    directoryOffset,
    directoryEnd,
    contentOffset: dataBase + (compressed ? 128 : 0),
  };
}

function parse(buffer: Buffer) {
  return new CHMParser().parse(new BitReader(buffer));
}

for (const version of [2, 3]) {
  for (const split of [false, true]) {
    test(`CHMParser: standard ITSF v${version}, ${split ? 'multiple' : 'single'} PMGL and Content-relative origin`, () => {
      const built = fixture({ version, split });
      const parsed = parse(built.buffer);
      equal(parsed.header.itsf.headerLength, version === 2 ? 0x58 : 0x60);
      equal(parsed.header.itsf.unknown2, version === 2 ? 88 : 96);
      equal(parsed.header.itsf.unknown4, version === 2 ? 0 : built.dataBase);
      equal(parsed.contentOffset, built.contentOffset);
      ok(parsed.contentOffset !== built.dataBase);
      equal(parsed.header.lzxc.windowSize, 0x10000);
      equal(parsed.header.lzxc.resetInterval, 0x10000);
      equal(parsed.directory.entries.size, 5);
      equal(parsed.directory.entries.get('/empty')!.length, 0);
      equal(
        parsed.directory.entries.get('/index.html')!.uncompressedLength,
        12,
      );
      equal(parsed.resetTable.compressedLength, 37);
      equal(parsed.resetTable.uncompressedLength, 0x8003);
      equal(
        parsed.resetTable.entries.map(entry => entry.compressedLength),
        [0, 20],
      );
      equal(
        parsed.resetTable.entries.map(entry => entry.uncompressedLength),
        [0x8000, 3],
      );
    });
  }
}

test('CHMParser.quickParse: same headers, directory and Content origin without resetTable', () => {
  const built = fixture({ split: true });
  const parser = new CHMParser();
  const parsed = parser.parse(new BitReader(built.buffer));
  const expected = {
    header: parsed.header,
    directory: parsed.directory,
    contentOffset: parsed.contentOffset,
  };
  equal(parser.quickParse(new BitReader(built.buffer)), expected);
  parser.reset();
  equal(parser.parse(new BitReader(built.buffer)), parsed);
});

for (const version of [2, 3]) {
  test(`CHMParser v${version}: pure section 0 needs no invented LZXC metadata`, () => {
    const built = fixture({ version, compressed: false });
    const parsed = parse(built.buffer);
    equal(parsed.directory.entries.size, 2);
    equal(parsed.contentOffset, built.dataBase);
    equal(parsed.header.lzxc, {
      signature: '',
      version: 0,
      resetInterval: 0,
      windowSize: 0,
      cacheSize: 0,
      unknown: 0,
    });
    equal(parsed.resetTable.entries, []);
    equal(
      built.buffer.subarray(built.dataBase, built.dataBase + 3).toString(),
      'raw',
    );
    equal(
      new CHMParser().quickParse(new BitReader(built.buffer)).contentOffset,
      built.dataBase,
    );
  });
}

test('CHMParser: a genuinely empty directory and zero-length section-0 file are valid', () => {
  const empty = fixture({ compressed: false, modify: () => [] });
  equal(parse(empty.buffer).directory.entries.size, 0);
  const zero = fixture({
    compressed: false,
    modify: () => [{ name: '/empty', section: 0, offset: 3, length: 0 }],
  });
  equal(parse(zero.buffer).directory.entries.get('/empty')!.length, 0);
  throws(() => parse(Buffer.alloc(0)));
});

test('CHMParser: every truncated archive prefix fails, never returns a partial directory', () => {
  for (const version of [2, 3]) {
    const built = fixture({ version, split: true });
    for (let length = 0; length < built.buffer.length; length++)
      throws(() => parse(built.buffer.subarray(0, length)));
  }
});

test('CHMParser: missing compressed metadata is an error, even with zero-length section-1 files', () => {
  for (const name of [CONTROL, CONTENT, RESET])
    throws(() => parse(fixture({ omit: [name] }).buffer), /元数据/);
  throws(
    () =>
      parse(
        fixture({
          compressed: false,
          modify: () => [{ name: '/empty', section: 1, offset: 0, length: 0 }],
        }).buffer,
      ),
    /元数据/,
  );
});

test('CHMParser: metadata must be section 0, unsupported sections are rejected', () => {
  for (const name of [CONTROL, CONTENT, RESET]) {
    const built = fixture({
      modify: entries =>
        entries.map(entry =>
          entry.name === name ? { ...entry, section: 1 } : entry,
        ),
    });
    throws(() => parse(built.buffer), /section 0/);
  }
  throws(
    () =>
      parse(
        fixture({
          compressed: false,
          modify: () => [{ name: '/bad', section: 2, offset: 0, length: 0 }],
        }).buffer,
      ),
    /节编号/,
  );
});

test('CHMParser: validates present ControlData instead of swallowing corruption', () => {
  const badSignature = fixture();
  badSignature.buffer.write('NOPE', badSignature.dataBase + 4);
  throws(() => parse(badSignature.buffer), /LZXC/);
  const badWindow = fixture();
  badWindow.buffer.writeUInt32LE(3, badWindow.dataBase + 16);
  throws(() => parse(badWindow.buffer), /LZXC/);
  const bounded = fixture({
    modify: entries =>
      entries.map(entry =>
        entry.name === CONTROL ? { ...entry, length: 24 } : entry,
      ),
  });
  throws(() => parse(bounded.buffer), /LZXC.*bounds/);
  throws(
    () => new CHMParser().quickParse(new BitReader(bounded.buffer)),
    /LZXC.*bounds/,
  );
});

test('CHMParser: corrupt or truncated ResetTable never becomes a default table', () => {
  for (const [offset, value] of [
    [0, 99],
    [8, 4],
    [12, 0],
    [32, 1],
    [48, 38],
  ]) {
    const built = fixture();
    built.buffer.writeUInt32LE(value!, built.dataBase + 32 + offset!);
    throws(() => parse(built.buffer));
  }
  const bounded = fixture({
    modify: entries =>
      entries.map(entry =>
        entry.name === RESET ? { ...entry, length: 40 } : entry,
      ),
  });
  throws(() => parse(bounded.buffer), /ResetTable.*bounds/);
  const mismatch = fixture();
  mismatch.buffer.writeBigUInt64LE(36n, mismatch.dataBase + 32 + 24);
  throws(() => parse(mismatch.buffer), /does not match Content/);
});

test('CHMParser: section-0 entries are bounded by the data base, not auxiliary HS0', () => {
  for (const entry of [
    { name: '/bad', section: 0, offset: 3, length: 1 },
    { name: '/bad', section: 0, offset: 4, length: 0 },
    { name: '/bad', section: 0, offset: Number.MAX_SAFE_INTEGER, length: 0 },
  ])
    throws(
      () => parse(fixture({ compressed: false, modify: () => [entry] }).buffer),
      /bounds|range/,
    );
});

test('CHMParser: compressed entries must fit the uncompressed stream, including empty entries', () => {
  for (const [offset, length] of [
    [0x8003, 1],
    [0x8004, 0],
    [0x8002, 2],
  ]) {
    const built = fixture({
      modify: entries =>
        entries.map(entry =>
          entry.name === '/index.html'
            ? { ...entry, offset: offset!, length: length! }
            : entry,
        ),
    });
    throws(() => parse(built.buffer), /outside uncompressed/);
  }
  const built = fixture({
    modify: entries =>
      entries.map(entry =>
        entry.name === '/index.html'
          ? { ...entry, offset: 0x8003, length: 0 }
          : entry,
      ),
  });
  equal(parse(built.buffer).directory.entries.get('/index.html')!.length, 0);
});

test('CHMParser: validates ITSF bases, safe ranges and ITSP chunk count/length exactly', () => {
  for (const [offset, value] of [
    [56, 99999n],
    [64, 99999n],
    [72, 99999n],
    [80, 99999n],
    [88, 0n],
    [88, 99999n],
    [88, 0x20000000000000n],
  ] as const) {
    const built = fixture();
    built.buffer.writeBigUInt64LE(value!, offset!);
    throws(() => parse(built.buffer));
  }
  for (const count of [0, 2, 0xffffffff]) {
    const built = fixture();
    built.buffer.writeUInt32LE(count, built.directoryOffset + 44);
    throws(() => parse(built.buffer));
  }
  const partial = fixture();
  partial.buffer.writeBigUInt64LE(
    BigInt(partial.directoryEnd - partial.directoryOffset - 1),
    80,
  );
  throws(() => parse(partial.buffer), /chunk count/);
});

test('CHMParser: later PMGL corruption and duplicate entries cannot hide behind an earlier valid chunk', () => {
  const unknown = fixture({ split: true });
  unknown.buffer.write('NOPE', unknown.directoryOffset + 84 + 512);
  throws(() => parse(unknown.buffer), /签名/);
  const duplicate = fixture({
    split: true,
    modify: entries => [
      ...entries,
      { name: '/INDEX.HTML', section: 1, offset: 0, length: 1 },
    ],
  });
  throws(() => parse(duplicate.buffer), /重复/);
});

test('CHMParser: standard metadata names are looked up case-insensitively', () => {
  const built = fixture({
    modify: entries =>
      entries.map(entry =>
        entry.name.startsWith('::')
          ? { ...entry, name: entry.name.toLowerCase() }
          : entry,
      ),
  });
  equal(parse(built.buffer).contentOffset, built.contentOffset);
});

test('CHMParser.quickParse: corrupt ResetTable and compressed ranges are still rejected', () => {
  const brokenReset = fixture();
  brokenReset.buffer.writeUInt32LE(99, brokenReset.dataBase + 32);
  throws(
    () => new CHMParser().quickParse(new BitReader(brokenReset.buffer)),
    /重置表版本/,
  );
  const brokenRange = fixture({
    modify: entries =>
      entries.map(entry =>
        entry.name === '/index.html'
          ? { ...entry, offset: 0x8004, length: 0 }
          : entry,
      ),
  });
  throws(
    () => new CHMParser().quickParse(new BitReader(brokenRange.buffer)),
    /outside uncompressed/,
  );
});

import { expect, test } from 'vitest';
import { DirectoryParser } from '../../src/core/directory/directory-parser';
import { ITSFHeaderParser } from '../../src/core/headers/itsf-header';
import { ITSPHeaderParser } from '../../src/core/headers/itsp-header';
import type { ITSPHeader } from '../../src/core/types';
import { BitReader } from '../../src/utils/io/bit-reader';
import { fixtureBytes, normalArchives } from './corpus';

// Standard: libmspack chmd.c search_chunk(), QR group M starts at M * stride.
// FPC release_3_2_2 packages/chm/src/chmtypes.pas WriteEntry(): every fifth
// entry's start (zero-based 4, 9, ...). This is not a new writer round trip.
type Convention = 'standard' | 'fpc';
const size = 4096;

function block(
  count: number,
  convention: Convention,
  density = 2,
  leaf = true,
  previous = -1,
  next = -1,
): { bytes: Buffer; starts: number[] } {
  const bytes = Buffer.alloc(size, 0xee);
  bytes.write(leaf ? 'PMGL' : 'PMGI');
  const headerSize = leaf ? 20 : 8;
  if (leaf) {
    bytes.writeUInt32LE(0, 8);
    bytes.writeInt32LE(previous, 12);
    bytes.writeInt32LE(next, 16);
  }
  const starts: number[] = [];
  let position = headerSize;
  for (let i = 0; i < count; i++) {
    starts.push(position - headerSize);
    const name = Buffer.from(`/entry-${String(i).padStart(2, '0')}`);
    const record = Buffer.concat([
      Buffer.from([name.length]),
      name,
      // Small, canonical one-byte ENCINTs. PMGI children identify leaf chunks.
      leaf ? Buffer.from([0, i, 0]) : Buffer.from([i]),
    ]);
    record.copy(bytes, position);
    position += record.length;
  }
  const stride = 1 + 2 ** density;
  const refs =
    convention === 'fpc'
      ? Math.floor(count / stride)
      : Math.max(0, Math.ceil(count / stride) - 1);
  for (let group = 1; group <= refs; group++) {
    bytes.writeUInt16LE(
      starts[group * stride - (convention === 'fpc' ? 1 : 0)]!,
      size - 2 - group * 2,
    );
  }
  bytes.writeUInt32LE(size - position, 4);
  bytes.writeUInt16LE(count, size - 2);
  return { bytes, starts };
}

function header(overrides: Partial<ITSPHeader> = {}): ITSPHeader {
  return {
    signature: 'ITSP',
    version: 1,
    headerLength: 84,
    unknown1: 10,
    chunkSize: size,
    density: 2,
    depth: 1,
    rootIndex: -1,
    firstPMGI: 0,
    lastPMGI: 0,
    unknown2: 0xffffffff,
    ...overrides,
  };
}

function parse(chunks: Buffer[], overrides: Partial<ITSPHeader> = {}) {
  return DirectoryParser.parse(
    new BitReader(Buffer.concat(chunks)),
    header(overrides),
    chunks.length,
  );
}

test('PMGL: standard density/count boundaries and consistent FPC fifth-entry tables', () => {
  for (const density of [0, 1, 2, 3]) {
    const stride = 1 + 2 ** density;
    for (const count of [
      0,
      1,
      stride - 1,
      stride,
      stride + 1,
      2 * stride,
      2 * stride + 1,
    ]) {
      const standard = block(count, 'standard', density);
      expect(parse([standard.bytes], { density }).entries.size).toBe(count);
      if (density === 2) {
        expect(parse([block(count, 'fpc').bytes])).toEqual(
          parse([standard.bytes]),
        );
      }
    }
  }
});

test('PMGL: identified FPC exact-multiple tables validate the extra final quickref', () => {
  for (const count of [10, 15, 20]) {
    const valid = block(count, 'fpc').bytes;
    expect(parse([valid]).entries.size).toBe(count);
    const slot = size - 2 - (count / 5) * 2;
    for (const wrong of [0, valid.readUInt16LE(slot) + 1, 0xffff]) {
      const bad = Buffer.from(valid);
      bad.writeUInt16LE(wrong, slot);
      expect(() => parse([bad])).toThrow(/quickref offset/);
    }
  }
});

test('PMGL: FPC alternate indexing is not generalized to other densities', () => {
  for (const density of [0, 1, 3]) {
    const data = block(2 * (1 + 2 ** density) + 1, 'fpc', density).bytes;
    expect(() => parse([data], { density })).toThrow(/quickref offset/);
  }
});

test('PMGL: every quickref must point to the exact expected record start', () => {
  for (const convention of ['standard', 'fpc'] as const) {
    const valid = block(16, convention);
    for (let group = 1; group <= 3; group++) {
      const slot = size - 2 - group * 2;
      for (const wrong of [
        0,
        1,
        0xffff,
        valid.starts[2]!,
        valid.starts[7]!,
        valid.bytes.readUInt16LE(slot) + 1,
      ]) {
        const bad = Buffer.from(valid.bytes);
        bad.writeUInt16LE(wrong, slot);
        expect(() => parse([bad])).toThrow(/quickref offset/);
      }
    }
  }
});

test('PMGL: mixing individually valid standard/FPC quickrefs in one chunk rejects', () => {
  for (const convention of ['standard', 'fpc'] as const) {
    const valid = block(16, convention);
    for (let group = 1; group <= 3; group++) {
      const bad = Buffer.from(valid.bytes);
      bad.writeUInt16LE(
        valid.starts[group * 5 - (convention === 'standard' ? 1 : 0)]!,
        size - 2 - group * 2,
      );
      expect(() => parse([bad])).toThrow(/quickref offset/);
    }
  }
});

function indexed(convention: Convention) {
  const leaves = Array.from({ length: 11 }, (_, i) => {
    const leaf = block(
      0,
      'standard',
      2,
      true,
      i - 1,
      i === 10 ? -1 : i + 1,
    ).bytes;
    return leaf;
  });
  return [...leaves, block(11, convention, 2, false).bytes];
}

const indexedHeader = { depth: 2, rootIndex: 11, lastPMGI: 10 };

test('PMGI: both complete conventions retain child, topology and quickref validation', () => {
  expect(parse(indexed('fpc'), indexedHeader)).toEqual(
    parse(indexed('standard'), indexedHeader),
  );
  for (const convention of ['standard', 'fpc'] as const) {
    const chunks = indexed(convention);
    const index = chunks[11]!;
    const valid = block(11, convention, 2, false);
    for (const wrong of [
      0,
      1,
      0xffff,
      valid.starts[2]!,
      valid.starts[5 - (convention === 'standard' ? 1 : 0)]!,
    ]) {
      index.writeUInt16LE(wrong, size - 4);
      expect(() => parse(chunks, indexedHeader)).toThrow(/quickref offset/);
    }
  }
});

test('PMGL: only verified FPC quickrefs permit the overwritten first-leaf hint', () => {
  const second = block(0, 'standard', 2, true, 0).bytes;
  const fpc = block(11, 'fpc', 2, true, -1, 1).bytes;
  const standard = block(11, 'standard', 2, true, -1, 1).bytes;
  const hint = { firstPMGI: 1, lastPMGI: 1 };
  expect(parse([fpc, second], hint).entries.size).toBe(11);
  expect(() => parse([standard, second], hint)).toThrow(/linked chunk chain/);
  const noRefs = block(1, 'fpc', 2, true, -1, 1).bytes;
  expect(() => parse([noRefs, second], hint)).toThrow(/linked chunk chain/);
  expect(() => parse([fpc, second], { ...hint, lastPMGI: 0 })).toThrow();
});

function fpcDirectory(bytes: Buffer) {
  const itsf = ITSFHeaderParser.parse(new BitReader(bytes));
  const reader = new BitReader(
    bytes.subarray(
      itsf.directoryOffset,
      itsf.directoryOffset + itsf.directoryLength,
    ),
  );
  const itsp = ITSPHeaderParser.parse(reader);
  const count = reader.buffer.readUInt32LE(0x2c);
  const directory = DirectoryParser.parse(reader, itsp, count);
  expect(reader.position).toBe(itsf.directoryLength);
  return directory;
}

test('unmodified FPC: all 147 directory entries parse before ResetTable processing', () => {
  const archive = normalArchives.find(a => a.file === 'fpc-3.2.2-fpdoc.chm')!;
  const directory = fpcDirectory(fixtureBytes(archive.file));
  expect(directory.entries.size).toBe(147);
  for (const file of archive.files) {
    expect(directory.entries.get(file.name)).toMatchObject({
      name: file.name,
      section: file.section,
      offset: file.offset,
      length: file.length,
    });
  }
  const resources = [...directory.entries.keys()]
    .filter(name => !name.endsWith('/') && !name.startsWith('::'))
    .sort();
  expect(resources).toEqual(archive.files.map(f => f.name).sort());
});

test('FPC: first-leaf compatibility retains all link, endpoint and rooted-index checks', () => {
  const input = fixtureBytes('fpc-3.2.2-fpdoc.chm');
  for (const [offset, value] of [
    [120 + 28, 0], // Root points to a leaf instead of the index.
    [120 + 32, 2], // First-leaf hint is not the evidenced 1.
    [120 + 36, 0], // Last-leaf hint omits chunk 1.
    [204 + 12, 0], // Initial leaf has a predecessor.
    [204 + 16, -1], // Initial leaf no longer links to chunk 1.
    [204 + 16, 2], // Initial leaf links to the index.
    [4300 + 12, -1], // Second leaf does not link back to chunk 0.
    [4300 + 16, 0], // Leaf cycle.
  ]) {
    const bad = Buffer.from(input);
    bad.writeInt32LE(value!, offset!);
    expect(() => fpcDirectory(bad)).toThrow();
  }
  const correctedHint = Buffer.from(input);
  correctedHint.writeUInt32LE(0, 120 + 32);
  expect(fpcDirectory(correctedHint)).toEqual(fpcDirectory(input));
});

test('FPC: raw ResetTable has 15 data-frame starts plus one terminal Content offset', () => {
  const input = fixtureBytes('fpc-3.2.2-fpdoc.chm');
  const directory = fpcDirectory(input);
  const reset = [...directory.entries.values()].find(e =>
    e.name.endsWith('/ResetTable'),
  )!;
  const content = directory.entries.get(
    '::DataSpace/Storage/MSCompressed/Content',
  )!;
  const base = Number(input.readBigUInt64LE(0x58));
  const raw = input.subarray(
    base + reset.offset,
    base + reset.offset + reset.length,
  );
  expect(raw.length).toBe(168);
  expect(raw.readUInt32LE(0)).toBe(2);
  expect(raw.readUInt32LE(4)).toBe(16);
  expect(raw.readUInt32LE(8)).toBe(8);
  expect(raw.readUInt32LE(12)).toBe(40);
  expect(raw.readBigUInt64LE(16)).toBe(460763n);
  expect(raw.readBigUInt64LE(24)).toBe(68542n);
  expect(raw.readBigUInt64LE(32)).toBe(32768n);
  const offsets = Array.from({ length: 16 }, (_, i) =>
    Number(raw.readBigUInt64LE(40 + i * 8)),
  );
  expect(offsets).toEqual([
    0, 6784, 10026, 14778, 18106, 23598, 27984, 33002, 36646, 41636, 46120,
    52232, 57016, 62286, 68150, 68542,
  ]);
  expect(Math.ceil(460763 / 32768)).toBe(15);
  expect(offsets[15]).toBe(content.length);
  expect(offsets[14]).toBeLessThan(content.length);
  // Raw-format evidence is deliberately separate from the normalized reader
  // model; full-reader tests compare actual decoded bytes with the 7-Zip oracle.
});

test('FPC: every stored quickref still rejects interior offsets or a mixed convention', () => {
  const input = fixtureBytes('fpc-3.2.2-fpdoc.chm');
  // FPC includes a 29th ref for the exact multiple of five; validate it too.
  // Immutable first PMGL: absolute 204, density 2, 145 entries.
  for (let group = 1; group <= 29; group++) {
    const slot = 204 + size - 2 - group * 2;
    const bad = Buffer.from(input);
    bad.writeUInt16LE(bad.readUInt16LE(slot) + 1, slot);
    expect(() => fpcDirectory(bad)).toThrow(/quickref offset/);
  }
  const mixed = Buffer.from(input);
  mixed.writeUInt16LE(61, 204 + size - 4); // Valid standard entry 5, not FPC entry 4.
  expect(() => fpcDirectory(mixed)).toThrow(/quickref offset/);
});

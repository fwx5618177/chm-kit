import { strict as assert } from 'node:assert';
import type { DirectoryEntry, LZXConfig } from '../../src/core/types';
import { CHMHeaderBuilder } from '../../src/encoder/builders/header-builder';
import { LZXEncoder, LZX_FRAME_SIZE } from '../../src/encoder/lzx-encoder';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { BitReader } from '../../src/utils/io/bit-reader';

export interface RawEntry {
  name: string;
  section: number;
  offset: number;
  length: number;
}

/** Test-only independent ENCINT/PMGL reader, including every quickref pointer. */
export function inspectDirectory(archive: Buffer): {
  entries: Map<string, RawEntry>;
  chunks: number;
  chunkSize: number;
} {
  const start = Number(archive.readBigUInt64LE(72));
  const length = Number(archive.readBigUInt64LE(80));
  const chunkSize = archive.readUInt32LE(start + 16);
  const chunks = archive.readUInt32LE(start + 44);
  const stride = 2 ** archive.readUInt32LE(start + 20) + 1;
  assert.equal(length, 84 + chunks * chunkSize);
  const entries = new Map<string, RawEntry>();
  for (let index = 0; index < chunks; index++) {
    const chunk = archive.subarray(
      start + 84 + index * chunkSize,
      start + 84 + (index + 1) * chunkSize,
    );
    assert.equal(chunk.toString('ascii', 0, 4), 'PMGL');
    assert.equal(chunk.readInt32LE(12), index === 0 ? -1 : index - 1);
    assert.equal(chunk.readInt32LE(16), index === chunks - 1 ? -1 : index + 1);
    const end = chunkSize - chunk.readUInt32LE(4);
    const count = chunk.readUInt16LE(chunkSize - 2);
    let position = 20;
    const encint = (): number => {
      let value = 0;
      let byte: number;
      do {
        assert.ok(position < end);
        byte = chunk[position++]!;
        value = value * 128 + (byte & 127);
        assert.ok(Number.isSafeInteger(value));
      } while (byte & 128);
      return value;
    };
    for (let entryIndex = 0; entryIndex < count; entryIndex++) {
      if (entryIndex > 0 && entryIndex % stride === 0) {
        assert.equal(
          chunk.readUInt16LE(chunkSize - 2 - (2 * entryIndex) / stride),
          position - 20,
        );
      }
      const nameLength = encint();
      const name = chunk.toString('utf8', position, position + nameLength);
      position += nameLength;
      const section = encint();
      const offset = encint();
      const size = encint();
      assert.ok(!entries.has(name), `duplicate directory entry ${name}`);
      entries.set(name, { name, section, offset, length: size });
    }
    assert.equal(position, end);
    assert.ok(
      chunk.readUInt32LE(4) >= Math.max(2, 2 * Math.ceil(count / stride)),
    );
  }
  return { entries, chunks, chunkSize };
}

export function storedEntry(archive: Buffer, entry: RawEntry): Buffer {
  assert.equal(entry.section, 0);
  const base = Number(archive.readBigUInt64LE(88));
  return archive.subarray(
    base + entry.offset,
    base + entry.offset + entry.length,
  );
}

export function allBytes(size: number): Buffer {
  return Buffer.from(Array.from({ length: size }, (_, index) => index % 256));
}

export function deterministicRandom(size: number, seed = 0x12345678): Buffer {
  const data = Buffer.alloc(size);
  let state = seed;
  for (let index = 0; index < size; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[index] = state & 0xff;
  }
  return data;
}

/** Rebuild all section-0 offsets when testing a different LZX configuration. */
export function reencodeArchive(original: Buffer, config: LZXConfig): Buffer {
  const storage = '::DataSpace/Storage/MSCompressed/';
  const resetName = `${storage}Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable`;
  const { entries, chunkSize } = inspectDirectory(original);
  const control = storedEntry(original, entries.get(`${storage}ControlData`)!);
  const logicalSize = Number(
    storedEntry(original, entries.get(resetName)!).readBigUInt64LE(16),
  );
  const source = new LZXDecoder(
    CHMHeaderBuilder.createLZXCHeader({
      resetInterval: control.readUInt32LE(12) * LZX_FRAME_SIZE,
      windowSize: control.readUInt32LE(16) * LZX_FRAME_SIZE,
    }),
  ).decode(
    new BitReader(storedEntry(original, entries.get(`${storage}Content`)!)),
    logicalSize,
  );
  const encoder = new LZXEncoder(config);
  const encoded = encoder.compress(source);
  const replacements = new Map([
    [
      `${storage}ControlData`,
      CHMHeaderBuilder.serializeLZXCHeader(
        CHMHeaderBuilder.createLZXCHeader(encoder.getConfig()),
      ),
    ],
    [`${storage}Content`, encoded.compressedData],
    [resetName, encoded.resetTable],
  ]);
  const updated: DirectoryEntry[] = [];
  const sections: Buffer[] = [];
  let offset = 0;
  for (const entry of entries.values()) {
    if (entry.section === 1 || entry.name.endsWith('/')) {
      updated.push({ ...entry, isCompressed: entry.section === 1 });
    } else {
      const data = replacements.get(entry.name) ?? storedEntry(original, entry);
      updated.push({
        ...entry,
        isCompressed: false,
        offset,
        length: data.length,
      });
      sections.push(data);
      offset += data.length;
    }
  }
  const leaves = CHMHeaderBuilder.serializeDirectory(updated, chunkSize);
  const itsp = CHMHeaderBuilder.serializeITSPHeader(
    CHMHeaderBuilder.createITSPHeader({
      chunkSize,
      numChunks: leaves.length / chunkSize,
    }),
  );
  const directoryLength = itsp.length + leaves.length;
  const itsf = CHMHeaderBuilder.serializeITSFHeader(
    CHMHeaderBuilder.createITSFHeader({
      directoryOffset: 120,
      directoryLength,
      timestamp: original.readUInt32BE(16),
      languageId: original.readUInt32LE(20),
    }),
  );
  const auxiliary = Buffer.alloc(24);
  auxiliary.writeUInt32LE(0x01fe);
  auxiliary.writeBigUInt64LE(BigInt(120 + directoryLength + offset), 8);
  return Buffer.concat([itsf, auxiliary, itsp, leaves, ...sections]);
}

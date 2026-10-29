import { CHMParser } from '../core/parser/chm-parser';
import { FileReconstructor } from '../core/files/file-reconstructor';
import { BitReader } from '../utils/io/bit-reader';

/** Writer-independent readback using our parser, not a third-party format oracle. */
export function readArchiveForVerification(data: Buffer): Map<string, Buffer> {
  if (
    data.length < 120 ||
    data.toString('ascii', 0, 4) !== 'ITSF' ||
    data.readUInt32LE(4) !== 3 ||
    data.readUInt32LE(8) !== 96
  ) {
    throw new Error('Invalid CHM ITSF v3 header');
  }
  function integer64(offset: number): number {
    const value = data.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('CHM offset exceeds safe integer range');
    return Number(value);
  }
  const auxiliary = integer64(56);
  const auxiliaryLength = integer64(64);
  const directory = integer64(72);
  const directoryLength = integer64(80);
  const content = integer64(88);
  if (
    auxiliary < 96 ||
    auxiliaryLength !== 24 ||
    auxiliary + 24 > data.length ||
    integer64(auxiliary + 8) !== data.length ||
    directory < auxiliary + auxiliaryLength ||
    directoryLength < 84 ||
    directory + directoryLength > content ||
    content > data.length ||
    data.toString('ascii', directory, directory + 4) !== 'ITSP'
  ) {
    throw new Error('Invalid CHM section bounds or declared file size');
  }
  const chunkSize = data.readUInt32LE(directory + 16);
  const chunks = data.readUInt32LE(directory + 44);
  if (
    data.readUInt32LE(directory + 8) !== 84 ||
    chunkSize < 22 ||
    chunks < 1 ||
    84 + chunks * chunkSize !== directoryLength
  ) {
    throw new Error('Invalid CHM directory dimensions');
  }
  const parsed = new CHMParser().parse(new BitReader(data));
  const reconstructor = new FileReconstructor(parsed);
  const result = new Map<string, Buffer>();
  for (const [name, entry] of parsed.directory.entries) {
    if (entry.section !== 0 && entry.section !== 1)
      throw new Error(`Invalid CHM section: ${name}`);
    const limit =
      entry.section === 0
        ? data.length - content
        : parsed.resetTable.uncompressedLength;
    if (
      entry.offset < 0 ||
      entry.length < 0 ||
      entry.offset + entry.length > limit
    ) {
      throw new Error(`CHM entry out of bounds: ${name}`);
    }
    const bytes =
      entry.length === 0 && name.endsWith('/')
        ? Buffer.alloc(0)
        : reconstructor.reconstructFile(name, new BitReader(data)).data;
    if (bytes.length !== entry.length)
      throw new Error(`CHM entry length mismatch: ${name}`);
    if (
      entry.section === 0 &&
      !bytes.equals(
        data.subarray(
          content + entry.offset,
          content + entry.offset + entry.length,
        ),
      )
    ) {
      throw new Error(
        `CHM section 0 reader disagrees with content_offset: ${name}`,
      );
    }
    result.set(name, bytes);
  }
  if (!result.has('/#SYSTEM') || !result.has('::DataSpace/NameList')) {
    throw new Error('CHM is missing system metadata or DataSpace NameList');
  }
  return result;
}

export function compareArchiveFiles(
  actual: ReadonlyMap<string, Buffer>,
  expected: ReadonlyMap<string, Uint8Array>,
  exact = false,
): void {
  if (exact && actual.size !== expected.size)
    throw new Error('CHM directory entry count mismatch');
  for (const [name, bytes] of expected) {
    const key = name.startsWith('::')
      ? name
      : `/${name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')}`;
    const extracted = actual.get(key);
    if (!extracted || !extracted.equals(Buffer.from(bytes))) {
      throw new Error(`CHM round-trip byte comparison failed: ${name}`);
    }
  }
}

import type { DirectoryEntry, CHMDirectory, ITSPHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { checkedEnd, isUInt, readBytes, requireRange } from '../headers/binary';
import { ITSPHeaderParser } from '../headers/itsp-header';

type Block = {
  leaf: boolean;
  previous: number;
  next: number;
  children: number[];
};

export class DirectoryParser {
  static parse(
    reader: BitReader,
    itspHeader: ITSPHeader,
    numChunks: number,
  ): CHMDirectory {
    if (
      !ITSPHeaderParser.validate(itspHeader) ||
      !isUInt(numChunks) ||
      numChunks === 0 ||
      itspHeader.lastPMGI >= numChunks
    ) {
      throw new Error('无效的目录块范围');
    }
    const size = itspHeader.chunkSize;
    requireRange(
      reader.buffer,
      reader.position,
      numChunks * size,
      'Directory chunks',
    );
    const entries = new Map<string, DirectoryEntry>();
    const names = new Set<string>();
    const blocks: Block[] = [];
    for (let index = 0; index < numChunks; index++) {
      const data = readBytes(reader, size, `Directory chunk ${index}`);
      const signature = data.toString('ascii', 0, 4);
      if (signature !== 'PMGL' && signature !== 'PMGI')
        throw new Error(`未知的块签名: ${signature}`);
      const leaf = signature === 'PMGL';
      const headerSize = leaf ? 20 : 8;
      const freeSpace = data.readUInt32LE(4);
      if (freeSpace < 2 || freeSpace > size - headerSize)
        throw new Error(`${signature}: invalid free space`);
      const end = size - freeSpace;
      const count = data.readUInt16LE(size - 2);
      const groupSize = 1 + 2 ** itspHeader.density;
      const quickRefs = Math.max(0, Math.ceil(count / groupSize) - 1);
      if (2 + quickRefs * 2 > freeSpace)
        throw new Error(`${signature}: truncated quickref table`);
      const block: Block = {
        leaf,
        previous: leaf ? data.readInt32LE(12) : -1,
        next: leaf ? data.readInt32LE(16) : -1,
        children: [],
      };
      const indexNames = new Set<string>();
      let offset = headerSize;
      for (let i = 0; i < count; i++) {
        if (i > 0 && i % groupSize === 0) {
          const quickRef = data.readUInt16LE(size - 2 - (i / groupSize) * 2);
          if (quickRef !== offset - headerSize)
            throw new Error(`${signature}: invalid quickref offset`);
        }
        const nameLength = this.readEncInt(data, offset, end);
        offset = nameLength.nextOffset;
        if (nameLength.value === 0 || nameLength.value > end - offset)
          throw new Error(`${signature}: invalid name length`);
        const rawName = data.subarray(offset, offset + nameLength.value);
        const name = rawName.toString('utf8');
        if (name.includes('\0') || !Buffer.from(name, 'utf8').equals(rawName))
          throw new Error(`${signature}: invalid UTF-8 name`);
        offset += nameLength.value;
        const key = name.toLowerCase();
        if (!leaf) {
          if (indexNames.has(key)) throw new Error(`重复的 PMGI 条目: ${name}`);
          indexNames.add(key);
          const child = this.readEncInt(data, offset, end);
          offset = child.nextOffset;
          if (
            child.value >= numChunks ||
            child.value === index ||
            block.children.includes(child.value)
          )
            throw new Error('PMGI: invalid child chunk');
          block.children.push(child.value);
        } else {
          if (names.has(key)) throw new Error(`重复的目录条目: ${name}`);
          names.add(key);
          const section = this.readEncInt(data, offset, end);
          const entryOffset = this.readEncInt(data, section.nextOffset, end);
          const length = this.readEncInt(data, entryOffset.nextOffset, end);
          offset = length.nextOffset;
          if (section.value > 1)
            throw new Error(`无效的节编号: ${section.value}`);
          checkedEnd(
            entryOffset.value,
            length.value,
            `Directory entry ${name}`,
          );
          const compressed = section.value === 1;
          entries.set(name, {
            name,
            isCompressed: compressed,
            offset: entryOffset.value,
            length: length.value,
            ...(compressed ? { uncompressedLength: length.value } : {}),
            section: section.value,
          });
        }
      }
      if (offset !== end)
        throw new Error(`${signature}: entry count/data length mismatch`);
      if (!leaf && count === 0) throw new Error('PMGI: empty index chunk');
      blocks.push(block);
    }
    this.validateBlocks(blocks, itspHeader);
    return { entries, rootPath: '/' };
  }

  private static readEncInt(
    data: Buffer,
    offset: number,
    end: number,
  ): { value: number; nextOffset: number } {
    let value = 0;
    for (let i = 0; i < 8; i++) {
      if (offset >= end)
        throw new Error('ENCINT: truncated at entry data boundary');
      const byte = data[offset++]!;
      const digit = byte & 0x7f;
      if (i === 0 && byte === 0x80)
        throw new Error('ENCINT: non-canonical leading zero');
      if (value > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 128))
        throw new Error('ENCINT: exceeds safe integer range');
      value = value * 128 + digit;
      if ((byte & 0x80) === 0) return { value, nextOffset: offset };
    }
    throw new Error('ENCINT: too many bytes');
  }

  private static validateBlocks(blocks: Block[], header: ITSPHeader): void {
    const seen = new Set<number>();
    let index = header.firstPMGI;
    let previous = -1;
    while (index !== -1) {
      const block = blocks[index];
      if (!block?.leaf || seen.has(index) || block.previous !== previous)
        throw new Error('PMGL: invalid linked chunk chain');
      seen.add(index);
      previous = index;
      index = block.next;
    }
    if (
      previous !== header.lastPMGI ||
      seen.size !== blocks.filter(block => block.leaf).length
    )
      throw new Error('PMGL: missing or unlinked leaf chunk');
    const root = header.rootIndex === 0xffffffff ? -1 : header.rootIndex;
    if (root === -1) {
      if (header.depth !== 1 || blocks.some(block => !block.leaf))
        throw new Error('PMGI: missing root index');
      return;
    }
    if (!blocks[root]) throw new Error('PMGI: root index out of bounds');
    if (blocks[root]!.leaf) {
      if (header.depth !== 1 || blocks.some(block => !block.leaf))
        throw new Error('PMGI: invalid root depth');
      return;
    }
    const visited = new Set<number>();
    const pending = [{ index: root, depth: 1 }];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current.index))
        throw new Error('PMGI: cycle or duplicate child');
      visited.add(current.index);
      const block = blocks[current.index]!;
      if (block.leaf) {
        if (current.depth !== header.depth)
          throw new Error('PMGI: leaf depth mismatch');
      } else {
        if (current.depth >= header.depth)
          throw new Error('PMGI: index depth mismatch');
        for (const child of block.children)
          pending.push({ index: child, depth: current.depth + 1 });
      }
    }
    if (visited.size !== blocks.length)
      throw new Error('PMGI: unreachable directory chunk');
  }

  static validate(directory: CHMDirectory): boolean {
    if (!(directory.entries instanceof Map)) return false;
    const names = new Set<string>();
    for (const [name, entry] of directory.entries) {
      const key = name.toLowerCase();
      if (
        !name ||
        name.includes('\0') ||
        name !== entry.name ||
        names.has(key) ||
        (entry.section !== 0 && entry.section !== 1) ||
        entry.isCompressed !== (entry.section === 1)
      )
        return false;
      names.add(key);
      try {
        checkedEnd(entry.offset, entry.length, name);
      } catch {
        return false;
      }
      if (
        entry.uncompressedLength !== undefined &&
        entry.uncompressedLength !== entry.length
      )
        return false;
    }
    return true;
  }

  static getSummary(directory: CHMDirectory): string {
    const totalFiles = directory.entries.size;
    const compressedFiles = Array.from(directory.entries.values()).filter(
      entry => entry.isCompressed,
    ).length;
    const totalSize = Array.from(directory.entries.values()).reduce(
      (sum, entry) => sum + entry.length,
      0,
    );
    return [
      `总文件数: ${totalFiles}`,
      `压缩文件数: ${compressedFiles}`,
      `未压缩文件数: ${totalFiles - compressedFiles}`,
      `总大小: ${this.formatBytes(totalSize)}`,
    ].join('\n');
  }

  private static formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} 字节`;
  }
}

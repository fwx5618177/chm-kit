import type { ResetTable, ResetTableEntry } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import {
  isUInt,
  readBytes,
  readUInt64LE,
  requireRange,
} from '../headers/binary';

export class ResetTableProcessor {
  private resetTable: ResetTable | null = null;

  parseResetTable(reader: BitReader): ResetTable {
    this.reset();
    const start = reader.position;
    const data = readBytes(reader, 0x28, 'ResetTable header');
    const version = data.readUInt32LE(0);
    const blockCount = data.readUInt32LE(4);
    const entrySize = data.readUInt32LE(8);
    const tableOffset = data.readUInt32LE(12);
    if (version !== 2) throw new Error(`不支持的重置表版本: ${version}`);
    if (entrySize !== 8) throw new Error(`无效的条目大小: ${entrySize}`);
    if (tableOffset < 0x28) throw new Error(`无效的表偏移: ${tableOffset}`);
    const uncompressedLength = readUInt64LE(
      data,
      0x10,
      'ResetTable uncompressed length',
    );
    const compressedLength = readUInt64LE(
      data,
      0x18,
      'ResetTable compressed length',
    );
    const blockSize = readUInt64LE(data, 0x20, 'ResetTable block size');
    if (blockSize !== 0x8000) throw new Error(`无效的块大小: ${blockSize}`);
    if (blockCount !== Math.ceil(uncompressedLength / blockSize))
      throw new Error(
        'ResetTable: block count does not match uncompressed length',
      );
    requireRange(
      reader.buffer,
      start,
      tableOffset + blockCount * entrySize,
      'ResetTable entries',
    );
    reader.setPosition(start + tableOffset, 0);
    const offsets = readBytes(
      reader,
      blockCount * entrySize,
      'ResetTable entries',
    );
    const entries: ResetTableEntry[] = [];
    for (let i = 0; i < blockCount; i++) {
      // Preserve the legacy property name: compressedLength is a cumulative
      // offset relative to Content, not the compressed size of this frame.
      entries.push({
        compressedLength: readUInt64LE(
          offsets,
          i * entrySize,
          'ResetTable compressed offset',
        ),
        uncompressedLength: Math.min(
          blockSize,
          uncompressedLength - i * blockSize,
        ),
      });
    }
    const table = {
      version,
      blockCount,
      entrySize,
      tableOffset,
      uncompressedLength,
      compressedLength,
      blockSize,
      entries,
    };
    if (!this.isValid(table))
      throw new Error('ResetTable: invalid cumulative compressed offsets');
    this.resetTable = table;
    return table;
  }

  getBlockInfo(blockIndex: number): ResetTableEntry | null {
    const entry = Number.isInteger(blockIndex)
      ? this.resetTable?.entries[blockIndex]
      : undefined;
    return entry ? { ...entry } : null;
  }

  getBlockCount(): number {
    return this.resetTable?.blockCount ?? 0;
  }

  getBlockSize(): number {
    return this.resetTable?.blockSize ?? 0;
  }

  /** Offset relative to the compressed Content stream, never to ResetTable. */
  calculateBlockOffset(blockIndex: number): number {
    if (!this.resetTable) throw new Error('重置表未初始化');
    const entry = this.getBlockInfo(blockIndex);
    if (!entry) throw new Error(`无效的块索引: ${blockIndex}`);
    return entry.compressedLength;
  }

  /** Find a frame by its compressed Content-stream offset (end exclusive). */
  findBlockByOffset(offset: number): number {
    const table = this.resetTable;
    if (!table || !isUInt(offset) || offset >= table.compressedLength)
      return -1;
    let low = 0;
    let high = table.entries.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (table.entries[middle]!.compressedLength <= offset) low = middle + 1;
      else high = middle - 1;
    }
    return high;
  }

  private isValid(table: ResetTable): boolean {
    if (
      table.version !== 2 ||
      table.entrySize !== 8 ||
      table.tableOffset < 0x28 ||
      table.blockSize !== 0x8000 ||
      ![
        table.blockCount,
        table.tableOffset,
        table.compressedLength,
        table.uncompressedLength,
      ].every(isUInt) ||
      table.blockCount !== table.entries.length ||
      table.blockCount !== Math.ceil(table.uncompressedLength / table.blockSize)
    )
      return false;
    if (table.blockCount === 0)
      return table.compressedLength === 0 && table.uncompressedLength === 0;
    if (table.entries[0]!.compressedLength !== 0) return false;
    let previous = -1;
    for (let i = 0; i < table.entries.length; i++) {
      const entry = table.entries[i]!;
      if (
        !isUInt(entry.compressedLength) ||
        entry.compressedLength <= previous ||
        entry.compressedLength >= table.compressedLength ||
        entry.uncompressedLength !==
          Math.min(
            table.blockSize,
            table.uncompressedLength - i * table.blockSize,
          )
      )
        return false;
      previous = entry.compressedLength;
    }
    return true;
  }

  validate(): boolean {
    return this.resetTable !== null && this.isValid(this.resetTable);
  }

  getStatistics(): string {
    if (!this.resetTable) return '重置表未初始化';
    const table = this.resetTable;
    const ratio =
      table.uncompressedLength === 0
        ? 0
        : (table.compressedLength / table.uncompressedLength) * 100;
    return [
      `重置表版本: ${table.version}`,
      `总块数: ${table.blockCount}`,
      `块大小: ${this.formatBytes(table.blockSize)}`,
      `总压缩大小: ${this.formatBytes(table.compressedLength)}`,
      `总未压缩大小: ${this.formatBytes(table.uncompressedLength)}`,
      `压缩率: ${ratio.toFixed(2)}%`,
    ].join('\n');
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} 字节`;
  }

  reset(): void {
    this.resetTable = null;
  }

  getResetTable(): ResetTable | null {
    if (!this.resetTable) return null;
    return {
      ...this.resetTable,
      entries: this.resetTable.entries.map(entry => ({ ...entry })),
    };
  }
}

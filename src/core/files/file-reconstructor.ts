import type { DirectoryEntry, CHMFile, ParsedCHM, ResetTable } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { LZXDecoder } from '../lzx/lzx-decoder';
import { CHMFileManager } from './file-manager';
import { logger } from '../../logger/logger';

/**
 * 文件重组器
 * 负责按需读取指定文件并重建完整文件内容
 */
export class FileReconstructor {
  private parsedCHM: ParsedCHM;
  private lzxDecoder: LZXDecoder;
  private fileManager: CHMFileManager;

  constructor(parsedCHM: ParsedCHM) {
    this.parsedCHM = parsedCHM;
    this.lzxDecoder = new LZXDecoder(parsedCHM.header.lzxc);
    this.fileManager = new CHMFileManager(parsedCHM);
  }

  /**
   * 重组指定文件
   * @param fileName 文件名
   * @param reader 位读取器（指向 CHM 文件内容）
   * @returns 重组后的文件对象
   */
  reconstructFile(fileName: string, reader: BitReader): CHMFile {
    // 查找文件条目
    const entry = this.fileManager.findFileEntry(fileName);
    if (!entry) {
      throw new Error(`文件未找到: ${fileName}`);
    }

    // 读取文件数据
    const data = this.readFileData(entry, reader);

    return {
      name: fileName,
      data,
      isCompressed: entry.isCompressed,
      originalSize: entry.uncompressedLength ?? entry.length,
      compressedSize: entry.length,
    };
  }

  /**
   * 批量重组文件
   * @param fileNames 文件名数组
   * @param reader 位读取器
   * @returns 重组后的文件映射
   */
  reconstructFiles(
    fileNames: string[],
    reader: BitReader,
  ): Map<string, CHMFile> {
    const result = new Map<string, CHMFile>();

    for (const fileName of fileNames) {
      try {
        const file = this.reconstructFile(fileName, reader);
        result.set(fileName, file);
      } catch (error) {
        // 记录错误但继续处理其他文件
        logger.error(`重组文件失败 ${fileName}:`, error);
      }
    }

    return result;
  }

  /**
   * 重组所有文件
   * @param reader 位读取器
   * @returns 所有文件的映射
   */
  reconstructAllFiles(reader: BitReader): Map<string, CHMFile> {
    const fileNames = this.fileManager.getFileList();
    return this.reconstructFiles(fileNames, reader);
  }

  /**
   * 读取文件数据
   * @param entry 文件条目
   * @param reader 位读取器
   * @returns 文件数据
   */
  private readFileData(entry: DirectoryEntry, reader: BitReader): Buffer {
    if (entry.isCompressed) {
      // section 1 压缩文件：readCompressedData 内部自行定位到正确的压缩块
      return this.readCompressedData(entry, reader);
    } else {
      // section 0 未压缩文件：基址为 itsf.unknown2（sect0Offset）
      const sect0Base = this.parsedCHM.header.itsf.unknown2;
      const absoluteOffset = sect0Base + entry.offset;
      reader.setPosition(absoluteOffset, 0);
      return this.readUncompressedData(entry, reader);
    }
  }

  /**
   * 读取压缩数据
   * 对于 section 1 压缩文件，entry.offset 是未压缩流中的字节偏移。
   * 需要通过重置表找到对应的压缩块起始位置，然后解压并截取。
   * 若文件跨越多个重置区间，则对每个区间独立解码（每次重置解码器状态）。
   * @param entry 文件条目
   * @param reader 位读取器
   * @returns 解压后的数据
   */
  private readCompressedData(entry: DirectoryEntry, reader: BitReader): Buffer {
    // 对于 section 1，length 字段本身就是未压缩大小
    const uncompressedLength = entry.uncompressedLength ?? entry.length;
    if (!uncompressedLength) {
      throw new Error('压缩文件缺少未压缩长度信息');
    }

    const resetTable = this.parsedCHM.resetTable;
    const blockSize = resetTable.blockSize > 0 ? resetTable.blockSize : 0x8000;

    const startBlock = Math.floor(entry.offset / blockSize);
    const endBlock = Math.floor(
      (entry.offset + uncompressedLength - 1) / blockSize,
    );
    const offsetWithinBlock = entry.offset - startBlock * blockSize;

    if (startBlock === endBlock) {
      // 快速路径：文件完全在一个重置区间内
      const compressedStart = this.getCompressedBlockOffset(
        startBlock,
        resetTable,
      );
      reader.setPosition(this.parsedCHM.contentOffset + compressedStart, 0);
      const decoded = this.lzxDecoder.decode(
        reader,
        offsetWithinBlock + uncompressedLength,
      );
      return decoded.subarray(
        offsetWithinBlock,
        offsetWithinBlock + uncompressedLength,
      );
    }

    // 文件跨越多个重置区间：逐区间独立解码（每次调用 decode() 时内部自动重置状态）
    const chunks: Buffer[] = [];
    for (let blk = startBlock; blk <= endBlock; blk++) {
      const compressedStart = this.getCompressedBlockOffset(blk, resetTable);
      reader.setPosition(this.parsedCHM.contentOffset + compressedStart, 0);

      // 每个区间解码的未压缩字节数：
      // - 非最后区间：完整的 blockSize 字节
      // - 最后区间：只需解码到文件末尾所在的字节数
      const bytesToDecode =
        blk === endBlock
          ? entry.offset + uncompressedLength - blk * blockSize
          : blockSize;

      chunks.push(this.lzxDecoder.decode(reader, bytesToDecode));
    }

    // 合并所有区间的解码数据，截取目标文件部分
    const allDecoded = Buffer.concat(chunks);
    return allDecoded.subarray(
      offsetWithinBlock,
      offsetWithinBlock + uncompressedLength,
    );
  }

  /**
   * 获取指定重置区间在压缩流中的起始偏移
   * @param blockIndex 区间索引
   * @param resetTable 重置表
   * @returns 压缩流偏移（相对于 contentOffset）
   */
  private getCompressedBlockOffset(
    blockIndex: number,
    resetTable: ResetTable,
  ): number {
    if (resetTable.entries.length > blockIndex) {
      return resetTable.entries[blockIndex]!.compressedLength;
    }
    return 0;
  }

  /**
   * 读取未压缩数据
   * @param entry 文件条目
   * @param reader 位读取器
   * @returns 原始数据
   */
  private readUncompressedData(
    entry: DirectoryEntry,
    reader: BitReader,
  ): Buffer {
    const data = Buffer.alloc(entry.length);

    for (let i = 0; i < entry.length; i++) {
      data[i] = reader.read(8);
    }

    return data;
  }

  /**
   * 验证文件数据完整性
   * @param file 文件对象
   * @returns 验证结果
   */
  validateFile(file: CHMFile): boolean {
    // 基本检查
    if (!file.data || file.data.length === 0) {
      return false;
    }

    // 检查压缩文件的大小一致性
    if (file.isCompressed) {
      return file.data.length === file.originalSize;
    } else {
      return file.data.length === file.compressedSize;
    }
  }
}

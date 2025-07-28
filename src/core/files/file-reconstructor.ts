import type { DirectoryEntry, CHMFile, ParsedCHM } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { LZXDecoder } from '../lzx/lzx-decoder';
import { CHMFileManager } from './file-manager';

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
        console.error(`重组文件失败 ${fileName}:`, error);
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
    // 定位到文件偏移位置
    this.seekToOffset(reader, entry.offset);

    if (entry.isCompressed) {
      return this.readCompressedData(entry, reader);
    } else {
      return this.readUncompressedData(entry, reader);
    }
  }

  /**
   * 定位到指定偏移位置
   * @param reader 位读取器
   * @param offset 目标偏移
   */
  private seekToOffset(reader: BitReader, offset: number): void {
    // 计算相对于内容起始位置的偏移
    const absoluteOffset = this.parsedCHM.contentOffset + offset;

    // 简化实现：假设 reader 支持跳转
    // 实际实现可能需要重新创建 reader 或使用不同的定位方法
    if (reader.position !== absoluteOffset) {
      const skipBytes = absoluteOffset - reader.position;
      if (skipBytes > 0) {
        for (let i = 0; i < skipBytes; i++) {
          reader.read(8);
        }
      }
    }
  }

  /**
   * 读取压缩数据
   * @param entry 文件条目
   * @param reader 位读取器
   * @returns 解压后的数据
   */
  private readCompressedData(entry: DirectoryEntry, reader: BitReader): Buffer {
    if (!entry.uncompressedLength) {
      throw new Error('压缩文件缺少未压缩长度信息');
    }

    // 使用 LZX 解码器解压数据
    return this.lzxDecoder.decode(reader, entry.uncompressedLength);
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

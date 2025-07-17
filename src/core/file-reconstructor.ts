import type { DirectoryEntry, CHMFile, ParsedCHM } from './types';
import type { BitReader } from '../utils/bit-reader';
import { LZXDecoder } from './lzx/lzx-decoder';

/**
 * 文件重组器
 * 负责按需读取指定文件并重建完整文件内容
 */
export class FileReconstructor {
  private parsedCHM: ParsedCHM;
  private lzxDecoder: LZXDecoder;

  constructor(parsedCHM: ParsedCHM) {
    this.parsedCHM = parsedCHM;
    this.lzxDecoder = new LZXDecoder(parsedCHM.header.lzxc);
  }

  /**
   * 重组指定文件
   * @param fileName 文件名
   * @param reader 位读取器（指向 CHM 文件内容）
   * @returns 重组后的文件对象
   */
  reconstructFile(fileName: string, reader: BitReader): CHMFile {
    // 查找文件条目
    const entry = this.findFileEntry(fileName);
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
    const fileNames = Array.from(this.parsedCHM.directory.entries.keys());
    return this.reconstructFiles(fileNames, reader);
  }

  /**
   * 检查文件是否存在
   * @param fileName 文件名
   * @returns 是否存在
   */
  fileExists(fileName: string): boolean {
    return this.parsedCHM.directory.entries.has(fileName);
  }

  /**
   * 获取文件信息（不读取内容）
   * @param fileName 文件名
   * @returns 文件信息
   */
  getFileInfo(fileName: string): DirectoryEntry | null {
    return this.parsedCHM.directory.entries.get(fileName) ?? null;
  }

  /**
   * 获取所有文件列表
   * @returns 文件名数组
   */
  getFileList(): string[] {
    return Array.from(this.parsedCHM.directory.entries.keys());
  }

  /**
   * 按类型过滤文件
   * @param extension 文件扩展名
   * @returns 过滤后的文件名数组
   */
  getFilesByType(extension: string): string[] {
    const normalizedExt = extension.toLowerCase();
    return this.getFileList().filter(fileName =>
      fileName.toLowerCase().endsWith(normalizedExt),
    );
  }

  /**
   * 查找文件条目
   * @param fileName 文件名
   * @returns 文件条目
   */
  private findFileEntry(fileName: string): DirectoryEntry | null {
    // 尝试直接查找
    let entry = this.parsedCHM.directory.entries.get(fileName);
    if (entry) {
      return entry;
    }

    // 尝试标准化路径后查找
    const normalizedName = this.normalizePath(fileName);
    entry = this.parsedCHM.directory.entries.get(normalizedName);
    if (entry) {
      return entry;
    }

    // 尝试不区分大小写查找
    for (const [entryName, entryData] of this.parsedCHM.directory.entries) {
      if (entryName.toLowerCase() === fileName.toLowerCase()) {
        return entryData;
      }
    }

    return null;
  }

  /**
   * 标准化文件路径
   * @param path 原始路径
   * @returns 标准化后的路径
   */
  private normalizePath(path: string): string {
    // 确保路径以 / 开头
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }

    // 替换反斜杠为正斜杠
    path = path.replace(/\\/g, '/');

    // 移除重复的斜杠
    path = path.replace(/\/+/g, '/');

    return path;
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

  /**
   * 获取文件统计信息
   * @returns 统计信息字符串
   */
  getStatistics(): string {
    const totalFiles = this.parsedCHM.directory.entries.size;
    const compressedFiles = Array.from(
      this.parsedCHM.directory.entries.values(),
    ).filter(entry => entry.isCompressed).length;

    const totalSize = Array.from(
      this.parsedCHM.directory.entries.values(),
    ).reduce((sum, entry) => sum + entry.length, 0);

    const uncompressedSize = Array.from(
      this.parsedCHM.directory.entries.values(),
    ).reduce(
      (sum, entry) => sum + (entry.uncompressedLength ?? entry.length),
      0,
    );

    const compressionRatio =
      totalSize > 0 ? (totalSize / uncompressedSize) * 100 : 0;

    return [
      `总文件数: ${totalFiles}`,
      `压缩文件数: ${compressedFiles}`,
      `未压缩文件数: ${totalFiles - compressedFiles}`,
      `压缩后总大小: ${this.formatBytes(totalSize)}`,
      `未压缩总大小: ${this.formatBytes(uncompressedSize)}`,
      `压缩率: ${compressionRatio.toFixed(2)}%`,
    ].join('\n');
  }

  /**
   * 格式化字节数为可读格式
   * @param bytes 字节数
   * @returns 格式化后的字符串
   */
  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    } else {
      return `${bytes} 字节`;
    }
  }

  /**
   * 获取文件类型统计
   * @returns 文件类型统计
   */
  getFileTypeStatistics(): Map<string, number> {
    const typeStats = new Map<string, number>();

    for (const fileName of this.getFileList()) {
      const ext = this.getFileExtension(fileName);
      const count = typeStats.get(ext) ?? 0;
      typeStats.set(ext, count + 1);
    }

    return typeStats;
  }

  /**
   * 获取文件扩展名
   * @param fileName 文件名
   * @returns 扩展名
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) {
      return '无扩展名';
    }
    return fileName.substring(lastDot + 1).toLowerCase();
  }
}

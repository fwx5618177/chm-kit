import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type {
  PackOptions,
  ITSFHeader,
  ITSPHeader,
  LZXCHeader,
  DirectoryEntry,
} from '../core/types';
import { LZXEncoder } from './lzx-encoder';
import { TOCBuilder } from './toc-builder';

/**
 * CHM 编码器
 * 负责将目录结构编码为 CHM 文件格式
 */
export class CHMEncoder {
  private lzxEncoder: LZXEncoder;
  private tocBuilder: TOCBuilder;
  private files: Map<string, Buffer> = new Map();
  private directoryEntries: DirectoryEntry[] = [];

  constructor() {
    this.lzxEncoder = new LZXEncoder();
    this.tocBuilder = new TOCBuilder();
  }

  /**
   * 编码目录为 CHM 文件
   * @param options 打包选项
   */
  async encode(options: PackOptions): Promise<void> {
    // 1. 扫描输入目录
    const fileList = await this.scanDirectory(options.inputDir);

    // 2. 读取所有文件
    await this.loadFiles(options.inputDir, fileList);

    // 3. 生成 TOC 和索引
    await this.generateTOCAndIndex(fileList, options.inputDir);

    // 4. 压缩文件内容
    const compressedData = await this.compressFiles();

    // 5. 构建目录条目
    this.buildDirectoryEntries(compressedData);

    // 6. 写入 CHM 文件
    await this.writeCHMFile(options.outputPath, compressedData, options);
  }

  /**
   * 扫描目录获取所有文件
   * @param dirPath 目录路径
   * @returns 文件列表
   */
  private async scanDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    async function scanRecursive(
      currentPath: string,
      relativePath: string = '',
    ): Promise<void> {
      const items = await fs.readdir(currentPath);

      for (const item of items) {
        const itemPath = join(currentPath, item);
        const itemRelativePath = relativePath ? join(relativePath, item) : item;

        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          await scanRecursive(itemPath, itemRelativePath);
        } else if (stats.isFile()) {
          files.push(itemRelativePath);
        }
      }
    }

    await scanRecursive(dirPath);
    return files.sort();
  }

  /**
   * 加载所有文件到内存
   * @param inputDir 输入目录
   * @param fileList 文件列表
   */
  private async loadFiles(inputDir: string, fileList: string[]): Promise<void> {
    for (const file of fileList) {
      const filePath = join(inputDir, file);
      const content = await fs.readFile(filePath);
      this.files.set(file, content);
    }
  }

  /**
   * 生成 TOC 和索引
   * @param fileList 文件列表
   * @param inputDir 输入目录
   */
  private async generateTOCAndIndex(
    fileList: string[],
    inputDir: string,
  ): Promise<void> {
    // 构建 TOC
    await this.tocBuilder.buildFromFiles(fileList, inputDir);
    await this.tocBuilder.buildIndex(fileList, inputDir);

    // 生成 TOC 和索引文件
    const hhcContent = this.tocBuilder.generateHHC();
    const hhkContent = this.tocBuilder.generateHHK();

    // 添加到文件列表
    this.files.set('Table of Contents.hhc', Buffer.from(hhcContent, 'utf-8'));
    this.files.set('Index.hhk', Buffer.from(hhkContent, 'utf-8'));
  }

  /**
   * 压缩所有文件
   * @returns 压缩后的数据
   */
  private async compressFiles(): Promise<{
    content: Buffer;
    resetTable: Buffer;
    totalUncompressed: number;
    totalCompressed: number;
  }> {
    const allContent: Buffer[] = [];
    let totalUncompressed = 0;

    // 合并所有文件内容
    for (const [filename, content] of this.files) {
      // 添加文件名长度 + 文件名 + 内容长度 + 内容
      const filenameBuffer = Buffer.from(filename, 'utf-8');
      const filenameLength = Buffer.alloc(4);
      filenameLength.writeUInt32LE(filenameBuffer.length, 0);

      const contentLength = Buffer.alloc(4);
      contentLength.writeUInt32LE(content.length, 0);

      allContent.push(filenameLength);
      allContent.push(filenameBuffer);
      allContent.push(contentLength);
      allContent.push(content);

      totalUncompressed += content.length;
    }

    const combinedContent = Buffer.concat(allContent);

    // 压缩合并后的内容
    const compressed = this.lzxEncoder.compress(combinedContent);

    return {
      content: compressed.compressedData,
      resetTable: compressed.resetTable,
      totalUncompressed,
      totalCompressed: compressed.compressedSize,
    };
  }

  /**
   * 构建目录条目
   * @param compressedData 压缩后的数据
   */
  private buildDirectoryEntries(compressedData: {
    content: Buffer;
    resetTable: Buffer;
    totalUncompressed: number;
    totalCompressed: number;
  }): void {
    void compressedData; // 防止 linter 警告，将来会使用此参数
    this.directoryEntries = [];
    let currentOffset = 0;

    // 为每个文件创建目录条目
    for (const [filename, content] of this.files) {
      const entry: DirectoryEntry = {
        name: filename,
        isCompressed: true,
        offset: currentOffset,
        length: content.length, // 这里应该是压缩后的长度，简化处理
        uncompressedLength: content.length,
        section: 0,
      };

      this.directoryEntries.push(entry);
      currentOffset += content.length;
    }
  }

  /**
   * 写入 CHM 文件
   * @param outputPath 输出路径
   * @param compressedData 压缩数据
   * @param options 打包选项
   */
  private async writeCHMFile(
    outputPath: string,
    compressedData: {
      content: Buffer;
      resetTable: Buffer;
      totalUncompressed: number;
      totalCompressed: number;
    },
    options: PackOptions,
  ): Promise<void> {
    void options; // 防止 linter 警告，将来会使用此参数

    // 确保输出目录存在
    await fs.mkdir(dirname(outputPath), { recursive: true });

    const buffers: Buffer[] = [];

    // 1. 写入 ITSF 头部
    const itsfHeader = this.createITSFHeader(compressedData);
    buffers.push(this.serializeITSFHeader(itsfHeader));

    // 2. 写入 ITSP 头部
    const itspHeader = this.createITSPHeader();
    buffers.push(this.serializeITSPHeader(itspHeader));

    // 3. 写入 LZXC 头部
    const lzxcHeader = this.createLZXCHeader();
    buffers.push(this.serializeLZXCHeader(lzxcHeader));

    // 4. 写入重置表
    buffers.push(compressedData.resetTable);

    // 5. 写入目录信息
    const directoryBuffer = this.serializeDirectory();
    buffers.push(directoryBuffer);

    // 6. 写入压缩内容
    buffers.push(compressedData.content);

    // 合并所有数据并写入文件
    const finalBuffer = Buffer.concat(buffers);
    await fs.writeFile(outputPath, finalBuffer);
  }

  /**
   * 创建 ITSF 头部
   */
  private createITSFHeader(compressedData: {
    content: Buffer;
    resetTable: Buffer;
    totalUncompressed: number;
    totalCompressed: number;
  }): ITSFHeader {
    void compressedData; // 防止 linter 警告，将来会使用此参数

    // 计算目录偏移：ITSF(96) + ITSP(84) + LZXC(40) + resetTable
    const directoryOffset = 96 + 84 + 40 + compressedData.resetTable.length;
    const directoryLength = this.directoryEntries.length * 32; // 每个条目 32 字节

    return {
      signature: 'ITSF',
      version: 3,
      headerLength: 96,
      unknown1: 0,
      timestamp: Math.floor(Date.now() / 1000),
      languageId: 0x409, // 英语
      unknown2: 0,
      unknown3: 0,
      directoryOffset,
      directoryLength,
      unknown4: 0,
    };
  }

  /**
   * 创建 ITSP 头部
   */
  private createITSPHeader(): ITSPHeader {
    return {
      signature: 'ITSP',
      version: 1,
      headerLength: 84,
      unknown1: 0,
      chunkSize: 4096,
      density: 2,
      depth: 2,
      rootIndex: 0,
      firstPMGI: 0,
      lastPMGI: 0,
      unknown2: 0,
    };
  }

  /**
   * 创建 LZXC 头部
   */
  private createLZXCHeader(): LZXCHeader {
    const config = this.lzxEncoder.getConfig();

    return {
      signature: 'LZXC',
      version: 2,
      resetInterval: config.resetInterval || 0x8000,
      windowSize: config.windowSize || 0x8000,
      cacheSize: 0,
      unknown: 0,
    };
  }

  /**
   * 序列化 ITSF 头部
   */
  private serializeITSFHeader(header: ITSFHeader): Buffer {
    const buffer = Buffer.alloc(96);
    let offset = 0;

    // 写入签名
    buffer.write(header.signature, offset, 4, 'ascii');
    offset += 4;

    // 写入其他字段
    buffer.writeUInt32LE(header.version, offset);
    offset += 4;
    buffer.writeUInt32LE(header.headerLength, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown1, offset);
    offset += 4;
    buffer.writeUInt32LE(header.timestamp, offset);
    offset += 4;
    buffer.writeUInt32LE(header.languageId, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown2, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown3, offset);
    offset += 4;
    buffer.writeUInt32LE(header.directoryOffset, offset);
    offset += 4;
    buffer.writeUInt32LE(header.directoryLength, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown4, offset);

    return buffer;
  }

  /**
   * 序列化 ITSP 头部
   */
  private serializeITSPHeader(header: ITSPHeader): Buffer {
    const buffer = Buffer.alloc(84);
    let offset = 0;

    buffer.write(header.signature, offset, 4, 'ascii');
    offset += 4;
    buffer.writeUInt32LE(header.version, offset);
    offset += 4;
    buffer.writeUInt32LE(header.headerLength, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown1, offset);
    offset += 4;
    buffer.writeUInt32LE(header.chunkSize, offset);
    offset += 4;
    buffer.writeUInt32LE(header.density, offset);
    offset += 4;
    buffer.writeUInt32LE(header.depth, offset);
    offset += 4;
    buffer.writeUInt32LE(header.rootIndex, offset);
    offset += 4;
    buffer.writeUInt32LE(header.firstPMGI, offset);
    offset += 4;
    buffer.writeUInt32LE(header.lastPMGI, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown2, offset);

    return buffer;
  }

  /**
   * 序列化 LZXC 头部
   */
  private serializeLZXCHeader(header: LZXCHeader): Buffer {
    const buffer = Buffer.alloc(40);
    let offset = 0;

    buffer.write(header.signature, offset, 4, 'ascii');
    offset += 4;
    buffer.writeUInt32LE(header.version, offset);
    offset += 4;
    buffer.writeUInt32LE(header.resetInterval, offset);
    offset += 4;
    buffer.writeUInt32LE(header.windowSize, offset);
    offset += 4;
    buffer.writeUInt32LE(header.cacheSize, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown, offset);

    return buffer;
  }

  /**
   * 序列化目录
   */
  private serializeDirectory(): Buffer {
    const entrySize = 32;
    const buffer = Buffer.alloc(this.directoryEntries.length * entrySize);
    let offset = 0;

    for (const entry of this.directoryEntries) {
      // 写入文件名长度
      const nameBuffer = Buffer.from(entry.name, 'utf-8');
      buffer.writeUInt16LE(nameBuffer.length, offset);
      offset += 2;

      // 写入文件名
      nameBuffer.copy(buffer, offset);
      offset += Math.min(nameBuffer.length, 24); // 最大 24 字节文件名

      // 填充剩余字节
      while (offset % entrySize !== 26) {
        buffer.writeUInt8(0, offset);
        offset++;
      }

      // 写入其他属性
      buffer.writeUInt8(entry.isCompressed ? 1 : 0, offset);
      offset += 1;
      buffer.writeUInt8(entry.section, offset);
      offset += 1;
      buffer.writeUInt32LE(entry.offset, offset);
      offset += 4;

      // 确保偏移对齐到条目边界
      offset = Math.ceil(offset / entrySize) * entrySize;
    }

    return buffer;
  }
}

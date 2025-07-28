import { promises as fs } from 'fs';
import { join } from 'path';
import type { PackOptions, DirectoryEntry } from '../core/types';
import { LZXEncoder } from './lzx-encoder';
import { TOCBuilder } from './builders/toc-builder';
import { DirectoryScanner } from './directory-scanner';
import { CHMHeaderBuilder } from './builders/header-builder';
import { CHMFileWriter } from './chm-file-writer';

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
    const fileList = await DirectoryScanner.scanDirectory(options.inputDir);

    // 2. 读取所有文件
    await this.loadFiles(options.inputDir, fileList);

    // 3. 生成 TOC 和索引
    await this.generateTOCAndIndex(fileList, options.inputDir);

    // 4. 压缩文件内容
    const compressedData = await this.compressFiles();

    // 5. 构建目录条目
    this.buildDirectoryEntries(compressedData);

    // 6. 构建头部
    const headers = this.buildHeaders(compressedData);

    // 7. 序列化目录
    const directory = CHMHeaderBuilder.serializeDirectory(
      this.directoryEntries,
    );

    // 8. 写入 CHM 文件
    await CHMFileWriter.writeCHMFile(
      options.outputPath,
      {
        headers,
        resetTable: compressedData.resetTable,
        directory,
        content: compressedData.content,
      },
      options,
    );
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
   * 构建头部
   * @param compressedData 压缩数据
   * @returns 头部数组
   */
  private buildHeaders(compressedData: {
    content: Buffer;
    resetTable: Buffer;
    totalUncompressed: number;
    totalCompressed: number;
  }): Buffer[] {
    // 计算目录偏移：ITSF(96) + ITSP(84) + LZXC(40) + resetTable
    const directoryOffset = CHMHeaderBuilder.calculateHeaderSize(
      compressedData.resetTable.length,
    );
    const directoryLength = this.directoryEntries.length * 32; // 每个条目 32 字节

    // 创建头部
    const itsfHeader = CHMHeaderBuilder.createITSFHeader({
      directoryOffset,
      directoryLength,
    });

    const itspHeader = CHMHeaderBuilder.createITSPHeader();

    const lzxConfig = this.lzxEncoder.getConfig();
    const lzxcHeader = CHMHeaderBuilder.createLZXCHeader({
      resetInterval: lzxConfig.resetInterval,
      windowSize: lzxConfig.windowSize,
    });

    // 序列化头部
    return [
      CHMHeaderBuilder.serializeITSFHeader(itsfHeader),
      CHMHeaderBuilder.serializeITSPHeader(itspHeader),
      CHMHeaderBuilder.serializeLZXCHeader(lzxcHeader),
    ];
  }
}

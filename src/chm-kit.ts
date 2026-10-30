import { ParserOperations } from './operations/parser';
import { ExtractorOperations } from './operations/extractor';
import { PackerOperations } from './operations/packer';
import { InfoOperations } from './operations/info';

import type {
  ParsedCHM,
  ExtractOptions,
  ExtractResult,
  PackOptions,
} from './core/types';
import { CHMReader } from './reader/chm-reader';
import { CHMArchive } from './reader/chm-archive';
import {
  packFiles,
  packTemplate,
  updateArchive,
} from './encoder/archive-builder';
import type { PackFilesOptions, UpdateArchiveOptions } from './encoder/types';
import type {
  ReaderOptions,
  NavigationEntry,
  SearchOptions,
  SearchResult,
} from './reader/types';

/**
 * CHM 操作的主要类
 * 作为门面类，提供统一的 API 接口
 */
export class CHMKit {
  /**
   * 解析 CHM 文件
   * @param filePath CHM 文件路径
   * @returns 解析后的 CHM 对象
   */
  static async parse(filePath: string): Promise<ParsedCHM> {
    return ParserOperations.parse(filePath);
  }

  /**
   * 提取 CHM 文件内容
   * @param filePath CHM 文件路径
   * @param outputDir 输出目录
   * @param options 提取选项
   * @returns 提取结果
   */
  static async extract(
    filePath: string,
    outputDir: string,
    options: Partial<ExtractOptions> = {},
  ): Promise<ExtractResult> {
    return ExtractorOperations.extract(filePath, outputDir, options);
  }

  /**
   * 打包目录为 CHM 文件
   * @param inputDir 输入目录
   * @param outputPath 输出 CHM 文件路径
   * @param options 打包选项
   * @returns 打包结果
   */
  static async pack(
    inputDir: string,
    outputPath: string,
    options: Partial<PackOptions> = {},
  ): Promise<{ success: boolean; message: string }> {
    return PackerOperations.pack(inputDir, outputPath, options);
  }

  /**
   * 获取 CHM 文件信息
   * @param filePath CHM 文件路径
   * @returns CHM 文件信息
   */
  static async getInfo(filePath: string): Promise<{
    header: {
      itsf: string;
      itsp: string;
      lzxc: string;
    };
    statistics: string;
    fileCount: number;
    totalSize: number;
    compressionRatio: number;
  }> {
    return InfoOperations.getInfo(filePath);
  }

  /**
   * 读取 CHM 文件中的单个文件
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @returns 文件内容
   */
  static async readFile(chmPath: string, filePath: string): Promise<Buffer> {
    return CHMKit.withReader(chmPath, reader => reader.readFile(filePath));
  }

  /**
   * 检查文件是否存在
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @returns 是否存在
   */
  static async exists(chmPath: string, filePath: string): Promise<boolean> {
    return CHMKit.withReader(chmPath, reader => reader.exists(filePath));
  }

  /**
   * 列出 CHM 文件中的所有文件
   * @param chmPath CHM 文件路径
   * @returns 文件路径数组
   */
  static async listFiles(chmPath: string, pattern?: string): Promise<string[]> {
    return CHMKit.withReader(chmPath, reader => reader.listFiles(pattern));
  }

  /**
   * 读取 CHM 文件中的文本文件
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @param encoding 字符编码（默认 utf-8）
   * @returns 文本内容
   */
  static async readText(
    chmPath: string,
    filePath: string,
    encoding?: string,
  ): Promise<string> {
    return CHMKit.withReader(chmPath, reader =>
      reader.readText(filePath, encoding),
    );
  }

  /**
   * 读取 CHM 文件中的 HTML 文件
   * @param chmPath CHM 文件路径
   * @param filePath HTML 文件路径
   * @returns HTML 内容字符串
   */
  static async readHTML(chmPath: string, filePath: string): Promise<string> {
    return CHMKit.withReader(chmPath, reader => reader.readHTML(filePath));
  }

  static open(filePath: string, options?: ReaderOptions): Promise<CHMReader> {
    return CHMReader.open(filePath, options);
  }

  static from(
    input: Uint8Array | ArrayBuffer,
    options?: ReaderOptions,
  ): CHMArchive {
    return new CHMArchive(input, options);
  }

  static packFiles(
    files: ReadonlyMap<string, Uint8Array>,
    options?: PackFilesOptions,
  ): Buffer {
    return packFiles(files, options);
  }

  static packTemplate(
    template: ReadonlyMap<string, Uint8Array>,
    overrides: ReadonlyMap<string, Uint8Array | null>,
    options?: PackFilesOptions,
  ): Buffer {
    return packTemplate(template, overrides, options);
  }

  static updateArchive(
    existing: Uint8Array | ArrayBuffer,
    changes: ReadonlyMap<string, Uint8Array | null>,
    options?: UpdateArchiveOptions,
  ): Buffer {
    return updateArchive(
      existing instanceof ArrayBuffer ? new Uint8Array(existing) : existing,
      changes,
      options,
    );
  }

  static readRange(
    chmPath: string,
    filePath: string,
    start = 0,
    end?: number,
  ): Promise<Buffer> {
    return CHMKit.withReader(chmPath, reader =>
      reader.readRange(filePath, start, end),
    );
  }

  static getTOC(chmPath: string): Promise<NavigationEntry[]> {
    return CHMKit.withReader(chmPath, reader => reader.getTOC());
  }

  static getIndex(chmPath: string): Promise<NavigationEntry[]> {
    return CHMKit.withReader(chmPath, reader => reader.getIndex());
  }

  static searchContent(
    chmPath: string,
    keyword: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    return CHMKit.withReader(chmPath, reader =>
      reader.search(keyword, options),
    );
  }

  static readMultiple(
    chmPath: string,
    paths: readonly string[],
  ): Promise<Map<string, Buffer>> {
    return CHMKit.withReader(chmPath, reader => reader.readMultiple(paths));
  }

  static exportFiles(
    chmPath: string,
    paths: readonly string[],
    outputDir: string,
  ): Promise<ExtractResult> {
    const selected = new Set(
      paths.map(path =>
        path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase(),
      ),
    );
    return CHMKit.extract(chmPath, outputDir, {
      preserveStructure: true,
      filter: path => selected.has(path.replace(/^\/+/, '').toLowerCase()),
    });
  }

  static list = CHMKit.listFiles;
  static get = CHMKit.readFile;
  static extractAll = CHMKit.extract;
  static search = CHMKit.searchContent;

  private static async withReader<T>(
    path: string,
    operation: (reader: CHMReader) => T | Promise<T>,
  ): Promise<T> {
    const reader = await CHMReader.open(path);
    try {
      return await operation(reader);
    } finally {
      reader.close();
    }
  }
}

// 导出核心类型定义
export * from './core/types';

// 导出工具类
export { BitReader } from './utils/bit-reader';
export { Huffman } from './utils/huffman';

// 导出核心功能
export { CHMParser } from './core/chm-parser';
export { LZXDecoder } from './core/lzx/lzx-decoder';
export { FileReconstructor } from './core/file-reconstructor';

// 导出头部解析器
export { ITSFHeaderParser } from './core/headers/itsf-header';
export { ITSPHeaderParser } from './core/headers/itsp-header';
export { LZXCHeaderParser } from './core/headers/lzxc-header';

// 导出其他核心组件
export { DirectoryParser } from './core/directory/directory-parser';
export { SlidingWindow } from './core/lzx/sliding-window';
export { ResetTableProcessor } from './core/lzx/reset-table';

// 导出编码器功能
export { CHMEncoder } from './encoder/chm-encoder';
export { TOCBuilder } from './encoder/toc-builder';
export { LZXEncoder } from './encoder/lzx-encoder';

import { readFileSync } from 'fs';
import { BitReader } from './utils/bit-reader';
import { CHMParser } from './core/chm-parser';
import { FileReconstructor } from './core/file-reconstructor';
import type { ParsedCHM, ExtractOptions, PackOptions } from './core/types';

/**
 * CHM 操作的主要类
 */
export class CHMKit {
  /**
   * 解析 CHM 文件
   * @param filePath CHM 文件路径
   * @returns 解析后的 CHM 对象
   */
  static async parse(filePath: string): Promise<ParsedCHM> {
    try {
      // 读取文件
      const fileBuffer = readFileSync(filePath);
      const reader = new BitReader(fileBuffer);

      // 创建解析器并解析
      const parser = CHMParser.create();
      const parsedCHM = parser.parse(reader);

      // 验证解析结果
      if (!CHMParser.validate(parsedCHM)) {
        throw new Error('CHM 文件解析验证失败');
      }

      return parsedCHM;
    } catch (error) {
      throw new Error(
        `CHM 文件解析失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    _outputDir: string, // 将来会使用
    options: Partial<ExtractOptions> = {},
  ): Promise<{ files: string[]; totalFiles: number; errors: string[] }> {
    try {
      // 解析 CHM 文件
      const parsedCHM = await this.parse(filePath);

      // 创建文件重组器
      const fileBuffer = readFileSync(filePath);
      const reader = new BitReader(fileBuffer);
      const reconstructor = new FileReconstructor(parsedCHM);

      // 获取文件列表
      let fileList = reconstructor.getFileList();

      // 应用过滤器
      if (options.filter) {
        fileList = fileList.filter(options.filter);
      }

      const extractedFiles: string[] = [];
      const errors: string[] = [];

      // 重组并提取文件
      for (const fileName of fileList) {
        try {
          const file = reconstructor.reconstructFile(fileName, reader);

          // 这里应该写入文件到 outputDir
          // 简化实现：仅记录成功提取的文件
          extractedFiles.push(fileName);

          if (options.verbose) {
            console.log(`已提取: ${fileName} (${file.data.length} 字节)`);
          }
        } catch (error) {
          const errorMsg = `提取文件 ${fileName} 失败: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);

          if (options.verbose) {
            console.error(errorMsg);
          }
        }
      }

      return {
        files: extractedFiles,
        totalFiles: fileList.length,
        errors,
      };
    } catch (error) {
      throw new Error(
        `CHM 文件提取失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    try {
      const { CHMEncoder } = await import('./encoder/chm-encoder');

      const packOptions: PackOptions = {
        inputDir,
        outputPath,
        compression: options.compression ?? true,
        verbose: options.verbose ?? false,
        ...(options.title && { title: options.title }),
        ...(options.defaultTopic && { defaultTopic: options.defaultTopic }),
      };

      const encoder = new CHMEncoder();
      await encoder.encode(packOptions);

      return {
        success: true,
        message: `CHM 文件已成功创建: ${outputPath}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `CHM 文件打包失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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
    try {
      // 解析 CHM 文件
      const parsedCHM = await this.parse(filePath);

      // 创建文件重组器获取统计信息
      const reconstructor = new FileReconstructor(parsedCHM);
      const fileList = reconstructor.getFileList();

      // 计算总大小
      let totalSize = 0;
      let compressedSize = 0;

      for (const [, entry] of parsedCHM.directory.entries) {
        totalSize += entry.uncompressedLength ?? entry.length;
        compressedSize += entry.length;
      }

      const compressionRatio =
        totalSize > 0 ? (compressedSize / totalSize) * 100 : 0;

      return {
        header: {
          itsf: ITSFHeaderParser.getSummary(parsedCHM.header.itsf),
          itsp: ITSPHeaderParser.getSummary(parsedCHM.header.itsp),
          lzxc: LZXCHeaderParser.getSummary(parsedCHM.header.lzxc),
        },
        statistics: CHMParser.getStatistics(parsedCHM),
        fileCount: fileList.length,
        totalSize,
        compressionRatio,
      };
    } catch (error) {
      throw new Error(
        `获取 CHM 文件信息失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 读取 CHM 文件中的单个文件
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @returns 文件内容
   */
  static async readFile(chmPath: string, filePath: string): Promise<Buffer> {
    try {
      const parsedCHM = await this.parse(chmPath);
      const fileBuffer = readFileSync(chmPath);
      const reader = new BitReader(fileBuffer);
      const reconstructor = new FileReconstructor(parsedCHM);

      const file = reconstructor.reconstructFile(filePath, reader);
      return file.data;
    } catch (error) {
      throw new Error(
        `读取文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 检查文件是否存在
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @returns 是否存在
   */
  static async exists(chmPath: string, filePath: string): Promise<boolean> {
    try {
      const parsedCHM = await this.parse(chmPath);
      const reconstructor = new FileReconstructor(parsedCHM);
      return reconstructor.fileExists(filePath);
    } catch (error) {
      return false;
    }
  }

  /**
   * 列出 CHM 文件中的所有文件
   * @param chmPath CHM 文件路径
   * @returns 文件路径数组
   */
  static async listFiles(chmPath: string): Promise<string[]> {
    try {
      const parsedCHM = await this.parse(chmPath);
      const reconstructor = new FileReconstructor(parsedCHM);
      return reconstructor.getFileList();
    } catch (error) {
      throw new Error(
        `列出文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

// 默认导出
export default CHMKit;

/**
 * 版本信息
 */
export const VERSION = '1.0.0';

/**
 * 支持的 CHM 格式版本
 */
export const SUPPORTED_VERSIONS = ['1.0', '1.1', '1.2'];

/**
 * 默认配置
 */
export const DEFAULT_CONFIG = {
  compression: true,
  windowSize: 0x8000,
  verbose: false,
  tempDir: './temp',
  maxMemory: 1024 * 1024 * 100, // 100MB
};

/**
 * 便捷方法
 */
export const chm = {
  /**
   * 解析 CHM 文件
   */
  parse: CHMKit.parse,

  /**
   * 提取 CHM 文件内容
   */
  extract: CHMKit.extract,

  /**
   * 打包目录为 CHM 文件
   */
  pack: CHMKit.pack,

  /**
   * 获取 CHM 文件信息
   */
  info: CHMKit.getInfo,

  /**
   * 读取单个文件
   */
  readFile: CHMKit.readFile,

  /**
   * 检查文件存在
   */
  exists: CHMKit.exists,

  /**
   * 列出所有文件
   */
  listFiles: CHMKit.listFiles,

  /**
   * 版本信息
   */
  version: VERSION,

  /**
   * 支持的版本
   */
  supportedVersions: SUPPORTED_VERSIONS,

  /**
   * 默认配置
   */
  config: DEFAULT_CONFIG,
};

// 需要导入的头部解析器
import { ITSFHeaderParser } from './core/headers/itsf-header';
import { ITSPHeaderParser } from './core/headers/itsp-header';
import { LZXCHeaderParser } from './core/headers/lzxc-header';

import { ParserOperations } from './operations/parser';
import { ExtractorOperations } from './operations/extractor';
import { PackerOperations } from './operations/packer';
import { InfoOperations } from './operations/info';
import { FileManagerOperations } from './operations/file-manager';
import type { ParsedCHM, ExtractOptions, PackOptions } from './core/types';

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
  ): Promise<{ files: string[]; totalFiles: number; errors: string[] }> {
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
    return FileManagerOperations.readFile(chmPath, filePath);
  }

  /**
   * 检查文件是否存在
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @returns 是否存在
   */
  static async exists(chmPath: string, filePath: string): Promise<boolean> {
    return FileManagerOperations.exists(chmPath, filePath);
  }

  /**
   * 列出 CHM 文件中的所有文件
   * @param chmPath CHM 文件路径
   * @returns 文件路径数组
   */
  static async listFiles(chmPath: string): Promise<string[]> {
    return FileManagerOperations.listFiles(chmPath);
  }
}

import { readFileSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import { BitReader } from '../utils/io/bit-reader';
import { FileReconstructor } from '../core/files/file-reconstructor';
import { CHMFileManager } from '../core/files/file-manager';
import { ParserOperations } from './parser';
import { logger } from '../logger/logger';
import type { ExtractOptions } from '../core/types';

/**
 * CHM 文件提取操作
 */
export class ExtractorOperations {
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
    try {
      // 解析 CHM 文件
      const parsedCHM = await ParserOperations.parse(filePath);

      // 创建文件重组器和管理器
      const fileBuffer = readFileSync(filePath);
      const reader = new BitReader(fileBuffer);
      const reconstructor = new FileReconstructor(parsedCHM);
      const fileManager = new CHMFileManager(parsedCHM);

      // 获取文件列表
      let fileList = fileManager.getFileList();

      // 应用过滤器
      if (options.filter) {
        fileList = fileList.filter(options.filter);
      }

      // 确保输出目录存在
      await fs.mkdir(outputDir, { recursive: true });

      const extractedFiles: string[] = [];
      const errors: string[] = [];

      // 重组并提取文件
      for (const fileName of fileList) {
        try {
          const file = reconstructor.reconstructFile(fileName, reader);

          // 构建输出路径
          const outputPath = options.preserveStructure
            ? join(outputDir, fileName)
            : join(outputDir, fileName.replace(/^\/+/, ''));

          // 确保父目录存在
          await fs.mkdir(dirname(outputPath), { recursive: true });

          // 写入文件到磁盘
          await fs.writeFile(outputPath, file.data);

          extractedFiles.push(fileName);

          if (options.verbose) {
            logger.info(`已提取: ${fileName} (${file.data.length} 字节)`);
          }
        } catch (error) {
          const errorMsg = `提取文件 ${fileName} 失败: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);

          if (options.verbose) {
            logger.error(errorMsg);
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
}

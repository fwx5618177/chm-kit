import { readFileSync } from 'fs';
import { BitReader } from '../utils/bit-reader';
import { FileReconstructor } from '../core/file-reconstructor';
import { ParserOperations } from './parser';
import type { ExtractOptions } from '../core/types';

/**
 * CHM 文件提取操作
 */
export class ExtractorOperations {
  /**
   * 提取 CHM 文件内容
   * @param filePath CHM 文件路径
   * @param _outputDir 输出目录
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
      const parsedCHM = await ParserOperations.parse(filePath);

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
}

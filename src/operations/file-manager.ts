import { readFileSync } from 'fs';
import { BitReader } from '../utils/bit-reader';
import { FileReconstructor } from '../core/file-reconstructor';
import { ParserOperations } from './parser';

/**
 * CHM 文件管理操作
 */
export class FileManagerOperations {
  /**
   * 读取 CHM 文件中的单个文件
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @returns 文件内容
   */
  static async readFile(chmPath: string, filePath: string): Promise<Buffer> {
    try {
      const parsedCHM = await ParserOperations.parse(chmPath);
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
      const parsedCHM = await ParserOperations.parse(chmPath);
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
      const parsedCHM = await ParserOperations.parse(chmPath);
      const reconstructor = new FileReconstructor(parsedCHM);
      return reconstructor.getFileList();
    } catch (error) {
      throw new Error(
        `列出文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

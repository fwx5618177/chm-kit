import { readFileSync } from 'fs';
import { BitReader } from '../utils/io/bit-reader';
import { FileReconstructor } from '../core/files/file-reconstructor';
import { CHMFileManager } from '../core/files/file-manager';
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
      const fileManager = new CHMFileManager(parsedCHM);
      return fileManager.fileExists(filePath);
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
      const fileManager = new CHMFileManager(parsedCHM);
      return fileManager.getFileList();
    } catch (error) {
      throw new Error(
        `列出文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 读取 CHM 文件中的单个文件并返回文本
   * @param chmPath CHM 文件路径
   * @param filePath 文件路径
   * @param encoding 字符编码方式（默认 utf-8）
   * @returns 文本内容
   */
  static async readText(
    chmPath: string,
    filePath: string,
    encoding: BufferEncoding = 'utf-8',
  ): Promise<string> {
    const buffer = await FileManagerOperations.readFile(chmPath, filePath);
    return buffer.toString(encoding);
  }

  /**
   * 读取 CHM 文件中的 HTML 文件内容
   * @param chmPath CHM 文件路径
   * @param filePath HTML 文件路径
   * @returns HTML 内容字符串
   */
  static async readHTML(chmPath: string, filePath: string): Promise<string> {
    const buffer = await FileManagerOperations.readFile(chmPath, filePath);
    // 尝试从 BOM 检测编码，默认使用 utf-8
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.toString('utf16le');
    }
    return buffer.toString('utf-8');
  }
}

import { readFileSync } from 'fs';
import { BitReader } from '../utils/io/bit-reader';
import { CHMParserFactory } from '../core/parser/parser-factory';
import { CHMParserValidator } from '../core/parser/parser-validator';
import type { ParsedCHM } from '../core/types';

/**
 * CHM 文件解析操作
 */
export class ParserOperations {
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
      const parser = CHMParserFactory.create();
      const parsedCHM = parser.parse(reader);

      // 验证解析结果
      if (!CHMParserValidator.validate(parsedCHM)) {
        throw new Error('CHM 文件解析验证失败');
      }

      return parsedCHM;
    } catch (error) {
      throw new Error(
        `CHM 文件解析失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

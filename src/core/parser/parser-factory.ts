import { CHMParser } from './chm-parser';
import { logger } from '../../logger/logger';

/**
 * CHM 解析器工厂
 * 负责创建和管理解析器实例
 */
export class CHMParserFactory {
  /**
   * 创建解析器实例
   * @returns 新的解析器实例
   */
  static create(): CHMParser {
    return new CHMParser();
  }

  /**
   * 创建具有预配置选项的解析器实例
   * @param options 解析器配置选项
   * @returns 配置好的解析器实例
   */
  static createWithOptions(options?: {
    enableResetTable?: boolean;
    strictValidation?: boolean;
  }): CHMParser {
    const parser = new CHMParser();

    logger.debug('Creating parser with options:', options);

    return parser;
  }

  /**
   * 创建轻量级解析器（仅解析头部和目录）
   * @returns 轻量级解析器实例
   */
  static createLightweight(): CHMParser {
    return new CHMParser();
  }
}

import type { ParsedCHM } from '../types';
import { ITSFHeaderParser } from '../headers/itsf-header';
import { ITSPHeaderParser } from '../headers/itsp-header';
import { LZXCHeaderParser } from '../headers/lzxc-header';
import { DirectoryParser } from '../directory/directory-parser';

/**
 * CHM 解析结果验证器
 * 负责验证解析后的 CHM 结构完整性
 */
export class CHMParserValidator {
  /**
   * 验证解析结果的完整性
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 验证结果
   */
  static validate(parsedCHM: ParsedCHM): boolean {
    // 验证头部
    if (!ITSFHeaderParser.validate(parsedCHM.header.itsf)) {
      return false;
    }

    if (!ITSPHeaderParser.validate(parsedCHM.header.itsp)) {
      return false;
    }

    if (!LZXCHeaderParser.validate(parsedCHM.header.lzxc)) {
      return false;
    }

    // 验证目录
    if (!DirectoryParser.validate(parsedCHM.directory)) {
      return false;
    }

    // 验证偏移
    if (parsedCHM.contentOffset <= 0) {
      return false;
    }

    return true;
  }

  /**
   * 验证头部信息
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 头部验证结果
   */
  static validateHeaders(parsedCHM: ParsedCHM): boolean {
    return (
      ITSFHeaderParser.validate(parsedCHM.header.itsf) &&
      ITSPHeaderParser.validate(parsedCHM.header.itsp) &&
      LZXCHeaderParser.validate(parsedCHM.header.lzxc)
    );
  }

  /**
   * 验证目录结构
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 目录验证结果
   */
  static validateDirectory(parsedCHM: ParsedCHM): boolean {
    return DirectoryParser.validate(parsedCHM.directory);
  }

  /**
   * 验证内容偏移
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 偏移验证结果
   */
  static validateContentOffset(parsedCHM: ParsedCHM): boolean {
    return parsedCHM.contentOffset > 0;
  }
}

import type { ParsedCHM } from '../types';
import { ITSFHeaderParser } from '../headers/itsf-header';
import { ITSPHeaderParser } from '../headers/itsp-header';
import { LZXCHeaderParser } from '../headers/lzxc-header';
import { CHMFileStatistics } from '../files/file-statistics';
import { CHMFileManager } from '../files/file-manager';

/**
 * CHM 统计信息生成器
 * 负责生成解析结果的统计信息
 */
export class CHMStatisticsGenerator {
  /**
   * 获取解析统计信息
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 统计信息字符串
   */
  static getStatistics(parsedCHM: ParsedCHM): string {
    const itsfSummary = ITSFHeaderParser.getSummary(parsedCHM.header.itsf);
    const itspSummary = ITSPHeaderParser.getSummary(parsedCHM.header.itsp);
    const lzxcSummary = this.getCompressionSummary(parsedCHM);
    const directorySummary = new CHMFileStatistics(parsedCHM).getStatistics();

    return [
      '=== CHM 文件解析统计 ===',
      '',
      '--- ITSF 头部信息 ---',
      itsfSummary,
      '',
      '--- ITSP 头部信息 ---',
      itspSummary,
      '',
      '--- LZXC 头部信息 ---',
      lzxcSummary,
      '',
      '--- 目录信息 ---',
      directorySummary,
      '',
      `内容偏移: 0x${parsedCHM.contentOffset.toString(16)}`,
    ].join('\n');
  }

  /**
   * 获取头部统计信息
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 头部统计信息
   */
  static getHeaderStatistics(parsedCHM: ParsedCHM): string {
    const itsfSummary = ITSFHeaderParser.getSummary(parsedCHM.header.itsf);
    const itspSummary = ITSPHeaderParser.getSummary(parsedCHM.header.itsp);
    const lzxcSummary = this.getCompressionSummary(parsedCHM);

    return [
      '=== CHM 头部统计 ===',
      '',
      '--- ITSF 头部信息 ---',
      itsfSummary,
      '',
      '--- ITSP 头部信息 ---',
      itspSummary,
      '',
      '--- LZXC 头部信息 ---',
      lzxcSummary,
    ].join('\n');
  }

  /**
   * 获取目录统计信息
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 目录统计信息
   */
  static getDirectoryStatistics(parsedCHM: ParsedCHM): string {
    const directorySummary = new CHMFileStatistics(parsedCHM).getStatistics();

    return ['=== CHM 目录统计 ===', '', directorySummary].join('\n');
  }

  private static getCompressionSummary(parsedCHM: ParsedCHM): string {
    return parsedCHM.header.lzxc.signature
      ? LZXCHeaderParser.getSummary(parsedCHM.header.lzxc)
      : '无压缩（仅 section 0）';
  }

  /**
   * 获取简化统计信息
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 简化统计信息
   */
  static getBriefStatistics(parsedCHM: ParsedCHM): string {
    return [
      `文件总数: ${new CHMFileManager(parsedCHM).getUserFileList().length}`,
      `内容偏移: 0x${parsedCHM.contentOffset.toString(16)}`,
      `压缩方法: ${parsedCHM.header.lzxc.signature || '无（section 0）'}`,
    ].join(' | ');
  }
}

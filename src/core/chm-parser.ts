import type { ParsedCHM, CHMHeader, CHMDirectory } from './types';
import type { BitReader } from '../utils/bit-reader';
import { ITSFHeaderParser } from './headers/itsf-header';
import { ITSPHeaderParser } from './headers/itsp-header';
import { LZXCHeaderParser } from './headers/lzxc-header';
import { DirectoryParser } from './directory/directory-parser';
import { ResetTableProcessor } from './lzx/reset-table';

/**
 * CHM 文件主解析器
 * 负责协调各个子解析器完成完整的 CHM 文件解析
 */
export class CHMParser {
  private resetTableProcessor: ResetTableProcessor;

  constructor() {
    this.resetTableProcessor = new ResetTableProcessor();
  }

  /**
   * 解析完整的 CHM 文件
   * @param reader 位读取器
   * @returns 解析后的 CHM 结构
   */
  parse(reader: BitReader): ParsedCHM {
    // 解析头部信息
    const header = this.parseHeaders(reader);

    // 定位到目录位置
    this.seekToDirectory(reader, header.itsf.directoryOffset);

    // 解析目录结构
    const directory = this.parseDirectory(reader, header.itsp);

    // 解析重置表
    const resetTable = this.parseResetTable(reader);

    // 计算内容偏移
    const contentOffset = this.calculateContentOffset(header);

    return {
      header,
      directory,
      resetTable,
      contentOffset,
    };
  }

  /**
   * 解析所有头部信息
   * @param reader 位读取器
   * @returns CHM 头部信息
   */
  private parseHeaders(reader: BitReader): CHMHeader {
    // 解析 ITSF 头部
    const itsf = ITSFHeaderParser.parse(reader);

    // 验证 ITSF 头部
    if (!ITSFHeaderParser.validate(itsf)) {
      throw new Error('ITSF 头部验证失败');
    }

    // 解析 ITSP 头部
    const itsp = ITSPHeaderParser.parse(reader);

    // 验证 ITSP 头部
    if (!ITSPHeaderParser.validate(itsp)) {
      throw new Error('ITSP 头部验证失败');
    }

    // 解析 LZXC 头部
    const lzxc = LZXCHeaderParser.parse(reader);

    // 验证 LZXC 头部
    if (!LZXCHeaderParser.validate(lzxc)) {
      throw new Error('LZXC 头部验证失败');
    }

    return {
      itsf,
      itsp,
      lzxc,
    };
  }

  /**
   * 定位到目录位置
   * @param reader 位读取器
   * @param directoryOffset 目录偏移
   */
  private seekToDirectory(reader: BitReader, directoryOffset: number): void {
    // 计算需要跳过的字节数
    const currentPosition = Math.floor(reader.position / 8);
    const skipBytes = directoryOffset - currentPosition;

    if (skipBytes > 0) {
      // 跳过到目录位置
      for (let i = 0; i < skipBytes; i++) {
        reader.read(8);
      }
    } else if (skipBytes < 0) {
      throw new Error(`无效的目录偏移: ${directoryOffset}`);
    }

    // 确保字节对齐
    reader.align();
  }

  /**
   * 解析目录结构
   * @param reader 位读取器
   * @param itspHeader ITSP 头部信息
   * @returns 目录结构
   */
  private parseDirectory(reader: BitReader, itspHeader: any): CHMDirectory {
    const directory = DirectoryParser.parse(reader, itspHeader);

    // 验证目录结构
    if (!DirectoryParser.validate(directory)) {
      throw new Error('目录结构验证失败');
    }

    return directory;
  }

  /**
   * 解析重置表
   * @param reader 位读取器
   * @returns 重置表
   */
  private parseResetTable(reader: BitReader) {
    try {
      return this.resetTableProcessor.parseResetTable(reader);
    } catch (error) {
      // 某些 CHM 文件可能没有重置表，这里提供默认值
      console.warn('重置表解析失败，使用默认值:', error);
      return {
        version: 2,
        blockCount: 0,
        entrySize: 8,
        tableOffset: 0,
        uncompressedLength: 0,
        compressedLength: 0,
        blockSize: 0x8000,
        entries: [],
      };
    }
  }

  /**
   * 计算内容偏移
   * @param header CHM 头部信息
   * @returns 内容偏移量
   */
  private calculateContentOffset(header: CHMHeader): number {
    // 内容通常在目录之后
    return header.itsf.directoryOffset + header.itsf.directoryLength;
  }

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
   * 获取解析统计信息
   * @param parsedCHM 解析后的 CHM 结构
   * @returns 统计信息字符串
   */
  static getStatistics(parsedCHM: ParsedCHM): string {
    const itsfSummary = ITSFHeaderParser.getSummary(parsedCHM.header.itsf);
    const itspSummary = ITSPHeaderParser.getSummary(parsedCHM.header.itsp);
    const lzxcSummary = LZXCHeaderParser.getSummary(parsedCHM.header.lzxc);
    const directorySummary = DirectoryParser.getSummary(parsedCHM.directory);

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
   * 创建解析器实例的工厂方法
   * @returns 新的解析器实例
   */
  static create(): CHMParser {
    return new CHMParser();
  }

  /**
   * 快速解析（仅解析头部和目录，跳过重置表）
   * @param reader 位读取器
   * @returns 简化的解析结果
   */
  quickParse(reader: BitReader): Omit<ParsedCHM, 'resetTable'> {
    const header = this.parseHeaders(reader);
    this.seekToDirectory(reader, header.itsf.directoryOffset);
    const directory = this.parseDirectory(reader, header.itsp);
    const contentOffset = this.calculateContentOffset(header);

    return {
      header,
      directory,
      contentOffset,
    };
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.resetTableProcessor.reset();
  }

  /**
   * 获取解析器状态信息
   * @returns 状态信息字符串
   */
  getStatus(): string {
    return [
      '=== CHM 解析器状态 ===',
      `重置表处理器状态: ${this.resetTableProcessor.validate() ? '正常' : '未初始化'}`,
    ].join('\n');
  }
}

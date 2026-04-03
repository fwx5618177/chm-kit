import type {
  ParsedCHM,
  CHMHeader,
  CHMDirectory,
  LZXCHeader,
  ITSPHeader,
} from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { ITSFHeaderParser } from '../headers/itsf-header';
import { ITSPHeaderParser } from '../headers/itsp-header';
import { LZXCHeaderParser } from '../headers/lzxc-header';
import { DirectoryParser } from '../directory/directory-parser';
import { ResetTableProcessor } from '../lzx/reset-table';
import { logger } from '../../logger/logger';

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
   * 正确顺序：ITSF → seek(directoryOffset) → ITSP → 目录块 → LZXC(从目录条目) → 重置表
   * @param reader 位读取器
   * @returns 解析后的 CHM 结构
   */
  parse(reader: BitReader): ParsedCHM {
    // 1. 解析 ITSF 头部（固定在文件开头）
    const itsf = ITSFHeaderParser.parse(reader);
    if (!ITSFHeaderParser.validate(itsf)) {
      throw new Error('ITSF 头部验证失败');
    }

    // 2. 跳转到目录偏移处并解析 ITSP 头部
    reader.setPosition(itsf.directoryOffset, 0);
    const itsp = ITSPHeaderParser.parse(reader);
    if (!ITSPHeaderParser.validate(itsp)) {
      throw new Error('ITSP 头部验证失败');
    }

    // 3. 计算目录块数量并解析所有目录块
    //    numChunks = (directoryLength - itspHeaderLength) / chunkSize
    const numChunks = Math.max(
      1,
      Math.floor((itsf.directoryLength - itsp.headerLength) / itsp.chunkSize),
    );
    const directory = this.parseDirectory(reader, itsp, numChunks);

    // 4. 从目录条目中找到并解析 LZXC 头部
    //    ControlData 条目存储在 section 0，偏移相对于 sect0Offset (itsf.unknown2)
    const lzxc = this.parseLZXCFromDirectory(reader, itsf.unknown2, directory);

    const header: CHMHeader = { itsf, itsp, lzxc };

    // 5. 解析重置表（可选，失败时使用默认值）
    const resetTable = this.parseResetTable(reader, itsf.unknown2, directory);

    // 6. 计算内容偏移（Section 1 压缩内容的起始位置）
    //    unknown4 (content_offset) 从 ITSF 读取，fallback 到 dir_end
    const contentOffset =
      itsf.unknown4 > 0
        ? itsf.unknown4
        : itsf.directoryOffset + itsf.directoryLength;

    return {
      header,
      directory,
      resetTable,
      contentOffset,
    };
  }

  /**
   * 解析目录结构
   */
  private parseDirectory(
    reader: BitReader,
    itspHeader: ITSPHeader,
    numChunks: number,
  ): CHMDirectory {
    const directory = DirectoryParser.parse(reader, itspHeader, numChunks);

    if (!DirectoryParser.validate(directory)) {
      throw new Error('目录结构验证失败');
    }

    return directory;
  }

  /**
   * 从目录条目中定位并解析 LZXC 头部
   * ControlData 存储路径: ::DataSpace/Storage/MSCompressed/ControlData
   * @param reader 位读取器
   * @param sect0Offset Section 0 数据起始偏移（来自 ITSF.unknown2）
   * @param directory 已解析的目录
   */
  private parseLZXCFromDirectory(
    reader: BitReader,
    sect0Offset: number,
    directory: CHMDirectory,
  ): LZXCHeader {
    const controlDataPath = '::DataSpace/Storage/MSCompressed/ControlData';
    const entry = directory.entries.get(controlDataPath);

    if (!entry) {
      // 某些简单测试文件可能没有 ControlData，使用合理默认值
      logger.warn('未找到 LZXC ControlData 条目，使用默认压缩参数');
      return {
        signature: 'LZXC',
        version: 2,
        resetInterval: 0x8000,
        windowSize: 0x8000,
        cacheSize: 0,
        unknown: 0,
      };
    }

    // ControlData 存储在 section 0: 文件偏移 = sect0Offset + entry.offset
    const controlDataOffset = sect0Offset + entry.offset;
    reader.setPosition(controlDataOffset, 0);

    const lzxc = LZXCHeaderParser.parse(reader);
    if (!LZXCHeaderParser.validate(lzxc)) {
      throw new Error('LZXC 头部验证失败');
    }

    return lzxc;
  }

  /**
   * 解析重置表（可选，失败时使用默认值）
   * ResetTable 路径: ::DataSpace/Storage/MSCompressed/Transform/.../ResetTable
   */
  private parseResetTable(
    reader: BitReader,
    sect0Offset: number,
    directory: CHMDirectory,
  ) {
    const resetTablePath =
      '::DataSpace/Storage/MSCompressed/Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable';
    const entry = directory.entries.get(resetTablePath);

    if (entry && sect0Offset > 0) {
      try {
        reader.setPosition(sect0Offset + entry.offset, 0);
        return this.resetTableProcessor.parseResetTable(reader);
      } catch (error) {
        logger.warn('重置表解析失败，使用默认值:', error);
      }
    }

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

  /**
   * 快速解析（仅解析头部和目录，跳过重置表）
   * @param reader 位读取器
   * @returns 简化的解析结果
   */
  quickParse(reader: BitReader): Omit<ParsedCHM, 'resetTable'> {
    const itsf = ITSFHeaderParser.parse(reader);
    if (!ITSFHeaderParser.validate(itsf)) {
      throw new Error('ITSF 头部验证失败');
    }

    reader.setPosition(itsf.directoryOffset, 0);
    const itsp = ITSPHeaderParser.parse(reader);
    if (!ITSPHeaderParser.validate(itsp)) {
      throw new Error('ITSP 头部验证失败');
    }

    const numChunks = Math.max(
      1,
      Math.floor((itsf.directoryLength - itsp.headerLength) / itsp.chunkSize),
    );
    const directory = this.parseDirectory(reader, itsp, numChunks);
    const lzxc = this.parseLZXCFromDirectory(reader, itsf.unknown2, directory);
    const header: CHMHeader = { itsf, itsp, lzxc };
    const contentOffset =
      itsf.unknown4 > 0
        ? itsf.unknown4
        : itsf.directoryOffset + itsf.directoryLength;

    return { header, directory, contentOffset };
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.resetTableProcessor.reset();
  }
}

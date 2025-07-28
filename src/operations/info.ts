import { CHMFileManager } from '../core/files/file-manager';
import { ITSFHeaderParser } from '../core/headers/itsf-header';
import { ITSPHeaderParser } from '../core/headers/itsp-header';
import { LZXCHeaderParser } from '../core/headers/lzxc-header';
import { CHMStatisticsGenerator } from '../core/parser/statistics-generator';
import { ParserOperations } from './parser';

/**
 * CHM 文件信息获取操作
 */
export class InfoOperations {
  /**
   * 获取 CHM 文件信息
   * @param filePath CHM 文件路径
   * @returns CHM 文件信息
   */
  static async getInfo(filePath: string): Promise<{
    header: {
      itsf: string;
      itsp: string;
      lzxc: string;
    };
    statistics: string;
    fileCount: number;
    totalSize: number;
    compressionRatio: number;
  }> {
    try {
      // 解析 CHM 文件
      const parsedCHM = await ParserOperations.parse(filePath);

      // 创建文件管理器获取统计信息
      const fileManager = new CHMFileManager(parsedCHM);
      const fileList = fileManager.getFileList();

      // 计算总大小
      let totalSize = 0;
      let compressedSize = 0;

      for (const [, entry] of parsedCHM.directory.entries) {
        totalSize += entry.uncompressedLength ?? entry.length;
        compressedSize += entry.length;
      }

      const compressionRatio =
        totalSize > 0 ? (compressedSize / totalSize) * 100 : 0;

      return {
        header: {
          itsf: ITSFHeaderParser.getSummary(parsedCHM.header.itsf),
          itsp: ITSPHeaderParser.getSummary(parsedCHM.header.itsp),
          lzxc: LZXCHeaderParser.getSummary(parsedCHM.header.lzxc),
        },
        statistics: CHMStatisticsGenerator.getStatistics(parsedCHM),
        fileCount: fileList.length,
        totalSize,
        compressionRatio,
      };
    } catch (error) {
      throw new Error(
        `获取 CHM 文件信息失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

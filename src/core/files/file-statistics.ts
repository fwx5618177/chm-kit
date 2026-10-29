import type { DirectoryEntry, ParsedCHM } from '../types';
import { CHMFileManager } from './file-manager';

/**
 * CHM 文件统计信息生成器
 * 负责生成各种文件统计信息
 */
export class CHMFileStatistics {
  private parsedCHM: ParsedCHM;
  private fileManager: CHMFileManager;

  constructor(parsedCHM: ParsedCHM) {
    this.parsedCHM = parsedCHM;
    this.fileManager = new CHMFileManager(parsedCHM);
  }

  /**
   * 获取文件统计信息
   * @returns 统计信息字符串
   */
  getStatistics(): string {
    const {
      totalFiles,
      compressedFiles,
      totalCompressedSize,
      totalUncompressedSize,
      compressionRatio,
    } = this.getCompressionStatistics();

    return [
      `总文件数: ${totalFiles}`,
      `压缩文件数: ${compressedFiles}`,
      `未压缩文件数: ${totalFiles - compressedFiles}`,
      `压缩后总大小（含共享 Content 流）: ${this.formatBytes(totalCompressedSize)}`,
      `未压缩总大小（用户文件）: ${this.formatBytes(totalUncompressedSize)}`,
      `存储/逻辑大小比（含共享流）: ${compressionRatio.toFixed(2)}%`,
    ].join('\n');
  }

  /**
   * 获取文件类型统计
   * @returns 文件类型统计
   */
  getFileTypeStatistics(): Map<string, number> {
    const typeStats = new Map<string, number>();

    for (const fileName of this.fileManager.getUserFileList()) {
      const ext = this.fileManager.getFileExtension(fileName);
      const count = typeStats.get(ext) ?? 0;
      typeStats.set(ext, count + 1);
    }

    return typeStats;
  }

  /**
   * 获取压缩统计信息。文件数与逻辑大小仅计用户文件；物理大小包含
   * 不可按文件拆分的完整 Content 流（其中可能含系统数据）。
   * compressionRatio 是该存储大小与用户逻辑大小的比值，不是逐文件压缩率。
   * averageCompressionRatio 为兼容字段，实际表示完整压缩流的压缩率。
   * @returns 压缩统计对象
   */
  getCompressionStatistics(): {
    totalFiles: number;
    compressedFiles: number;
    uncompressedFiles: number;
    totalCompressedSize: number;
    totalUncompressedSize: number;
    compressionRatio: number;
    averageCompressionRatio: number;
  } {
    const entries = this.getUserEntries();
    const totalFiles = entries.length;
    const compressedFiles = entries.filter(entry => entry.section === 1).length;
    const uncompressedFiles = totalFiles - compressedFiles;
    const storedSize = entries.reduce(
      (sum, entry) => sum + (entry.section === 0 ? entry.length : 0),
      0,
    );
    const content = Array.from(this.parsedCHM.directory.entries.values()).find(
      entry =>
        entry.name.toLowerCase() ===
          '::dataspace/storage/mscompressed/content' && entry.section === 0,
    );
    // Section-1 lengths are logical sizes, not independently compressed files.
    // The shared physical Content stream cannot be apportioned per user file.
    const streamSize =
      content?.length ?? this.parsedCHM.resetTable.compressedLength;
    const totalCompressedSize =
      storedSize + (compressedFiles > 0 ? streamSize : 0);
    const totalUncompressedSize = entries.reduce(
      (sum, entry) => sum + entry.length,
      0,
    );

    const compressionRatio =
      totalUncompressedSize > 0
        ? (totalCompressedSize / totalUncompressedSize) * 100
        : 0;

    // Legacy field: report the stream-wide ratio, never fabricate per-file ratios.
    const streamLogicalSize = this.parsedCHM.resetTable.uncompressedLength;
    const averageCompressionRatio =
      compressedFiles > 0 && streamLogicalSize > 0
        ? (streamSize / streamLogicalSize) * 100
        : 0;

    return {
      totalFiles,
      compressedFiles,
      uncompressedFiles,
      totalCompressedSize,
      totalUncompressedSize,
      compressionRatio,
      averageCompressionRatio,
    };
  }

  /**
   * 获取大小分布统计
   * @returns 大小分布统计
   */
  getSizeDistribution(): {
    small: number; // < 1KB
    medium: number; // 1KB - 100KB
    large: number; // 100KB - 1MB
    veryLarge: number; // > 1MB
  } {
    const distribution = { small: 0, medium: 0, large: 0, veryLarge: 0 };

    for (const entry of this.getUserEntries()) {
      const size = entry.length;

      if (size < 1024) {
        distribution.small++;
      } else if (size < 100 * 1024) {
        distribution.medium++;
      } else if (size < 1024 * 1024) {
        distribution.large++;
      } else {
        distribution.veryLarge++;
      }
    }

    return distribution;
  }

  /**
   * 获取详细统计报告
   * @returns 详细统计报告字符串
   */
  getDetailedReport(): string {
    const basic = this.getStatistics();
    const typeStats = this.getFileTypeStatistics();
    const compressionStats = this.getCompressionStatistics();
    const sizeDistribution = this.getSizeDistribution();

    const typeStatsStr = Array.from(typeStats.entries())
      .sort((a, b) => b[1] - a[1]) // 按数量排序
      .map(([type, count]) => `  ${type}: ${count}`)
      .join('\n');

    const sizeDistStr = [
      `  小文件 (< 1KB): ${sizeDistribution.small}`,
      `  中等文件 (1KB - 100KB): ${sizeDistribution.medium}`,
      `  大文件 (100KB - 1MB): ${sizeDistribution.large}`,
      `  超大文件 (> 1MB): ${sizeDistribution.veryLarge}`,
    ].join('\n');

    return [
      '=== CHM 文件详细统计报告 ===',
      '',
      '--- 基本信息 ---',
      basic,
      '',
      '--- 压缩信息 ---',
      `共享压缩流压缩率（非逐文件平均）: ${compressionStats.averageCompressionRatio.toFixed(2)}%`,
      '共享 Content 流可能包含系统数据，无法精确分摊到用户文件。',
      '',
      '--- 文件类型分布 ---',
      typeStatsStr,
      '',
      '--- 文件大小分布 ---',
      sizeDistStr,
    ].join('\n');
  }

  private getUserEntries(): DirectoryEntry[] {
    return this.fileManager
      .getUserFileList()
      .map(name => this.parsedCHM.directory.entries.get(name)!);
  }

  /**
   * 格式化字节数为可读格式
   * @param bytes 字节数
   * @returns 格式化后的字符串
   */
  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    } else {
      return `${bytes} 字节`;
    }
  }
}

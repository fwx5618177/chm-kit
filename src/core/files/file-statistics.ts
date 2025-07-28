import type { ParsedCHM } from '../types';
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
    const totalFiles = this.parsedCHM.directory.entries.size;
    const compressedFiles = Array.from(
      this.parsedCHM.directory.entries.values(),
    ).filter(entry => entry.isCompressed).length;

    const totalSize = Array.from(
      this.parsedCHM.directory.entries.values(),
    ).reduce((sum, entry) => sum + entry.length, 0);

    const uncompressedSize = Array.from(
      this.parsedCHM.directory.entries.values(),
    ).reduce(
      (sum, entry) => sum + (entry.uncompressedLength ?? entry.length),
      0,
    );

    const compressionRatio =
      totalSize > 0 ? (totalSize / uncompressedSize) * 100 : 0;

    return [
      `总文件数: ${totalFiles}`,
      `压缩文件数: ${compressedFiles}`,
      `未压缩文件数: ${totalFiles - compressedFiles}`,
      `压缩后总大小: ${this.formatBytes(totalSize)}`,
      `未压缩总大小: ${this.formatBytes(uncompressedSize)}`,
      `压缩率: ${compressionRatio.toFixed(2)}%`,
    ].join('\n');
  }

  /**
   * 获取文件类型统计
   * @returns 文件类型统计
   */
  getFileTypeStatistics(): Map<string, number> {
    const typeStats = new Map<string, number>();

    for (const fileName of this.fileManager.getFileList()) {
      const ext = this.fileManager.getFileExtension(fileName);
      const count = typeStats.get(ext) ?? 0;
      typeStats.set(ext, count + 1);
    }

    return typeStats;
  }

  /**
   * 获取压缩统计信息
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
    const entries = Array.from(this.parsedCHM.directory.entries.values());

    const totalFiles = entries.length;
    const compressedFiles = entries.filter(entry => entry.isCompressed).length;
    const uncompressedFiles = totalFiles - compressedFiles;

    const totalCompressedSize = entries.reduce(
      (sum, entry) => sum + entry.length,
      0,
    );
    const totalUncompressedSize = entries.reduce(
      (sum, entry) => sum + (entry.uncompressedLength ?? entry.length),
      0,
    );

    const compressionRatio =
      totalUncompressedSize > 0
        ? (totalCompressedSize / totalUncompressedSize) * 100
        : 0;

    // 计算平均压缩率（仅计算压缩文件）
    let averageCompressionRatio = 0;
    if (compressedFiles > 0) {
      const compressedEntries = entries.filter(entry => entry.isCompressed);
      const totalCompressedRatio = compressedEntries.reduce((sum, entry) => {
        const ratio = entry.uncompressedLength
          ? (entry.length / entry.uncompressedLength) * 100
          : 100;
        return sum + ratio;
      }, 0);
      averageCompressionRatio = totalCompressedRatio / compressedFiles;
    }

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

    for (const entry of this.parsedCHM.directory.entries.values()) {
      const size = entry.uncompressedLength ?? entry.length;

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
      `平均压缩率: ${compressionStats.averageCompressionRatio.toFixed(2)}%`,
      '',
      '--- 文件类型分布 ---',
      typeStatsStr,
      '',
      '--- 文件大小分布 ---',
      sizeDistStr,
    ].join('\n');
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

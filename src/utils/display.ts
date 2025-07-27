import { logger } from '@/logger/logger';
import type { CHMBasicInfo } from '@/core/types';

/**
 * 显示 CHM 文件信息
 * @param info CHM 文件信息对象
 */
export function displayInfo(info: CHMBasicInfo): void {
  logger.info(`\n📋 CHM 文件信息\n`);
  logger.info(`📄 ITSF 头部: ${info.header.itsf}`);
  logger.info(`📦 ITSP 头部: ${info.header.itsp}`);
  logger.info(`🗜️  LZXC 头部: ${info.header.lzxc}`);
  logger.info(`\n📊 统计信息: ${info.statistics}`);
  logger.info(`📁 文件数: ${info.fileCount}`);
  logger.info(`🗜️  总大小: ${info.totalSize} 字节`);
  logger.info(`📈 压缩率: ${info.compressionRatio.toFixed(1)}%`);
}

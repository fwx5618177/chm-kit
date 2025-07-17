import { Command } from 'commander';
import { extname } from 'path';
import { logger } from '../logger/logger';
import { CHMKit } from '../index';

/**
 * 显示 CHM 文件信息的命令
 */
export const infoCommand = new Command('info')
  .description('显示 CHM 文件信息')
  .argument('<input>', 'CHM 文件路径')
  .option('-v, --verbose', '启用详细输出', false)
  .option('-j, --json', '以 JSON 格式输出信息', false)
  .action(async (input: string, options: any) => {
    try {
      const info = await CHMKit.getInfo(input);
      if (options.json) {
        logger.info(JSON.stringify(info, null, 2));
      } else {
        displayInfo(info);
      }
    } catch (error) {
      logger.error('❌ Error reading CHM file:', error);
      process.exit(1);
    }
  });

function displayInfo(info: any): void {
  logger.info(`\n📋 CHM 文件信息\n`);
  logger.info(`📄 ITSF 头部: ${info.header.itsf}`);
  logger.info(`📦 ITSP 头部: ${info.header.itsp}`);
  logger.info(`🗜️  LZXC 头部: ${info.header.lzxc}`);
  logger.info(`\n📊 统计信息: ${info.statistics}`);
  logger.info(`📁 文件数: ${info.fileCount}`);
  logger.info(`🗜️  总大小: ${info.totalSize} 字节`);
  logger.info(`📈 压缩率: ${info.compressionRatio.toFixed(1)}%`);
}

/**
 * 分析文件类型
 * @param fileName 文件名
 * @returns 文件类型
 */
export function getFileType(fileName: string): string {
  const ext = extname(fileName).toLowerCase();

  const typeMap: { [key: string]: string } = {
    '.html': 'HTML',
    '.htm': 'HTML',
    '.css': 'CSS',
    '.js': 'JavaScript',
    '.png': 'Image',
    '.jpg': 'Image',
    '.jpeg': 'Image',
    '.gif': 'Image',
    '.svg': 'Image',
    '.ico': 'Icon',
    '.xml': 'XML',
    '.json': 'JSON',
    '.txt': 'Text',
    '.md': 'Markdown',
  };

  return typeMap[ext] || 'Other';
}

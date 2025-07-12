import { Command } from 'commander';
import { promises as fs } from 'fs';
import { extname, basename } from 'path';
import { logger } from '../logger/logger';

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
      const info = await getCHMInfo(input, options.verbose || false);

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

/**
 * CHM 文件信息接口
 */
interface CHMFileInfo {
  file: string;
  size: number;
  format: string;
  title?: string;
  author?: string;
  subject?: string;
  created?: string;
  modified?: string;
  filesCount: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionRatio: number;
  defaultTopic?: string;
  hasTOC: boolean;
  hasIndex: boolean;
  language?: string;
  version?: string;
  files: string[];
}

/**
 * 获取 CHM 文件信息
 * @param filePath CHM 文件路径
 * @param verbose 是否详细输出
 * @returns CHM 文件信息
 */
async function getCHMInfo(
  filePath: string,
  verbose: boolean,
): Promise<CHMFileInfo> {
  // 检查文件是否存在
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new Error(`文件未找到: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new Error(`不是文件: ${filePath}`);
  }

  // 检查文件扩展名
  const ext = extname(filePath).toLowerCase();
  if (ext !== '.chm') {
    logger.warn(`⚠️  文件扩展名不是 .chm: ${ext}`);
  }

  if (verbose) {
    logger.info(`📄 正在分析 CHM 文件: ${filePath}`);
  }

  // TODO: 实现实际的 CHM 文件分析逻辑
  // 这里需要使用 core 模块中的 CHM 解析器
  logger.warn('⚠️  CHM 分析逻辑尚未实现');
  logger.info('这是实际分析实现的占位符');

  // 示例信息（实际应该从 CHM 文件中解析）
  const info: CHMFileInfo = {
    file: filePath,
    size: stats.size,
    format: 'Microsoft Compiled HTML Help',
    title: '示例 CHM 文件',
    author: '未知',
    subject: '帮助文档',
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString(),
    filesCount: 42, // 示例数据
    compressedSize: stats.size,
    uncompressedSize: Math.round(stats.size * 2.5), // 示例压缩比
    compressionRatio: 0.4, // 示例压缩比
    defaultTopic: 'index.html',
    hasTOC: true,
    hasIndex: true,
    language: 'zh-CN',
    version: '1.0',
    files: [
      'index.html',
      'chapter1.html',
      'chapter2.html',
      'styles.css',
      'images/logo.png',
      'scripts/main.js',
    ],
  };

  return info;
}

/**
 * 显示 CHM 文件信息
 * @param info CHM 文件信息
 */
function displayInfo(info: CHMFileInfo): void {
  logger.info(`\n📋 CHM 文件信息\n`);

  logger.info(`📄 文件: ${info.file}`);
  logger.info(`📦 格式: ${info.format}`);
  logger.info(`💾 大小: ${formatBytes(info.size)}`);

  if (info.title) {
    logger.info(`📖 标题: ${info.title}`);
  }

  if (info.author) {
    logger.info(`👤 作者: ${info.author}`);
  }

  if (info.subject) {
    logger.info(`📝 主题: ${info.subject}`);
  }

  if (info.language) {
    logger.info(`🌐 语言: ${info.language}`);
  }

  if (info.version) {
    logger.info(`🏷️  版本: ${info.version}`);
  }

  if (info.created) {
    logger.info(`📅 创建时间: ${new Date(info.created).toLocaleString()}`);
  }

  if (info.modified) {
    logger.info(`📅 修改时间: ${new Date(info.modified).toLocaleString()}`);
  }

  if (info.defaultTopic) {
    logger.info(`🏠 默认主题: ${info.defaultTopic}`);
  }

  logger.info(`\n📊 内容信息\n`);

  logger.info(`📁 文件数: ${info.filesCount}`);
  logger.info(`🗜️  压缩大小: ${formatBytes(info.compressedSize)}`);
  logger.info(`📏 未压缩大小: ${formatBytes(info.uncompressedSize)}`);
  logger.info(`📈 压缩率: ${(info.compressionRatio * 100).toFixed(1)}%`);

  logger.info(`📋 目录: ${info.hasTOC ? '✅' : '❌'}`);
  logger.info(`📑 索引: ${info.hasIndex ? '✅' : '❌'}`);

  if (info.files && info.files.length > 0) {
    logger.info(`\n📄 文件列表 (显示前 10 个):\n`);
    info.files.slice(0, 10).forEach(file => {
      logger.info(`  • ${file}`);
    });

    if (info.files.length > 10) {
      logger.info(`  ... 还有 ${info.files.length - 10} 个文件`);
    }
  }

  logger.info(`\n💡 使用 'chmkit extract ${basename(info.file)}' 提取内容`);
}

/**
 * 格式化字节大小
 * @param bytes 字节数
 * @param decimals 小数位数
 * @returns 格式化的字符串
 */
function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 字节';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['字节', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
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

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { extname, basename } from 'path';

/**
 * 显示 CHM 文件信息的命令
 */
export const infoCommand = new Command('info')
  .description('Display information about a CHM file')
  .argument('<input>', 'Input CHM file path')
  .option('-v, --verbose', 'Enable verbose output', false)
  .option('-j, --json', 'Output information as JSON', false)
  .action(async (input: string, options: any) => {
    try {
      const info = await getCHMInfo(input, options.verbose || false);

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
      } else {
        displayInfo(info);
      }
    } catch (error) {
      console.error('❌ Error reading CHM file:', error);
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
    throw new Error(`File not found: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  // 检查文件扩展名
  const ext = extname(filePath).toLowerCase();
  if (ext !== '.chm') {
    console.warn(`⚠️  File extension is not .chm: ${ext}`);
  }

  if (verbose) {
    console.log(`📄 Analyzing CHM file: ${filePath}`);
  }

  // TODO: 实现实际的 CHM 文件分析逻辑
  // 这里需要使用 core 模块中的 CHM 解析器
  console.log('⚠️  CHM analysis logic not yet implemented');
  console.log('This is a placeholder for the actual analysis implementation');

  // 示例信息（实际应该从 CHM 文件中解析）
  const info: CHMFileInfo = {
    file: filePath,
    size: stats.size,
    format: 'Microsoft Compiled HTML Help',
    title: 'Sample CHM File',
    author: 'Unknown',
    subject: 'Help Documentation',
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString(),
    filesCount: 42, // 示例数据
    compressedSize: stats.size,
    uncompressedSize: Math.round(stats.size * 2.5), // 示例压缩比
    compressionRatio: 0.4, // 示例压缩比
    defaultTopic: 'index.html',
    hasTOC: true,
    hasIndex: true,
    language: 'en-US',
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
  console.log(`\n📋 CHM File Information\n`);

  console.log(`📄 File: ${info.file}`);
  console.log(`📦 Format: ${info.format}`);
  console.log(`💾 Size: ${formatBytes(info.size)}`);

  if (info.title) {
    console.log(`📖 Title: ${info.title}`);
  }

  if (info.author) {
    console.log(`👤 Author: ${info.author}`);
  }

  if (info.subject) {
    console.log(`📝 Subject: ${info.subject}`);
  }

  if (info.language) {
    console.log(`🌐 Language: ${info.language}`);
  }

  if (info.version) {
    console.log(`🏷️  Version: ${info.version}`);
  }

  if (info.created) {
    console.log(`📅 Created: ${new Date(info.created).toLocaleString()}`);
  }

  if (info.modified) {
    console.log(`📅 Modified: ${new Date(info.modified).toLocaleString()}`);
  }

  if (info.defaultTopic) {
    console.log(`🏠 Default Topic: ${info.defaultTopic}`);
  }

  console.log(`\n📊 Content Information\n`);

  console.log(`📁 Files: ${info.filesCount}`);
  console.log(`🗜️  Compressed Size: ${formatBytes(info.compressedSize)}`);
  console.log(`📏 Uncompressed Size: ${formatBytes(info.uncompressedSize)}`);
  console.log(
    `📈 Compression Ratio: ${(info.compressionRatio * 100).toFixed(1)}%`,
  );

  console.log(`📋 Table of Contents: ${info.hasTOC ? '✅' : '❌'}`);
  console.log(`📑 Index: ${info.hasIndex ? '✅' : '❌'}`);

  if (info.files && info.files.length > 0) {
    console.log(`\n📄 Files (showing first 10):\n`);
    info.files.slice(0, 10).forEach(file => {
      console.log(`  • ${file}`);
    });

    if (info.files.length > 10) {
      console.log(`  ... and ${info.files.length - 10} more files`);
    }
  }

  console.log(
    `\n💡 Use 'chmkit extract ${basename(info.file)}' to extract contents`,
  );
}

/**
 * 格式化字节大小
 * @param bytes 字节数
 * @param decimals 小数位数
 * @returns 格式化的字符串
 */
function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

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

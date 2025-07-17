import { Command } from 'commander';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { ExtractOptions } from '../core/types';
import { logger } from '../logger/logger';
import { CHMKit } from '../index';

/**
 * 提取 CHM 文件内容的命令
 */
export const extractCommand = new Command('extract')
  .description('从 CHM 文件中提取内容')
  .argument('<input>', 'CHM 文件路径')
  .option('-o, --output <dir>', '输出目录', './output')
  .option('-f, --filter <pattern>', '按模式过滤文件 (glob)')
  .option('-p, --preserve-structure', '保留原始目录结构', false)
  .option('-v, --verbose', '启用详细输出', false)
  .action(async (input: string, options: any) => {
    try {
      const extractOptions: Partial<ExtractOptions> = {
        verbose: options.verbose,
        ...(options.filter && { filter: createFilterFunction(options.filter) }),
      };
      const result = await CHMKit.extract(
        input,
        options.output,
        extractOptions,
      );
      if (result.errors.length > 0) {
        logger.warn(`部分文件提取失败: ${result.errors.join(', ')}`);
      }
      logger.success(
        `✅ 成功提取 ${result.files.length} 个文件到: ${options.output}`,
      );
    } catch (error) {
      logger.error('❌ Error extracting CHM file:', error);
      process.exit(1);
    }
  });

/**
 * 创建文件过滤函数
 * @param pattern 过滤模式
 * @returns 过滤函数
 */
function createFilterFunction(pattern: string): (fileName: string) => boolean {
  // 简单的 glob 模式支持
  const regex = new RegExp(
    pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.'),
  );

  return (fileName: string) => regex.test(fileName);
}

/**
 * 确保目录存在
 * @param filePath 文件路径
 */
export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * 写入文件并确保目录存在
 * @param filePath 文件路径
 * @param content 文件内容
 */
export async function writeFileWithDir(
  filePath: string,
  content: Buffer | string,
): Promise<void> {
  await ensureDirectoryExists(filePath);
  await fs.writeFile(filePath, content);
}

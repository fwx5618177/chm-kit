import { Command } from 'commander';
import type { ExtractOptions, ExtractCommandOptions } from '../../core/types';
import { logger } from '../../logger/logger';
import { CHMKit } from '../../index';
import { createFilterFunction } from '../../utils/helpers';

/**
 * 提取 CHM 文件内容的命令
 */
export const extract = new Command('extract')
  .description('从 CHM 文件中提取内容')
  .argument('<input>', 'CHM 文件路径')
  .option('-o, --output <dir>', '输出目录', './output')
  .option('-f, --filter <pattern>', '按模式过滤文件 (glob)')
  .option('-p, --preserve-structure', '保留原始目录结构', false)
  .option('-v, --verbose', '启用详细输出', false)
  .action(async (input: string, options: ExtractCommandOptions) => {
    try {
      const extractOptions: Partial<ExtractOptions> = {
        verbose: options.verbose,
        ...(options.filter && {
          filter: createFilterFunction([options.filter]),
        }),
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

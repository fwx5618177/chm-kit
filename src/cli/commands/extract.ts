import { Command } from 'commander';
import type { ExtractOptions, ExtractCommandOptions } from '../../core/types';
import { CHMKit } from '../../chm-kit';
import { createFilterFunction } from '../../utils/helpers';

/**
 * 提取 CHM 文件内容的命令
 */
export const extract = new Command('extract')
  .description('从 CHM 文件中提取内容')
  .argument('<input>', 'CHM 文件路径')
  .option('-o, --output <dir>', '输出目录（路径不得含符号链接）', './output')
  .option('-f, --filter <pattern>', '按模式过滤文件 (glob)')
  .option('-p, --preserve-structure', '保留原始目录结构', false)
  .option('-v, --verbose', '启用详细输出', false)
  .addHelpText(
    'after',
    '\n安全策略：输出根目录及祖先目录拒绝符号链接，包括 macOS /tmp 等别名；请使用对应真实路径。',
  )
  .action(async (input: string, options: ExtractCommandOptions) => {
    try {
      const extractOptions: Partial<ExtractOptions> = {
        verbose: options.verbose,
        preserveStructure: options.preserveStructure,
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
        process.stderr.write(`${result.errors.join('\n')}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(
        `成功提取 ${result.files.length}/${result.totalFiles} 个文件到: ${options.output}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `Error extracting CHM file: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

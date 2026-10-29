import { Command } from 'commander';
import type { PackOptions, PackCommandOptions } from '../../core/types';

import { CHMKit } from '../../chm-kit';
import { assertSafeSourceDirectory } from '../paths';

/**
 * 打包目录为 CHM 文件的命令
 */
export const pack = new Command('pack')
  .description('将目录打包为 CHM 文件')
  .argument('<input>', '输入目录路径')
  .option('-o, --output <file>', '输出 CHM 文件路径', './output.chm')
  .option('-t, --title <title>', 'CHM 文件标题')
  .option('-d, --default-topic <file>', '默认主题文件')
  .option('-c, --compression', '启用压缩', true)
  .option('--no-compression', '不压缩用户内容')
  .option('-v, --verbose', '启用详细输出', false)
  .action(async (input: string, options: PackCommandOptions) => {
    try {
      const source = await assertSafeSourceDirectory(input);
      const packOptions: PackOptions = {
        inputDir: source,
        outputPath: options.output,
        compression: options.compression,
        verbose: options.verbose,
        ...(options.title && { title: options.title }),
        ...(options.defaultTopic && { defaultTopic: options.defaultTopic }),
      };

      const result = await CHMKit.pack(source, options.output, packOptions);

      if (result.success) {
        if (options.verbose) {
          process.stdout.write(`${result.message}\n`);
        } else {
          process.stdout.write(`CHM 文件已创建: ${options.output}\n`);
        }
      } else {
        process.stderr.write(`${result.message}\n`);
        process.exitCode = 1;
      }
    } catch (error) {
      process.stderr.write(
        `Error packing CHM file: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

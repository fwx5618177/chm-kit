import { Command } from 'commander';
import type { PackOptions } from '../core/types';
import { logger } from '../logger/logger';
import { CHMKit } from '../index';

/**
 * 打包目录为 CHM 文件的命令
 */
export const packCommand = new Command('pack')
  .description('将目录打包为 CHM 文件')
  .argument('<input>', '输入目录路径')
  .option('-o, --output <file>', '输出 CHM 文件路径', './output.chm')
  .option('-t, --title <title>', 'CHM 文件标题')
  .option('-d, --default-topic <file>', '默认主题文件')
  .option('-c, --compression', '启用压缩', true)
  .option('-v, --verbose', '启用详细输出', false)
  .action(async (input: string, options: any) => {
    try {
      const packOptions: PackOptions = {
        inputDir: input,
        outputPath: options.output,
        compression: options.compression,
        verbose: options.verbose,
        ...(options.title && { title: options.title }),
        ...(options.defaultTopic && { defaultTopic: options.defaultTopic }),
      };

      const result = await CHMKit.pack(input, options.output, packOptions);

      if (result.success) {
        if (options.verbose) {
          logger.success(`✅ ${result.message}`);
        } else {
          logger.success(`✅ CHM 文件已创建: ${options.output}`);
        }
      } else {
        logger.error(`❌ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      logger.error('❌ Error packing CHM file:', error);
      process.exit(1);
    }
  });

import { Command } from 'commander';
import type { InfoCommandOptions } from '../../core/types';
import { logger } from '../../logger/logger';
import { CHMKit } from '../../chm-kit';
import { displayInfo } from '../../utils/helpers';

/**
 * 显示 CHM 文件信息的命令
 */
export const info = new Command('info')
  .description('显示 CHM 文件信息')
  .argument('<input>', 'CHM 文件路径')
  .option('-v, --verbose', '启用详细输出', false)
  .option('-j, --json', '以 JSON 格式输出信息', false)
  .action(async (input: string, options: InfoCommandOptions) => {
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

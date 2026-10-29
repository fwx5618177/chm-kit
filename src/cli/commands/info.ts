import { Command } from 'commander';
import type { InfoCommandOptions } from '../../core/types';

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
        process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
      } else {
        displayInfo(info);
      }
    } catch (error) {
      process.stderr.write(
        `Error reading CHM file: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

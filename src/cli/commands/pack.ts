import { Command } from 'commander';
import type { PackOptions, PackCommandOptions } from '../../core/types';

import { CHMKit } from '../../chm-kit';
import { assertSafeSourceDirectory } from '../paths';
import { runtimeConfig } from '../runtime';
import { integer, positiveInteger } from '../filters';

/**
 * 打包目录为 CHM 文件的命令
 */
export const pack = new Command('pack')
  .description('将目录打包为 CHM 文件')
  .argument('<input>', '输入目录路径')
  .option('-o, --output <file>', '输出 CHM 文件路径')
  .option('-t, --title <title>', 'CHM 文件标题')
  .option('-d, --default-topic <file>', '默认主题文件')
  .option('-c, --compression', '启用压缩', true)
  .option('--no-compression', '不压缩用户内容')
  .option('--compression-level <level>', '真实编码策略级别 0..9', integer)
  .option('--window-bits <bits>', 'LZX 窗口指数 15..21', positiveInteger)
  .option(
    '--reset-interval <bytes>',
    'reset 字节数：32768 的 2 次幂倍数，最多 256 MiB',
    positiveInteger,
  )
  .option(
    '--block-size <bytes>',
    'LZX 编码块大小：256..32768 的 2 次幂；frame 固定 32768',
    positiveInteger,
  )
  .option('-v, --verbose', '启用详细输出', false)
  .action(
    async (input: string, options: PackCommandOptions, command: Command) => {
      try {
        const config = runtimeConfig(command);
        options = {
          ...options,
          output: options.output ?? config.cli!.defaultOutputFile!,
        };
        const source = await assertSafeSourceDirectory(input);
        const packOptions: PackOptions = {
          inputDir: source,
          outputPath: options.output,
          compression: options.compression,
          compressionLevel:
            options.compressionLevel ?? config.lzx!.compressionLevel,
          windowBits: options.windowBits ?? Math.log2(config.lzx!.windowSize!),
          resetInterval: options.resetInterval ?? config.lzx!.resetInterval,
          blockSize: options.blockSize,
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
    },
  );

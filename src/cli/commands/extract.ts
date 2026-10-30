import { Command } from 'commander';
import type {
  CHMKitConfig,
  ExtractOptions,
  ExtractResult,
} from '../../core/types';
import { ExtractorOperations } from '../../operations/extractor';
import { mimeType } from '../../reader/reader-utils';
import {
  addFileFilters,
  filePredicate,
  positiveInteger,
  type FileFilters,
} from '../filters';
import { runtimeConfig, withCancellation, progressReporter } from '../runtime';

export interface ExtractionFlags extends FileFilters {
  output?: string;
  preserveStructure?: boolean;
  verbose?: boolean;
  concurrency?: number;
  chunkSize?: number;
  progress?: boolean;
  json?: boolean;
}

export function extractionOptions(
  flags: ExtractionFlags,
  config: CHMKitConfig,
  signal: AbortSignal,
): Partial<ExtractOptions> {
  const accepts = filePredicate(flags);
  return {
    verbose: flags.verbose,
    preserveStructure: flags.preserveStructure,
    concurrency: flags.concurrency ?? config.cli!.maxConcurrency,
    chunkSize: flags.chunkSize ?? config.performance!.chunkSize,
    signal,
    onProgress: progressReporter(
      flags.progress ?? (config.cli!.showProgress! && !!process.stderr.isTTY),
    ),
    filter: (path, entry) =>
      accepts({ path, size: entry.length, mimeType: mimeType(path) }),
  };
}

export function reportExtractionErrors(result: ExtractResult): void {
  if (result.errors.length)
    process.stderr.write(`${result.errors.join('\n')}\n`);
  if (result.cancelled) {
    process.stderr.write(
      '提取已取消；已完成文件保留，未完成文件已尝试清理。\n',
    );
    process.exitCode = 130;
  } else if (result.errors.length) process.exitCode = 1;
}

export function addExtractionFlags(command: Command): Command {
  return addFileFilters(command)
    .option('-o, --output <dir>', '输出目录（拒绝符号链接及覆盖）')
    .option('-p, --preserve-structure', '保留原始目录结构')
    .option('-v, --verbose', '详细信息写 stderr')
    .option(
      '--concurrency <count>',
      '异步文件 I/O 并发数（非 CPU 并行）',
      positiveInteger,
    )
    .option(
      '--chunk-size <bytes>',
      '每 worker 最大写入 chunk 字节数',
      positiveInteger,
    )
    .option('--progress', '实际文件/字节进度写 stderr')
    .option('--no-progress', '关闭进度')
    .option('-j, --json', '机器可读结果，诊断写 stderr');
}

export const extract = addExtractionFlags(
  new Command('extract')
    .description('提取 CHM；Ctrl-C 取消并等待清理，已完成文件保留')
    .argument('<input>', 'CHM 文件路径'),
)
  .addHelpText(
    'after',
    '\n安全策略：输出根及祖先拒绝符号链接，包括 macOS /tmp；请使用真实路径。',
  )
  .action(async (input: string, flags: ExtractionFlags, command: Command) => {
    const config = runtimeConfig(command);
    const output = flags.output ?? config.cli!.defaultOutputDir!;
    const result = await withCancellation(signal =>
      ExtractorOperations.extract(
        input,
        output,
        extractionOptions(flags, config, signal),
      ),
    );
    reportExtractionErrors(result);
    process.stdout.write(
      flags.json
        ? `${JSON.stringify({ ...result, output }, null, 2)}\n`
        : `成功提取 ${result.files.length}/${result.totalFiles} 个文件到: ${output}\n`,
    );
  });

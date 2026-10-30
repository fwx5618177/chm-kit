import type { Command } from 'commander';
import { loadConfig } from '../core/config';
import type { CHMKitConfig, ExtractProgress } from '../core/types';

const configurations = new WeakMap<Command, CHMKitConfig>();
const connectedFields = new Set([
  'cli.defaultOutputDir',
  'cli.defaultOutputFile',
  'cli.maxConcurrency',
  'cli.showProgress',
  'performance.chunkSize',
  'performance.maxFileSize',
  'lzx.windowSize',
  'lzx.resetInterval',
  'lzx.compressionLevel',
]);

/** Loads once per invocation, never during module import or help/version output. */
export function configureCLI(program: Command): void {
  program.option(
    '--config <file>',
    '显式配置文件；否则读取 cwd/chmkit.config.json',
  );
  program.hook('preAction', () => {
    const config = loadConfig({
      configPath: program.opts<{ config?: string }>().config,
      strict: true,
      onField: field => {
        if (!connectedFields.has(field))
          process.stderr.write(
            `配置 ${field} 为兼容字段，CLI 不会自动应用该字段；请使用对应 API 的显式选项。\n`,
          );
      },
    });
    configurations.set(program, config);
  });
}

export function runtimeConfig(command: Command): CHMKitConfig {
  while (command.parent) command = command.parent;
  return configurations.get(command) ?? loadConfig({ searchPaths: [] });
}

/** SIGINT stops scheduling and drains workers instead of abandoning open files. */
export async function withCancellation<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  try {
    return await run(controller.signal);
  } finally {
    process.off('SIGINT', interrupt);
  }
}

export function progressReporter(
  enabled: boolean,
): ((progress: Readonly<ExtractProgress>) => void) | undefined {
  if (!enabled) return undefined;
  return progress => {
    // stderr only; redirected output gets complete lines, not terminal control bytes.
    process.stderr.write(
      `${process.stderr.isTTY ? '\r' : ''}提取 ${progress.completedFiles}/${progress.totalFiles} 文件；${progress.bytesWritten}/${progress.totalBytes} 字节；失败 ${progress.failedFiles}${process.stderr.isTTY ? '\x1b[K' : '\n'}`,
    );
    if (process.stderr.isTTY && progress.completedFiles === progress.totalFiles)
      process.stderr.write('\n');
  };
}

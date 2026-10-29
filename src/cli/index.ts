#!/usr/bin/env node

import { Command } from 'commander';
import { extract, pack, info, read } from './commands';

const program = new Command();

program
  .name('chmkit')
  .description('用于读取、解析和压缩 .chm 文件的 TypeScript 库')
  .version('1.0.0')
  .addCommand(extract)
  .addCommand(pack)
  .addCommand(info)
  .addCommand(read);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

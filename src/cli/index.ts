#!/usr/bin/env node

import { Command } from 'commander';
import { extractCommand } from './extract';
import { packCommand } from './pack';
import { infoCommand } from './info';

const program = new Command();

program
  .name('chmkit')
  .description('用于读取、解析和压缩 .chm 文件的 TypeScript 库')
  .version('1.0.0');

// 添加子命令
program.addCommand(extractCommand);
program.addCommand(packCommand);
program.addCommand(infoCommand);

// 解析命令行参数
program.parse(process.argv);

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

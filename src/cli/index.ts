#!/usr/bin/env node

import { Command } from 'commander';
import {
  extract,
  pack,
  info,
  read,
  tree,
  search,
  preview,
  browse,
  batch,
} from './commands';
import { configureCLI } from './runtime';
import { VERSION } from '../constants';

const program = new Command();

program
  .name('chmkit')
  .description('用于读取、解析和压缩 .chm 文件的 TypeScript 库')
  .version(VERSION)
  .addCommand(extract)
  .addCommand(pack)
  .addCommand(info)
  .addCommand(read)
  .addCommand(tree)
  .addCommand(search)
  .addCommand(preview)
  .addCommand(browse)
  .addCommand(batch);

configureCLI(program);

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

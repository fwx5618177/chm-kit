import { Command } from 'commander';
import { basename, join } from 'path';
import { CHMReader } from '../../reader/chm-reader';
import type { CHMKitConfig, ExtractResult } from '../../core/types';
import type { FileTreeNode, SearchResult } from '../../reader/types';
import { ExtractorOperations } from '../../operations/extractor';
import {
  addFileFilters,
  byteSize,
  filePredicate,
  integer,
  positiveInteger,
  type FileFilters,
} from '../filters';
import { runtimeConfig, withCancellation } from '../runtime';
import {
  addExtractionFlags,
  extractionOptions,
  reportExtractionErrors,
  type ExtractionFlags,
} from './extract';
import { renderPreview, writePreview } from '../preview';
import { browseArchive } from '../browse';

export async function openReader(
  input: string,
  command: Command,
): Promise<CHMReader> {
  return CHMReader.open(input, {
    maxFileSize:
      command.opts<{ maxReadSize?: number }>().maxReadSize ??
      runtimeConfig(command).performance!.maxFileSize,
  });
}

export function filteredTree(
  reader: CHMReader,
  flags: FileFilters,
  depth = Infinity,
): FileTreeNode {
  const accepts = filePredicate(flags);
  function prune(node: FileTreeNode, level: number): FileTreeNode | undefined {
    if (node.type === 'file')
      return accepts(reader.getFileInfo(node.path)) ? { ...node } : undefined;
    const children = node
      .children!.map(child => prune(child, level + 1))
      .filter((child): child is FileTreeNode => !!child);
    if (level && !children.length) return undefined;
    const size = children.reduce((sum, child) => sum + child.size, 0);
    return { ...node, size, children: level >= depth ? [] : children };
  }
  return prune(reader.getFileTree(), 0)!;
}

export function treeText(root: FileTreeNode): string {
  const lines: string[] = [];
  function visit(node: FileTreeNode, prefix: string, marker: string): void {
    lines.push(
      `${prefix}${marker}${JSON.stringify(node.name || '/')}${node.type === 'directory' ? '/' : ` (${node.size} B)`}`,
    );
    node.children?.forEach((child, index, children) => {
      const last = index === children.length - 1;
      visit(
        child,
        prefix + (marker ? (marker.startsWith('└') ? '   ' : '│  ') : ''),
        last ? '└─ ' : '├─ ',
      );
    });
  }
  visit(root, '', '');
  return `${lines.join('\n')}\n`;
}

export const tree = addFileFilters(
  new Command('tree')
    .description('显示过滤后的归档文件树')
    .argument('<input>', 'CHM 文件'),
)
  .option(
    '--depth <count>',
    '显示层数（根为 0；reader 的安全目录上限仍适用）',
    integer,
  )
  .option('-j, --json', '输出 JSON 树')
  .action(
    async (
      input: string,
      flags: FileFilters & { depth?: number; json?: boolean },
      command: Command,
    ) => {
      const reader = await openReader(input, command);
      try {
        const result = filteredTree(reader, flags, flags.depth);
        process.stdout.write(
          flags.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : treeText(result),
        );
      } finally {
        reader.close();
      }
    },
  );

interface SearchFlags extends FileFilters {
  names?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  limit: number;
  maxMatches: number;
  encoding?: string;
  json?: boolean;
}

export function searchArchive(
  reader: CHMReader,
  query: string,
  flags: SearchFlags,
): SearchResult[] {
  if (!query) throw new Error('搜索词不能为空');
  if (flags.names && (flags.wholeWord || flags.encoding))
    throw new Error('--names 不支持 --whole-word/--encoding');
  const accepts = filePredicate(flags);
  const result: SearchResult[] = [];
  if (!flags.limit) return result;
  for (const path of reader.listFiles()) {
    const info = reader.getFileInfo(path);
    if (!accepts(info)) continue;
    if (flags.names) {
      if (
        (flags.caseSensitive ? path : path.toLowerCase()).includes(
          flags.caseSensitive ? query : query.toLowerCase(),
        )
      )
        result.push({ path, fileName: path, matches: [] });
    } else if (
      info.mimeType.startsWith('text/') ||
      ['application/json', 'application/xml', 'image/svg+xml'].includes(
        info.mimeType,
      )
    ) {
      const matches = reader.searchInFile(path, query, {
        caseSensitive: flags.caseSensitive,
        wholeWord: flags.wholeWord,
        encoding: flags.encoding,
        maxResults: flags.maxMatches,
      });
      if (matches.length) result.push({ path, fileName: path, matches });
    }
    if (result.length >= flags.limit) break;
  }
  return result;
}

export const search = addFileFilters(
  new Command('search')
    .description('字面量全文或文件名搜索；默认跳过二进制文件')
    .argument('<input>', 'CHM 文件')
    .argument('<query>', '搜索词'),
)
  .option('--names', '仅查找文件名，不读取内容')
  .option('--case-sensitive', '大小写敏感')
  .option('--whole-word', 'Unicode 整词匹配')
  .option('--limit <count>', '最多匹配文件数（0 返回空）', integer, 100)
  .option('--max-matches <count>', '每文件最多匹配数', positiveInteger, 100)
  .option('--encoding <encoding>', '搜索文本编码')
  .option(
    '--max-read-size <size>',
    '单次物化读取上限（不限制输入大小）',
    byteSize,
  )
  .option('-j, --json', '输出 JSON')
  .action(
    async (
      input: string,
      query: string,
      flags: SearchFlags,
      command: Command,
    ) => {
      const reader = await openReader(input, command);
      try {
        const result = searchArchive(reader, query, flags);
        process.stdout.write(
          flags.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : result
                .map(
                  item =>
                    `${JSON.stringify(item.path)}${flags.names ? '' : `: ${item.matches.length} matches`}\n`,
                )
                .join(''),
        );
      } finally {
        reader.close();
      }
    },
  );

export const preview = new Command('preview')
  .description(
    '生成无服务器、禁脚本/外部资源/交互的静态 HTML 预览；不自动打开浏览器',
  )
  .argument('<input>', 'CHM 文件')
  .argument('<file-path>', '预览 HTML 或文本文件（不捆绑资源）')
  .option('-o, --output <file>', '独占创建预览文件；否则 HTML 写 stdout')
  .option('--encoding <encoding>', '文本编码')
  .option('--max-read-size <size>', '预览源文件物化读取上限', byteSize)
  .action(
    async (
      input: string,
      path: string,
      flags: { output?: string; encoding?: string },
      command: Command,
    ) => {
      const reader = await openReader(input, command);
      try {
        const html = renderPreview(reader, path, flags.encoding);
        if (flags.output) await writePreview(flags.output, html);
        else process.stdout.write(html);
      } finally {
        reader.close();
      }
    },
  );

export const browse = new Command('browse')
  .description('TTY 交互式终端浏览；界面只写 stderr，不向 stdout 混入提示')
  .argument('<input>', 'CHM 文件')
  .option('--max-read-size <size>', '单次物化读取上限', byteSize)
  .action(async (input: string, _flags: unknown, command: Command) => {
    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new Error(
        'browse 需要 stdin/stderr TTY；机器调用请用 tree/search/read',
      );
    const reader = await openReader(input, command);
    try {
      await browseArchive(reader, process.stdin, process.stderr);
    } finally {
      reader.close();
    }
  });

export interface BatchItem extends ExtractResult {
  input: string;
  output: string;
}

/** Archives are sequential; each archive shares the configured bounded I/O budget. */
export async function extractBatch(
  inputs: string[],
  output: string,
  flags: ExtractionFlags,
  config: CHMKitConfig,
  signal: AbortSignal,
): Promise<BatchItem[]> {
  // Validate all options before creating any output or processing an archive.
  filePredicate(flags);
  const result: BatchItem[] = [];
  for (const [index, input] of inputs.entries()) {
    if (signal.aborted) break;
    const stem =
      basename(input)
        .replace(/\.chm$/i, '')
        .replace(/[^a-z0-9._-]/gi, '_')
        .replace(/[. ]+$/, '') || 'archive';
    const directory = join(output, `${index + 1}-${stem}`);
    try {
      result.push({
        input,
        output: directory,
        ...(await ExtractorOperations.extract(
          input,
          directory,
          extractionOptions(flags, config, signal),
        )),
      });
    } catch (error) {
      result.push({
        input,
        output: directory,
        files: [],
        totalFiles: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        cancelled: signal.aborted,
      });
    }
  }
  return result;
}

export const batch = addExtractionFlags(
  new Command('batch')
    .description('批量提取（逐归档处理，每档案 I/O 并发；输出为编号子目录）')
    .argument('<inputs...>', 'CHM 文件路径列表，不展开 shell glob'),
).action(async (inputs: string[], flags: ExtractionFlags, command: Command) => {
  const config = runtimeConfig(command);
  const output = flags.output ?? config.cli!.defaultOutputDir!;
  await withCancellation(async signal => {
    const result = await extractBatch(inputs, output, flags, config, signal);
    result.forEach(reportExtractionErrors);
    if (signal.aborted) process.exitCode = 130;
    process.stdout.write(
      flags.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result
            .map(
              item =>
                `${JSON.stringify(item.input)}: ${item.files.length}/${item.totalFiles} -> ${JSON.stringify(item.output)}\n`,
            )
            .join(''),
    );
  });
});

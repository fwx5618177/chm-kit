import { Command } from 'commander';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { ExtractOptions } from '../core/types';

/**
 * 提取 CHM 文件内容的命令
 */
export const extractCommand = new Command('extract')
  .description('Extract contents from a CHM file')
  .argument('<input>', 'Input CHM file path')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-f, --filter <pattern>', 'Filter files by pattern (glob)')
  .option(
    '-p, --preserve-structure',
    'Preserve original directory structure',
    false,
  )
  .option('-v, --verbose', 'Enable verbose output', false)
  .action(async (input: string, options: any) => {
    try {
      const extractOptions: ExtractOptions = {
        outputDir: options.output,
        preserveStructure: options.preserveStructure,
        verbose: options.verbose,
        ...(options.filter && { filter: createFilterFunction(options.filter) }),
      };

      await extractCHM(input, extractOptions);

      if (options.verbose) {
        console.log(`✅ Successfully extracted CHM file to: ${options.output}`);
      }
    } catch (error) {
      console.error('❌ Error extracting CHM file:', error);
      process.exit(1);
    }
  });

/**
 * 创建文件过滤函数
 * @param pattern 过滤模式
 * @returns 过滤函数
 */
function createFilterFunction(pattern: string): (fileName: string) => boolean {
  // 简单的 glob 模式支持
  const regex = new RegExp(
    pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.'),
  );

  return (fileName: string) => regex.test(fileName);
}

/**
 * 提取 CHM 文件内容
 * @param inputPath 输入 CHM 文件路径
 * @param options 提取选项
 */
async function extractCHM(
  inputPath: string,
  options: ExtractOptions,
): Promise<void> {
  // 检查输入文件是否存在
  try {
    await fs.access(inputPath);
  } catch {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // 创建输出目录
  await fs.mkdir(options.outputDir, { recursive: true });

  if (options.verbose) {
    console.log(`📁 Extracting CHM file: ${inputPath}`);
    console.log(`📁 Output directory: ${options.outputDir}`);
  }

  // TODO: 实现实际的 CHM 提取逻辑
  // 这里需要使用 core 模块中的 CHM 解析器
  console.log('⚠️  CHM extraction logic not yet implemented');
  console.log('This is a placeholder for the actual extraction implementation');

  // 示例：创建一个示例文件
  const exampleContent = `# CHM Extraction Result

This is a placeholder output from the CHM extraction process.

- Input file: ${inputPath}
- Output directory: ${options.outputDir}
- Preserve structure: ${options.preserveStructure}
- Filter: ${options.filter ? 'Yes' : 'No'}
- Verbose: ${options.verbose}

## TODO
- Implement CHM file parsing
- Implement LZX decompression
- Implement file extraction
- Implement directory structure preservation
`;

  await fs.writeFile(
    join(options.outputDir, 'extraction-info.md'),
    exampleContent,
  );

  if (options.verbose) {
    console.log('📄 Created extraction-info.md');
  }
}

/**
 * 确保目录存在
 * @param filePath 文件路径
 */
export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * 写入文件并确保目录存在
 * @param filePath 文件路径
 * @param content 文件内容
 */
export async function writeFileWithDir(
  filePath: string,
  content: Buffer | string,
): Promise<void> {
  await ensureDirectoryExists(filePath);
  await fs.writeFile(filePath, content);
}

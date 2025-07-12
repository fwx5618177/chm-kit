import { Command } from 'commander';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { ExtractOptions } from '../core/types';
import { logger } from '../logger/logger';

/**
 * 提取 CHM 文件内容的命令
 */
export const extractCommand = new Command('extract')
  .description('从 CHM 文件中提取内容')
  .argument('<input>', 'CHM 文件路径')
  .option('-o, --output <dir>', '输出目录', './output')
  .option('-f, --filter <pattern>', '按模式过滤文件 (glob)')
  .option('-p, --preserve-structure', '保留原始目录结构', false)
  .option('-v, --verbose', '启用详细输出', false)
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
        logger.success(`✅ 成功提取 CHM 文件到: ${options.output}`);
      }
    } catch (error) {
      logger.error('❌ Error extracting CHM file:', error);
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
    throw new Error(`输入文件未找到: ${inputPath}`);
  }

  // 创建输出目录
  await fs.mkdir(options.outputDir, { recursive: true });

  if (options.verbose) {
    logger.info(`📁 正在提取 CHM 文件: ${inputPath}`);
    logger.info(`📁 输出目录: ${options.outputDir}`);
  }

  // TODO: 实现实际的 CHM 提取逻辑
  // 这里需要使用 core 模块中的 CHM 解析器
  logger.warn('⚠️  CHM 提取逻辑尚未实现');
  logger.info('这是实际提取实现的占位符');

  // 示例：创建一个示例文件
  const exampleContent = `# CHM 提取结果

这是 CHM 提取过程的占位符输出。

- 输入文件: ${inputPath}
- 输出目录: ${options.outputDir}
- 保留结构: ${options.preserveStructure}
- 过滤器: ${options.filter ? '是' : '否'}
- 详细输出: ${options.verbose}

## 待办事项
- 实现 CHM 文件解析
- 实现 LZX 解压缩
- 实现文件提取
- 实现目录结构保留
`;

  await fs.writeFile(
    join(options.outputDir, 'extraction-info.md'),
    exampleContent,
  );

  if (options.verbose) {
    logger.info('📄 已创建 extraction-info.md');
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

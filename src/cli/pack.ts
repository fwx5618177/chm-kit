import { Command } from 'commander';
import { promises as fs } from 'fs';
import { join, extname, basename } from 'path';
import type { PackOptions } from '../core/types';
import { logger } from '../logger/logger';

/**
 * 打包目录为 CHM 文件的命令
 */
export const packCommand = new Command('pack')
  .description('将目录打包为 CHM 文件')
  .argument('<input>', '输入目录路径')
  .option('-o, --output <file>', '输出 CHM 文件路径', './output.chm')
  .option('-t, --title <title>', 'CHM 文件标题')
  .option('-d, --default-topic <file>', '默认主题文件')
  .option('-c, --compression', '启用压缩', true)
  .option('-v, --verbose', '启用详细输出', false)
  .action(async (input: string, options: any) => {
    try {
      const packOptions: PackOptions = {
        inputDir: input,
        outputPath: options.output,
        compression: options.compression,
        verbose: options.verbose,
        ...(options.title && { title: options.title }),
        ...(options.defaultTopic && { defaultTopic: options.defaultTopic }),
      };

      await packCHM(packOptions);

      if (options.verbose) {
        logger.success(`✅ 成功创建 CHM 文件: ${options.output}`);
      }
    } catch (error) {
      logger.error('❌ Error packing CHM file:', error);
      process.exit(1);
    }
  });

/**
 * 打包目录为 CHM 文件
 * @param options 打包选项
 */
async function packCHM(options: PackOptions): Promise<void> {
  // 检查输入目录是否存在
  try {
    const stats = await fs.stat(options.inputDir);
    if (!stats.isDirectory()) {
      throw new Error(`输入路径不是目录: ${options.inputDir}`);
    }
  } catch {
    throw new Error(`输入目录未找到: ${options.inputDir}`);
  }

  if (options.verbose) {
    logger.info(`📁 正在打包目录: ${options.inputDir}`);
    logger.info(`📦 输出 CHM 文件: ${options.outputPath}`);
    logger.info(`🗜️  压缩: ${options.compression ? '已启用' : '已禁用'}`);
    if (options.title) {
      logger.info(`📖 标题: ${options.title}`);
    }
    if (options.defaultTopic) {
      logger.info(`🏠 默认主题: ${options.defaultTopic}`);
    }
  }

  // 扫描输入目录
  const files = await scanDirectory(options.inputDir);

  if (options.verbose) {
    logger.info(`📄 找到 ${files.length} 个待打包文件`);
  }

  // 生成 TOC 和索引文件
  await generateTOC(options.inputDir, files, options.verbose || false);
  await generateIndex(options.inputDir, files, options.verbose || false);

  // TODO: 实现实际的 CHM 打包逻辑
  // 这里需要使用 encoder 模块中的 CHM 编码器
  logger.warn('⚠️  CHM 打包逻辑尚未实现');
  logger.info('这是实际打包实现的占位符');

  // 示例：创建一个示例 CHM 文件（实际上是文本文件）
  const manifestContent = `# CHM 包清单

这是由 chmkit 创建的 CHM 文件占位符。

## 包信息
- 输入目录: ${options.inputDir}
- 输出文件: ${options.outputPath}
- 标题: ${options.title || '无标题'}
- 默认主题: ${options.defaultTopic || 'index.html'}
- 压缩: ${options.compression ? '已启用' : '已禁用'}
- 创建时间: ${new Date().toISOString()}

## 文件 (共 ${files.length} 个)
${files.map(file => `- ${file}`).join('\n')}

## 待办事项
- 实现 CHM 文件格式写入
- 实现 LZX 压缩
- 实现 ITSF/ITSP/LZXC 头部写入
- 实现目录结构编码
`;

  await fs.writeFile(options.outputPath, manifestContent);

  if (options.verbose) {
    logger.info('📦 已创建 CHM 清单文件');
  }
}

/**
 * 扫描目录获取所有文件
 * @param dirPath 目录路径
 * @returns 文件列表
 */
async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  async function scanRecursive(
    currentPath: string,
    relativePath: string = '',
  ): Promise<void> {
    const items = await fs.readdir(currentPath);

    for (const item of items) {
      const itemPath = join(currentPath, item);
      const itemRelativePath = relativePath ? join(relativePath, item) : item;

      const stats = await fs.stat(itemPath);

      if (stats.isDirectory()) {
        await scanRecursive(itemPath, itemRelativePath);
      } else if (stats.isFile()) {
        files.push(itemRelativePath);
      }
    }
  }

  await scanRecursive(dirPath);
  return files.sort();
}

/**
 * 生成 TOC (Table of Contents) 文件
 * @param inputDir 输入目录
 * @param files 文件列表
 * @param verbose 是否详细输出
 */
async function generateTOC(
  inputDir: string,
  files: string[],
  verbose: boolean,
): Promise<void> {
  const htmlFiles = files.filter(
    file => extname(file).toLowerCase() === '.html',
  );

  const tocContent = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML>
<HEAD>
<meta name="GENERATOR" content="chmkit">
<!-- Sitemap 1.0 -->
</HEAD><BODY>
<OBJECT type="text/site properties">
	<param name="ImageType" value="Folder">
</OBJECT>
<UL>
${htmlFiles
  .map(file => {
    const title = basename(file, '.html');
    return `	<LI> <OBJECT type="text/sitemap">
		<param name="Name" value="${title}">
		<param name="Local" value="${file}">
		</OBJECT>`;
  })
  .join('\n')}
</UL>
</BODY></HTML>`;

  const tocPath = join(inputDir, 'Table of Contents.hhc');
  await fs.writeFile(tocPath, tocContent);

  if (verbose) {
    logger.info('📋 已生成目录 (TOC)');
  }
}

/**
 * 生成索引文件
 * @param inputDir 输入目录
 * @param files 文件列表
 * @param verbose 是否详细输出
 */
async function generateIndex(
  inputDir: string,
  files: string[],
  verbose: boolean,
): Promise<void> {
  const htmlFiles = files.filter(
    file => extname(file).toLowerCase() === '.html',
  );

  const indexContent = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">
<HTML>
<HEAD>
<meta name="GENERATOR" content="chmkit">
<!-- Sitemap 1.0 -->
</HEAD><BODY>
<UL>
${htmlFiles
  .map(file => {
    const title = basename(file, '.html');
    return `	<LI> <OBJECT type="text/sitemap">
		<param name="Name" value="${title}">
		<param name="Local" value="${file}">
		</OBJECT>`;
  })
  .join('\n')}
</UL>
</BODY></HTML>`;

  const indexPath = join(inputDir, 'Index.hhk');
  await fs.writeFile(indexPath, indexContent);

  if (verbose) {
    logger.info('📑 已生成索引文件');
  }
}

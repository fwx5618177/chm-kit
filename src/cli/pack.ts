import { Command } from 'commander';
import { promises as fs } from 'fs';
import { join, extname, basename } from 'path';
import type { PackOptions } from '../core/types';

/**
 * 打包目录为 CHM 文件的命令
 */
export const packCommand = new Command('pack')
  .description('Pack a directory into a CHM file')
  .argument('<input>', 'Input directory path')
  .option('-o, --output <file>', 'Output CHM file path', './output.chm')
  .option('-t, --title <title>', 'CHM file title')
  .option('-d, --default-topic <file>', 'Default topic file')
  .option('-c, --compression', 'Enable compression', true)
  .option('-v, --verbose', 'Enable verbose output', false)
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
        console.log(`✅ Successfully created CHM file: ${options.output}`);
      }
    } catch (error) {
      console.error('❌ Error packing CHM file:', error);
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
      throw new Error(`Input path is not a directory: ${options.inputDir}`);
    }
  } catch {
    throw new Error(`Input directory not found: ${options.inputDir}`);
  }

  if (options.verbose) {
    console.log(`📁 Packing directory: ${options.inputDir}`);
    console.log(`📦 Output CHM file: ${options.outputPath}`);
    console.log(
      `🗜️  Compression: ${options.compression ? 'Enabled' : 'Disabled'}`,
    );
    if (options.title) {
      console.log(`📖 Title: ${options.title}`);
    }
    if (options.defaultTopic) {
      console.log(`🏠 Default topic: ${options.defaultTopic}`);
    }
  }

  // 扫描输入目录
  const files = await scanDirectory(options.inputDir);

  if (options.verbose) {
    console.log(`📄 Found ${files.length} files to pack`);
  }

  // 生成 TOC 和索引文件
  await generateTOC(options.inputDir, files, options.verbose || false);
  await generateIndex(options.inputDir, files, options.verbose || false);

  // TODO: 实现实际的 CHM 打包逻辑
  // 这里需要使用 encoder 模块中的 CHM 编码器
  console.log('⚠️  CHM packing logic not yet implemented');
  console.log('This is a placeholder for the actual packing implementation');

  // 示例：创建一个示例 CHM 文件（实际上是文本文件）
  const manifestContent = `# CHM Package Manifest

This is a placeholder CHM file created by chmkit.

## Package Information
- Input directory: ${options.inputDir}
- Output file: ${options.outputPath}
- Title: ${options.title || 'Untitled'}
- Default topic: ${options.defaultTopic || 'index.html'}
- Compression: ${options.compression ? 'Enabled' : 'Disabled'}
- Created: ${new Date().toISOString()}

## Files (${files.length} total)
${files.map(file => `- ${file}`).join('\n')}

## TODO
- Implement CHM file format writing
- Implement LZX compression
- Implement ITSF/ITSP/LZXC header writing
- Implement directory structure encoding
`;

  await fs.writeFile(options.outputPath, manifestContent);

  if (options.verbose) {
    console.log('📦 Created CHM manifest file');
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
    console.log('📋 Generated Table of Contents (TOC)');
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
    console.log('📑 Generated Index file');
  }
}

import { constants, readFileSync, promises as fs } from 'fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path';
import { BitReader } from '../utils/io/bit-reader';
import { FileReconstructor } from '../core/files/file-reconstructor';
import { CHMFileManager } from '../core/files/file-manager';
import { ParserOperations } from './parser';
import type { ExtractOptions } from '../core/types';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Create one component at a time; recursive mkdir would follow existing links. */
async function ensureDirectory(directory: string): Promise<void> {
  const parent = dirname(directory);
  if (parent !== directory) await ensureDirectory(parent);
  try {
    await fs.mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`不安全的输出目录（符号链接或非目录）: ${directory}`);
  }
}

function archiveRelativePath(name: string): string {
  // A single leading slash is CHM's namespace root, never the filesystem root.
  const path = name.startsWith('/') ? name.slice(1) : name;
  const components = path.split('/');
  if (
    !path ||
    name.startsWith('//') ||
    isAbsolute(path) ||
    /[\\:<>"|?*]/.test(path) ||
    [...path].some(char => char.charCodeAt(0) < 0x20) ||
    components.some(
      part =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(
          part.split('.')[0]!.replace(/[. ]+$/, ''),
        ),
    )
  ) {
    throw new Error(`不安全的归档路径: ${JSON.stringify(name)}`);
  }
  return path;
}

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (
    !path ||
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error(`输出路径越界: ${target}`);
  }
}

/**
 * No overwrite or symbolic-link traversal, including root ancestors. On macOS,
 * aliases such as /tmp must be supplied as their real path (e.g. /private/tmp).
 */
export class ExtractorOperations {
  static async extract(
    filePath: string,
    outputDir: string,
    options: Partial<ExtractOptions> = {},
  ): Promise<{ files: string[]; totalFiles: number; errors: string[] }> {
    try {
      const parsedCHM = await ParserOperations.parse(filePath);
      const reader = new BitReader(readFileSync(filePath));
      const reconstructor = new FileReconstructor(parsedCHM);
      const manager = new CHMFileManager(parsedCHM);
      const fileList = manager
        .getUserFileList()
        .filter(options.filter ?? (() => true));
      const outputRoot = resolve(outputDir);
      await ensureDirectory(outputRoot);
      const realRoot = await fs.realpath(outputRoot);
      const rootStat = await fs.lstat(outputRoot);
      if (realRoot !== outputRoot)
        throw new Error('输出根目录 realpath 不一致');

      const checkRoot = async () => {
        const stat = await fs.lstat(outputRoot);
        if (
          stat.isSymbolicLink() ||
          stat.dev !== rootStat.dev ||
          stat.ino !== rootStat.ino ||
          (await fs.realpath(outputRoot)) !== realRoot
        ) {
          throw new Error('输出根目录已更改或为符号链接');
        }
      };

      const extractedFiles: string[] = [];
      const errors: string[] = [];
      const destinations = new Set<string>();

      for (const fileName of fileList) {
        try {
          const archivePath = archiveRelativePath(fileName);
          const destination = options.preserveStructure
            ? archivePath
            : basename(archivePath);
          const outputPath = resolve(realRoot, destination);
          assertInside(realRoot, outputPath);
          // Detect collisions even on case-sensitive hosts for portable extraction.
          const key = destination.normalize('NFC').toLowerCase();
          if (destinations.has(key))
            throw new Error(`输出文件名冲突: ${destination}`);
          destinations.add(key);

          await checkRoot();
          let parent = realRoot;
          for (const component of destination.split('/').slice(0, -1)) {
            parent = join(parent, component);
            await ensureDirectory(parent);
            assertInside(realRoot, await fs.realpath(parent));
          }
          const realParent = await fs.realpath(dirname(outputPath));
          if (realParent !== realRoot) assertInside(realRoot, realParent);
          if (realParent !== dirname(outputPath))
            throw new Error('输出父目录 realpath 不一致');

          try {
            await fs.lstat(outputPath);
            throw new Error(`输出路径已存在，拒绝覆盖: ${destination}`);
          } catch (error) {
            if (!isMissing(error)) throw error;
          }

          const file = reconstructor.reconstructFile(fileName, reader);
          await checkRoot();
          if ((await fs.realpath(dirname(outputPath))) !== realParent) {
            throw new Error('输出父目录已更改');
          }
          const handle = await fs.open(
            outputPath,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW,
            0o666,
          );
          try {
            await handle.writeFile(file.data);
          } finally {
            await handle.close();
          }
          extractedFiles.push(fileName);
          if (options.verbose) {
            process.stderr.write(
              `已提取: ${fileName} (${file.data.length} 字节)\n`,
            );
          }
        } catch (error) {
          const message = `提取文件 ${JSON.stringify(fileName)} 失败: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(message);
          if (options.verbose) process.stderr.write(`${message}\n`);
        }
      }

      return { files: extractedFiles, totalFiles: fileList.length, errors };
    } catch (error) {
      throw new Error(
        `CHM 文件提取失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

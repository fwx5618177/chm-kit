import { constants, promises as fs } from 'fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path';
import { FileByteSource } from '../reader/file-byte-source';
import { FileReconstructor } from '../core/files/file-reconstructor';
import { CHMFileManager } from '../core/files/file-manager';
import { CHMParserFactory } from '../core/parser/parser-factory';
import { CHMParserValidator } from '../core/parser/parser-validator';
import type {
  ExtractOptions,
  ExtractProgress,
  ExtractResult,
} from '../core/types';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Create one component at a time; recursive mkdir would follow existing links. */
async function ensureDirectory(directory: string): Promise<void> {
  const parent = dirname(directory);
  // Drive/share roots already exist; mkdir(root) returns EPERM on Windows.
  if (parent !== directory) {
    await ensureDirectory(parent);
    try {
      await fs.mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
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
    components.length > 1024 ||
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
  ): Promise<ExtractResult> {
    const concurrency = options.concurrency ?? 4;
    const chunkSize = options.chunkSize ?? 64 * 1024;
    for (const [name, value] of [
      ['concurrency', concurrency],
      ['chunkSize', chunkSize],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(`${name} must be a positive safe integer`);
    }
    const result: ExtractResult = {
      files: [],
      totalFiles: 0,
      errors: [],
      cancelled: false,
    };
    if (options.signal?.aborted) return { ...result, cancelled: true };
    let source: FileByteSource | undefined;
    try {
      const input = await FileByteSource.open(filePath);
      source = input;
      if (options.signal?.aborted) return { ...result, cancelled: true };
      const parsedCHM = CHMParserFactory.create().parseSource(input);
      if (!CHMParserValidator.validate(parsedCHM))
        throw new Error('CHM 文件解析验证失败');
      if (options.signal?.aborted) return { ...result, cancelled: true };
      // Sequential generators own their decoder state; only the bounded source
      // window is shared. Positioned reads remain safe across interleaved jobs.
      input.cache.setLimit(256 * 1024);
      const reconstructor = new FileReconstructor(parsedCHM, {
        maxCacheBytes: 0,
      });
      const manager = new CHMFileManager(parsedCHM);
      const fileList = manager
        .getUserFileList()
        .filter(
          name =>
            options.filter?.(name, parsedCHM.directory.entries.get(name)!) ??
            true,
        );
      result.totalFiles = fileList.length;
      if (options.signal?.aborted) return { ...result, cancelled: true };
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

      const checkParent = async (path: string, expected: string) => {
        if ((await fs.realpath(dirname(path))) !== expected)
          throw new Error('输出父目录已更改');
      };
      const succeeded = new Map<number, string>();
      const failures = new Map<number, string>();
      const recordFailure = (index: number, message: string) => {
        const previous = failures.get(index);
        failures.set(index, previous ? `${previous}\n${message}` : message);
      };
      // Reserve destinations in archive order before workers start. Prefix conflicts
      // must be deterministic too (a file cannot later become a directory).
      type DestinationNode = {
        file: boolean;
        children: Map<string, DestinationNode>;
      };
      const destinations: DestinationNode = {
        file: false,
        children: new Map(),
      };
      const reserve = (destination: string) => {
        const parts = destination.normalize('NFC').toLowerCase().split('/');
        let node = destinations;
        for (const [index, part] of parts.entries()) {
          if (node.file) throw new Error(`输出文件名冲突: ${destination}`);
          let child = node.children.get(part);
          if (!child) {
            child = { file: false, children: new Map() };
            node.children.set(part, child);
          }
          if (index === parts.length - 1) {
            if (child.file || child.children.size)
              throw new Error(`输出文件名冲突: ${destination}`);
            child.file = true;
          }
          node = child;
        }
      };
      const jobs = fileList.map((fileName, index) => {
        try {
          const archivePath = archiveRelativePath(fileName);
          const destination = options.preserveStructure
            ? archivePath
            : basename(archivePath);
          reserve(destination);
          return { fileName, index, destination };
        } catch (error) {
          return { fileName, index, error };
        }
      });
      const progress: ExtractProgress = {
        totalFiles: fileList.length,
        completedFiles: 0,
        succeededFiles: 0,
        failedFiles: 0,
        bytesWritten: 0,
        totalBytes: fileList.reduce(
          (sum, name) => sum + parsedCHM.directory.entries.get(name)!.length,
          0,
        ),
      };
      let observerFailed = false;
      let observerError: unknown;
      const notify = (currentFile?: string) => {
        if (observerFailed) return;
        try {
          options.onProgress?.({ ...progress, currentFile });
        } catch (error) {
          observerFailed = true;
          observerError = error;
        }
      };
      const stopped = () => options.signal?.aborted || observerFailed;
      notify();
      let next = 0;
      const worker = async () => {
        while (!stopped() && next < jobs.length) {
          const job = jobs[next++]!;
          const { fileName, index } = job;
          let outputPath: string | undefined;
          let created: { dev: number; ino: number } | undefined;
          let committed = false;
          let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
          try {
            if ('error' in job) throw job.error;
            const destination = job.destination;
            outputPath = resolve(realRoot, destination);
            assertInside(realRoot, outputPath);

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

            if (stopped()) break;
            await checkRoot();
            await checkParent(outputPath, realParent);
            handle = await fs.open(
              outputPath,
              constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
              0o666,
            );
            created = await handle.stat();
            if (stopped()) break;
            for (const chunk of reconstructor.iterateFileChunks(
              fileName,
              input,
              chunkSize,
            )) {
              if (stopped()) break;
              await checkRoot();
              await checkParent(outputPath, realParent);
              if (stopped()) break;
              input.validate();
              await handle.writeFile(chunk);
              progress.bytesWritten += chunk.length;
              notify(fileName);
              if (stopped()) break;
            }
            if (stopped()) break;
            await handle.close();
            handle = undefined;
            input.validate();
            committed = true;
            succeeded.set(index, fileName);
            progress.succeededFiles++;
            progress.completedFiles++;
            if (options.verbose)
              process.stderr.write(`已提取: ${JSON.stringify(fileName)}\n`);
            notify(fileName);
          } catch (error) {
            const message = `提取文件 ${JSON.stringify(fileName)} 失败: ${error instanceof Error ? error.message : String(error)}`;
            recordFailure(index, message);
            progress.failedFiles++;
            progress.completedFiles++;
            if (options.verbose) process.stderr.write(`${message}\n`);
            notify(fileName);
          } finally {
            try {
              await handle?.close();
            } catch (error) {
              recordFailure(index, `关闭输出失败: ${String(error)}`);
            }
            if (!committed && created && outputPath) {
              try {
                await checkRoot();
                await checkParent(outputPath, dirname(outputPath));
                const stat = await fs.lstat(outputPath);
                if (
                  !stat.isSymbolicLink() &&
                  stat.dev === created.dev &&
                  stat.ino === created.ino
                )
                  await fs.unlink(outputPath);
              } catch (error) {
                if (!isMissing(error))
                  recordFailure(index, `清理未完成输出失败: ${String(error)}`);
              }
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
      );
      if (observerFailed) throw observerError;
      result.files = [...succeeded]
        .sort(([a], [b]) => a - b)
        .map(([, name]) => name);
      result.errors = [...failures]
        .sort(([a], [b]) => a - b)
        .map(([, message]) => message);
      result.cancelled = !!options.signal?.aborted;
      return result;
    } catch (error) {
      if (
        options.signal?.aborted &&
        (error as Error | null)?.name === 'AbortError'
      )
        return { ...result, cancelled: true };
      throw new Error(
        `CHM 文件提取失败: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      source?.close();
    }
  }
}

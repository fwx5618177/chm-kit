import { CHMArchive } from './reader/chm-archive';
import {
  packFiles as encodeFiles,
  packTemplate as encodeTemplate,
  updateArchive as rebuildArchive,
} from './encoder/archive-builder';
import type {
  PackFilesOptions,
  UpdateArchiveOptions,
  PackTOCEntry,
  HTMLHelpMetadata,
} from './encoder/types';
import type {
  CacheStrategy,
  AdaptivePreloadOptions,
  CacheLayerStats,
  CacheStats,
  CHMFileInfo,
  FileTreeNode,
  FileWithMetadataData as ArchiveFileWithMetadata,
  NavigationEntry,
  NavLink,
  ReaderMetadata,
  ReaderOptions,
  SearchMatch,
  SearchOptions,
  SearchResult,
} from './reader/types';

export { CacheStrategy } from './reader/types';
export type {
  AdaptivePreloadOptions,
  CacheLayerStats,
  CacheStats,
  CHMFileInfo,
  FileTreeNode,
  NavigationEntry,
  NavLink,
  ReaderMetadata,
  ReaderOptions,
  SearchMatch,
  SearchOptions,
  SearchResult,
  PackFilesOptions,
  UpdateArchiveOptions,
  PackTOCEntry,
  HTMLHelpMetadata,
};

export type CHMSource = Uint8Array | ArrayBuffer | Blob;

export type FileWithMetadata = ArchiveFileWithMetadata<Uint8Array>;

/** Browser facade: composition keeps Buffer out of all public method signatures. */
export class CHMReader {
  private readonly archive: CHMArchive;

  constructor(input: Uint8Array | ArrayBuffer, options?: ReaderOptions) {
    if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
      throw new TypeError(
        'CHMReader expects Uint8Array or ArrayBuffer; use open() for Blob sources',
      );
    }
    this.archive = new CHMArchive(input, options);
  }

  static async open(
    source: CHMSource,
    options?: ReaderOptions,
  ): Promise<CHMReader> {
    if (source instanceof Uint8Array || source instanceof ArrayBuffer)
      return new CHMReader(source, options);
    if (typeof Blob !== 'undefined' && source instanceof Blob)
      return new CHMReader(await source.arrayBuffer(), options);
    throw new TypeError(
      'CHM source must be Uint8Array, ArrayBuffer or Blob, not a filesystem path or URL',
    );
  }

  isOpen(): boolean {
    return this.archive.isOpen();
  }
  close(): void {
    this.archive.close();
  }
  listFiles(pattern?: string): string[] {
    return this.archive.listFiles(pattern);
  }
  listDirectories(): string[] {
    return this.archive.listDirectories();
  }
  exists(path: string): boolean {
    return this.archive.exists(path);
  }
  getFileTree(): FileTreeNode {
    return this.archive.getFileTree();
  }
  glob(pattern: string): string[] {
    return this.archive.glob(pattern);
  }

  readFile(path: string): Uint8Array {
    return Uint8Array.from(this.archive.readFile(path));
  }
  readText(path: string, encoding?: string): string {
    return this.archive.readText(path, encoding);
  }
  readHTML(path: string, encoding?: string): string {
    return this.archive.readHTML(path, encoding);
  }
  readJSON<T = unknown>(path: string, encoding?: string): T {
    return this.archive.readJSON<T>(path, encoding);
  }
  readImage(path: string): Uint8Array {
    return Uint8Array.from(this.archive.readImage(path));
  }
  readCSS(path: string, encoding?: string): string {
    return this.archive.readCSS(path, encoding);
  }
  readJS(path: string, encoding?: string): string {
    return this.archive.readJS(path, encoding);
  }
  readRange(path: string, start = 0, end?: number): Uint8Array {
    return Uint8Array.from(this.archive.readRange(path, start, end));
  }
  createReadStream(
    path: string,
    start = 0,
    end?: number,
  ): ReadableStream<Uint8Array> {
    const source = this.archive.createReadStream(path, start, end).getReader();
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const { done, value } = await source.read();
            if (done) {
              source.releaseLock();
              controller.close();
            } else {
              controller.enqueue(Uint8Array.from(value));
            }
          } catch (error) {
            source.releaseLock();
            controller.error(error);
          }
        },
        async cancel(reason) {
          try {
            await source.cancel(reason);
          } finally {
            source.releaseLock();
          }
        },
      },
      { highWaterMark: 0 },
    );
  }

  readMultiple(paths: readonly string[]): Map<string, Uint8Array> {
    const result = new Map<string, Uint8Array>();
    for (const [path, data] of this.archive.readMultiple(paths))
      result.set(path, Uint8Array.from(data));
    return result;
  }

  readWithMetadata(path: string): FileWithMetadata {
    const file = this.archive.readWithMetadata(path);
    return { ...file, data: Uint8Array.from(file.data) };
  }

  getFileInfo(path: string): CHMFileInfo {
    return this.archive.getFileInfo(path);
  }
  getFileSize(path: string): number {
    return this.archive.getFileSize(path);
  }
  getCompressedSize(path: string): number | null {
    return this.archive.getCompressedSize(path);
  }
  getCompressionRatio(path: string): number | null {
    return this.archive.getCompressionRatio(path);
  }
  getMimeType(path: string): string {
    return this.archive.getMimeType(path);
  }
  getMetadata(): ReaderMetadata {
    return this.archive.getMetadata();
  }
  getTOC(): NavigationEntry[] {
    return this.archive.getTOC();
  }
  getIndex(): NavigationEntry[] {
    return this.archive.getIndex();
  }
  getDefaultPage(): string | undefined {
    return this.archive.getDefaultPage();
  }
  getHomePage(): string | undefined {
    return this.archive.getHomePage();
  }
  getNavigationLinks(path: string): NavLink[] {
    return this.archive.getNavigationLinks(path);
  }
  search(keyword: string, options?: SearchOptions): SearchResult[] {
    return this.archive.search(keyword, options);
  }
  searchInFile(
    path: string,
    keyword: string,
    options?: SearchOptions,
  ): SearchMatch[] {
    return this.archive.searchInFile(path, keyword, options);
  }
  findFiles(pattern: string): string[] {
    return this.archive.findFiles(pattern);
  }
  fuzzySearch(query: string, options?: SearchOptions): SearchResult[] {
    return this.archive.fuzzySearch(query, options);
  }
  preload(paths: readonly string[]): void {
    this.archive.preload(paths);
  }
  getPreloadError(): Error | undefined {
    return this.archive.getPreloadError();
  }
  clearCache(): void {
    this.archive.clearCache();
  }
  getCacheStats(): CacheStats {
    return this.archive.getCacheStats();
  }
  setCacheStrategy(strategy: CacheStrategy): void {
    this.archive.setCacheStrategy(strategy);
  }
}

/** Pure in-memory CHM packing; no filesystem paths or Node-valued outputs. */
export function packFiles(
  files: ReadonlyMap<string, Uint8Array>,
  options?: PackFilesOptions,
): Uint8Array {
  return Uint8Array.from(encodeFiles(files, options));
}

export function packTemplate(
  template: ReadonlyMap<string, Uint8Array>,
  overrides: ReadonlyMap<string, Uint8Array | null>,
  options?: PackFilesOptions,
): Uint8Array {
  return Uint8Array.from(encodeTemplate(template, overrides, options));
}

export function updateArchive(
  existing: Uint8Array | ArrayBuffer,
  changes: ReadonlyMap<string, Uint8Array | null>,
  options?: UpdateArchiveOptions,
): Uint8Array {
  return Uint8Array.from(
    rebuildArchive(
      existing instanceof ArrayBuffer ? new Uint8Array(existing) : existing,
      changes,
      options,
    ),
  );
}

/** Source-based convenience API. One-shot operations always close their reader. */
export class CHMKit {
  static from(
    input: Uint8Array | ArrayBuffer,
    options?: ReaderOptions,
  ): CHMReader {
    return new CHMReader(input, options);
  }

  static open(source: CHMSource, options?: ReaderOptions): Promise<CHMReader> {
    return CHMReader.open(source, options);
  }

  static packFiles(
    files: ReadonlyMap<string, Uint8Array>,
    options?: PackFilesOptions,
  ): Uint8Array {
    return packFiles(files, options);
  }

  static packTemplate(
    template: ReadonlyMap<string, Uint8Array>,
    overrides: ReadonlyMap<string, Uint8Array | null>,
    options?: PackFilesOptions,
  ): Uint8Array {
    return packTemplate(template, overrides, options);
  }

  static updateArchive(
    existing: Uint8Array | ArrayBuffer,
    changes: ReadonlyMap<string, Uint8Array | null>,
    options?: UpdateArchiveOptions,
  ): Uint8Array {
    return updateArchive(existing, changes, options);
  }

  static readFile(
    source: CHMSource,
    path: string,
    options?: ReaderOptions,
  ): Promise<Uint8Array> {
    return CHMKit.withReader(source, options, reader => reader.readFile(path));
  }

  static readText(
    source: CHMSource,
    path: string,
    encoding?: string,
    options?: ReaderOptions,
  ): Promise<string> {
    return CHMKit.withReader(source, options, reader =>
      reader.readText(path, encoding),
    );
  }

  static readHTML(
    source: CHMSource,
    path: string,
    encoding?: string,
    options?: ReaderOptions,
  ): Promise<string> {
    return CHMKit.withReader(source, options, reader =>
      reader.readHTML(path, encoding),
    );
  }

  static listFiles(
    source: CHMSource,
    pattern?: string,
    options?: ReaderOptions,
  ): Promise<string[]> {
    return CHMKit.withReader(source, options, reader =>
      reader.listFiles(pattern),
    );
  }

  static exists(
    source: CHMSource,
    path: string,
    options?: ReaderOptions,
  ): Promise<boolean> {
    return CHMKit.withReader(source, options, reader => reader.exists(path));
  }

  static getTOC(
    source: CHMSource,
    options?: ReaderOptions,
  ): Promise<NavigationEntry[]> {
    return CHMKit.withReader(source, options, reader => reader.getTOC());
  }

  static searchContent(
    source: CHMSource,
    keyword: string,
    options?: SearchOptions,
    readerOptions?: ReaderOptions,
  ): Promise<SearchResult[]> {
    return CHMKit.withReader(source, readerOptions, reader =>
      reader.search(keyword, options),
    );
  }

  private static async withReader<T>(
    source: CHMSource,
    options: ReaderOptions | undefined,
    action: (reader: CHMReader) => T | Promise<T>,
  ): Promise<T> {
    const reader = await CHMReader.open(source, options);
    try {
      return await action(reader);
    } finally {
      reader.close();
    }
  }
}

export default CHMReader;

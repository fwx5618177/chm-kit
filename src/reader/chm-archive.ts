import { CHMParser } from '../core/parser/chm-parser';
import { FileReconstructor } from '../core/files/file-reconstructor';
import { BitReader } from '../utils/io/bit-reader';
import type { DirectoryEntry, ParsedCHM } from '../core/types';
import {
  CacheStrategy,
  type CacheLayerStats,
  type CacheStats,
  type CHMFileInfo,
  type FileTreeNode,
  type FileWithMetadataData,
  type NavigationEntry,
  type NavLink,
  type ReaderMetadata,
  type ReaderOptions,
  type SearchMatch,
  type SearchOptions,
  type SearchResult,
} from './types';
import {
  decodeText,
  escapeRegExp,
  globExpression,
  htmlEncoding,
  languageEncoding,
  mimeType,
  normalizePath,
} from './reader-utils';
import { parseLinks, parseSitemap } from './navigation';

export * from './types';

const DEFAULT_CACHE_BYTES = 8 * 1024 * 1024;
const DEFAULT_FILE_SIZE = 256 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
// Inferred parents can otherwise expand a small deep-path archive quadratically.
const MAX_DIRECTORY_DEPTH = 1024;
const MAX_DIRECTORY_COUNT = 100000;
const MAX_DIRECTORY_PATH_CHARS = 8 * 1024 * 1024;

function isInternalPath(path: string): boolean {
  const relative = normalizePath(path).replace(/^\/+/, '');
  return /^[#$]/.test(relative) || /^::dataspace(?:\/|$)/i.test(relative);
}

function nonnegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}

/**
 * In-memory CHM reader. All operations are synchronous (and may also be awaited),
 * except the WHATWG stream's normal asynchronous consumption. No filesystem,
 * process, logger or Node stream dependency belongs in this module.
 */
export class CHMArchive {
  private buffer?: Buffer;
  private parsed?: ParsedCHM;
  private reconstructor?: FileReconstructor;
  private readonly paths = new Map<string, DirectoryEntry>();
  private readonly cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private readonly maxCacheBytes: number;
  private readonly maxFileSize: number;
  private readonly defaultEncoding?: string;
  private strategy: CacheStrategy;

  constructor(input: Uint8Array | ArrayBuffer, options: ReaderOptions = {}) {
    this.maxCacheBytes = nonnegative(
      options.maxCacheBytes ?? DEFAULT_CACHE_BYTES,
      'maxCacheBytes',
    );
    this.maxFileSize = nonnegative(
      options.maxFileSize ?? DEFAULT_FILE_SIZE,
      'maxFileSize',
    );
    this.defaultEncoding = options.defaultEncoding;
    this.strategy = options.cacheStrategy ?? CacheStrategy.LRU;
    this.validateStrategy(this.strategy);
    // Own the input: caller mutations and Buffer views cannot invalidate parsing.
    this.buffer = Buffer.from(
      input instanceof Uint8Array ? input : new Uint8Array(input),
    );
    this.parsed = new CHMParser().parse(new BitReader(this.buffer));
    for (const entry of this.parsed.directory.entries.values()) {
      const key = normalizePath(entry.name).toLowerCase();
      if (this.paths.has(key))
        throw new Error(`Ambiguous case-insensitive CHM path: ${entry.name}`);
      this.paths.set(key, entry);
    }
    this.reconstructor = new FileReconstructor(this.parsed, {
      maxCacheBytes: this.blockCacheLimit(),
      maxOutputBytes: this.maxFileSize,
    });
  }

  isOpen(): boolean {
    return this.buffer !== undefined;
  }

  close(): void {
    this.clearCache();
    this.paths.clear();
    this.reconstructor = undefined;
    this.parsed = undefined;
    this.buffer = undefined;
  }

  listFiles(pattern?: string): string[] {
    this.assertOpen();
    const files = [...this.paths.values()]
      .filter(entry => !entry.name.endsWith('/') && !isInternalPath(entry.name))
      .map(entry => entry.name)
      .sort();
    if (pattern === undefined) return files;
    const expression = globExpression(pattern);
    return files.filter(name => expression.test(name.replace(/^\/+/, '')));
  }

  listDirectories(): string[] {
    this.assertOpen();
    const directories = new Map<string, string>();
    let characters = 0;
    for (const entry of this.paths.values()) {
      if (isInternalPath(entry.name)) continue;
      const path = normalizePath(entry.name);
      if (path.split('/').length - 2 > MAX_DIRECTORY_DEPTH)
        throw new RangeError('CHM directory depth exceeds safety limit (1024)');
      for (
        let index = path.indexOf('/', path.startsWith('/') ? 1 : 0);
        index !== -1;
        index = path.indexOf('/', index + 1)
      ) {
        const directoryKey = path.slice(0, index + 1).toLowerCase();
        if (directories.has(directoryKey)) continue;
        if (
          directories.size >= MAX_DIRECTORY_COUNT ||
          characters + index + 1 > MAX_DIRECTORY_PATH_CHARS
        )
          throw new RangeError('CHM directory expansion exceeds safety limit');
        characters += index + 1;
        directories.set(directoryKey, path.slice(0, index + 1));
      }
    }
    return [...directories.values()].sort();
  }

  exists(path: string): boolean {
    this.assertOpen();
    const key = normalizePath(path).toLowerCase();
    const directory = key.endsWith('/') ? key : `${key}/`;
    return (
      key === '/' ||
      this.paths.has(key) ||
      this.paths.has(directory) ||
      [...this.paths.keys()].some(name => name.startsWith(directory))
    );
  }

  getFileTree(): FileTreeNode {
    this.assertOpen();
    const root: FileTreeNode = {
      name: '/',
      path: '/',
      type: 'directory',
      size: 0,
      children: [],
    };
    const nodes = new Map<string, FileTreeNode>([['/', root]]);
    const addDirectory = (path: string): FileTreeNode => {
      const key = path.toLowerCase();
      const existing = nodes.get(key);
      if (existing) return existing;
      const node: FileTreeNode = {
        name: path.replace(/\/$/, '').split('/').pop()!,
        path,
        type: 'directory',
        size: 0,
        children: [],
      };
      nodes.set(key, node);
      return node;
    };
    // listDirectories includes parents; shorter parents must be attached first.
    for (const path of this.listDirectories().sort(
      (a, b) => a.length - b.length,
    )) {
      const node = addDirectory(path);
      const parentPath = path.slice(0, -1).replace(/[^/]+$/, '');
      const parent = parentPath ? addDirectory(parentPath) : root;
      parent.children!.push(node);
    }
    for (const path of this.listFiles()) {
      const entry = this.fileEntry(path);
      const parentPath = path.slice(0, path.lastIndexOf('/') + 1);
      const parent = nodes.get(parentPath.toLowerCase()) ?? root;
      parent.children!.push({
        name: path.split('/').pop()!,
        path,
        type: 'file',
        size: this.entrySize(entry),
      });
    }
    return root;
  }

  glob(pattern: string): string[] {
    return this.listFiles(pattern);
  }

  readFile(path: string): Buffer {
    const entry = this.fileEntry(path);
    const size = this.entrySize(entry);
    this.checkOutputSize(size);
    const key = entry.name;
    const cached = this.cachedFile(key);
    if (cached) return Buffer.from(cached);
    this.cacheMisses++;
    const data = this.reconstruct(entry, 0, size);
    const limit = this.fileCacheLimit();
    if (
      this.strategy === CacheStrategy.LRU &&
      data.length <= limit &&
      limit > 0
    ) {
      while (this.cacheBytes + data.length > limit) this.evictOldest();
      this.cache.set(key, data);
      this.cacheBytes += data.length;
      return Buffer.from(data);
    }
    return data;
  }

  readText(path: string, encoding?: string): string {
    return this.decode(path, this.readFile(path), encoding);
  }

  readHTML(path: string, encoding?: string): string {
    const data = this.readFile(path);
    return this.decode(path, data, encoding ?? htmlEncoding(data));
  }

  readJSON<T = unknown>(path: string, encoding?: string): T {
    const text = this.readText(path, encoding);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new SyntaxError(
        `Invalid JSON in CHM file "${path}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  readImage(path: string): Buffer {
    return this.readFile(path);
  }
  readCSS(path: string, encoding?: string): string {
    return this.readText(path, encoding);
  }
  readJS(path: string, encoding?: string): string {
    return this.readText(path, encoding);
  }

  /** Strict half-open [start, end); no clamping or negative-index surprises. */
  readRange(path: string, start = 0, end?: number): Buffer {
    const entry = this.fileEntry(path);
    const size = this.entrySize(entry);
    const until = end ?? size;
    nonnegative(start, 'range start');
    nonnegative(until, 'range end');
    if (start > until || until > size)
      throw new RangeError(
        `Invalid range [${start}, ${until}) for "${entry.name}" (${size} bytes)`,
      );
    this.checkOutputSize(until - start);
    const cached = this.cachedFile(entry.name);
    if (cached) return Buffer.from(cached.subarray(start, until));
    return this.reconstruct(entry, start, until);
  }

  /** Backpressured <=64-KiB pulls, reusing LZX state even with caching disabled. */
  createReadStream(
    path: string,
    start = 0,
    end?: number,
  ): ReadableStream<Uint8Array> {
    const entry = this.fileEntry(path);
    const fileSize = this.entrySize(entry);
    const until = end ?? fileSize;
    nonnegative(start, 'range start');
    nonnegative(until, 'range end');
    if (start > until || until > fileSize)
      throw new RangeError(
        `Invalid range [${start}, ${until}) for "${entry.name}" (${fileSize} bytes)`,
      );
    const size = until - start;
    if (size > 0 && this.maxFileSize === 0) this.checkOutputSize(1);
    const chunkSize = Math.max(
      1,
      Math.min(STREAM_CHUNK_BYTES, this.maxFileSize),
    );
    let iterator: Generator<Buffer> | undefined;
    let position = 0;
    let cancelled = false;
    const release = () => {
      iterator?.return(undefined);
      iterator = undefined;
    };
    return new ReadableStream<Uint8Array>(
      {
        pull: controller => {
          if (cancelled) return;
          try {
            this.assertOpen();
            if (position === size) {
              controller.close();
              return;
            }
            iterator ??= this.reconstructor!.iterateFileChunks(
              entry.name,
              new BitReader(this.buffer!),
              chunkSize,
              start,
              until,
            );
            const next = iterator.next();
            if (next.done || next.value.length === 0)
              throw new Error(
                `Incomplete CHM stream reconstruction: ${entry.name}`,
              );
            position += next.value.length;
            if (position > size)
              throw new Error(`CHM stream exceeds file size: ${entry.name}`);
            controller.enqueue(next.value);
            if (position === size) {
              release();
              controller.close();
            }
          } catch (error) {
            release();
            controller.error(error);
          }
        },
        cancel: () => {
          cancelled = true;
          release();
        },
      },
      { highWaterMark: 0 },
    );
  }

  readMultiple(paths: readonly string[]): Map<string, Buffer> {
    this.assertOpen();
    const result = new Map<string, Buffer>();
    for (const path of paths) result.set(path, this.readFile(path));
    return result;
  }

  readWithMetadata(path: string): FileWithMetadataData<Buffer> {
    const metadata = this.getFileInfo(path);
    return { ...metadata, data: this.readFile(path), metadata };
  }

  getFileInfo(path: string): CHMFileInfo {
    const entry = this.fileEntry(path);
    const size = this.entrySize(entry);
    const isCompressed = entry.section === 1;
    const compressedSize = isCompressed ? null : size;
    return {
      name: entry.name,
      path: entry.name,
      size,
      originalSize: size,
      isCompressed,
      compressedSize,
      compressedSizeExact: !isCompressed,
      compressionRatio: isCompressed ? null : size === 0 ? 0 : 1,
      ...(isCompressed
        ? {
            compressionNote:
              'File belongs to a shared LZX stream; exact per-file compressed size and ratio are unavailable.',
          }
        : {}),
      mimeType: mimeType(entry.name),
      section: entry.section,
      offset: entry.offset,
    };
  }

  getFileSize(path: string): number {
    return this.entrySize(this.fileEntry(path));
  }
  getCompressedSize(path: string): number | null {
    return this.getFileInfo(path).compressedSize;
  }
  /** compressed/original; null for shared compressed streams, 0 for an empty stored file. */
  getCompressionRatio(path: string): number | null {
    return this.getFileInfo(path).compressionRatio;
  }
  getMimeType(path: string): string {
    return mimeType(this.fileEntry(path).name);
  }

  getMetadata(): ReaderMetadata {
    this.assertOpen();
    const entry = this.paths.get('/#system');
    if (!entry) return {};
    const data = this.readFile(entry.name);
    if (data.length < 4) throw new Error('Invalid /#SYSTEM: missing version');
    const records: { code: number; bytes: Buffer }[] = [];
    let languageId = this.parsed!.header.itsf.languageId;
    for (let offset = 4; offset < data.length; ) {
      if (offset + 4 > data.length)
        throw new Error('Invalid /#SYSTEM: truncated record header');
      const code = data.readUInt16LE(offset);
      const length = data.readUInt16LE(offset + 2);
      offset += 4;
      if (offset + length > data.length)
        throw new Error(`Invalid /#SYSTEM: truncated record ${code}`);
      const bytes = data.subarray(offset, offset + length);
      records.push({ code, bytes });
      if (code === 4 && length >= 4) languageId = bytes.readUInt32LE(0);
      offset += length;
    }
    const result: ReaderMetadata = {};
    const names = ['toc', 'index', 'defaultTopic', 'title'] as const;
    for (const { code, bytes } of records) {
      if (code <= 3)
        result[names[code]] = decodeText(
          bytes,
          this.defaultEncoding,
          languageEncoding(languageId),
        ).replace(/\0[\s\S]*$/, '');
    }
    return result;
  }

  getTOC(): NavigationEntry[] {
    return this.readNavigation('toc', /\.hhc$/i);
  }
  getIndex(): NavigationEntry[] {
    return this.readNavigation('index', /\.hhk$/i);
  }

  getDefaultPage(): string | undefined {
    const metadata = this.getMetadata();
    if (metadata.defaultTopic)
      return this.resolveLink(metadata.defaultTopic, '/');
    const files = this.listFiles();
    return (
      files.find(path => /^\/index\.html?$/i.test(path)) ??
      files.find(path => /\.html?$/i.test(path))
    );
  }

  getHomePage(): string | undefined {
    return this.getDefaultPage();
  }

  getNavigationLinks(path: string): NavLink[] {
    const entry = this.fileEntry(path);
    return parseLinks(this.readHTML(entry.name), local =>
      this.resolveLink(local, entry.name),
    );
  }

  search(keyword: string, options: SearchOptions = {}): SearchResult[] {
    this.assertOpen();
    const limit = nonnegative(options.maxResults ?? 100, 'maxResults');
    const matchesLimit = nonnegative(
      options.maxMatchesPerFile ?? 100,
      'maxMatchesPerFile',
    );
    if (!keyword || !limit || !matchesLimit) return [];
    const results: SearchResult[] = [];
    for (const path of this.listFiles(options.pattern)) {
      const mime = mimeType(path);
      if (
        !mime.startsWith('text/') &&
        !['application/json', 'application/xml', 'image/svg+xml'].includes(mime)
      )
        continue;
      const matches = this.searchInFile(path, keyword, {
        ...options,
        maxResults: matchesLimit,
      });
      if (matches.length) results.push({ path, fileName: path, matches });
      if (results.length === limit) break;
    }
    return results;
  }

  searchInFile(
    path: string,
    keyword: string,
    options: SearchOptions = {},
  ): SearchMatch[] {
    this.fileEntry(path);
    const limit = nonnegative(options.maxResults ?? 100, 'maxResults');
    const contextLength = nonnegative(
      options.contextLength ?? 80,
      'contextLength',
    );
    if (!keyword || !limit) return [];
    const text = /\.hh[ctk]$|\.html?$/i.test(path)
      ? this.readHTML(path, options.encoding)
      : this.readText(path, options.encoding);
    const escaped = escapeRegExp(keyword);
    const wordCharacters = '\\p{L}\\p{N}\\p{M}_';
    const expression = new RegExp(
      options.wholeWord
        ? `(?<![${wordCharacters}])${escaped}(?![${wordCharacters}])`
        : escaped,
      options.caseSensitive ? 'gu' : 'giu',
    );
    const matches: SearchMatch[] = [];
    let line = 1;
    let lineStart = 0;
    let scanned = 0;
    for (const match of text.matchAll(expression)) {
      const index = match.index!;
      for (; scanned < index; scanned++)
        if (text[scanned] === '\n') {
          line++;
          lineStart = scanned + 1;
        }
      matches.push({
        index,
        length: match[0].length,
        match: match[0],
        line,
        column: index - lineStart + 1,
        context: text.slice(
          Math.max(0, index - contextLength),
          index + match[0].length + contextLength,
        ),
      });
      if (matches.length === limit) break;
    }
    return matches;
  }

  /** Globs when wildcards are present; otherwise a case-insensitive path substring. */
  findFiles(pattern: string): string[] {
    return /[*?{[]/.test(pattern)
      ? this.glob(pattern)
      : this.listFiles().filter(path =>
          path.toLowerCase().includes(pattern.toLowerCase()),
        );
  }

  /** Deterministic filename subsequence matching, not an AI/full-text index. */
  fuzzySearch(query: string, options: SearchOptions = {}): SearchResult[] {
    this.assertOpen();
    const limit = nonnegative(options.maxResults ?? 100, 'maxResults');
    if (!query || !limit) return [];
    const needle = Array.from(
      options.caseSensitive ? query : query.toLowerCase(),
    );
    const results: SearchResult[] = [];
    for (const path of this.listFiles(options.pattern)) {
      const haystack = options.caseSensitive ? path : path.toLowerCase();
      let position = 0;
      for (const character of haystack)
        if (character === needle[position]) position++;
      if (position === needle.length)
        results.push({
          path,
          fileName: path,
          matches: [],
          score: needle.length / Array.from(haystack).length,
        });
    }
    return results
      .sort((a, b) => b.score! - a.score! || a.path.localeCompare(b.path))
      .slice(0, limit);
  }

  /** Preloads only the paths explicitly requested, subject to normal LRU eviction. */
  preload(paths: readonly string[]): void {
    this.assertOpen();
    for (const path of paths) this.readFile(path);
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.reconstructor?.clearCache();
  }

  getCacheStats(): CacheStats {
    const files: CacheLayerStats = {
      entries: this.cache.size,
      bytes: this.cacheBytes,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      maxBytes: this.fileCacheLimit(),
    };
    const blocks: CacheLayerStats = this.reconstructor?.getCacheStats() ?? {
      entries: 0,
      bytes: 0,
      hits: 0,
      misses: 0,
      maxBytes: this.blockCacheLimit(),
    };
    return {
      entries: files.entries + blocks.entries,
      bytes: files.bytes + blocks.bytes,
      hits: files.hits + blocks.hits,
      misses: files.misses + blocks.misses,
      maxBytes: this.maxCacheBytes,
      strategy: this.strategy,
      files,
      blocks,
    };
  }

  setCacheStrategy(strategy: CacheStrategy): void {
    this.assertOpen();
    this.validateStrategy(strategy);
    this.strategy = strategy;
    this.clearCache();
    this.reconstructor!.setCacheLimit(this.blockCacheLimit());
  }

  private assertOpen(): void {
    if (!this.buffer) throw new Error('CHM archive is closed');
  }

  private fileEntry(path: string): DirectoryEntry {
    this.assertOpen();
    const normalized = normalizePath(path);
    const entry = this.paths.get(normalized.toLowerCase());
    if (!entry) throw new Error(`CHM file not found: ${path}`);
    if (entry.name.endsWith('/'))
      throw new Error(`CHM path is a directory: ${path}`);
    return entry;
  }

  private entrySize(entry: DirectoryEntry): number {
    return entry.uncompressedLength ?? entry.length;
  }

  private checkOutputSize(size: number): void {
    if (size > this.maxFileSize)
      throw new RangeError(
        `Requested output (${size} bytes) exceeds maxFileSize (${this.maxFileSize} bytes); use readRange or createReadStream`,
      );
  }

  private reconstruct(
    entry: DirectoryEntry,
    start: number,
    end: number,
  ): Buffer {
    if (start === end) return Buffer.alloc(0);
    const data = this.reconstructor!.reconstructRange(
      entry.name,
      new BitReader(this.buffer!),
      start,
      end,
    );
    if (data.length !== end - start)
      throw new Error(`Incomplete CHM range reconstruction: ${entry.name}`);
    // Do not leak an archive/block-cache view that the caller can mutate or retain.
    return Buffer.from(data);
  }

  private cachedFile(key: string): Buffer | undefined {
    const data = this.cache.get(key);
    if (data) {
      this.cache.delete(key);
      this.cache.set(key, data);
      this.cacheHits++;
    }
    return data;
  }

  private evictOldest(): void {
    const key = this.cache.keys().next().value as string;
    this.cacheBytes -= this.cache.get(key)!.length;
    this.cache.delete(key);
  }

  // Fixed partition guarantees aggregate retained buffers never exceed the budget.
  private fileCacheLimit(): number {
    return this.strategy === CacheStrategy.None
      ? 0
      : Math.floor(this.maxCacheBytes / 2);
  }
  private blockCacheLimit(): number {
    return this.strategy === CacheStrategy.None
      ? 0
      : this.maxCacheBytes - this.fileCacheLimit();
  }

  private validateStrategy(strategy: CacheStrategy): void {
    if (strategy !== CacheStrategy.None && strategy !== CacheStrategy.LRU)
      throw new Error(`Unsupported cache strategy: ${strategy}`);
  }

  private decode(path: string, data: Buffer, encoding?: string): string {
    try {
      return decodeText(
        data,
        encoding ?? this.defaultEncoding,
        languageEncoding(this.parsed!.header.itsf.languageId),
      );
    } catch (error) {
      throw new Error(
        `Cannot decode CHM file "${path}" (${encoding ?? this.defaultEncoding ?? 'auto'}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private readNavigation(
    field: 'toc' | 'index',
    extension: RegExp,
  ): NavigationEntry[] {
    const name = this.getMetadata()[field];
    // Metadata and extension fallback are both case-insensitive.
    const canonical = name ? this.resolveLink(name, '/') : undefined;
    const path =
      canonical && this.exists(canonical)
        ? canonical
        : this.listFiles().find(file => extension.test(file));
    if (!path) return [];
    return parseSitemap(this.readHTML(path), local =>
      this.resolveLink(local, path, true),
    );
  }

  private resolveLink(
    local: string,
    from: string,
    rootFallback = false,
  ): string {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(local)) return local;
    const suffixStart = local.search(/[?#]/);
    const suffix = suffixStart < 0 ? '' : local.slice(suffixStart);
    let path = suffixStart < 0 ? local : local.slice(0, suffixStart);
    try {
      path = decodeURIComponent(path);
    } catch {
      /* Retain literal invalid URL escapes. */
    }
    const base = from.slice(0, from.lastIndexOf('/') + 1);
    const resolved = normalizePath(
      path ? (/^[\\/]/.test(path) ? path : base + path) : from,
    );
    let canonical = this.paths.get(resolved.toLowerCase())?.name;
    // Some compilers write root-based Local values even for nested HHC/HHK files.
    if (!canonical && rootFallback && path && !/^[.\\/]/.test(path)) {
      canonical = this.paths.get(normalizePath(path).toLowerCase())?.name;
    }
    return (canonical ?? resolved) + suffix;
  }
}

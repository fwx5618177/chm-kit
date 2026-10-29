/** Both string literals and enum-like names are accepted. */
export const CacheStrategy = {
  None: 'none',
  LRU: 'lru',
} as const;
// eslint-disable-next-line no-redeclare -- TypeScript value/type namespaces intentionally share this API name.
export type CacheStrategy = (typeof CacheStrategy)[keyof typeof CacheStrategy];

export interface ReaderOptions {
  /** Total file + reconstructed-block cache budget, excluding input and caller-owned output. */
  maxCacheBytes?: number;
  /** Maximum bytes materialized by one read; ranges/streams may read larger files. */
  maxFileSize?: number;
  cacheStrategy?: CacheStrategy;
  /** Used when no explicit encoding, BOM or HTML charset is present. */
  defaultEncoding?: string;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  maxBytes: number;
  strategy: CacheStrategy;
  files: CacheLayerStats;
  blocks: CacheLayerStats;
}

export interface CacheLayerStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  maxBytes: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  children?: FileTreeNode[];
}

export interface CHMFileInfo {
  name: string;
  path: string;
  size: number;
  originalSize: number;
  isCompressed: boolean;
  /** null: an individual file's byte count in a shared LZX stream is not known. */
  compressedSize: number | null;
  compressedSizeExact: boolean;
  compressionRatio: number | null;
  compressionNote?: string;
  mimeType: string;
  section: number;
  offset: number;
}

/** Shared shape keeps browser declarations independent of Node's Buffer type. */
export interface FileWithMetadataData<Data> extends CHMFileInfo {
  data: Data;
  metadata: CHMFileInfo;
}

export interface ReaderMetadata {
  title?: string;
  defaultTopic?: string;
  toc?: string;
  index?: string;
}

export interface NavigationEntry {
  name: string;
  local: string;
  level: number;
  children?: NavigationEntry[];
}

export interface NavLink {
  name: string;
  href: string;
  /** Canonical internal path, or the original URL for an external link. */
  local: string;
  rel?: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Maximum matching files (or matches for searchInFile); defaults to 100. */
  maxResults?: number;
  maxMatchesPerFile?: number;
  /** Archive glob restricting full-text search. */
  pattern?: string;
  encoding?: string;
  contextLength?: number;
}

export interface SearchMatch {
  /** UTF-16 character offset, not a byte offset. */
  index: number;
  length: number;
  match: string;
  line: number;
  column: number;
  context: string;
}

export interface SearchResult {
  path: string;
  fileName: string;
  matches: SearchMatch[];
  /** Filename subsequence score for fuzzySearch, in [0, 1]. */
  score?: number;
}

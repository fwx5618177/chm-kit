/**
 * CHM 文件格式相关类型定义
 */

import type { PackFilesOptions } from '../encoder/types';

export interface ITSFHeader {
  signature: string; // 'ITSF'
  version: number;
  headerLength: number;
  unknown1: number;
  timestamp: number;
  languageId: number;
  unknown2: number; // Auxiliary header section offset (not the file-data base).
  unknown3: number; // Auxiliary header section length.
  directoryOffset: number;
  directoryLength: number;
  unknown4: number; // ITSF v3 data-section base; absent/zero in v2.
}

export interface ITSPHeader {
  signature: string; // 'ITSP'
  version: number;
  headerLength: number;
  unknown1: number;
  chunkSize: number;
  density: number;
  depth: number;
  rootIndex: number;
  firstPMGI: number;
  lastPMGI: number;
  unknown2: number;
}

export interface LZXCHeader {
  signature: string; // 'LZXC'
  version: number;
  resetInterval: number;
  windowSize: number;
  cacheSize: number;
  unknown: number;
}

export interface DirectoryEntry {
  name: string;
  isCompressed: boolean;
  offset: number;
  length: number;
  uncompressedLength?: number;
  section: number;
}

export interface ResetTable {
  version: number;
  blockCount: number;
  entrySize: number;
  tableOffset: number;
  uncompressedLength: number;
  compressedLength: number;
  blockSize: number;
  entries: ResetTableEntry[];
}

export interface ResetTableEntry {
  /** Historical name: cumulative compressed frame offset, not a frame length. */
  compressedLength: number;
  uncompressedLength: number;
}

export interface CHMFile {
  name: string;
  data: Buffer;
  isCompressed: boolean;
  originalSize: number;
  /** null for files in a shared LZX stream: no exact per-file physical size. */
  compressedSize: number | null;
}

export interface CHMHeader {
  itsf: ITSFHeader;
  itsp: ITSPHeader;
  lzxc: LZXCHeader;
}

export interface CHMDirectory {
  entries: Map<string, DirectoryEntry>;
  rootPath: string;
}

export interface ParsedCHM {
  header: CHMHeader;
  directory: CHMDirectory;
  resetTable: ResetTable;
  contentOffset: number;
}

export interface ExtractProgress {
  totalFiles: number;
  completedFiles: number;
  succeededFiles: number;
  failedFiles: number;
  /** Bytes successfully written, including an in-flight file. */
  bytesWritten: number;
  totalBytes: number;
  currentFile?: string;
}

export interface ExtractResult {
  files: string[];
  totalFiles: number;
  errors: string[];
  /** Completed files are retained; unfinished exclusive-created files are removed. */
  cancelled: boolean;
}

export interface ExtractOptions {
  outputDir: string;
  filter?: (fileName: string, entry: Readonly<DirectoryEntry>) => boolean;
  preserveStructure?: boolean;
  verbose?: boolean;
  /** Bounded asynchronous file I/O, not parallel CPU decompression. Default: 4. */
  concurrency?: number;
  /** Maximum output chunk size per worker. Default: 64 KiB. */
  chunkSize?: number;
  signal?: AbortSignal;
  /** Synchronous observer. Exceptions reject extraction after workers drain. */
  onProgress?: (progress: Readonly<ExtractProgress>) => void;
}

export interface PackOptions extends PackFilesOptions {
  inputDir: string;
  outputPath: string;
  title?: string;
  defaultTopic?: string;
  compression?: boolean;
  verbose?: boolean;
  validateBeforeWrite?: boolean;
  verifyAfterWrite?: boolean;
}

export interface HuffmanTree {
  symbols: number[];
  codes: number[];
  lengths: number[];
}

export interface LZXBlock {
  type: number;
  uncompressedSize: number;
  alignedOffset?: number;
  data: Buffer;
}

export interface LZXWindow {
  data: Buffer;
  size: number;
  position: number;
}

export interface BitReader {
  buffer: Buffer;
  position: number;
  bitPosition: number;
  read(bits: number): number;
  peek(bits: number): number;
  skip(bits: number): void;
  align(): void;
  hasMore(): boolean;
  setPosition(byte: number, bit?: number): void;
}

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  blocksCount: number;
}

export interface CHMMetadata {
  title?: string;
  author?: string;
  subject?: string;
  comments?: string;
  keywords?: string;
  language?: string;
  defaultTopic?: string;
  homePage?: string;
  toc?: string;
  index?: string;
  createdTime?: Date;
  modifiedTime?: Date;
}

export interface TOCEntry {
  name: string;
  local: string;
  level: number;
  children?: TOCEntry[];
}

export interface IndexEntry {
  name: string;
  local: string;
  keywords?: string[];
}

export interface CHMInfo {
  metadata: CHMMetadata;
  toc: TOCEntry[];
  index: IndexEntry[];
  files: string[];
  totalSize: number;
  compressedSize: number;
  filesCount: number;
}

/**
 * CHM 文件基本信息（用于 info 命令）
 */
export interface CHMBasicInfo {
  header: {
    itsf: string;
    itsp: string;
    lzxc: string;
  };
  statistics: string;
  fileCount: number;
  totalSize: number;
  compressionRatio: number;
}

/**
 * CLI 命令选项接口
 */
export interface ExtractCommandOptions {
  output: string;
  filter?: string;
  preserveStructure: boolean;
  verbose: boolean;
}

export interface PackCommandOptions extends Pick<
  PackFilesOptions,
  'compressionLevel' | 'windowBits' | 'resetInterval' | 'blockSize'
> {
  output: string;
  title?: string;
  defaultTopic?: string;
  compression: boolean;
  verbose: boolean;
}

export interface InfoCommandOptions {
  verbose: boolean;
  json: boolean;
}

/**
 * LZX 压缩配置
 */
export interface LZXConfig {
  windowSize?: number;
  resetInterval?: number;
  compressionLevel?: number;
}

/**
 * CLI 配置
 */
export interface CLIConfig {
  defaultOutputDir?: string;
  defaultOutputFile?: string;
  maxConcurrency?: number;
  showProgress?: boolean;
}

/**
 * 性能配置
 */
export interface PerformanceConfig {
  chunkSize?: number;
  maxFileSize?: number;
}

/**
 * 完整的 CHMKit 配置
 */
export interface CHMKitConfig {
  lzx?: LZXConfig;
  cli?: CLIConfig;
  performance?: PerformanceConfig;
}

/**
 * 配置文件查找选项
 */
export interface ConfigLoadOptions {
  searchPaths?: string[];
  configFileName?: string;
  /** Explicit path wins over discovery, and must exist. */
  configPath?: string;
  /** Throw on invalid configuration instead of falling back (used by the CLI). */
  strict?: boolean;
}

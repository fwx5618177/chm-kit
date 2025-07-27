/**
 * CHM 文件格式相关类型定义
 */

import type { LogLevel, Logger } from '../logger/types';

export interface ITSFHeader {
  signature: string; // 'ITSF'
  version: number;
  headerLength: number;
  unknown1: number;
  timestamp: number;
  languageId: number;
  unknown2: number;
  unknown3: number;
  directoryOffset: number;
  directoryLength: number;
  unknown4: number;
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
  compressedLength: number;
  uncompressedLength: number;
}

export interface CHMFile {
  name: string;
  data: Buffer;
  isCompressed: boolean;
  originalSize: number;
  compressedSize: number;
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

export interface ExtractOptions {
  outputDir: string;
  filter?: (fileName: string) => boolean;
  preserveStructure?: boolean;
  verbose?: boolean;
}

export interface PackOptions {
  inputDir: string;
  outputPath: string;
  title?: string;
  defaultTopic?: string;
  compression?: boolean;
  verbose?: boolean;
}

export interface HuffmanTree {
  symbols: number[];
  codes: number[];
  lengths: number[];
}

export interface HuffmanDecoder {
  literalTree: HuffmanTree;
  matchTree: HuffmanTree;
  lengthTree: HuffmanTree;
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

export interface PackCommandOptions {
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

export interface CHMOptions {
  logLevel?: LogLevel;
  logger?: Logger;
  tempDir?: string;
  maxMemory?: number;
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
 * CHM 文件格式配置
 */
export interface CHMFormatConfig {
  itsfSignature?: string;
  itsfVersion?: number;
  itspSignature?: string;
  itspVersion?: number;
  lzxcSignature?: string;
  lzxcVersion?: number;
  defaultFiles?: {
    toc?: string;
    index?: string;
    project?: string;
  };
  supportedExtensions?: string[];
}

/**
 * CLI 配置
 */
export interface CLIConfig {
  defaultOutputDir?: string;
  defaultOutputFile?: string;
  defaultTempDir?: string;
  maxConcurrency?: number;
  showProgress?: boolean;
  colorOutput?: boolean;
}

/**
 * 性能配置
 */
export interface PerformanceConfig {
  chunkSize?: number;
  bufferSize?: number;
  maxFileSize?: number;
  compressionThreshold?: number;
}

/**
 * 验证配置
 */
export interface ValidationConfig {
  validateHeaders?: boolean;
  validateChecksums?: boolean;
  strictMode?: boolean;
  allowMissingFiles?: boolean;
}

/**
 * 完整的 CHMKit 配置
 */
export interface CHMKitConfig {
  default?: CHMOptions;
  lzx?: LZXConfig;
  format?: CHMFormatConfig;
  cli?: CLIConfig;
  performance?: PerformanceConfig;
  validation?: ValidationConfig;
}

/**
 * 配置文件查找选项
 */
export interface ConfigLoadOptions {
  searchPaths?: string[];
  configFileName?: string;
  validateConfig?: boolean;
}

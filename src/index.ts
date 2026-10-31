// 导出核心类型定义
export * from './core/types';
export type { BitReader as BitReaderContract } from './core/types';
export type { Logger, LogLevel } from './logger/types';
export type { ReconstructorOptions } from './core/files/file-reconstructor';

// 导出工具类
export { BitReader } from './utils/io/bit-reader';
export { Huffman } from './utils/compression/huffman';

// 导出核心功能
export { CHMParser } from './core/parser/chm-parser';
export { LZXDecoder } from './core/lzx/lzx-decoder';
export { FileReconstructor } from './core/files/file-reconstructor';

// 导出头部解析器
export { ITSFHeaderParser } from './core/headers/itsf-header';
export { ITSPHeaderParser } from './core/headers/itsp-header';
export { LZXCHeaderParser } from './core/headers/lzxc-header';

// 导出其他核心组件
export { DirectoryParser } from './core/directory/directory-parser';
export { SlidingWindow } from './core/lzx/sliding-window';
export { ResetTableProcessor } from './core/lzx/reset-table';

// 导出编码器功能
export { CHMEncoder } from './encoder/chm-encoder';
export { TOCBuilder } from './encoder/builders/toc-builder';
export { LZXEncoder } from './encoder/lzx-encoder';

// 导出操作模块
export * from './operations';

// 导出主类
export { CHMKit } from './chm-kit';

// 导出常量
export { VERSION, SUPPORTED_VERSIONS } from './constants';

// 导出便捷方法
export { chm } from './convenience';

export { CHMArchive } from './reader/chm-archive';
export { CHMReader } from './reader/chm-reader';
export type { FileWithMetadata } from './reader/chm-reader';
export * from './reader/types';
export {
  packFiles,
  packTemplate,
  updateArchive,
} from './encoder/archive-builder';
export type {
  PackFilesOptions,
  UpdateArchiveOptions,
  PackTOCEntry,
  HTMLHelpMetadata,
} from './encoder/types';
export type { LZXEncoderOptions } from './encoder/lzx-encoder';
export { MemoryByteSource } from './core/files/byte-source';
export type { ByteSource, SourceCacheStats } from './core/files/byte-source';

// 默认导出
export { CHMKit as default } from './chm-kit';

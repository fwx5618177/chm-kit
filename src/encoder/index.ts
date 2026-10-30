// 导出编码器相关类
export { CHMEncoder } from './chm-encoder';
export { packFiles, packTemplate, updateArchive } from './archive-builder';
export type {
  PackFilesOptions,
  PackTOCEntry,
  HTMLHelpMetadata,
  UpdateArchiveOptions,
} from './types';
export { LZXEncoder } from './lzx-encoder';
export type { LZXEncoderOptions } from './lzx-encoder';
export { TOCBuilder } from './builders/toc-builder';

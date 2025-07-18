// 导出核心类型定义
export * from './core/types';

// 导出工具类
export { BitReader } from './utils/bit-reader';
export { Huffman } from './utils/huffman';

// 导出核心功能
export { CHMParser } from './core/chm-parser';
export { LZXDecoder } from './core/lzx/lzx-decoder';
export { FileReconstructor } from './core/file-reconstructor';

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
export { TOCBuilder } from './encoder/toc-builder';
export { LZXEncoder } from './encoder/lzx-encoder';

// 导出操作模块
export * from './operations';

// 导出主类
export { CHMKit } from './chm-kit';

// 导出常量
export { VERSION, SUPPORTED_VERSIONS, DEFAULT_CONFIG } from './constants';

// 导出便捷方法
export { chm } from './convenience';

// 默认导出
export { CHMKit as default } from './chm-kit';

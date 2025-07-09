/**
 * chmkit - A TypeScript library for reading, parsing, and compressing .chm files
 * @version 1.0.0
 * @author Your Name
 * @license MIT
 */

// 导出核心类型定义
export * from './core/types';

// 导出工具类
export { BitReader } from './utils/bit-reader';
export { Huffman } from './utils/huffman';

// 导出核心功能（当实现后启用）
// export { CHMParser } from './core/chm-parser';
// export { LZXDecoder } from './core/lzx-decoder';
// export { FileReconstructor } from './core/file-reconstructor';

// 导出编码器功能（当实现后启用）
// export { CHMEncoder } from './encoder/chm-encoder';
// export { TOCBuilder } from './encoder/toc-builder';
// export { LZXEncoder } from './encoder/lzx-encoder';

/**
 * CHM 操作的主要类
 */
export class CHMKit {
  /**
   * 解析 CHM 文件
   * @param filePath CHM 文件路径
   * @returns 解析后的 CHM 对象
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  static async parse(_filePath: string): Promise<unknown> {
    // TODO: 实现 CHM 文件解析
    throw new Error('CHM parsing not yet implemented');
  }

  /**
   * 提取 CHM 文件内容
   * @param _filePath CHM 文件路径
   * @param _outputDir 输出目录
   * @returns 提取结果
   */
  static async extract(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    _filePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    _outputDir: string,
  ): Promise<unknown> {
    // TODO: 实现 CHM 文件提取
    throw new Error('CHM extraction not yet implemented');
  }

  /**
   * 打包目录为 CHM 文件
   * @param inputDir 输入目录
   * @param outputPath 输出 CHM 文件路径
   * @returns 打包结果
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  static async pack(_inputDir: string, _outputPath: string): Promise<unknown> {
    // TODO: 实现 CHM 文件打包
    throw new Error('CHM packing not yet implemented');
  }

  /**
   * 获取 CHM 文件信息
   * @param filePath CHM 文件路径
   * @returns CHM 文件信息
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  static async getInfo(_filePath: string): Promise<unknown> {
    // TODO: 实现 CHM 文件信息获取
    throw new Error('CHM info extraction not yet implemented');
  }
}

// 默认导出
export default CHMKit;

/**
 * 版本信息
 */
export const VERSION = '1.0.0';

/**
 * 支持的 CHM 格式版本
 */
export const SUPPORTED_VERSIONS = ['1.0', '1.1', '1.2'];

/**
 * 默认配置
 */
export const DEFAULT_CONFIG = {
  compression: true,
  windowSize: 0x8000,
  verbose: false,
  tempDir: './temp',
  maxMemory: 1024 * 1024 * 100, // 100MB
};

/**
 * 便捷方法
 */
export const chm = {
  /**
   * 解析 CHM 文件
   */
  parse: CHMKit.parse,

  /**
   * 提取 CHM 文件内容
   */
  extract: CHMKit.extract,

  /**
   * 打包目录为 CHM 文件
   */
  pack: CHMKit.pack,

  /**
   * 获取 CHM 文件信息
   */
  info: CHMKit.getInfo,

  /**
   * 版本信息
   */
  version: VERSION,

  /**
   * 支持的版本
   */
  supportedVersions: SUPPORTED_VERSIONS,

  /**
   * 默认配置
   */
  config: DEFAULT_CONFIG,
};

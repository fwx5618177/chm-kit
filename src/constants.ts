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

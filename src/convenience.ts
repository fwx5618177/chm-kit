import { CHMKit } from './chm-kit';
import { VERSION, SUPPORTED_VERSIONS, DEFAULT_CONFIG } from './constants';

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
   * 读取单个文件
   */
  readFile: CHMKit.readFile,

  /**
   * 检查文件存在
   */
  exists: CHMKit.exists,

  /**
   * 列出所有文件
   */
  listFiles: CHMKit.listFiles,

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

import { CHMKit } from './chm-kit';
import { VERSION, SUPPORTED_VERSIONS } from './constants';

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
   * 读取文本文件内容
   */
  readText: CHMKit.readText,

  /**
   * 读取 HTML 文件内容
   */
  readHTML: CHMKit.readHTML,

  /**
   * 版本信息
   */
  version: VERSION,
  open: CHMKit.open,
  from: CHMKit.from,
  packFiles: CHMKit.packFiles,
  getTOC: CHMKit.getTOC,
  getIndex: CHMKit.getIndex,
  search: CHMKit.searchContent,
  readRange: CHMKit.readRange,
  readMultiple: CHMKit.readMultiple,
  exportFiles: CHMKit.exportFiles,

  /**
   * 支持的版本
   */
  supportedVersions: SUPPORTED_VERSIONS,
};

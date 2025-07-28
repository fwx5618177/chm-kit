import type { DirectoryEntry, ParsedCHM } from '../types';

/**
 * CHM 文件管理器
 * 负责文件查找、存在性检查和路径处理
 */
export class CHMFileManager {
  private parsedCHM: ParsedCHM;

  constructor(parsedCHM: ParsedCHM) {
    this.parsedCHM = parsedCHM;
  }

  /**
   * 检查文件是否存在
   * @param fileName 文件名
   * @returns 是否存在
   */
  fileExists(fileName: string): boolean {
    return this.parsedCHM.directory.entries.has(fileName);
  }

  /**
   * 获取文件信息（不读取内容）
   * @param fileName 文件名
   * @returns 文件信息
   */
  getFileInfo(fileName: string): DirectoryEntry | null {
    return this.parsedCHM.directory.entries.get(fileName) ?? null;
  }

  /**
   * 获取所有文件列表
   * @returns 文件名数组
   */
  getFileList(): string[] {
    return Array.from(this.parsedCHM.directory.entries.keys());
  }

  /**
   * 按类型过滤文件
   * @param extension 文件扩展名
   * @returns 过滤后的文件名数组
   */
  getFilesByType(extension: string): string[] {
    const normalizedExt = extension.toLowerCase();
    return this.getFileList().filter(fileName =>
      fileName.toLowerCase().endsWith(normalizedExt),
    );
  }

  /**
   * 查找文件条目
   * @param fileName 文件名
   * @returns 文件条目
   */
  findFileEntry(fileName: string): DirectoryEntry | null {
    // 尝试直接查找
    let entry = this.parsedCHM.directory.entries.get(fileName);
    if (entry) {
      return entry;
    }

    // 尝试标准化路径后查找
    const normalizedName = this.normalizePath(fileName);
    entry = this.parsedCHM.directory.entries.get(normalizedName);
    if (entry) {
      return entry;
    }

    // 尝试不区分大小写查找
    for (const [entryName, entryData] of this.parsedCHM.directory.entries) {
      if (entryName.toLowerCase() === fileName.toLowerCase()) {
        return entryData;
      }
    }

    return null;
  }

  /**
   * 标准化文件路径
   * @param path 原始路径
   * @returns 标准化后的路径
   */
  normalizePath(path: string): string {
    // 确保路径以 / 开头
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }

    // 替换反斜杠为正斜杠
    path = path.replace(/\\/g, '/');

    // 移除重复的斜杠
    path = path.replace(/\/+/g, '/');

    return path;
  }

  /**
   * 获取文件扩展名
   * @param fileName 文件名
   * @returns 扩展名
   */
  getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) {
      return '无扩展名';
    }
    return fileName.substring(lastDot + 1).toLowerCase();
  }

  /**
   * 按模式搜索文件
   * @param pattern 搜索模式（支持通配符 *）
   * @returns 匹配的文件名数组
   */
  searchFiles(pattern: string): string[] {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
    return this.getFileList().filter(fileName => regex.test(fileName));
  }

  /**
   * 获取目录结构
   * @returns 目录结构映射
   */
  getDirectoryStructure(): Map<string, string[]> {
    const structure = new Map<string, string[]>();

    for (const fileName of this.getFileList()) {
      const dir = fileName.substring(0, fileName.lastIndexOf('/')) || '/';
      const files = structure.get(dir) || [];
      files.push(fileName);
      structure.set(dir, files);
    }

    return structure;
  }
}

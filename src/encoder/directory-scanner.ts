import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * 目录扫描器
 * 负责扫描输入目录并获取文件列表
 */
export class DirectoryScanner {
  /**
   * 扫描目录获取所有文件
   * @param dirPath 目录路径
   * @param options 扫描选项
   * @returns 文件列表
   */
  static async scanDirectory(
    dirPath: string,
    options: {
      recursive?: boolean;
      filter?: (filename: string) => boolean;
      sortFiles?: boolean;
    } = {},
  ): Promise<string[]> {
    const { recursive = true, filter, sortFiles = true } = options;

    const files: string[] = [];

    async function scanRecursive(
      currentPath: string,
      relativePath: string = '',
    ): Promise<void> {
      const items = await fs.readdir(currentPath);

      for (const item of items) {
        const itemPath = join(currentPath, item);
        const itemRelativePath = relativePath ? join(relativePath, item) : item;

        const stats = await fs.stat(itemPath);

        if (stats.isDirectory() && recursive) {
          await scanRecursive(itemPath, itemRelativePath);
        } else if (stats.isFile()) {
          // 应用过滤器
          if (!filter || filter(itemRelativePath)) {
            files.push(itemRelativePath);
          }
        }
      }
    }

    await scanRecursive(dirPath);

    return sortFiles ? files.sort() : files;
  }

  /**
   * 获取目录统计信息
   * @param dirPath 目录路径
   * @returns 统计信息
   */
  static async getDirectoryStats(dirPath: string): Promise<{
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    fileTypes: Map<string, number>;
  }> {
    let totalFiles = 0;
    let totalDirectories = 0;
    let totalSize = 0;
    const fileTypes = new Map<string, number>();

    async function scanStats(currentPath: string): Promise<void> {
      const items = await fs.readdir(currentPath);

      for (const item of items) {
        const itemPath = join(currentPath, item);
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          totalDirectories++;
          await scanStats(itemPath);
        } else if (stats.isFile()) {
          totalFiles++;
          totalSize += stats.size;

          // 统计文件类型
          const ext = item.substring(item.lastIndexOf('.') + 1).toLowerCase();
          const count = fileTypes.get(ext) || 0;
          fileTypes.set(ext, count + 1);
        }
      }
    }

    await scanStats(dirPath);

    return {
      totalFiles,
      totalDirectories,
      totalSize,
      fileTypes,
    };
  }

  /**
   * 验证目录是否适合打包为 CHM
   * @param dirPath 目录路径
   * @returns 验证结果和建议
   */
  static async validateDirectory(dirPath: string): Promise<{
    isValid: boolean;
    warnings: string[];
    suggestions: string[];
  }> {
    const warnings: string[] = [];
    const suggestions: string[] = [];

    try {
      const stats = await this.getDirectoryStats(dirPath);

      // 检查是否有必要的文件
      const files = await this.scanDirectory(dirPath);
      const hasHtmlFiles = files.some(
        f =>
          f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'),
      );

      if (!hasHtmlFiles) {
        warnings.push('未找到 HTML 文件，CHM 文件可能无法正常使用');
        suggestions.push('确保目录中包含 HTML 文件作为内容');
      }

      // 检查文件数量
      if (stats.totalFiles === 0) {
        warnings.push('目录中没有文件');
        return { isValid: false, warnings, suggestions };
      }

      if (stats.totalFiles > 10000) {
        warnings.push(`文件数量较多 (${stats.totalFiles})，可能影响性能`);
        suggestions.push('考虑将大型项目拆分为多个 CHM 文件');
      }

      // 检查文件大小
      if (stats.totalSize > 100 * 1024 * 1024) {
        // 100MB
        warnings.push('总文件大小较大，可能影响 CHM 文件的性能');
        suggestions.push('考虑压缩图片或移除不必要的文件');
      }

      return {
        isValid: true,
        warnings,
        suggestions,
      };
    } catch (error) {
      return {
        isValid: false,
        warnings: [
          `扫描目录失败: ${error instanceof Error ? error.message : String(error)}`,
        ],
        suggestions: ['检查目录路径是否正确，以及是否有读取权限'],
      };
    }
  }
}

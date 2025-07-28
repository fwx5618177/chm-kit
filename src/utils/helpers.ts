/**
 * 通用工具函数
 * 合并了原本分散的小工具函数
 */

/**
 * 格式化时间戳
 * @param timestamp 时间戳（可选，默认为当前时间）
 * @returns 格式化后的时间字符串
 */
export function formatTimestamp(timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  return new Date(ts * 1000).toISOString();
}

/**
 * 判断文件类型
 * @param fileName 文件名
 * @returns 文件类型
 */
export function getFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();

  const typeMap: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    txt: 'text/plain',
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  };

  return typeMap[ext || ''] || 'application/octet-stream';
}

/**
 * 过滤文件列表
 * @param files 文件列表
 * @param pattern 过滤模式
 * @returns 过滤后的文件列表
 */
export function filterFiles(files: string[], pattern: string): string[] {
  const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
  return files.filter(file => regex.test(file));
}

/**
 * 显示文件大小
 * @param size 文件大小（字节）
 * @returns 格式化后的大小字符串
 */
export function formatFileSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let fileSize = size;

  while (fileSize >= 1024 && unitIndex < units.length - 1) {
    fileSize /= 1024;
    unitIndex++;
  }

  return `${fileSize.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 检查路径是否为有效的文件系统路径
 * @param path 路径
 * @returns 是否有效
 */
export function isValidPath(path: string): boolean {
  // 基本路径验证
  if (!path || path.trim().length === 0) {
    return false;
  }

  // 检查非法字符（适用于大多数文件系统）
  const invalidChars = /[<>:"|?*]/;
  return !invalidChars.test(path);
}

/**
 * 标准化路径分隔符
 * @param path 路径
 * @returns 标准化后的路径
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * 显示进度条
 * @param current 当前进度
 * @param total 总进度
 * @param width 进度条宽度
 * @returns 进度条字符串
 */
export function formatProgress(
  current: number,
  total: number,
  width: number = 40,
): string {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percentage.toFixed(1)}% (${current}/${total})`;
}

/**
 * 创建过滤函数
 * @param filters 过滤器数组
 * @returns 过滤函数
 */
export function createFilterFunction(
  filters: string[],
): (path: string) => boolean {
  if (!filters || filters.length === 0) {
    return () => true;
  }

  const regexPatterns = filters.map(
    filter => new RegExp(filter.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i'),
  );

  return (path: string) => {
    return regexPatterns.some(pattern => pattern.test(path));
  };
}

/**
 * 显示信息对象
 * @param info 信息对象
 */
export function displayInfo(info: unknown): void {
  console.log(JSON.stringify(info, null, 2));
}

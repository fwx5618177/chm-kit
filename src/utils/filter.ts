/**
 * 创建文件过滤函数
 * @param pattern 过滤模式
 * @returns 过滤函数
 */
export function createFilterFunction(
  pattern: string,
): (fileName: string) => boolean {
  // 简单的 glob 模式支持
  const regex = new RegExp(
    pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.'),
  );

  return (fileName: string) => regex.test(fileName);
}

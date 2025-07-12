/**
 * 格式化时间戳
 */
export function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(11, 23); // HH:mm:ss.SSS
}

/**
 * 日志级别类型
 * error: 错误日志, 用于记录错误信息
 * warn: 警告日志, 用于记录警告信息
 * info: 信息日志, 用于记录信息, 用于记录正常信息
 * debug: 调试日志, 用于调试, 用于调试
 * verbose: 详细日志, 用于详细输出, 用于详细输出
 * success: 成功日志, 用于记录成功信息
 */
export type LogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'success'
  | 'verbose';

/**
 * Logger 接口定义
 */
export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  success(message: string, ...args: unknown[]): void;
  verbose(message: string, ...args: unknown[]): void;
}

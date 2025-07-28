import type { Logger } from './types';
import { formatTimestamp } from '../utils/helpers';
import type { ChalkInstance } from 'chalk';

/**
 * Logger 工具类
 * 支持六个日志级别：error, warn, info, debug, verbose, success
 * 所有输出都使用 chalk 进行彩色渲染，包括文字和背景颜色
 */
export class CHMLogger implements Logger {
  private static instance: CHMLogger;
  private chalk: ChalkInstance | undefined;

  constructor() {
    this.initChalk();
  }

  /**
   * 动态导入 chalk 模块
   */
  private async initChalk(): Promise<void> {
    this.chalk = (await import('chalk')).default;
  }

  public static getInstance(): CHMLogger {
    if (!CHMLogger.instance) {
      CHMLogger.instance = new CHMLogger();
    }
    return CHMLogger.instance;
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(
    level: string,
    message: string,
    ...args: unknown[]
  ): string {
    const timestamp = formatTimestamp();
    const formattedArgs =
      args.length > 0
        ? ` ${args
            .map(arg =>
              typeof arg === 'object'
                ? JSON.stringify(arg, null, 2)
                : String(arg),
            )
            .join(' ')}`
        : '';

    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }

  /**
   * 获取彩色文本，如果 chalk 未加载则返回原始文本
   */
  private getColoredText(
    text: string,
    colorFn: (text: string) => string,
  ): string {
    if (!this.chalk) {
      return text;
    }
    try {
      return colorFn(text);
    } catch (error) {
      return text;
    }
  }

  /**
   * 详细日志 - 用于调试信息，灰色背景，白色文字
   */
  verbose(message: string, ...args: unknown[]): void {
    const formattedMessage = this.formatMessage('VERBOSE', message, ...args);
    const styledMessage = this.getColoredText(
      formattedMessage,
      text => this.chalk?.white?.bgGray(text) || text,
    );
    console.debug(styledMessage);
  }

  /**
   * 一般信息日志 - 蓝色背景，白色文字
   */
  info(message: string, ...args: unknown[]): void {
    const formattedMessage = this.formatMessage('INFO', message, ...args);
    const styledMessage = this.getColoredText(
      formattedMessage,
      text => this.chalk?.white?.bgBlue(text) || text,
    );
    console.info(styledMessage);
  }

  /**
   * 警告日志 - 黄色背景，黑色文字
   */
  warn(message: string, ...args: unknown[]): void {
    const formattedMessage = this.formatMessage('WARN', message, ...args);
    const styledMessage = this.getColoredText(
      formattedMessage,
      text => this.chalk?.black?.bgYellow(text) || text,
    );
    console.warn(styledMessage);
  }

  /**
   * 错误日志 - 红色背景，白色文字
   */
  error(message: string, ...args: unknown[]): void {
    const formattedMessage = this.formatMessage('ERROR', message, ...args);
    const styledMessage = this.getColoredText(
      formattedMessage,
      text => this.chalk?.white?.bgRed(text) || text,
    );
    console.error(styledMessage);
  }

  /**
   * 成功日志 - 绿色背景，白色文字
   */
  success(message: string, ...args: unknown[]): void {
    const formattedMessage = this.formatMessage('SUCCESS', message, ...args);
    const styledMessage = this.getColoredText(
      formattedMessage,
      text => this.chalk?.white?.bgGreen(text) || text,
    );
    console.log(styledMessage);
  }

  /**
   * debug 日志 - 调试信息，紫色背景，白色文字
   */
  debug(message: string, ...args: unknown[]): void {
    const formattedMessage = this.formatMessage('DEBUG', message, ...args);
    const styledMessage = this.getColoredText(
      formattedMessage,
      text => this.chalk?.white?.bgMagenta(text) || text,
    );
    console.debug(styledMessage);
  }

  /**
   * 创建子 logger，继承当前设置
   */
  child(prefix: string): CHMLogger {
    const childLogger = Object.create(CHMLogger.prototype);
    Object.assign(childLogger, this);

    // 重写所有日志方法，添加前缀
    const originalVerbose = this.verbose.bind(childLogger);
    const originalInfo = this.info.bind(childLogger);
    const originalWarn = this.warn.bind(childLogger);
    const originalError = this.error.bind(childLogger);
    const originalSuccess = this.success.bind(childLogger);
    const originalDebug = this.debug.bind(childLogger);

    childLogger.verbose = (message: string, ...args: unknown[]) =>
      originalVerbose(`[${prefix}] ${message}`, ...args);
    childLogger.info = (message: string, ...args: unknown[]) =>
      originalInfo(`[${prefix}] ${message}`, ...args);
    childLogger.warn = (message: string, ...args: unknown[]) =>
      originalWarn(`[${prefix}] ${message}`, ...args);
    childLogger.error = (message: string, ...args: unknown[]) =>
      originalError(`[${prefix}] ${message}`, ...args);
    childLogger.success = (message: string, ...args: unknown[]) =>
      originalSuccess(`[${prefix}] ${message}`, ...args);
    childLogger.debug = (message: string, ...args: unknown[]) =>
      originalDebug(`[${prefix}] ${message}`, ...args);

    return childLogger;
  }
}

/**
 * 默认 logger 实例（单例）
 */
export const logger = CHMLogger.getInstance();

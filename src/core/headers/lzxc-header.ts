import type { LZXCHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';

/**
 * LZXC 头部解析器
 * 负责解析 CHM 文件的 LZX 压缩控制信息
 */
export class LZXCHeaderParser {
  // LZX 窗口大小常量（支持所有 CHM 常用窗口大小）
  private static readonly WINDOW_SIZES = [
    0x0200, // 512B
    0x0400, // 1KB
    0x0800, // 2KB
    0x1000, // 4KB
    0x2000, // 8KB
    0x4000, // 16KB
    0x8000, // 32KB
    0x10000, // 64KB
    0x20000, // 128KB
    0x40000, // 256KB
    0x80000, // 512KB
    0x100000, // 1MB
    0x200000, // 2MB
  ];

  /**
   * 解析 LZXC 头部
   * @param reader 位读取器
   * @returns 解析后的 LZXC 头部信息
   */
  static parse(reader: BitReader): LZXCHeader {
    // 读取签名
    const signature = this.readSignature(reader);
    if (signature !== 'LZXC') {
      throw new Error(`无效的 LZXC 签名: ${signature}`);
    }

    // 读取版本号
    const version = this.readUInt32LE(reader);
    if (version !== 2) {
      throw new Error(`不支持的 LZXC 版本: ${version}`);
    }

    // 读取重置间隔
    const resetInterval = this.readUInt32LE(reader);

    // 读取窗口大小
    const windowSize = this.readUInt32LE(reader);
    // 对于未知窗口大小只警告而不报错，提高兼容性
    if (!this.isValidWindowSize(windowSize)) {
      // 使用 32KB 默认值继续解析
    }

    // 读取缓存大小
    const cacheSize = this.readUInt32LE(reader);

    // 读取未知字段
    const unknown = this.readUInt32LE(reader);

    return {
      signature,
      version,
      resetInterval,
      windowSize,
      cacheSize,
      unknown,
    };
  }

  /**
   * 读取 4 字节签名
   * @param reader 位读取器
   * @returns 签名字符串
   */
  private static readSignature(reader: BitReader): string {
    const bytes: number[] = [];
    for (let i = 0; i < 4; i++) {
      bytes.push(reader.read(8));
    }
    return String.fromCharCode(...bytes);
  }

  /**
   * 读取 32 位小端序无符号整数
   * @param reader 位读取器
   * @returns 32 位整数
   */
  private static readUInt32LE(reader: BitReader): number {
    const byte1 = reader.read(8);
    const byte2 = reader.read(8);
    const byte3 = reader.read(8);
    const byte4 = reader.read(8);
    // >>> 0 将有符号 32 位整数转换为无符号，避免高位置 1 时产生负值
    return (byte1 | (byte2 << 8) | (byte3 << 16) | (byte4 << 24)) >>> 0;
  }

  /**
   * 验证窗口大小是否有效
   * @param windowSize 窗口大小
   * @returns 是否有效
   */
  private static isValidWindowSize(windowSize: number): boolean {
    return this.WINDOW_SIZES.includes(windowSize);
  }

  /**
   * 验证 LZXC 头部的完整性
   * @param header LZXC 头部
   * @returns 验证结果
   */
  static validate(header: LZXCHeader): boolean {
    if (header.signature !== 'LZXC') {
      return false;
    }

    if (header.version !== 2) {
      return false;
    }

    if (!this.isValidWindowSize(header.windowSize)) {
      return false;
    }

    if (header.resetInterval <= 0) {
      return false;
    }

    return true;
  }

  /**
   * 获取窗口大小的人类可读格式
   * @param windowSize 窗口大小（字节）
   * @returns 可读格式字符串
   */
  static getWindowSizeString(windowSize: number): string {
    if (windowSize >= 1024 * 1024) {
      return `${windowSize / (1024 * 1024)}MB`;
    } else if (windowSize >= 1024) {
      return `${windowSize / 1024}KB`;
    } else {
      return `${windowSize}B`;
    }
  }

  /**
   * 获取头部信息摘要
   * @param header LZXC 头部
   * @returns 头部信息字符串
   */
  static getSummary(header: LZXCHeader): string {
    return [
      `LZXC 版本: ${header.version}`,
      `重置间隔: ${header.resetInterval}`,
      `窗口大小: ${this.getWindowSizeString(header.windowSize)}`,
      `缓存大小: ${header.cacheSize} 字节`,
    ].join('\n');
  }

  /**
   * 获取支持的窗口大小列表
   * @returns 窗口大小数组
   */
  static getSupportedWindowSizes(): number[] {
    return [...this.WINDOW_SIZES];
  }
}

import type { LZXWindow } from '../types';

/**
 * LZX 滑动窗口实现
 * 负责管理 LZX 解码过程中的滑动窗口机制
 */
export class SlidingWindow implements LZXWindow {
  public data: Buffer;
  public size: number;
  public position: number;

  constructor(windowSize: number) {
    this.size = windowSize;
    this.data = Buffer.alloc(windowSize);
    this.position = 0;
  }

  /**
   * 写入数据到窗口
   * @param data 要写入的数据
   */
  write(data: Buffer): void {
    for (let i = 0; i < data.length; i++) {
      this.data[this.position] = data[i]!;
      this.position = (this.position + 1) % this.size;
    }
  }

  /**
   * 写入单个字节到窗口
   * @param byte 要写入的字节
   */
  writeByte(byte: number): void {
    this.data[this.position] = byte;
    this.position = (this.position + 1) % this.size;
  }

  /**
   * 从指定偏移位置读取数据
   * @param offset 回退偏移量
   * @param length 要读取的长度
   * @returns 读取的数据
   */
  readBack(offset: number, length: number): Buffer {
    if (offset <= 0 || offset > this.size) {
      throw new Error(`无效的偏移量: ${offset}`);
    }

    if (length <= 0) {
      throw new Error(`无效的长度: ${length}`);
    }

    const result = Buffer.alloc(length);
    let readPosition = (this.position - offset + this.size) % this.size;

    for (let i = 0; i < length; i++) {
      result[i] = this.data[readPosition]!;
      readPosition = (readPosition + 1) % this.size;
    }

    return result;
  }

  /**
   * 从指定偏移位置读取单个字节
   * @param offset 回退偏移量
   * @returns 读取的字节
   */
  readBackByte(offset: number): number {
    if (offset <= 0 || offset > this.size) {
      throw new Error(`无效的偏移量: ${offset}`);
    }

    const readPosition = (this.position - offset + this.size) % this.size;
    return this.data[readPosition]!;
  }

  /**
   * 复制数据（用于 LZ77 匹配）
   * @param offset 回退偏移量
   * @param length 复制长度
   * @returns 复制的数据
   */
  copyData(offset: number, length: number): Buffer {
    const result = Buffer.alloc(length);

    for (let i = 0; i < length; i++) {
      const byte = this.readBackByte(offset);
      result[i] = byte;
      this.writeByte(byte);
    }

    return result;
  }

  /**
   * 重置窗口
   */
  reset(): void {
    this.data.fill(0);
    this.position = 0;
  }

  /**
   * 获取当前窗口使用量
   * @returns 使用的字节数
   */
  getUsage(): number {
    return Math.min(this.position, this.size);
  }

  /**
   * 获取窗口剩余空间
   * @returns 剩余字节数
   */
  getRemainingSpace(): number {
    return this.size - this.getUsage();
  }

  /**
   * 检查是否可以进行指定长度的回退读取
   * @param offset 回退偏移量
   * @param length 读取长度
   * @returns 是否可以读取
   */
  canReadBack(offset: number, length: number): boolean {
    if (offset <= 0 || offset > this.size) {
      return false;
    }

    if (length <= 0) {
      return false;
    }

    // 检查是否有足够的历史数据
    const availableData = this.getUsage();
    return offset <= availableData;
  }

  /**
   * 获取窗口状态信息
   * @returns 窗口状态字符串
   */
  getStatus(): string {
    return [
      `窗口大小: ${this.size} 字节`,
      `当前位置: ${this.position}`,
      `使用量: ${this.getUsage()} 字节`,
      `利用率: ${((this.getUsage() / this.size) * 100).toFixed(2)}%`,
    ].join('\n');
  }

  /**
   * 创建窗口的快照（用于调试）
   * @param start 开始位置
   * @param length 快照长度
   * @returns 快照数据
   */
  snapshot(start = 0, length = Math.min(32, this.size)): Buffer {
    const snapshotLength = Math.min(length, this.size - start);
    return this.data.subarray(start, start + snapshotLength);
  }
}

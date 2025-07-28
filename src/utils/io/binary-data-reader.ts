import type { BitReader } from './bit-reader';

/**
 * 二进制数据读取器
 * 负责从 BitReader 中读取高级数据类型
 */
export class BinaryDataReader {
  private bitReader: BitReader;

  constructor(bitReader: BitReader) {
    this.bitReader = bitReader;
  }

  /**
   * 读取字节对齐的数据
   * @param bytes 要读取的字节数
   * @returns 读取的 Buffer
   */
  readBytes(bytes: number): Buffer {
    this.bitReader.align();

    if (this.bitReader.position + bytes > this.bitReader.buffer.length) {
      throw new Error('Not enough data to read');
    }

    const result = this.bitReader.buffer.slice(
      this.bitReader.position,
      this.bitReader.position + bytes,
    );
    this.bitReader.position += bytes;
    return result;
  }

  /**
   * 读取 little-endian 整数
   * @param bytes 字节数 (1, 2, 4, 8)
   * @returns 读取的整数
   */
  readInt(bytes: number): number {
    const data = this.readBytes(bytes);

    switch (bytes) {
      case 1:
        return data.readUInt8(0);
      case 2:
        return data.readUInt16LE(0);
      case 4:
        return data.readUInt32LE(0);
      case 8:
        return Number(data.readBigUInt64LE(0));
      default:
        throw new Error('Invalid byte count: must be 1, 2, 4, or 8');
    }
  }

  /**
   * 读取 big-endian 整数
   * @param bytes 字节数 (1, 2, 4, 8)
   * @returns 读取的整数
   */
  readIntBE(bytes: number): number {
    const data = this.readBytes(bytes);

    switch (bytes) {
      case 1:
        return data.readUInt8(0);
      case 2:
        return data.readUInt16BE(0);
      case 4:
        return data.readUInt32BE(0);
      case 8:
        return Number(data.readBigUInt64BE(0));
      default:
        throw new Error('Invalid byte count: must be 1, 2, 4, or 8');
    }
  }

  /**
   * 读取有符号整数 (little-endian)
   * @param bytes 字节数 (1, 2, 4, 8)
   * @returns 读取的有符号整数
   */
  readSignedInt(bytes: number): number {
    const data = this.readBytes(bytes);

    switch (bytes) {
      case 1:
        return data.readInt8(0);
      case 2:
        return data.readInt16LE(0);
      case 4:
        return data.readInt32LE(0);
      case 8:
        return Number(data.readBigInt64LE(0));
      default:
        throw new Error('Invalid byte count: must be 1, 2, 4, or 8');
    }
  }

  /**
   * 读取浮点数
   * @param bytes 字节数 (4 或 8)
   * @returns 读取的浮点数
   */
  readFloat(bytes: number): number {
    const data = this.readBytes(bytes);

    switch (bytes) {
      case 4:
        return data.readFloatLE(0);
      case 8:
        return data.readDoubleLE(0);
      default:
        throw new Error('Invalid byte count: must be 4 or 8');
    }
  }

  /**
   * 读取字符串
   * @param length 字符串长度
   * @param encoding 编码格式
   * @returns 读取的字符串
   */
  readString(
    length: number,
    encoding: 'utf8' | 'ascii' | 'base64' | 'utf16le' = 'utf8',
  ): string {
    const data = this.readBytes(length);
    return data.toString(encoding);
  }

  /**
   * 读取以 null 结尾的字符串
   * @param maxLength 最大长度
   * @param encoding 编码格式
   * @returns 读取的字符串
   */
  readNullTerminatedString(
    maxLength: number = 1024,
    encoding: 'utf8' | 'ascii' = 'ascii',
  ): string {
    const bytes: number[] = [];
    let count = 0;

    while (count < maxLength) {
      const byte = this.readInt(1);
      if (byte === 0) {
        break;
      }
      bytes.push(byte);
      count++;
    }

    return Buffer.from(bytes).toString(encoding);
  }

  /**
   * 读取 UUID (16 字节)
   * @returns UUID 字符串
   */
  readUUID(): string {
    const data = this.readBytes(16);
    const hex = data.toString('hex').toLowerCase();
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20, 32),
    ].join('-');
  }

  /**
   * 读取时间戳（Windows FILETIME 格式）
   * @returns Date 对象
   */
  readFileTime(): Date {
    const low = this.readInt(4);
    const high = this.readInt(4);
    const filetime = high * 0x100000000 + low;

    // Windows FILETIME 是从 1601年1月1日 开始的 100 纳秒计数
    const windowsEpoch = new Date('1601-01-01T00:00:00Z').getTime();
    const timestamp = windowsEpoch + filetime / 10000; // 转换为毫秒

    return new Date(timestamp);
  }

  /**
   * 读取数组
   * @param count 数组元素数量
   * @param elementReader 元素读取函数
   * @returns 读取的数组
   */
  readArray<T>(count: number, elementReader: () => T): T[] {
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      result.push(elementReader());
    }
    return result;
  }

  /**
   * 跳过指定字节数
   * @param bytes 要跳过的字节数
   */
  skipBytes(bytes: number): void {
    this.bitReader.position += bytes;
  }

  /**
   * 获取当前字节位置
   * @returns 当前字节位置
   */
  getBytePosition(): number {
    return this.bitReader.position;
  }

  /**
   * 设置字节位置
   * @param position 目标位置
   */
  setBytePosition(position: number): void {
    this.bitReader.position = position;
    this.bitReader.bitPosition = 0;
  }

  /**
   * 获取剩余字节数
   * @returns 剩余字节数
   */
  remainingBytes(): number {
    return this.bitReader.buffer.length - this.bitReader.position;
  }

  /**
   * 检查是否还有数据
   * @returns 是否还有数据
   */
  hasMoreData(): boolean {
    return this.bitReader.position < this.bitReader.buffer.length;
  }
}

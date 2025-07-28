import type { BitReader as IBitReader } from '../../core/types';

/**
 * BitReader 类用于位级数据读取
 */
export class BitReader implements IBitReader {
  public buffer: Buffer;
  public position: number;
  public bitPosition: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.position = 0;
    this.bitPosition = 0;
  }

  /**
   * 读取指定位数的数据
   * @param bits 要读取的位数
   * @returns 读取的数值
   */
  public read(bits: number): number {
    if (bits <= 0 || bits > 32) {
      throw new Error('Invalid bits count: must be between 1 and 32');
    }

    let result = 0;
    let bitsLeft = bits;

    while (bitsLeft > 0) {
      if (this.position >= this.buffer.length) {
        throw new Error('End of buffer reached');
      }

      const currentByte = this.buffer[this.position]!;
      const availableBits = 8 - this.bitPosition;
      const bitsToRead = Math.min(bitsLeft, availableBits);

      // 从当前字节中提取位
      const mask = (1 << bitsToRead) - 1;
      const shift = availableBits - bitsToRead;
      const extractedBits = (currentByte >> shift) & mask;

      result = (result << bitsToRead) | extractedBits;

      // 更新位置
      this.bitPosition += bitsToRead;
      if (this.bitPosition >= 8) {
        this.position++;
        this.bitPosition = 0;
      }

      bitsLeft -= bitsToRead;
    }

    return result;
  }

  /**
   * 预览指定位数的数据（不改变位置）
   * @param bits 要预览的位数
   * @returns 预览的数值
   */
  public peek(bits: number): number {
    const currentPosition = this.position;
    const currentBitPosition = this.bitPosition;

    const result = this.read(bits);

    // 恢复位置
    this.position = currentPosition;
    this.bitPosition = currentBitPosition;

    return result;
  }

  /**
   * 跳过指定位数
   * @param bits 要跳过的位数
   */
  public skip(bits: number): void {
    const totalBits = this.bitPosition + bits;
    this.position += Math.floor(totalBits / 8);
    this.bitPosition = totalBits % 8;
  }

  /**
   * 对齐到字节边界
   */
  public align(): void {
    if (this.bitPosition > 0) {
      this.position++;
      this.bitPosition = 0;
    }
  }

  /**
   * 检查是否还有更多数据
   * @returns 是否还有数据
   */
  public hasMore(): boolean {
    return this.position < this.buffer.length;
  }

  /**
   * 获取当前位置信息
   * @returns 位置信息
   */
  public getPosition(): { byte: number; bit: number } {
    return {
      byte: this.position,
      bit: this.bitPosition,
    };
  }

  /**
   * 设置位置
   * @param byte 字节位置
   * @param bit 位位置
   */
  public setPosition(byte: number, bit: number = 0): void {
    if (byte < 0 || byte >= this.buffer.length) {
      throw new Error('Invalid byte position');
    }
    if (bit < 0 || bit >= 8) {
      throw new Error('Invalid bit position');
    }

    this.position = byte;
    this.bitPosition = bit;
  }

  /**
   * 获取剩余字节数
   * @returns 剩余字节数
   */
  public remainingBytes(): number {
    return this.buffer.length - this.position;
  }
}

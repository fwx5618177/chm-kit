import type { ITSFHeader } from '../types';
import type { BitReader } from '../../utils/bit-reader';

/**
 * ITSF 头部解析器
 * 负责解析 CHM 文件的 Info-Tech Storage Format 头部信息
 */
export class ITSFHeaderParser {
  /**
   * 解析 ITSF 头部
   * @param reader 位读取器
   * @returns 解析后的 ITSF 头部信息
   */
  static parse(reader: BitReader): ITSFHeader {
    // 读取签名
    const signature = this.readSignature(reader);
    if (signature !== 'ITSF') {
      throw new Error(`无效的 ITSF 签名: ${signature}`);
    }

    // 读取版本号（小端序）
    const version = this.readUInt32LE(reader);
    if (version !== 3) {
      throw new Error(`不支持的 ITSF 版本: ${version}`);
    }

    // 读取头部长度（小端序）
    const headerLength = this.readUInt32LE(reader);
    if (headerLength < 96) {
      throw new Error(`ITSF 头部长度无效: ${headerLength}`);
    }

    const result = {
      signature,
      version,
      headerLength,
      unknown1: this.readUInt32LE(reader),
      timestamp: this.readUInt32LE(reader),
      languageId: this.readUInt32LE(reader),
      unknown2: this.readUInt32LE(reader),
      unknown3: this.readUInt32LE(reader),
      directoryOffset: this.readUInt32LE(reader),
      directoryLength: this.readUInt32LE(reader),
      unknown4: this.readUInt32LE(reader),
    };

    // 跳过剩余的头部字节以对齐到头部结束位置
    const bytesRead = 4 + 4 * 10; // signature + 10 * 4-byte fields = 44 bytes
    const remainingBytes = headerLength - bytesRead;
    for (let i = 0; i < remainingBytes; i++) {
      reader.read(8); // 跳过剩余字节
    }

    return result;
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

    return byte1 | (byte2 << 8) | (byte3 << 16) | (byte4 << 24);
  }

  /**
   * 验证 ITSF 头部的完整性
   * @param header ITSF 头部
   * @returns 验证结果
   */
  static validate(header: ITSFHeader): boolean {
    if (header.signature !== 'ITSF') {
      return false;
    }

    if (header.version !== 3) {
      return false;
    }

    if (header.headerLength < 96) {
      return false;
    }

    if (header.directoryOffset <= 0 || header.directoryLength <= 0) {
      return false;
    }

    return true;
  }

  /**
   * 获取头部信息摘要
   * @param header ITSF 头部
   * @returns 头部信息字符串
   */
  static getSummary(header: ITSFHeader): string {
    return [
      `ITSF 版本: ${header.version}`,
      `头部长度: ${header.headerLength} 字节`,
      `语言 ID: ${header.languageId}`,
      `目录偏移: 0x${header.directoryOffset.toString(16)}`,
      `目录长度: ${header.directoryLength} 字节`,
    ].join('\n');
  }
}

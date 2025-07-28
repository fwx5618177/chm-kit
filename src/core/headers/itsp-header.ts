import type { ITSPHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';

/**
 * ITSP 头部解析器
 * 负责解析 CHM 文件的 Info-Tech Storage Path 头部信息
 */
export class ITSPHeaderParser {
  /**
   * 解析 ITSP 头部
   * @param reader 位读取器
   * @returns 解析后的 ITSP 头部信息
   */
  static parse(reader: BitReader): ITSPHeader {
    // 读取签名
    const signature = this.readSignature(reader);
    if (signature !== 'ITSP') {
      throw new Error(`无效的 ITSP 签名: ${signature}`);
    }

    // 读取版本号
    const version = this.readUInt32LE(reader);
    if (version !== 1) {
      throw new Error(`不支持的 ITSP 版本: ${version}`);
    }

    // 读取头部长度
    const headerLength = this.readUInt32LE(reader);
    if (headerLength < 84) {
      throw new Error(`ITSP 头部长度无效: ${headerLength}`);
    }

    const result = {
      signature,
      version,
      headerLength,
      unknown1: this.readUInt32LE(reader),
      chunkSize: this.readUInt32LE(reader),
      density: this.readUInt32LE(reader),
      depth: this.readUInt32LE(reader),
      rootIndex: this.readUInt32LE(reader),
      firstPMGI: this.readUInt32LE(reader),
      lastPMGI: this.readUInt32LE(reader),
      unknown2: this.readUInt32LE(reader),
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
   * 验证 ITSP 头部的完整性
   * @param header ITSP 头部
   * @returns 验证结果
   */
  static validate(header: ITSPHeader): boolean {
    if (header.signature !== 'ITSP') {
      return false;
    }

    if (header.version !== 1) {
      return false;
    }

    if (header.headerLength < 84) {
      return false;
    }

    if (header.chunkSize <= 0) {
      return false;
    }

    return true;
  }

  /**
   * 获取头部信息摘要
   * @param header ITSP 头部
   * @returns 头部信息字符串
   */
  static getSummary(header: ITSPHeader): string {
    return [
      `ITSP 版本: ${header.version}`,
      `头部长度: ${header.headerLength} 字节`,
      `块大小: ${header.chunkSize} 字节`,
      `密度: ${header.density}`,
      `深度: ${header.depth}`,
      `根索引: ${header.rootIndex}`,
      `首个 PMGI: ${header.firstPMGI}`,
      `最后 PMGI: ${header.lastPMGI}`,
    ].join('\n');
  }
}

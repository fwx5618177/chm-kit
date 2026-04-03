import type { ITSFHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';

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
    if (version !== 3 && version !== 2) {
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
      // 跳过两个 16 字节 GUID（0x18-0x27 和 0x28-0x37）
      unknown2: (() => {
        for (let i = 0; i < 32; i++) reader.read(8); // skip GUID0 + GUID1
        // sect0_offset uint64 LE: 取低 32 位（0x38-0x3B）
        const lo = this.readUInt32LE(reader);
        reader.read(8);
        reader.read(8);
        reader.read(8);
        reader.read(8); // skip high 4 bytes
        return lo;
      })(),
      unknown3: (() => {
        // sect0_length uint64 LE: 取低 32 位（0x40-0x43）
        const lo = this.readUInt32LE(reader);
        reader.read(8);
        reader.read(8);
        reader.read(8);
        reader.read(8); // skip high 4 bytes
        return lo;
      })(),
      // dir_offset uint64 LE: 取低 32 位（0x48-0x4B）
      directoryOffset: (() => {
        const lo = this.readUInt32LE(reader);
        reader.read(8);
        reader.read(8);
        reader.read(8);
        reader.read(8); // skip high 4 bytes
        return lo;
      })(),
      // dir_len uint64 LE: 取低 32 位（0x50-0x53）
      directoryLength: (() => {
        const lo = this.readUInt32LE(reader);
        reader.read(8);
        reader.read(8);
        reader.read(8);
        reader.read(8); // skip high 4 bytes
        return lo;
      })(),
      // content_offset uint64 LE: 取低 32 位（0x58-0x5B）— version 2 没有此字段
      unknown4: (() => {
        if (version !== 3) return 0;
        const lo = this.readUInt32LE(reader);
        reader.read(8);
        reader.read(8);
        reader.read(8);
        reader.read(8); // skip high 4 bytes
        return lo;
      })(),
    };

    // 计算已消费字节数，跳过尾部填充
    // sig(4)+5fields(20)+GUIDs(32)+5pairs×8(40)+unknown4_lo(4)+unknown4_hi(4) = 4+20+32+40+8 = 104
    // 但 headerLength 通常为 96，所以对于较旧格式（无 content_offset 字段）需特殊处理
    // 这里采用保守策略：用 setPosition 直接跳到 directoryOffset
    // （不需要再手动 skip 剩余字节，由 CHMParser.parse() 通过 setPosition 定位）

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
    // >>> 0 将有符号 32 位整数转换为无符号，避免高位置 1 时产生负值
    return (byte1 | (byte2 << 8) | (byte3 << 16) | (byte4 << 24)) >>> 0;
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

    if (header.version !== 3 && header.version !== 2) {
      return false;
    }

    // version 3 最小 96 字节，version 2 最小 88 字节（无 content_offset 字段）
    const minHeaderLength = header.version === 3 ? 96 : 88;
    if (header.headerLength < minHeaderLength) {
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

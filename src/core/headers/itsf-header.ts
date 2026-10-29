import type { ITSFHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { checkedEnd, isUInt, readBytes, readUInt64LE } from './binary';

const GUIDS = Buffer.from(
  '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec',
  'hex',
);

export class ITSFHeaderParser {
  static parse(reader: BitReader): ITSFHeader {
    const start = reader.position;
    const prefix = readBytes(reader, 12, 'ITSF header');
    const signature = prefix.toString('ascii', 0, 4);
    if (signature !== 'ITSF') throw new Error(`无效的 ITSF 签名: ${signature}`);
    const version = prefix.readUInt32LE(4);
    if (version !== 2 && version !== 3)
      throw new Error(`不支持的 ITSF 版本: ${version}`);
    const headerLength = prefix.readUInt32LE(8);
    if (headerLength < (version === 2 ? 0x58 : 0x60)) {
      throw new Error(`ITSF 头部长度无效: ${headerLength}`);
    }
    reader.setPosition(start, 0);
    const data = readBytes(reader, headerLength, 'ITSF header');
    if (!data.subarray(0x18, 0x38).equals(GUIDS))
      throw new Error('无效的 ITSF GUID');
    const result: ITSFHeader = {
      signature,
      version,
      headerLength,
      unknown1: data.readUInt32LE(0x0c),
      timestamp: data.readUInt32BE(0x10),
      languageId: data.readUInt32LE(0x14),
      // These describe auxiliary header section 0, not the content data section.
      unknown2: readUInt64LE(data, 0x38, 'ITSF header section 0 offset'),
      unknown3: readUInt64LE(data, 0x40, 'ITSF header section 0 length'),
      directoryOffset: readUInt64LE(data, 0x48, 'ITSF directory offset'),
      directoryLength: readUInt64LE(data, 0x50, 'ITSF directory length'),
      unknown4:
        version === 3 ? readUInt64LE(data, 0x58, 'ITSF data offset') : 0,
    };
    if (!this.validate(result))
      throw new Error('ITSF 头部验证失败: invalid range');
    return result;
  }

  static validate(header: ITSFHeader): boolean {
    if (
      header.signature !== 'ITSF' ||
      (header.version !== 2 && header.version !== 3)
    )
      return false;
    if (
      !isUInt(header.headerLength) ||
      header.headerLength < (header.version === 2 ? 0x58 : 0x60)
    )
      return false;
    if (
      !isUInt(header.directoryOffset) ||
      header.directoryOffset < header.headerLength ||
      !isUInt(header.directoryLength) ||
      header.directoryLength < 0x54
    )
      return false;
    if (![header.unknown2, header.unknown3, header.unknown4].every(isUInt))
      return false;
    try {
      const directoryEnd = checkedEnd(
        header.directoryOffset,
        header.directoryLength,
        'ITSF directory',
      );
      checkedEnd(header.unknown2, header.unknown3, 'ITSF header section 0');
      if (header.version === 3 && header.unknown4 < directoryEnd) return false;
    } catch {
      return false;
    }
    return true;
  }

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

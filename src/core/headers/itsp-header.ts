import type { ITSPHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { isUInt, readBytes } from './binary';

const GUID = Buffer.from('6a92025d2e21d0119df900a0c922e6ec', 'hex');

export class ITSPHeaderParser {
  static parse(reader: BitReader): ITSPHeader {
    const start = reader.position;
    const prefix = readBytes(reader, 12, 'ITSP header');
    const signature = prefix.toString('ascii', 0, 4);
    if (signature !== 'ITSP') throw new Error(`无效的 ITSP 签名: ${signature}`);
    const version = prefix.readUInt32LE(4);
    if (version !== 1) throw new Error(`不支持的 ITSP 版本: ${version}`);
    const headerLength = prefix.readUInt32LE(8);
    if (headerLength < 0x54)
      throw new Error(`ITSP 头部长度无效: ${headerLength}`);
    reader.setPosition(start, 0);
    const data = readBytes(reader, headerLength, 'ITSP header');
    if (!data.subarray(0x34, 0x44).equals(GUID))
      throw new Error('无效的 ITSP GUID');
    const header: ITSPHeader = {
      signature,
      version,
      headerLength,
      unknown1: data.readUInt32LE(0x0c),
      chunkSize: data.readUInt32LE(0x10),
      density: data.readUInt32LE(0x14),
      depth: data.readUInt32LE(0x18),
      rootIndex: data.readInt32LE(0x1c),
      // Retain the public field names: these are actually first/last PMGL.
      firstPMGI: data.readUInt32LE(0x20),
      lastPMGI: data.readUInt32LE(0x24),
      unknown2: data.readUInt32LE(0x28),
    };
    const numChunks = data.readUInt32LE(0x2c);
    if (
      !this.validate(header) ||
      numChunks === 0 ||
      header.lastPMGI >= numChunks ||
      header.rootIndex >= numChunks ||
      header.depth > numChunks
    ) {
      throw new Error('ITSP 头部验证失败: invalid chunk range');
    }
    return header;
  }

  static validate(header: ITSPHeader): boolean {
    return (
      header.signature === 'ITSP' &&
      header.version === 1 &&
      isUInt(header.headerLength) &&
      header.headerLength >= 0x54 &&
      isUInt(header.chunkSize) &&
      header.chunkSize >= 22 &&
      isUInt(header.density) &&
      header.density <= 31 &&
      isUInt(header.depth) &&
      header.depth >= 1 &&
      Number.isInteger(header.rootIndex) &&
      header.rootIndex >= -1 &&
      header.rootIndex <= 0xffffffff &&
      isUInt(header.firstPMGI) &&
      isUInt(header.lastPMGI) &&
      header.firstPMGI <= header.lastPMGI
    );
  }

  static getSummary(header: ITSPHeader): string {
    return [
      `ITSP 版本: ${header.version}`,
      `头部长度: ${header.headerLength} 字节`,
      `块大小: ${header.chunkSize} 字节`,
      `密度: ${header.density}`,
      `深度: ${header.depth}`,
      `根索引: ${header.rootIndex}`,
      `首个 PMGL: ${header.firstPMGI}`,
      `最后 PMGL: ${header.lastPMGI}`,
    ].join('\n');
  }
}

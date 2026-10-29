import type { LZXCHeader } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { isUInt, readBytes } from './binary';

export class LZXCHeaderParser {
  private static readonly WINDOW_SIZES = [
    0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000,
  ];

  static parse(reader: BitReader): LZXCHeader {
    const start = reader.position;
    const prefix = readBytes(reader, 12, 'LZXC ControlData');
    // The length is a count of DWORDs following the length DWORD itself.
    const words = prefix.readUInt32LE(0);
    const signature = prefix.toString('ascii', 4, 8);
    if (signature !== 'LZXC') throw new Error(`无效的 LZXC 签名: ${signature}`);
    const version = prefix.readUInt32LE(8);
    if (version !== 1 && version !== 2)
      throw new Error(`不支持的 LZXC 版本: ${version}`);
    if (words < (version === 1 ? 5 : 6))
      throw new Error('LZXC ControlData 长度前缀无效');
    reader.setPosition(start, 0);
    const data = readBytes(reader, 4 + words * 4, 'LZXC ControlData');
    const unit = version === 2 ? 0x8000 : 1;
    const header: LZXCHeader = {
      signature,
      version,
      resetInterval: data.readUInt32LE(0x0c) * unit,
      windowSize: data.readUInt32LE(0x10) * unit,
      // This on-disk field is windowsPerReset, not a byte count.
      cacheSize: data.readUInt32LE(0x14),
      unknown: words >= 6 ? data.readUInt32LE(0x18) : 0,
    };
    if (!this.validate(header)) throw new Error('LZXC 头部验证失败');
    return header;
  }

  static validate(header: LZXCHeader): boolean {
    return (
      header.signature === 'LZXC' &&
      (header.version === 1 || header.version === 2) &&
      this.WINDOW_SIZES.includes(header.windowSize) &&
      isUInt(header.resetInterval) &&
      header.resetInterval > 0 &&
      header.resetInterval % 0x8000 === 0 &&
      isUInt(header.cacheSize) &&
      isUInt(header.unknown)
    );
  }

  static getWindowSizeString(windowSize: number): string {
    if (windowSize >= 1024 * 1024) return `${windowSize / (1024 * 1024)}MB`;
    if (windowSize >= 1024) return `${windowSize / 1024}KB`;
    return `${windowSize}B`;
  }

  static getSummary(header: LZXCHeader): string {
    return [
      `LZXC 版本: ${header.version}`,
      `重置间隔: ${header.resetInterval}`,
      `窗口大小: ${this.getWindowSizeString(header.windowSize)}`,
      `每次重置的窗口数: ${header.cacheSize}`,
    ].join('\n');
  }

  static getSupportedWindowSizes(): number[] {
    return [...this.WINDOW_SIZES];
  }
}

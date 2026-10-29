import type { ParsedCHM, ResetTable } from '../types';
import { ITSFHeaderParser } from '../headers/itsf-header';
import { ITSPHeaderParser } from '../headers/itsp-header';
import { LZXCHeaderParser } from '../headers/lzxc-header';
import { DirectoryParser } from '../directory/directory-parser';

const STORAGE = '::dataspace/storage/mscompressed/';
const CONTENT = `${STORAGE}content`;
const CONTROL = `${STORAGE}controldata`;
const RESET = `${STORAGE}transform/{7fc28940-9d31-11d0-9b27-00a0c91e9c7c}/instancedata/resettable`;
const isUInt = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

/** Validate parsed data without weakening the format parser's mandatory checks. */
export class CHMParserValidator {
  static validate(
    parsedCHM: ParsedCHM,
    options: { strict?: boolean; fileSize?: number } = {},
  ): boolean {
    try {
      return (
        this.validateHeaders(parsedCHM) &&
        this.validateDirectory(parsedCHM) &&
        this.validateContentOffset(parsedCHM) &&
        (!options.strict || this.validateStructure(parsedCHM, options.fileSize))
      );
    } catch {
      return false;
    }
  }

  static validateHeaders(parsedCHM: ParsedCHM): boolean {
    try {
      const { itsf, itsp, lzxc } = parsedCHM.header;
      if (
        !ITSFHeaderParser.validate(itsf) ||
        !ITSPHeaderParser.validate(itsp)
      ) {
        return false;
      }
      if (lzxc.signature !== '') return LZXCHeaderParser.validate(lzxc);
      // A section-0-only archive has no ControlData; its empty marker is valid.
      return (
        [
          lzxc.version,
          lzxc.resetInterval,
          lzxc.windowSize,
          lzxc.cacheSize,
          lzxc.unknown,
        ].every(value => value === 0) &&
        Array.from(parsedCHM.directory.entries.values()).every(
          entry =>
            entry.section === 0 &&
            ![CONTENT, CONTROL, RESET].includes(entry.name.toLowerCase()),
        )
      );
    } catch {
      return false;
    }
  }

  static validateDirectory(parsedCHM: ParsedCHM): boolean {
    try {
      return DirectoryParser.validate(parsedCHM.directory);
    } catch {
      return false;
    }
  }

  static validateContentOffset(parsedCHM: ParsedCHM): boolean {
    return Boolean(parsedCHM) && isUInt(parsedCHM.contentOffset);
  }

  private static validateStructure(
    parsed: ParsedCHM,
    fileSize?: number,
  ): boolean {
    const { itsf, itsp, lzxc } = parsed.header;
    const directoryEnd = itsf.directoryOffset + itsf.directoryLength;
    const chunks = (itsf.directoryLength - itsp.headerLength) / itsp.chunkSize;
    const root = itsp.rootIndex === 0xffffffff ? -1 : itsp.rootIndex;
    if (
      !isUInt(directoryEnd) ||
      !isUInt(chunks) ||
      chunks === 0 ||
      itsp.lastPMGI >= chunks ||
      root >= chunks ||
      itsp.depth > chunks
    )
      return false;
    const base = itsf.version === 3 ? itsf.unknown4 : directoryEnd;
    if (
      fileSize !== undefined &&
      (!isUInt(fileSize) ||
        directoryEnd > fileSize ||
        base > fileSize ||
        parsed.contentOffset > fileSize ||
        itsf.unknown2 + itsf.unknown3 > fileSize)
    )
      return false;

    const entries = Array.from(parsed.directory.entries.values());
    const find = (name: string) =>
      entries.find(entry => entry.name.toLowerCase() === name);
    const content = find(CONTENT);
    const control = find(CONTROL);
    const reset = find(RESET);
    const compressed = Boolean(
      content || control || reset || entries.some(entry => entry.section === 1),
    );
    if (parsed.contentOffset !== base + (content?.offset ?? 0)) return false;
    if (
      compressed &&
      (!content ||
        !control ||
        !reset ||
        [content, control, reset].some(entry => entry.section !== 0) ||
        !LZXCHeaderParser.validate(lzxc) ||
        !this.validateResetTable(parsed.resetTable) ||
        parsed.resetTable.compressedLength !== content.length)
    )
      return false;
    if (
      !compressed &&
      (lzxc.signature !== '' ||
        !this.validateResetTable(parsed.resetTable) ||
        parsed.resetTable.blockCount !== 0)
    )
      return false;

    return entries.every(entry => {
      const end = entry.offset + entry.length;
      if (!isUInt(end)) return false;
      if (entry.section === 1)
        return end <= parsed.resetTable.uncompressedLength;
      const physicalEnd = base + end;
      return (
        isUInt(physicalEnd) &&
        (fileSize === undefined || physicalEnd <= fileSize)
      );
    });
  }

  private static validateResetTable(table: ResetTable): boolean {
    if (
      !table ||
      table.version !== 2 ||
      table.entrySize !== 8 ||
      !isUInt(table.tableOffset) ||
      table.tableOffset < 0x28 ||
      table.blockSize !== 0x8000 ||
      !isUInt(table.blockCount) ||
      !isUInt(table.compressedLength) ||
      !isUInt(table.uncompressedLength) ||
      !Array.isArray(table.entries) ||
      table.blockCount !== table.entries.length ||
      table.blockCount !== Math.ceil(table.uncompressedLength / table.blockSize)
    )
      return false;
    if (table.blockCount === 0) {
      return table.compressedLength === 0 && table.uncompressedLength === 0;
    }
    let previous = -1;
    return table.entries.every((entry, index) => {
      if (
        !entry ||
        !isUInt(entry.compressedLength) ||
        (index === 0 && entry.compressedLength !== 0) ||
        entry.compressedLength <= previous ||
        entry.compressedLength >= table.compressedLength ||
        entry.uncompressedLength !==
          Math.min(
            table.blockSize,
            table.uncompressedLength - index * table.blockSize,
          )
      )
        return false;
      previous = entry.compressedLength;
      return true;
    });
  }
}

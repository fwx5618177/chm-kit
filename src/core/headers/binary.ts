import type { BitReader } from '../../utils/io/bit-reader';

export function isUInt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function checkedEnd(
  offset: number,
  length: number,
  label: string,
): number {
  if (
    !isUInt(offset) ||
    !isUInt(length) ||
    length > Number.MAX_SAFE_INTEGER - offset
  ) {
    throw new Error(`${label}: invalid or unsafe range`);
  }
  return offset + length;
}

export function requireRange(
  buffer: Buffer,
  offset: number,
  length: number,
  label: string,
): void {
  if (checkedEnd(offset, length, label) > buffer.length) {
    throw new Error(`${label}: truncated or out of bounds`);
  }
}

export function readBytes(
  reader: BitReader,
  length: number,
  label: string,
): Buffer {
  if (reader.bitPosition !== 0)
    throw new Error(`${label}: expected byte alignment`);
  requireRange(reader.buffer, reader.position, length, label);
  const start = reader.position;
  reader.setPosition(start + length, 0);
  return reader.buffer.subarray(start, start + length);
}

export function readUInt64LE(
  buffer: Buffer,
  offset: number,
  label: string,
): number {
  requireRange(buffer, offset, 8, label);
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readUInt32LE(offset + 4);
  if (high > 0x1fffff)
    throw new Error(`${label}: uint64 exceeds safe integer range`);
  return high * 0x100000000 + low;
}

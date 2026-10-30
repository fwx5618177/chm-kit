import { Command, InvalidArgumentError } from 'commander';
import { extname } from 'path';
import { createFilterFunction } from '../utils/helpers';
import type { CHMFileInfo } from '../reader/types';

export interface FileFilters {
  filter?: string;
  type?: string;
  minSize?: number;
  maxSize?: number;
}

export function integer(value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number))
    throw new InvalidArgumentError('必须是非负安全整数');
  return number;
}

export function positiveInteger(value: string): number {
  const number = integer(value);
  if (number === 0) throw new InvalidArgumentError('必须大于 0');
  return number;
}

/** Bytes by default; binary KiB/MiB/GiB and decimal KB/MB/GB are explicit. */
export function byteSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|KB|MB|GB)?$/i.exec(value);
  if (!match)
    throw new InvalidArgumentError(
      '大小必须为字节数或带 B/KB/MB/GB/KiB/MiB/GiB 单位',
    );
  const unit = (match[2] ?? 'B').toLowerCase();
  const factors: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000000,
    gb: 1000000000,
    kib: 1024,
    mib: 1048576,
    gib: 1073741824,
  };
  const size = Number(match[1]) * factors[unit]!;
  if (!Number.isSafeInteger(size) || size < 0)
    throw new InvalidArgumentError('大小必须为非负安全整数字节');
  return size;
}

export function addFileFilters(command: Command, shortFlag = true): Command {
  return command
    .option(
      shortFlag ? '-f, --filter <glob>' : '--filter <glob>',
      '归档路径 glob（与类型/大小条件取交集）',
    )
    .option('--type <types>', '扩展名或 MIME，逗号分隔，如 html,txt,image/*')
    .option('--min-size <size>', '最小解压大小（包含）', byteSize)
    .option('--max-size <size>', '最大解压大小（包含）', byteSize);
}

export function filePredicate(
  options: FileFilters,
): (info: Pick<CHMFileInfo, 'path' | 'size' | 'mimeType'>) => boolean {
  if ((options.minSize ?? 0) > (options.maxSize ?? Infinity))
    throw new Error('--min-size 不能大于 --max-size');
  const glob = options.filter
    ? createFilterFunction([options.filter])
    : () => true;
  const types = options.type?.split(',').map(type => type.trim().toLowerCase());
  if (
    types?.some(
      type =>
        !/^(?:\.?[a-z0-9][a-z0-9_+-]*|[a-z0-9.+-]+\/(?:[a-z0-9.+-]+|\*))$/.test(
          type,
        ),
    )
  )
    throw new Error('--type 必须是扩展名或 MIME（可用 type/*）');
  return info =>
    glob(info.path) &&
    info.size >= (options.minSize ?? 0) &&
    info.size <= (options.maxSize ?? Infinity) &&
    (!types ||
      types.some(type =>
        type.includes('/')
          ? type.endsWith('/*')
            ? info.mimeType.startsWith(type.slice(0, -1))
            : info.mimeType === type
          : extname(info.path).toLowerCase() === `.${type.replace(/^\./, '')}`,
      ));
}

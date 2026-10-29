import { Command } from 'commander';
import { createWriteStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { CHMReader } from '../../reader/chm-reader';
import { decodeText } from '../../reader/reader-utils';

export interface ReadOptions {
  list?: boolean;
  toc?: boolean;
  index?: boolean;
  stream?: boolean;
  output?: string;
  format?: string;
  encoding?: string;
  range?: string;
}

function byteRange(value: string, length: number): [number, number] {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match)
    throw new Error('range 必须为 start:end（字节偏移，end 不包含在内）');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    end > length
  ) {
    throw new Error(`range 越界：必须满足 0 <= start <= end <= ${length}`);
  }
  return [start, end];
}

function decode(data: Buffer, encoding: string): string {
  return Buffer.isEncoding(encoding)
    ? data.toString(encoding)
    : decodeText(data, encoding);
}

async function emit(data: string | Buffer, output?: string): Promise<void> {
  if (output) {
    await fs.writeFile(output, data);
  } else {
    await pipeline(
      Readable.from([data], { objectMode: false }),
      process.stdout,
      {
        end: false,
      },
    );
  }
}

function navigationSource(reader: CHMReader, field: 'toc' | 'index'): string {
  let name = reader.getMetadata()[field];
  if (name) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // Match Reader's handling of literal, invalid URL escapes.
    }
    if (reader.exists(name)) return reader.getFileInfo(name).path;
  }
  const extension = field === 'toc' ? /\.hhc$/i : /\.hhk$/i;
  const fallback = reader.listFiles().find(path => extension.test(path));
  if (!fallback)
    throw new Error(`归档中未找到 ${field === 'toc' ? '.hhc' : '.hhk'} 文件`);
  return fallback;
}

async function emitStream(
  source: ReadableStream<Uint8Array>,
  output?: string,
): Promise<void> {
  // DOM and Node declarations differ; the runtime value is a WHATWG stream.
  const stream = Readable.fromWeb(source as NodeReadableStream<Uint8Array>);
  if (output) {
    await pipeline(stream, createWriteStream(output));
  } else {
    await pipeline(stream, process.stdout, { end: false });
  }
}

/** Separated from Commander so resource lifetime and lazy reads can be tested. */
export async function readArchive(
  input: string,
  filePath: string | undefined,
  options: ReadOptions,
): Promise<void> {
  const format = options.format ?? 'text';
  const encoding = options.encoding ?? 'utf8';
  if (!['text', 'json', 'raw'].includes(format)) {
    throw new Error('format 必须是 text、json 或 raw');
  }
  try {
    decode(Buffer.alloc(0), encoding);
  } catch {
    throw new Error(`不支持的 encoding: ${encoding}`);
  }
  const modes = [
    !!filePath,
    !!options.list,
    !!options.toc,
    !!options.index,
  ].filter(Boolean).length;
  if (modes !== 1)
    throw new Error(
      '指定一个 file-path、--list、--toc 或 --index，不能组合使用',
    );
  if (options.stream && format === 'json')
    throw new Error('--stream 输出原始字节，不能与 json 格式组合');
  if (
    options.list &&
    (options.range !== undefined || options.stream || format === 'raw')
  ) {
    throw new Error('--list 支持 text/json，不支持 --range 或 --stream');
  }
  if (
    (options.toc || options.index) &&
    format === 'json' &&
    options.range !== undefined
  ) {
    throw new Error('结构化导航 JSON 不支持 --range；请使用 text/raw 源内容');
  }

  const binaryEncoding = /^(?:base64(?:url)?|hex)$/i.test(encoding);
  const reader = await CHMReader.open(
    input,
    options.encoding && !binaryEncoding
      ? { defaultEncoding: encoding }
      : undefined,
  );
  try {
    if (options.list) {
      const files = reader.listFiles();
      await emit(
        format === 'json'
          ? `${JSON.stringify(files, null, 2)}\n`
          : files.map(name => `${name}\n`).join(''),
        options.output,
      );
      return;
    }
    if ((options.toc || options.index) && format === 'json') {
      const navigation = options.toc ? reader.getTOC() : reader.getIndex();
      await emit(`${JSON.stringify(navigation, null, 2)}\n`, options.output);
      return;
    }

    const selected = options.toc
      ? navigationSource(reader, 'toc')
      : options.index
        ? navigationSource(reader, 'index')
        : filePath!;
    const info = reader.getFileInfo(selected);
    const range =
      options.range !== undefined
        ? byteRange(options.range, info.size)
        : undefined;
    if (options.stream) {
      await emitStream(
        reader.createReadStream(info.path, range?.[0], range?.[1]),
        options.output,
      );
      return;
    }
    const data = range
      ? reader.readRange(info.path, range[0], range[1])
      : reader.readFile(info.path);
    if (format === 'raw') {
      await emit(data, options.output);
    } else if (format === 'json') {
      await emit(
        `${JSON.stringify(
          {
            path: info.path,
            size: info.size,
            encoding,
            ...(range && { range }),
            content: decode(data, encoding),
          },
          null,
          2,
        )}\n`,
        options.output,
      );
    } else {
      await emit(decode(data, encoding), options.output);
    }
  } finally {
    reader.close();
  }
}

export const read = new Command('read')
  .description('读取 CHM 中的用户文件；raw/stream 输出保持原始字节')
  .argument('<input>', 'CHM 文件路径')
  .argument('[file-path]', '归档内的文件路径')
  .option('-l, --list', '列出普通用户文件')
  .option('--toc', '读取 #SYSTEM 指定的 .hhc 源内容；json 输出结构化目录')
  .option('--index', '读取 #SYSTEM 指定的 .hhk 源内容；json 输出结构化索引')
  .option('-o, --output <file>', '写入文件而不是 stdout')
  .option('-f, --format <format>', '输出格式：text、json、raw', 'text')
  .option(
    '-e, --encoding <encoding>',
    '文本/JSON 编码（如 utf8、GBK、utf16le、base64、hex）',
  )
  .option('--range <start:end>', '按需读取字节范围 [start, end)')
  .option('--stream', '按需输出原始字节流，支持 --range/--output，不支持 json')
  .action(
    async (
      input: string,
      filePath: string | undefined,
      options: ReadOptions,
    ) => {
      try {
        await readArchive(input, filePath, options);
      } catch (error) {
        process.stderr.write(
          `Error reading CHM file: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    },
  );

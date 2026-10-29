import type { DirectoryEntry } from '../core/types';
import { CHMHeaderBuilder } from './builders/header-builder';
import { LZXEncoder, LZX_FRAME_SIZE } from './lzx-encoder';

import type { PackFilesOptions } from './types';
export type { PackFilesOptions } from './types';

const STORAGE = '::DataSpace/Storage/MSCompressed/';
const TRANSFORM = '{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}';

/** Normalize archive paths without any filesystem/path dependency. */
export function normalizeArchivePath(name: string): string {
  if (name.replace(/\\/g, '/').startsWith('//'))
    throw new Error(`Network paths are not allowed in CHM paths: ${name}`);
  const normalized = name
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (
    !normalized ||
    normalized.includes('\0') ||
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(
      normalized,
    )
  ) {
    throw new Error(`Invalid CHM path: ${name}`);
  }
  if (normalized.split('/').some(part => part === '.' || part === '..')) {
    throw new Error(
      `Relative path components are not allowed in CHM paths: ${name}`,
    );
  }
  if (normalized.startsWith('::') || /^[#$]/.test(normalized)) {
    throw new Error(`Reserved CHM path: ${name}`);
  }
  const components = normalized.replace(/\/$/, '').split('/');
  if (
    /[:<>"|?*]/.test(normalized) ||
    Array.from(normalized).some(character => character.charCodeAt(0) < 32) ||
    components.some(
      part =>
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(
          part.split('.')[0]!.replace(/[. ]+$/, ''),
        ),
    )
  )
    throw new Error(`Non-portable CHM path: ${name}`);
  return `/${normalized}`;
}

const pathKey = (name: string): string => name.normalize('NFC').toLowerCase();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function topicURL(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function sitemap(files: ReadonlyMap<string, Buffer>): Buffer {
  const items = [...files]
    .filter(([name]) => /\.html?$/i.test(name))
    .map(([name, data]) => {
      const title =
        data.toString('utf8').match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ||
        name.slice(1);
      return `<LI><OBJECT type="text/sitemap"><param name="Name" value="${escapeHtml(title)}"><param name="Local" value="${escapeHtml(topicURL(name.slice(1)))}"></OBJECT></LI>`;
    });
  return Buffer.from(
    `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN">\n<HTML><HEAD><meta charset="utf-8"></HEAD><BODY><UL>\n${items.join('\n')}\n</UL></BODY></HTML>`,
    'utf8',
  );
}

function nameList(compression: boolean): Buffer {
  const names = compression
    ? ['Uncompressed', 'MSCompressed']
    : ['Uncompressed'];
  const parts = names.map(name => {
    const data = Buffer.from(`${name}\0`, 'utf16le');
    const length = Buffer.alloc(2);
    length.writeUInt16LE(name.length);
    return Buffer.concat([length, data]);
  });
  const buffer = Buffer.concat([Buffer.alloc(4), ...parts]);
  buffer.writeUInt16LE(buffer.length / 2, 0);
  buffer.writeUInt16LE(names.length, 2);
  return buffer;
}

function systemMetadata(
  title: string,
  defaultTopic: string,
  contents: string,
  index: string,
): Buffer {
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3);
  const records = [
    [0, contents],
    [1, index],
    [2, defaultTopic],
    [3, title],
    [9, 'chmkit'],
  ] as const;
  const parts: Buffer[] = [version];
  for (const [code, text] of records) {
    if (text.includes('\0'))
      throw new Error('CHM metadata cannot contain NUL characters');
    const data = Buffer.from(`${text}\0`, 'utf8');
    if (data.length > 0xffff)
      throw new Error('CHM metadata value exceeds 65535 bytes');
    const header = Buffer.alloc(4);
    header.writeUInt16LE(code, 0);
    header.writeUInt16LE(data.length, 2);
    parts.push(header, data);
  }
  const properties = Buffer.alloc(40);
  properties.writeUInt16LE(4, 0);
  properties.writeUInt16LE(36, 2);
  properties.writeUInt32LE(0x409, 4);
  parts.push(properties);
  return Buffer.concat(parts);
}

/**
 * Pure in-memory, browser-friendly CHM writer. Keys ending in '/' represent
 * directories and must have empty data. User files are never silently replaced.
 * Compression uses lossless LZX VERBATIM/LZ77/Huffman; incompressible frames
 * fall back to stored blocks. Fixed trees favor reliability over optimal ratios.
 */
export function packFiles(
  files: ReadonlyMap<string, Uint8Array>,
  options: PackFilesOptions = {},
): Buffer {
  const input = new Map<string, Buffer>();
  const names = new Set<string>();
  for (const [name, data] of files) {
    const normalized = normalizeArchivePath(name);
    if (names.has(pathKey(normalized))) {
      throw new Error(`Duplicate CHM path (case-insensitive): ${name}`);
    }
    if (normalized.endsWith('/') && data.length)
      throw new Error(`Directory has content: ${name}`);
    names.add(pathKey(normalized));
    input.set(normalized, Buffer.from(data));
  }
  // Reject file/directory conflicts instead of producing an unextractable file.
  for (const name of input.keys()) {
    const components = name.slice(1).split('/');
    components.pop();
    let parent = '';
    for (const component of components) {
      parent += `/${component}`;
      if (names.has(pathKey(parent)))
        throw new Error(`File is also a parent directory: ${parent}`);
      if (!names.has(pathKey(`${parent}/`))) {
        names.add(pathKey(`${parent}/`));
        input.set(`${parent}/`, Buffer.alloc(0));
      }
    }
    if (name.endsWith('/') && names.has(pathKey(name.slice(0, -1)))) {
      throw new Error(`File/directory path conflict: ${name}`);
    }
  }
  const existingContents = [...input.keys()].find(name => /\.hhc$/i.test(name));
  const existingIndex = [...input.keys()].find(name => /\.hhk$/i.test(name));
  const navigation = sitemap(input);
  function addNavigation(preferred: string): string {
    let name = `/${preferred}`;
    let suffix = 1;
    while (names.has(pathKey(name)) || names.has(pathKey(`${name}/`))) {
      name = `/chmkit-${suffix++}-${preferred}`;
    }
    input.set(name, navigation);
    names.add(pathKey(name));
    return name;
  }
  const contents = existingContents ?? addNavigation('Table of Contents.hhc');
  const index = existingIndex ?? addNavigation('Index.hhk');
  const defaultTopic =
    options.defaultTopic === undefined
      ? topicURL(
          (
            [...input.keys()].find(name => /^\/index\.html?$/i.test(name)) ??
            [...input.keys()].find(name => /\.html?$/i.test(name)) ??
            ''
          ).replace(/^\//, ''),
        )
      : options.defaultTopic.replace(/\\/g, '/').replace(/^\/+/, '');
  if (defaultTopic) {
    const path = defaultTopic.split(/[?#]/)[0]!;
    let normalized = normalizeArchivePath(path);
    if (!names.has(pathKey(normalized))) {
      try {
        normalized = normalizeArchivePath(decodeURIComponent(path));
      } catch {
        throw new Error(`Invalid default topic: ${defaultTopic}`);
      }
    }
    if (normalized.endsWith('/') || !names.has(pathKey(normalized)))
      throw new Error(
        `Default topic does not name a file in the archive: ${defaultTopic}`,
      );
  }
  const compressed = options.compression !== false;
  const entries: DirectoryEntry[] = [];
  const section0: Buffer[] = [];
  let section0Size = 0;
  function addUncompressed(name: string, data: Buffer): void {
    entries.push({
      name,
      section: 0,
      isCompressed: false,
      offset: section0Size,
      length: data.length,
    });
    section0.push(data);
    section0Size += data.length;
  }
  addUncompressed(
    '/#SYSTEM',
    systemMetadata(
      options.title ?? 'CHM Help File',
      defaultTopic,
      contents.slice(1),
      index.slice(1),
    ),
  );
  addUncompressed('::DataSpace/NameList', nameList(compressed));
  const stream: Buffer[] = [];
  let streamSize = 0;
  for (const [name, data] of input) {
    if (name.endsWith('/')) {
      entries.push({
        name,
        section: 0,
        isCompressed: false,
        offset: 0,
        length: 0,
      });
    } else if (compressed) {
      entries.push({
        name,
        section: 1,
        isCompressed: true,
        offset: streamSize,
        length: data.length,
        uncompressedLength: data.length,
      });
      stream.push(data);
      streamSize += data.length;
    } else {
      addUncompressed(name, data);
    }
  }
  if (compressed) {
    // 7-Zip computes its minimum ResetTable count as (size + 32769) / 32768,
    // rejecting otherwise valid empty/exact-boundary/32767-byte streams without
    // an optional terminal-offset entry. Keep the conventional one-offset-per-
    // frame table by adding 1–2 real, unreferenced zero bytes to those streams.
    // Both SpanInfo and ResetTable describe these bytes; no file is modified.
    const remainder = streamSize % LZX_FRAME_SIZE;
    const endPadding =
      remainder === 0 ? 1 : remainder === LZX_FRAME_SIZE - 1 ? 2 : 0;
    if (endPadding) {
      stream.push(Buffer.alloc(endPadding));
      streamSize += endPadding;
    }
    const encoder = new LZXEncoder();
    const result = encoder.compress(Buffer.concat(stream, streamSize));
    const config = encoder.getConfig();
    addUncompressed(
      `${STORAGE}ControlData`,
      CHMHeaderBuilder.serializeLZXCHeader(
        CHMHeaderBuilder.createLZXCHeader(config),
      ),
    );
    const span = Buffer.alloc(8);
    span.writeBigUInt64LE(BigInt(streamSize));
    addUncompressed(`${STORAGE}SpanInfo`, span);
    addUncompressed(
      `${STORAGE}Transform/List`,
      Buffer.from('4089c27f319dd0119b2700a0c91e9c7c', 'hex'),
    );
    addUncompressed(
      `${STORAGE}Transform/${TRANSFORM}/InstanceData/ResetTable`,
      result.resetTable,
    );
    addUncompressed(`${STORAGE}Content`, result.compressedData);
  }
  let chunkSize = 4096;
  const longestEntry = entries.reduce(
    (size, entry) => Math.max(size, Buffer.byteLength(entry.name, 'utf8') + 50),
    0,
  );
  while (chunkSize < longestEntry && chunkSize < 0x10000) chunkSize *= 2;
  const directory = CHMHeaderBuilder.serializeDirectory(entries, chunkSize);
  const itsp = CHMHeaderBuilder.serializeITSPHeader(
    CHMHeaderBuilder.createITSPHeader({
      chunkSize,
      numChunks: directory.length / chunkSize,
    }),
  );
  const directoryOffset = 120;
  const directoryLength = itsp.length + directory.length;
  const itsf = CHMHeaderBuilder.serializeITSFHeader(
    CHMHeaderBuilder.createITSFHeader({
      directoryOffset,
      directoryLength,
      contentOffset: directoryOffset + directoryLength,
    }),
  );
  const auxiliary = Buffer.alloc(24);
  auxiliary.writeUInt32LE(0x01fe, 0);
  auxiliary.writeBigUInt64LE(
    BigInt(directoryOffset + directoryLength + section0Size),
    8,
  );
  return Buffer.concat([itsf, auxiliary, itsp, directory, ...section0]);
}

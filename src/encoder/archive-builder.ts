import type { DirectoryEntry } from '../core/types';
import { CHMParser } from '../core/parser/chm-parser';
import { FileReconstructor } from '../core/files/file-reconstructor';
import { BitReader } from '../utils/io/bit-reader';
import { escapeHtml, inferTOC, renderSitemap, topicURL } from './navigation';
import { CHMHeaderBuilder } from './builders/header-builder';
import { LZXEncoder, LZX_FRAME_SIZE } from './lzx-encoder';

import type {
  HTMLHelpMetadata,
  PackFilesOptions,
  UpdateArchiveOptions,
} from './types';
export type { PackFilesOptions, UpdateArchiveOptions } from './types';

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
  languageId: number,
  metadata: HTMLHelpMetadata = {},
): Buffer {
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3);
  const records: [number, string][] = [
    [0, contents],
    [1, index],
    [2, defaultTopic],
    [3, title],
    [9, metadata.compiler ?? 'chmkit'],
  ];
  if (metadata.defaultWindow !== undefined)
    records.push([5, metadata.defaultWindow]);
  if (metadata.compiledFile !== undefined)
    records.push([6, metadata.compiledFile]);
  if (metadata.defaultFont !== undefined)
    records.push([16, metadata.defaultFont]);
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
  properties.writeUInt32LE(languageId, 4);
  parts.push(properties);
  for (const [code, bytes] of metadata.extraRecords ?? []) {
    if (
      !Number.isInteger(code) ||
      code < 0 ||
      code > 0xffff ||
      [0, 1, 2, 3, 4, 5, 6, 9, 16].includes(code)
    )
      throw new Error(`Reserved or invalid HTML Help metadata code: ${code}`);
    if (bytes.length > 0xffff)
      throw new Error('CHM metadata value exceeds 65535 bytes');
    const header = Buffer.alloc(4);
    header.writeUInt16LE(code, 0);
    header.writeUInt16LE(bytes.length, 2);
    parts.push(header, Buffer.from(bytes));
  }
  return Buffer.concat(parts);
}

/** Only private, already-owned maps opt out of byte copying. */
function prepareFiles(
  files: ReadonlyMap<string, Uint8Array>,
  copyBytes = true,
): Map<string, Buffer> {
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
    input.set(
      normalized,
      !copyBytes && Buffer.isBuffer(data) ? data : Buffer.from(data),
    );
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
  return input;
}

function mergeFileChanges(
  files: Map<string, Buffer>,
  changes: ReadonlyMap<string, Uint8Array | null>,
  maxBytes = Infinity,
): Map<string, Buffer> {
  const planned = new Map<string, Uint8Array>(files);
  const replacements: string[] = [];
  const keys = new Map([...files.keys()].map(name => [pathKey(name), name]));
  const changed = new Set<string>();
  const deletedDirectories: string[] = [];
  for (const [name, bytes] of changes) {
    const normalized = normalizeArchivePath(name);
    const key = pathKey(normalized);
    if (changed.has(key)) throw new Error(`Ambiguous update path: ${name}`);
    changed.add(key);
    const original = keys.get(key);
    if (bytes === null) {
      if (!original) throw new Error(`Cannot delete missing CHM path: ${name}`);
      if (original.endsWith('/')) deletedDirectories.push(original);
      planned.delete(original);
    } else {
      const target = original ?? normalized;
      planned.set(target, bytes);
      replacements.push(target);
    }
  }
  for (const directory of deletedDirectories) {
    if (
      [...planned.keys()].some(path =>
        pathKey(path).startsWith(pathKey(directory)),
      )
    )
      throw new Error(`Cannot delete nonempty directory: ${directory}`);
  }
  let total = 0;
  for (const bytes of planned.values()) {
    total += bytes.length;
    if (!Number.isSafeInteger(total))
      throw new Error('CHM payload size exceeds the safe integer range');
    if (total > maxBytes)
      throw new Error(
        'updateArchive resulting payloads exceed the 256 MiB safety limit',
      );
  }
  // Preflight the final batch before copying any overrides; deleting a large
  // file and adding a replacement is independent of map iteration order.
  for (const name of replacements)
    planned.set(name, Buffer.from(planned.get(name)!));
  return prepareFiles(planned, false);
}

/**
 * Reuse HTML/assets as a byte template with whole-file replacements/additions
 * and explicit null deletions. Canonical aliases replace content but retain
 * the template's path spelling; ambiguous overrides and unsafe paths fail.
 * No interpolation, scripts or
 * template expressions are evaluated, and neither input map/buffer is mutated.
 * This is content composition, not HTML sanitization.
 */
export function packTemplate(
  templateFiles: ReadonlyMap<string, Uint8Array>,
  overrides: ReadonlyMap<string, Uint8Array | null>,
  options: PackFilesOptions = {},
): Buffer {
  return packPreparedFiles(
    mergeFileChanges(prepareFiles(templateFiles), overrides),
    options,
  );
}

/**
 * Pure in-memory, browser-friendly CHM writer. Keys ending in '/' represent
 * directories and must have empty data. User files are never silently replaced.
 * Compression selects fixed/adaptive VERBATIM, ALIGNED and stored blocks by
 * encoded cost. Existing authored navigation is never silently replaced.
 */
export function packFiles(
  files: ReadonlyMap<string, Uint8Array>,
  options: PackFilesOptions = {},
): Buffer {
  return packPreparedFiles(prepareFiles(files), options);
}

function packPreparedFiles(
  input: Map<string, Buffer>,
  options: PackFilesOptions,
): Buffer {
  const names = new Set([...input.keys()].map(pathKey));
  // URL resolution is case-insensitive but must retain the actual Unicode
  // spelling: the reader does not treat NFC and NFD URLs as interchangeable.
  const references = new Set([...input.keys()].map(name => name.toLowerCase()));
  function validateLocal(local: string): void {
    validateTopic(local, references);
  }
  function navigationFile(
    option: string | undefined,
    extension: RegExp,
  ): string | undefined {
    if (option === undefined)
      return [...input.keys()].find(name => extension.test(name));
    const normalized = normalizeArchivePath(option);
    const existing = [...input.keys()].find(
      name => pathKey(name) === pathKey(normalized),
    );
    if (!existing || existing.endsWith('/'))
      throw new Error(`Navigation file not found: ${option}`);
    return existing;
  }
  const existingContents = navigationFile(options.contentsFile, /\.hhc$/i);
  const existingIndex = navigationFile(options.indexFile, /\.hhk$/i);
  if (
    options.tocHierarchy !== undefined &&
    !['flat', 'folders'].includes(options.tocHierarchy)
  )
    throw new Error('tocHierarchy must be flat or folders');
  if (
    existingContents &&
    (options.tocEntries !== undefined ||
      options.tocTemplate !== undefined ||
      options.tocHierarchy !== undefined)
  )
    throw new Error(
      'tocEntries/tocTemplate cannot replace an existing contents file; edit that file explicitly',
    );
  function addNavigation(preferred: string, navigation: Buffer): string {
    let name = `/${preferred}`;
    let suffix = 1;
    while (names.has(pathKey(name)) || names.has(pathKey(`${name}/`))) {
      name = `/chmkit-${suffix++}-${preferred}`;
    }
    input.set(name, navigation);
    names.add(pathKey(name));
    references.add(name.toLowerCase());
    return name;
  }
  const contents =
    existingContents ??
    addNavigation(
      'Table of Contents.hhc',
      renderSitemap(
        options.tocEntries ??
          inferTOC(input, options.tocHierarchy === 'folders'),
        validateLocal,
        options.tocTemplate,
      ),
    );
  const index = existingIndex ?? addNavigation('Index.hhk', sitemap(input));
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
  if (defaultTopic) validateTopic(defaultTopic, references);
  const languageId = options.languageId ?? 0x409;
  if (
    !Number.isInteger(languageId) ||
    languageId < 0 ||
    languageId > 0xffffffff
  )
    throw new Error('languageId must be an unsigned 32-bit LCID');
  return serializeArchive(
    input,
    systemMetadata(
      options.title ?? 'CHM Help File',
      defaultTopic,
      contents
        .slice(1)
        .replace(/[%#]/g, character => encodeURIComponent(character)),
      index
        .slice(1)
        .replace(/[%#]/g, character => encodeURIComponent(character)),
      languageId,
      options.htmlHelp,
    ),
    options,
    { languageId },
  );
}

function validateTopic(local: string, names: ReadonlySet<string>): void {
  if (
    typeof local !== 'string' ||
    Array.from(local).some(character => character.charCodeAt(0) < 32)
  )
    throw new Error('Invalid topic URL');
  let path = local.split(/[?#]/)[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Match the reader's literal fallback for invalid URL escapes. */
  }
  const normalized = normalizeArchivePath(path);
  if (normalized.endsWith('/') || !names.has(normalized.toLowerCase()))
    throw new Error(
      `Default topic / navigation Local does not name a file in the archive: ${local}`,
    );
}

function serializeArchive(
  input: ReadonlyMap<string, Buffer>,
  system: Buffer,
  options: UpdateArchiveOptions,
  header: {
    languageId: number;
    timestamp?: number;
    directoryLanguageId?: number;
  },
): Buffer {
  // Validate even when compression=false: unsupported options must not be silently ignored.
  if (
    options.compression !== undefined &&
    typeof options.compression !== 'boolean'
  )
    throw new Error('compression must be a boolean');
  for (const key of [
    'windowBits',
    'resetInterval',
    'blockSize',
    'compressionLevel',
  ] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'number')
      throw new Error(`${key} must be a number`);
  }
  const windowBits = options.windowBits ?? 15;
  if (!Number.isInteger(windowBits) || windowBits < 15 || windowBits > 21)
    throw new Error('windowBits must be an integer from 15 to 21');
  const resetInterval = options.resetInterval ?? LZX_FRAME_SIZE;
  const resetFrames = resetInterval / LZX_FRAME_SIZE;
  if (
    !Number.isSafeInteger(resetInterval) ||
    !Number.isInteger(Math.log2(resetFrames)) ||
    resetFrames < 1 ||
    resetFrames > 8192
  )
    throw new Error(
      'CHM resetInterval must be a power-of-two multiple of 32768, at most 256 MiB',
    );
  const encoder = new LZXEncoder({
    windowSize: 2 ** windowBits,
    resetInterval,
    blockSize: options.blockSize,
    compressionLevel: options.compressionLevel,
  });
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
  addUncompressed('/#SYSTEM', system);
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
    } else if (compressed && !/^\/[#$]/.test(name)) {
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
      languageId: header.directoryLanguageId ?? header.languageId,
    }),
  );
  const directoryOffset = 120;
  const directoryLength = itsp.length + directory.length;
  const itsf = CHMHeaderBuilder.serializeITSFHeader(
    CHMHeaderBuilder.createITSFHeader({
      directoryOffset,
      directoryLength,
      contentOffset: directoryOffset + directoryLength,
      languageId: header.languageId,
      timestamp: header.timestamp,
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

/**
 * Transactional in-memory update: re-encodes transport, preserving all other
 * bytes, authored navigation, #SYSTEM records, LCIDs and timestamp. This is not
 * an in-place binary patch. Compiled topic/search indexes cannot safely be
 * regenerated here and cause an explicit refusal rather than data loss.
 * Reconstructed payloads are limited to 256 MiB. Input, payloads and output
 * remain in memory; authored HHC/HHK links are retained, not repaired.
 */
export function updateArchive(
  existing: Uint8Array,
  changes: ReadonlyMap<string, Uint8Array | null>,
  options: UpdateArchiveOptions = {},
): Buffer {
  const data = Buffer.from(existing);
  const parsed = new CHMParser().parse(new BitReader(data));
  const allowed = new Set([
    'compression',
    'compressionLevel',
    'windowBits',
    'resetInterval',
    'blockSize',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key))
      throw new Error(
        `Unsupported updateArchive option: ${key}; metadata is preserved verbatim`,
      );
  }
  const supplied = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as UpdateArchiveOptions;
  if (changes.size === 0 && Object.keys(supplied).length === 0) return data;
  const infrastructure = new Set(
    [
      '::DataSpace/NameList',
      `${STORAGE}Content`,
      `${STORAGE}ControlData`,
      `${STORAGE}SpanInfo`,
      `${STORAGE}Transform/List`,
      `${STORAGE}Transform/${TRANSFORM}/InstanceData/ResetTable`,
    ].map(pathKey),
  );
  const compressed = parsed.header.lzxc.signature === 'LZXC';
  const span = Buffer.alloc(8);
  span.writeBigUInt64LE(BigInt(parsed.resetTable.uncompressedLength));
  const expectedTransport = new Map([
    [pathKey('::DataSpace/NameList'), nameList(compressed)],
    [
      pathKey(`${STORAGE}Transform/List`),
      Buffer.from('4089c27f319dd0119b2700a0c91e9c7c', 'hex'),
    ],
    [pathKey(`${STORAGE}SpanInfo`), span],
  ]);
  const reconstructor = new FileReconstructor(parsed);
  const user = new Map<string, Buffer>();
  const opaque = new Map<string, Buffer>();
  const allNames = new Set<string>();
  let system: Buffer | undefined;
  let total = 0;
  for (const [name, entry] of parsed.directory.entries) {
    const key = pathKey(name);
    if (allNames.has(key))
      throw new Error(`Ambiguous existing CHM path: ${name}`);
    allNames.add(key);
    if (entry.section !== 0 && entry.section !== 1)
      throw new Error(`Cannot safely update unsupported CHM section: ${name}`);
    if (name.endsWith('/') && entry.length !== 0)
      throw new Error(`Cannot safely update directory with content: ${name}`);
    if (name.startsWith('::')) {
      const expected = expectedTransport.get(key);
      if (
        expected &&
        (entry.length !== expected.length ||
          !reconstructor
            .reconstructFile(name, new BitReader(data))
            .data.equals(expected))
      )
        throw new Error(
          `Cannot safely update nonstandard CHM transport metadata: ${name}`,
        );
      if (key === pathKey(`${STORAGE}ControlData`) && entry.length > 28)
        throw new Error(
          `Cannot safely update extended LZX ControlData: ${name}`,
        );
      if (
        infrastructure.has(key) ||
        (name.endsWith('/') &&
          [...infrastructure].some(path => path.startsWith(key)))
      )
        continue;
      throw new Error(
        `Cannot safely update unknown CHM DataSpace stream: ${name}`,
      );
    }
    if (
      /^\/(?:\$|#(?:TOPICS|STRINGS|URLTBL|URLSTR|TOCIDX|IDXHDR|FIftiMain|ITBITS|WINDOWS)(?:$|\/))/i.test(
        name,
      )
    )
      throw new Error(
        `Cannot safely update compiled HTML Help indexes/structures: ${name}`,
      );
    total += entry.length;
    if (!Number.isSafeInteger(total) || total > 256 * 1024 * 1024)
      throw new Error(
        'updateArchive reconstructed content exceeds 256 MiB safety limit',
      );
    const bytes =
      entry.length === 0
        ? Buffer.alloc(0)
        : reconstructor.reconstructFile(name, new BitReader(data)).data;
    if (key === '/#system') system = bytes;
    else if (/^\/[#$]/.test(name)) {
      const portable = name.replace(/^\/[#$]/, '/metadata-');
      if (normalizeArchivePath(portable) !== portable)
        throw new Error(
          `Cannot safely preserve nonportable metadata path: ${name}`,
        );
      opaque.set(name, bytes);
    } else user.set(name, bytes);
  }
  if (!system || system.length < 4)
    throw new Error('Cannot update archive without valid #SYSTEM metadata');
  prepareFiles(
    new Map(
      [...opaque].map(([name, bytes]) => [
        name.replace(/^\/[#$]/, '/metadata-'),
        bytes,
      ]),
    ),
    false,
  );
  const metadataBytes =
    system.length +
    [...opaque.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  const input = mergeFileChanges(
    prepareFiles(user, false),
    changes,
    256 * 1024 * 1024 - metadataBytes,
  );
  const names = new Set([...input.keys()].map(name => name.toLowerCase()));
  // Retain every record byte (including unknown records and legacy strings).
  // References must remain valid; never silently choose another default/nav.
  for (let offset = 4; offset < system.length;) {
    if (offset + 4 > system.length) throw new Error('Truncated #SYSTEM record');
    const code = system.readUInt16LE(offset);
    const length = system.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + length > system.length)
      throw new Error('Truncated #SYSTEM value');
    if (code <= 2 && length > 0) {
      const bytes = system.subarray(offset, offset + length);
      let local: string;
      try {
        local = new TextDecoder('utf-8', { fatal: true })
          .decode(bytes)
          .replace(/\0[\s\S]*$/, '');
      } catch {
        throw new Error(
          'Cannot safely validate legacy-encoded #SYSTEM navigation references',
        );
      }
      if (local) validateTopic(local, names);
    }
    offset += length;
  }
  for (const [name, bytes] of opaque) input.set(name, bytes);
  return serializeArchive(
    input,
    system,
    {
      compression: compressed,
      ...(compressed
        ? {
            windowBits: Math.log2(parsed.header.lzxc.windowSize),
            resetInterval: parsed.header.lzxc.resetInterval,
          }
        : {}),
      ...supplied,
    },
    {
      languageId: parsed.header.itsf.languageId,
      directoryLanguageId: data.readUInt32LE(
        parsed.header.itsf.directoryOffset + 48,
      ),
      timestamp: parsed.header.itsf.timestamp,
    },
  );
}

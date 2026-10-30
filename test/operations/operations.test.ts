import { test, beforeEach, afterEach, vi } from 'vitest';
import { deepStrictEqual as equal, ok, rejects } from 'node:assert/strict';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, parse, relative, sep } from 'path';
import type { ParsedCHM } from '../../src/core/types';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { CHMParserValidator } from '../../src/core/parser/parser-validator';
import { MemoryByteSource } from '../../src/core/files/byte-source';
import { FileByteSource } from '../../src/reader/file-byte-source';
import { ParserOperations } from '../../src/operations/parser';
import { ExtractorOperations } from '../../src/operations/extractor';
import { FileManagerOperations } from '../../src/operations/file-manager';
import { InfoOperations } from '../../src/operations/info';

let root: string;
let archive: string;
let parsed: ParsedCHM;
const originalParse = ParserOperations.parse;
const payload = Buffer.from('hello');

function entry(name: string, length = payload.length, section = 0) {
  return { name, length, section, offset: 0, isCompressed: section === 1 };
}

// Independent minimal ITSF v3 + ITSP + empty PMGL + section-0 payload.
// Do not use the production packer: its path validation must not remove our
// deliberately malformed names before extractor destination checks run.
function minimalInput(): Buffer {
  const directoryOffset = 128;
  const directoryLength = 84 + 512;
  const base = directoryOffset + directoryLength;
  const bytes = Buffer.alloc(base + payload.length);
  bytes.write('ITSF');
  bytes.writeUInt32LE(3, 4);
  bytes.writeUInt32LE(96, 8);
  Buffer.from(
    '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec',
    'hex',
  ).copy(bytes, 24);
  bytes.writeBigUInt64LE(96n, 56);
  bytes.writeBigUInt64LE(24n, 64);
  bytes.writeBigUInt64LE(BigInt(directoryOffset), 72);
  bytes.writeBigUInt64LE(BigInt(directoryLength), 80);
  bytes.writeBigUInt64LE(BigInt(base), 88);
  const itsp = bytes.subarray(directoryOffset, directoryOffset + 84);
  itsp.write('ITSP');
  itsp.writeUInt32LE(1, 4);
  itsp.writeUInt32LE(84, 8);
  itsp.writeUInt32LE(10, 12);
  itsp.writeUInt32LE(512, 16);
  itsp.writeUInt32LE(2, 20);
  itsp.writeUInt32LE(1, 24);
  itsp.writeInt32LE(-1, 28);
  itsp.writeUInt32LE(0xffffffff, 40);
  itsp.writeUInt32LE(1, 44);
  Buffer.from('6a92025d2e21d0119df900a0c922e6ec', 'hex').copy(itsp, 52);
  const leaf = bytes.subarray(directoryOffset + 84, base);
  leaf.write('PMGL');
  leaf.writeUInt32LE(512 - 20, 4);
  leaf.writeInt32LE(-1, 12);
  leaf.writeInt32LE(-1, 16);
  payload.copy(bytes, base);
  return bytes;
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'chm-operations-'));
  archive = join(root, 'input.chm');
  const input = minimalInput();
  await fs.writeFile(archive, input);
  const parseSource = CHMParser.prototype.parseSource;
  parsed = new CHMParser().parseSource(new MemoryByteSource(input));
  // Still parse real bytes from the new extractor's real file-backed source.
  // Inject only the directory boundary so NULs/case collisions (which a real
  // format parser rejects) can independently exercise extractor defenses.
  vi.spyOn(CHMParser.prototype, 'parseSource').mockImplementation(function (
    this: CHMParser,
    source,
  ) {
    ok(source instanceof FileByteSource);
    parseSource.call(this, source);
    return parsed;
  });
  vi.spyOn(CHMParserValidator, 'validate').mockReturnValue(true);
  // FileManager/Info retain their separate parsed-data test boundary.
  ParserOperations.parse = async () => parsed;
});

afterEach(async () => {
  vi.restoreAllMocks();
  ParserOperations.parse = originalParse;
  await fs.rm(root, { recursive: true, force: true });
});

function files(...names: string[]) {
  for (const name of names) parsed.directory.entries.set(name, entry(name));
}

test('extraction skips directories and system streams but writes empty user files', async () => {
  files(
    '/',
    '/docs/',
    '::DataSpace/Storage/MSCompressed/Content',
    '/#SYSTEM',
    '/$OBJINST',
    '/docs/a.txt',
  );
  parsed.directory.entries.set('/empty.txt', entry('/empty.txt', 0));
  const output = join(root, 'output');
  const result = await ExtractorOperations.extract(archive, output, {
    preserveStructure: true,
  });
  equal(result.errors, []);
  equal(result.totalFiles, 2);
  equal(await fs.readFile(join(output, 'docs/a.txt')), payload);
  equal((await fs.stat(join(output, 'empty.txt'))).size, 0);
  equal((await fs.readdir(output)).sort(), ['docs', 'empty.txt']);
});

test('extraction validates existing filesystem roots without attempting to create them', async () => {
  files('/safe.txt');
  const mkdir = vi.spyOn(fs, 'mkdir');
  try {
    const output = join(root, 'nested', 'output');
    const result = await ExtractorOperations.extract(archive, output);
    equal(result.errors, []);
    equal(await fs.readFile(join(output, 'safe.txt')), payload);
    equal(
      mkdir.mock.calls.some(([directory]) => directory === parse(root).root),
      false,
    );
  } finally {
    mkdir.mockRestore();
  }
});

test('unsafe paths fail independently before reconstruction or directory creation', async () => {
  const bad = [
    '../escape.txt',
    '/../../escape.txt',
    '//server/share.txt',
    'C:/drive.txt',
    '/C:/drive.txt',
    'C:drive.txt',
    'docs\\escape.txt',
    '/docs/../escape.txt',
    'bad\0name.txt',
  ];
  files(...bad, '/safe.txt');
  for (const preserveStructure of [true, false]) {
    const output = join(root, preserveStructure ? 'structured' : 'flat');
    const result = await ExtractorOperations.extract(archive, output, {
      preserveStructure,
    });
    equal(result.files, ['/safe.txt']);
    equal(result.errors.length, bad.length);
    equal(await fs.readdir(output), ['safe.txt']);
  }
  equal((await fs.readdir(root)).sort(), ['flat', 'input.chm', 'structured']);
});

test('excessively deep archive paths fail per-file before prefix expansion or mkdir, even when flattened', async () => {
  const deep = `/${'d/'.repeat(1024)}file.txt`;
  files(deep, '/safe.txt');
  const output = join(root, 'deep');
  const result = await ExtractorOperations.extract(archive, output, {
    concurrency: 2,
  });
  equal(result.files, ['/safe.txt']);
  equal(result.errors.length, 1);
  equal(await fs.readdir(output), ['safe.txt']);
});

test('prefix conflicts are deterministic in both archive orders under parallel extraction', async () => {
  for (const names of [
    ['/a', '/a/b.txt'],
    ['/a/b.txt', '/a'],
  ]) {
    parsed.directory.entries.clear();
    files(...names, '/safe.txt');
    const output = join(root, names[0] === '/a' ? 'file-first' : 'dir-first');
    const result = await ExtractorOperations.extract(archive, output, {
      preserveStructure: true,
      concurrency: 3,
    });
    equal(result.files, [names[0], '/safe.txt']);
    equal(result.errors.length, 1);
  }
});

test('Windows ADS, device names, trailing dots/spaces and invalid characters are rejected before flattening', async () => {
  const bad = [
    '/protected.txt:stream',
    '/protected.txt::$DATA',
    '/protected.txt.',
    '/protected.txt ',
    '/docs./a.txt',
    '/docs /a.txt',
    '/CON',
    '/con.txt',
    '/NUL.bin',
    '/aux/a.txt',
    '/PRN.log',
    '/COM1.txt',
    '/lpt9/a.txt',
    '/COM¹.txt',
    '/LPT²/a.txt',
    '/CoN .txt',
    '/CONIN$',
    '/conout$.log',
    '/bad<name.txt',
    '/bad>name.txt',
    '/bad"name.txt',
    '/bad|name.txt',
    '/bad?name.txt',
    '/bad*name.txt',
  ];
  files(...bad, '/safe.txt', '/com10.txt', '/console.txt');
  for (const preserveStructure of [true, false]) {
    const output = join(root, preserveStructure ? 'structured' : 'flat');
    await fs.mkdir(output);
    await fs.writeFile(join(output, 'protected.txt'), 'original');
    const result = await ExtractorOperations.extract(archive, output, {
      preserveStructure,
    });
    equal(result.errors.length, bad.length);
    equal(result.files, ['/safe.txt', '/com10.txt', '/console.txt']);
    equal(await fs.readFile(join(output, 'protected.txt'), 'utf8'), 'original');
    equal((await fs.readdir(output)).sort(), [
      'com10.txt',
      'console.txt',
      'protected.txt',
      'safe.txt',
    ]);
  }
});

test('leading CHM slash is anchored to the extraction root, never the filesystem root', async () => {
  const absolute = join(root, 'outside.txt');
  const archivePath = `/${relative(parse(root).root, absolute).split(sep).join('/')}`;
  files(archivePath);
  const output = join(root, 'output');
  const result = await ExtractorOperations.extract(archive, output, {
    preserveStructure: true,
  });
  equal(result.errors, []);
  equal(await fs.readFile(join(output, archivePath.slice(1))), payload);
  await rejects(fs.stat(absolute));
});

test('flatten detects duplicate basenames and never overwrites existing files', async () => {
  files('/one/same.txt', '/two/same.txt', '/ok.txt', '/existing.txt');
  const output = join(root, 'output');
  await fs.mkdir(output);
  await fs.writeFile(join(output, 'existing.txt'), 'original');
  const result = await ExtractorOperations.extract(archive, output, {
    preserveStructure: false,
  });
  ok(result.errors.length >= 2);
  equal(await fs.readFile(join(output, 'same.txt')), payload);
  equal(await fs.readFile(join(output, 'existing.txt'), 'utf8'), 'original');
  equal(await fs.readdir(output), ['existing.txt', 'ok.txt', 'same.txt']);
});

test('user filters never expose system streams or directory entries', async () => {
  files(
    '/docs/',
    '/#SYSTEM',
    '::DataSpace/NameList',
    '/docs/a.txt',
    '/docs/b.css',
  );
  const seen: string[] = [];
  const result = await ExtractorOperations.extract(
    archive,
    join(root, 'filtered'),
    {
      filter: name => {
        seen.push(name);
        return name.endsWith('.txt');
      },
    },
  );
  equal(seen, ['/docs/a.txt', '/docs/b.css']);
  equal(result.files, ['/docs/a.txt']);
  equal(result.totalFiles, 1);
  equal(await FileManagerOperations.listFiles(archive), [
    '/docs/a.txt',
    '/docs/b.css',
  ]);
});

test('file versus directory destination conflicts cannot overwrite', async () => {
  files('/a', '/a/b.txt', '/safe.txt');
  const output = join(root, 'output');
  const result = await ExtractorOperations.extract(archive, output, {
    preserveStructure: true,
  });
  equal(result.files, ['/a', '/safe.txt']);
  equal(result.errors.length, 1);
  equal(await fs.readFile(join(output, 'a')), payload);
});

test('case-folded destination collisions cannot overwrite', async () => {
  files('/A.txt', '/a.txt');
  const result = await ExtractorOperations.extract(
    archive,
    join(root, 'output'),
  );
  equal(result.files.length, 1);
  equal(result.errors.length, 1);
});

test('rejects output root symlinks, including dangling links', async () => {
  files('/safe.txt');
  const outside = join(root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, join(root, 'link'), 'dir');
  await fs.symlink(join(root, 'missing'), join(root, 'dangling'), 'dir');
  await rejects(
    ExtractorOperations.extract(archive, join(root, 'link')),
    /符号链接/,
  );
  await rejects(ExtractorOperations.extract(archive, join(root, 'dangling')));
  await rejects(
    ExtractorOperations.extract(archive, join(root, 'link/nested')),
  );
  equal(await fs.readdir(outside), []);
  await rejects(fs.stat(join(outside, 'nested')));
});

test('rejects parent and leaf symlinks without writing outside the root', async () => {
  files('/docs/a.txt', '/leaf.txt', '/safe.txt');
  const output = join(root, 'output');
  const outside = join(root, 'outside');
  await fs.mkdir(output);
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, 'target.txt'), 'unchanged');
  await fs.symlink(outside, join(output, 'docs'), 'dir');
  await fs.symlink(
    join(outside, 'target.txt'),
    join(output, 'leaf.txt'),
    'file',
  );
  const result = await ExtractorOperations.extract(archive, output, {
    preserveStructure: true,
  });
  equal(result.files, ['/safe.txt']);
  equal(result.errors.length, 2);
  equal(await fs.readdir(outside), ['target.txt']);
  equal(await fs.readFile(join(outside, 'target.txt'), 'utf8'), 'unchanged');
});

test('exists and read use the same normalized case-insensitive lookup', async () => {
  files('/Docs/Hello.txt');
  ok(await FileManagerOperations.exists(archive, 'docs\\HELLO.TXT'));
  equal(
    await FileManagerOperations.readFile(archive, 'docs\\HELLO.TXT'),
    payload,
  );
  equal(await FileManagerOperations.exists(archive, 'missing.txt'), false);
  await rejects(FileManagerOperations.readFile(archive, 'missing.txt'));
});

test('info uses user lengths and the physical compressed Content stream only once', async () => {
  files('/plain.txt');
  parsed.directory.entries.set(
    '/compressed.txt',
    entry('/compressed.txt', 1000, 1),
  );
  parsed.directory.entries.set(
    '::DataSpace/Storage/MSCompressed/Content',
    entry('::DataSpace/Storage/MSCompressed/Content', 100),
  );
  parsed.directory.entries.set('/#SYSTEM', entry('/#SYSTEM', 80));
  const info = await InfoOperations.getInfo(archive);
  equal(info.fileCount, 2);
  equal(info.totalSize, 1005);
  equal(info.compressionRatio, (105 / 1005) * 100);
});

test('info falls back to reset-table compressedLength, not section-1 entry.length', async () => {
  parsed.directory.entries.set(
    '/compressed.txt',
    entry('/compressed.txt', 1000, 1),
  );
  parsed.resetTable.compressedLength = 200;
  const info = await InfoOperations.getInfo(archive);
  equal(info.totalSize, 1000);
  equal(info.compressionRatio, 20);
});

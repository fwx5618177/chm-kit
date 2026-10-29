import { test, beforeEach, afterEach, vi } from 'vitest';
import { deepStrictEqual as equal, ok, rejects } from 'node:assert/strict';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, parse, relative, sep } from 'path';
import type { ParsedCHM } from '../../src/core/types';
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

beforeEach(async () => {
  root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'chm-operations-'));
  archive = join(root, 'input.chm');
  await fs.writeFile(archive, payload);
  parsed = {
    header: {
      itsf: {
        signature: 'ITSF',
        version: 3,
        headerLength: 96,
        unknown1: 0,
        timestamp: 0,
        languageId: 0x409,
        unknown2: 0,
        unknown3: 0,
        directoryOffset: 220,
        directoryLength: 4096,
        unknown4: 0,
      },
      itsp: {
        signature: 'ITSP',
        version: 1,
        headerLength: 84,
        unknown1: 0,
        chunkSize: 4096,
        density: 2,
        depth: 1,
        rootIndex: 0,
        firstPMGI: 0,
        lastPMGI: 0,
        unknown2: 0,
      },
      lzxc: {
        signature: 'LZXC',
        version: 2,
        resetInterval: 32768,
        windowSize: 32768,
        cacheSize: 0,
        unknown: 0,
      },
    },
    directory: { entries: new Map(), rootPath: '/' },
    resetTable: {
      version: 2,
      blockCount: 0,
      entrySize: 8,
      tableOffset: 0,
      uncompressedLength: 0,
      compressedLength: 0,
      blockSize: 32768,
      entries: [],
    },
    contentOffset: 0,
  };
  ParserOperations.parse = async () => parsed;
});

afterEach(async () => {
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

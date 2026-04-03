import { test } from 'uvu';
import { equal, ok } from 'uvu/assert';
import { CHMFileManager } from '../../src/core/files/file-manager';
import type { ParsedCHM, CHMDirectory } from '../../src/core/types';

function createMockParsedCHM(): ParsedCHM {
  const directory: CHMDirectory = {
    entries: new Map([
      [
        '/index.html',
        {
          name: '/index.html',
          isCompressed: true,
          offset: 0,
          length: 1000,
          section: 1,
        },
      ],
      [
        '/style.css',
        {
          name: '/style.css',
          isCompressed: false,
          offset: 1000,
          length: 500,
          section: 0,
        },
      ],
      [
        '/images/logo.png',
        {
          name: '/images/logo.png',
          isCompressed: false,
          offset: 1500,
          length: 2000,
          section: 0,
        },
      ],
      [
        '/scripts/app.js',
        {
          name: '/scripts/app.js',
          isCompressed: true,
          offset: 3500,
          length: 800,
          section: 1,
        },
      ],
    ]),
    rootPath: '/',
  };

  return {
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
        depth: 2,
        rootIndex: 0,
        firstPMGI: 0,
        lastPMGI: 0,
        unknown2: 0,
      },
      lzxc: {
        signature: 'LZXC',
        version: 2,
        resetInterval: 0x8000,
        windowSize: 0x8000,
        cacheSize: 0,
        unknown: 0,
      },
    },
    directory,
    resetTable: {
      version: 2,
      blockCount: 0,
      entrySize: 8,
      tableOffset: 0,
      uncompressedLength: 0,
      compressedLength: 0,
      blockSize: 0x8000,
      entries: [],
    },
    contentOffset: 4316,
  };
}

test('CHMFileManager.fileExists should find existing files', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  ok(manager.fileExists('/index.html'));
  ok(manager.fileExists('/style.css'));
  ok(!manager.fileExists('/nonexistent.html'));
});

test('CHMFileManager.getFileInfo should return entry', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const info = manager.getFileInfo('/index.html');
  ok(info !== null);
  equal(info!.length, 1000);
  equal(info!.isCompressed, true);
});

test('CHMFileManager.getFileInfo should return null for missing files', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const info = manager.getFileInfo('/missing.html');
  equal(info, null);
});

test('CHMFileManager.getFileList should return all file names', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const files = manager.getFileList();
  equal(files.length, 4);
  ok(files.includes('/index.html'));
  ok(files.includes('/scripts/app.js'));
});

test('CHMFileManager.getFilesByType should filter by extension', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const htmlFiles = manager.getFilesByType('.html');
  equal(htmlFiles.length, 1);
  equal(htmlFiles[0], '/index.html');

  const cssFiles = manager.getFilesByType('.css');
  equal(cssFiles.length, 1);
});

test('CHMFileManager.findFileEntry should find case-insensitive', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const entry = manager.findFileEntry('/INDEX.HTML');
  ok(entry !== null);
  equal(entry!.name, '/index.html');
});

test('CHMFileManager.findFileEntry should normalize paths', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const entry = manager.findFileEntry('index.html');
  ok(entry !== null);
});

test('CHMFileManager.normalizePath should add leading slash', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  equal(manager.normalizePath('index.html'), '/index.html');
  equal(manager.normalizePath('/index.html'), '/index.html');
});

test('CHMFileManager.normalizePath should fix backslashes', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  equal(manager.normalizePath('images\\logo.png'), '/images/logo.png');
});

test('CHMFileManager.normalizePath should remove duplicate slashes', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  equal(manager.normalizePath('//images///logo.png'), '/images/logo.png');
});

test('CHMFileManager.getFileExtension should return extension', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  equal(manager.getFileExtension('test.html'), 'html');
  equal(manager.getFileExtension('test.CSS'), 'css');
});

test('CHMFileManager.searchFiles should match patterns', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const results = manager.searchFiles('*.html');
  equal(results.length, 1);
  ok(results[0]!.includes('index.html'));
});

test('CHMFileManager.getDirectoryStructure should map dirs', () => {
  const manager = new CHMFileManager(createMockParsedCHM());
  const structure = manager.getDirectoryStructure();
  ok(structure.size > 0);
});

test.run();

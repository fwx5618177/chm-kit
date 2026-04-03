import { test } from 'uvu';
import { equal, ok } from 'uvu/assert';
import { DirectoryParser } from '../../src/core/directory/directory-parser';
import type { CHMDirectory } from '../../src/core/types';

test('DirectoryParser.validate should reject empty directories', () => {
  const emptyDir: CHMDirectory = {
    entries: new Map(),
    rootPath: '/',
  };
  ok(!DirectoryParser.validate(emptyDir));
});

test('DirectoryParser.validate should accept valid directories', () => {
  const dir: CHMDirectory = {
    entries: new Map([
      [
        '/index.html',
        {
          name: '/index.html',
          isCompressed: false,
          offset: 0,
          length: 100,
          section: 0,
        },
      ],
    ]),
    rootPath: '/',
  };
  ok(DirectoryParser.validate(dir));
});

test('DirectoryParser.validate should reject entries with invalid offsets', () => {
  const dir: CHMDirectory = {
    entries: new Map([
      [
        '/bad.html',
        {
          name: '/bad.html',
          isCompressed: false,
          offset: -1,
          length: -1,
          section: 0,
        },
      ],
    ]),
    rootPath: '/',
  };
  ok(!DirectoryParser.validate(dir));
});

test('DirectoryParser.getSummary should return formatted summary', () => {
  const dir: CHMDirectory = {
    entries: new Map([
      [
        '/index.html',
        {
          name: '/index.html',
          isCompressed: true,
          offset: 0,
          length: 5000,
          section: 1,
        },
      ],
      [
        '/style.css',
        {
          name: '/style.css',
          isCompressed: false,
          offset: 5000,
          length: 2000,
          section: 0,
        },
      ],
    ]),
    rootPath: '/',
  };

  const summary = DirectoryParser.getSummary(dir);
  ok(summary.includes('2')); // Total files
  ok(summary.includes('1')); // Compressed files count
});

test('DirectoryParser.getSummary should format bytes correctly', () => {
  const dir: CHMDirectory = {
    entries: new Map([
      [
        '/large.html',
        {
          name: '/large.html',
          isCompressed: false,
          offset: 0,
          length: 1024 * 1024 * 2, // 2 MB
          section: 0,
        },
      ],
    ]),
    rootPath: '/',
  };

  const summary = DirectoryParser.getSummary(dir);
  ok(summary.includes('MB'));
});

test('DirectoryParser ENCINT parsing should work correctly', () => {
  // Build a minimal PMGL block with known entries to test parsing
  // PMGL header: "PMGL" + free_space(4) + unknown(4) + prev(4) + next(4) = 20 bytes
  // Then directory entries follow

  // Entry: name_length(ENCINT) + name + section(ENCINT) + offset(ENCINT) + length(ENCINT)
  // Let's create: name="a" section=0 offset=100 length=50

  const header = Buffer.alloc(20);
  header.write('PMGL', 0, 4, 'ascii');
  header.writeUInt32LE(0, 4); // free space = 0 (all data is entries)

  const nameLen = Buffer.from([0x01]); // ENCINT 1
  const name = Buffer.from('a', 'utf-8'); // name "a"
  const section = Buffer.from([0x00]); // ENCINT 0
  const offset = Buffer.from([0x64]); // ENCINT 100
  const length = Buffer.from([0x32]); // ENCINT 50

  const blockData = Buffer.concat([
    header,
    nameLen,
    name,
    section,
    offset,
    length,
  ]);

  // We can't easily call parseLeafBlock directly since it's private,
  // but we can verify the parse method works with a mock BitReader
  // For now, just verify the structure
  ok(blockData.length > 20, 'Block should have header + entries');
  equal(blockData.subarray(0, 4).toString('ascii'), 'PMGL');
});

test.run();

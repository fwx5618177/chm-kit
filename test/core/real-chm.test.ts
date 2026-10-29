import { test } from 'vitest';
import { deepStrictEqual as equal, ok } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { LZXDecoder } from '../../src/core/lzx/lzx-decoder';
import { BitReader } from '../../src/utils/io/bit-reader';
import type { DirectoryEntry } from '../../src/core/types';
import manifest from '../fixtures/pychm-example/manifest.json';
import { sevenZip } from '../support/sevenzip';

// PyCHM's unmodified normal integration archive, GPL-2.0-or-later.
// Provenance, upstream notices and the independent 7-Zip oracle are vendored
// beside it; this test never downloads or repairs the archive.
const fixture = resolve(__dirname, '../fixtures/pychm-example');
const archivePath = join(fixture, 'example.chm');
const archive = readFileSync(archivePath);
const ARCHIVE_SHA256 =
  '729ecdc2a8c29e9672b0162d07fb01910882ce012bd5f7f1d72ac87f2df9ca54';
const USER_DOCUMENTS = [
  '/Documents/Table of Contents.hhc',
  '/page 1.html',
  '/page 2.html',
];

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeArchive() {
  const parsed = new CHMParser().parse(new BitReader(archive));
  const table = parsed.resetTable;
  const frames = table.entries.map((entry, index) => {
    const start = parsed.contentOffset + entry.compressedLength;
    const end =
      parsed.contentOffset +
      (table.entries[index + 1]?.compressedLength ?? table.compressedLength);
    ok(start >= parsed.contentOffset && start < end && end <= archive.length);
    return archive.subarray(start, end);
  });
  const stream = new LZXDecoder(parsed.header.lzxc).decodeFrames(
    frames,
    table.uncompressedLength,
  );
  const itsf = parsed.header.itsf;
  const base =
    itsf.version === 3
      ? itsf.unknown4
      : itsf.directoryOffset + itsf.directoryLength;
  const exposed = Array.from(parsed.directory.entries.values()).filter(
    entry => !entry.name.startsWith('::') && !entry.name.endsWith('/'),
  );
  function readEntry(entry: DirectoryEntry): Buffer {
    const bytes = entry.section === 1 ? stream : archive;
    const offset = (entry.section === 1 ? 0 : base) + entry.offset;
    const result = bytes.subarray(offset, offset + entry.length);
    equal(result.length, entry.length, entry.name);
    return result;
  }
  return { parsed, frames, stream, exposed, readEntry };
}

/** Independent header probe: LZX bits are MSB-first in little-endian words. */
function firstBlockType(frame: Buffer): number {
  let position = 0;
  function read(bits: number): number {
    let value = 0;
    while (bits-- > 0) {
      const word = frame.readUInt16LE(Math.floor(position / 16) * 2);
      value = value * 2 + ((word >>> (15 - (position % 16))) & 1);
      position++;
    }
    return value;
  }
  if (read(1)) {
    read(16);
    read(16);
  }
  return read(3);
}

function listFiles(root: string, relative = ''): string[] {
  return readdirSync(join(root, relative), { withFileTypes: true })
    .flatMap(item => {
      const file = relative ? `${relative}/${item.name}` : item.name;
      return item.isDirectory() ? listFiles(root, file) : [`/${file}`];
    })
    .sort();
}

test('real CHM: pinned upstream bytes, provenance, licenses and oracle digests', () => {
  equal(archive.length, 10842);
  equal(sha256(archive), ARCHIVE_SHA256);
  equal(manifest.archive.sha256, ARCHIVE_SHA256);
  equal(manifest.source.modified, false);
  equal(manifest.source.license, 'GPL-2.0-or-later');
  const gitBlob = createHash('sha1')
    .update(`blob ${archive.length}\0`)
    .update(archive)
    .digest('hex');
  equal(gitBlob, 'a77d0a403edfc5644dc0219d2418a87f152c686e');
  equal(gitBlob, manifest.source.gitBlobSha1);
  equal(
    sha256(readFileSync(join(fixture, 'LICENSE.upstream'))),
    'ee8ad0da4000f87a54b135a35c2148f318cba67dbba018753b2010db4c652fff',
  );
  equal(
    sha256(readFileSync(join(fixture, 'COPYING'))),
    '669cd20e1d23a23737c7d50e22fc80053ccd94e624920479f8618b0606b022fe',
  );
  equal(
    listFiles(join(fixture, 'expected')),
    manifest.files.map(file => file.name).sort(),
  );
  for (const file of manifest.files) {
    const expected = readFileSync(join(fixture, file.expectedFile));
    equal(expected.length, file.length, file.name);
    equal(sha256(expected), file.sha256, file.name);
  }
  const sums = readFileSync(join(fixture, 'SHA256SUMS'), 'utf8');
  equal(
    sums,
    [
      `${ARCHIVE_SHA256}  example.chm`,
      ...manifest.files.map(file => `${file.sha256}  ${file.expectedFile}`),
      '',
    ].join('\n'),
  );
});

test('real CHM: actual aligned-Huffman LZX and distinct HS0/data/Content origins', () => {
  const { parsed, frames, stream } = decodeArchive();
  equal(parsed.header.itsf.version, 3);
  equal(parsed.header.itsf.headerLength, 0x60);
  equal(parsed.header.itsp.headerLength, 0x54);
  equal(parsed.header.itsf.unknown2, 96);
  equal(parsed.header.itsf.unknown4, 4300);
  equal(parsed.contentOffset, 8702);
  equal(parsed.contentOffset, manifest.archive.contentOffset);
  equal(parsed.directory.entries.size, 25);
  equal(parsed.directory.entries.size, manifest.archive.directoryEntries);
  equal(parsed.header.lzxc.version, 2);
  equal(parsed.header.lzxc.windowSize, 65536);
  equal(parsed.header.lzxc.resetInterval, 65536);
  equal(parsed.resetTable.blockCount, 1);
  equal(parsed.resetTable.compressedLength, 2092);
  equal(parsed.resetTable.uncompressedLength, 13068);
  equal(frames.length, manifest.archive.frameCount);
  equal(frames[0]!.length, manifest.archive.compressedLength);
  equal(stream.length, manifest.archive.uncompressedLength);
  equal(firstBlockType(frames[0]!), 2);
  equal(firstBlockType(frames[0]!), manifest.archive.firstLzxBlockType);
  ok(
    frames[0]!.length < stream.length,
    'Real Huffman compression, not raw storage',
  );
});

test('real CHM: every user document matches independently extracted bytes', () => {
  const { exposed, readEntry } = decodeArchive();
  const users = exposed.filter(entry => !/^\/[#$]/.test(entry.name));
  equal(users.map(entry => entry.name).sort(), USER_DOCUMENTS);
  equal(
    manifest.files.filter(file => file.userDocument).map(file => file.name),
    USER_DOCUMENTS,
  );
  for (const entry of users) {
    const file = manifest.files.find(file => file.name === entry.name)!;
    equal(entry.section, 1, entry.name);
    const actual = readEntry(entry);
    equal(actual, readFileSync(join(fixture, file.expectedFile)), entry.name);
    equal(sha256(actual), file.sha256, entry.name);
  }
});

test('real CHM: every internal resource also matches, including empty section-0 data', () => {
  const { exposed, readEntry } = decodeArchive();
  equal(
    exposed.map(entry => entry.name).sort(),
    manifest.files.map(file => file.name),
  );
  equal(exposed.length, manifest.oracle.files);
  let total = 0;
  for (const entry of exposed) {
    const file = manifest.files.find(file => file.name === entry.name)!;
    const actual = readEntry(entry);
    equal(entry.section, file.section, entry.name);
    equal(entry.offset, file.offset, entry.name);
    equal(entry.length, file.length, entry.name);
    equal(actual, readFileSync(join(fixture, file.expectedFile)), entry.name);
    equal(sha256(actual), file.sha256, entry.name);
    total += actual.length;
  }
  equal(total, 17336);
  equal(total, manifest.oracle.totalBytes);
  const empty = exposed.find(entry => entry.name === '/#ITBITS')!;
  equal(empty.section, 0);
  equal(readEntry(empty), Buffer.alloc(0));
});

(sevenZip ? test : test.skip)(
  'real CHM: fresh 7-Zip t/x output matches every decoded file and checked-in oracle',
  () => {
    const directory = mkdtempSync(join(fixture, '.7zz-check-'));
    try {
      for (const args of [
        ['t', archivePath],
        ['x', '-y', `-o${directory}`, archivePath],
      ]) {
        const result = spawnSync(sevenZip!, args, {
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        if (result.error) throw result.error;
        equal(result.status, 0, result.stdout + result.stderr);
        ok(result.stdout.includes('Everything is Ok'), result.stdout);
      }
      const { exposed, readEntry } = decodeArchive();
      equal(listFiles(directory), exposed.map(entry => entry.name).sort());
      for (const entry of exposed) {
        const fresh = readFileSync(join(directory, entry.name.slice(1)));
        const file = manifest.files.find(file => file.name === entry.name)!;
        equal(fresh, readEntry(entry), entry.name);
        equal(
          fresh,
          readFileSync(join(fixture, file.expectedFile)),
          entry.name,
        );
        equal(sha256(fresh), file.sha256, entry.name);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

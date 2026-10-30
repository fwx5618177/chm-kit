import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CHMArchive, CacheStrategy } from '../../src/reader/chm-archive';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { BitReader } from '../../src/utils/io/bit-reader';
import { ITSFHeaderParser } from '../../src/core/headers/itsf-header';
import {
  consumeStream,
  corpusRoot,
  fixtureBytes,
  manifest,
  normalArchives,
  oracleBytes,
  sha256,
} from './corpus';

function filesBelow(path: string, prefix = ''): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const name = `${prefix}${entry.name}`;
    return entry.isDirectory()
      ? filesBelow(join(path, entry.name), `${name}/`)
      : [name];
  });
}

test('all upstream bytes, notices and independent oracle digests are pinned', () => {
  expect(manifest.oracle.chmKitUsed).toBe(false);
  expect(manifest.oracle.tool).toContain('7-Zip');
  const sums = fixtureBytes('SHA256SUMS').toString('utf8').trim().split('\n');
  expect(sums.length).toBeGreaterThan(700);
  for (const line of sums) {
    const [, hash, path] = /^([a-f0-9]{64}) {2}(.+)$/.exec(line)!;
    expect(sha256(fixtureBytes(path!)), path).toBe(hash);
  }
  for (const notice of manifest.licenses) {
    expect(sha256(fixtureBytes(notice.file))).toBe(notice.sha256);
    expect(notice.sourceUrl).toMatch(/^https:\/\//);
  }
  const expectedPaths: string[] = [];
  for (const archive of manifest.archives) {
    const bytes = fixtureBytes(archive.file);
    expect(bytes.length).toBe(archive.length);
    expect(sha256(bytes)).toBe(archive.sha256);
    expect(archive.modified).toBe(false);
    if (archive.file === 'fpc-3.2.2-fpdoc.chm') {
      expect(archive.sourceCommitUrl).toBeNull();
      expect(archive.binaryBuildCommit).toBeNull();
      expect(archive.documentationSourceUrl).toBe(
        'https://raw.githubusercontent.com/fpc/FPCDocumentation/28a887047f9fa593dff284cb35b938cdb2f86268/fpdoc.tex',
      );
      expect(archive.documentationSourceArchiveUrl).toBe(
        'https://github.com/fpc/FPCDocumentation/archive/28a887047f9fa593dff284cb35b938cdb2f86268.tar.gz',
      );
      expect(archive.downloadUrl).toBe(
        'https://downloads.freepascal.org/fpc/dist/3.2.2/docs/doc-chm.zip',
      );
      expect(archive.container).toEqual({
        sha256:
          'cb9ebc5f333653e6c22bdbcf92ea3390f485db330d5cf9377281af0ed367ab53',
        member: 'help/fpdoc.chm',
        executed: false,
        retained: false,
      });
      expect(archive.provenanceNote).toContain(
        'exact binary build commit is unknown',
      );
    } else {
      expect(archive.sourceCommitUrl).toMatch(/[a-f0-9]{40}/);
    }
    expect(archive.license).not.toBe('');
    expect(fixtureBytes(archive.licenseFile).length).toBeGreaterThan(100);
    if (archive.gitBlobSha1) {
      expect(
        createHash('sha1')
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest('hex'),
      ).toBe(archive.gitBlobSha1);
    }
    for (const file of archive.files) {
      const expected = oracleBytes(file);
      expect(expected.length, file.name).toBe(file.length);
      expect(sha256(expected), file.name).toBe(file.sha256);
      expectedPaths.push(file.expectedFile.replace(/^expected\//, ''));
    }
  }
  expect(filesBelow(join(corpusRoot, 'expected')).sort()).toEqual(
    expectedPaths.sort(),
  );
});

test('official FPC fpdoc retains producer evidence and the nonstandard GUID pair', () => {
  const archive = normalArchives.find(a => a.file === 'fpc-3.2.2-fpdoc.chm')!;
  const bytes = fixtureBytes(archive.file);
  expect(bytes.length).toBe(81579);
  expect(sha256(bytes)).toBe(
    '20d3d4932ae7cca2fa1efa033e9c4e63780788fedc96e9134c53c6f9a9d2c552',
  );
  const pair = '10fd017caa7bd0119e0c00a0c922e6ec'.repeat(2);
  expect(bytes.subarray(0x18, 0x38).toString('hex')).toBe(pair);
  expect(archive.itsfGuidPair).toBe(pair);
  const reader = new BitReader(bytes);
  expect(ITSFHeaderParser.parse(reader)).toMatchObject({
    version: 3,
    headerLength: 96,
    languageId: 0,
    directoryOffset: 120,
    directoryLength: 12372,
    unknown4: 12492,
  });
  expect(reader.position).toBe(96);
  expect(archive.producer?.resource).toBe('/_#_README_#_');
  const producer = archive.files.find(
    f => f.name === archive.producer!.resource,
  )!;
  const text = oracleBytes(producer).toString('ascii');
  expect(text).toBe(archive.producer!.text);
  expect(text).toContain("Free Pascal's chm package 3.3.1");
  expect(archive.files).toHaveLength(138);
  expect(archive.license).toBe('LGPL-2.0-or-later');
});

for (const archive of normalArchives) {
  describe(`unmodified independent corpus: ${archive.file}`, () => {
    const input = fixtureBytes(archive.file);

    test('observed ITSF, directory, window and reset layout', () => {
      const parsed = new CHMParser().parse(new BitReader(input));
      const observed = archive.observed!;
      expect(parsed.header.itsf.version).toBe(observed.itsfVersion);
      expect(parsed.header.itsf.languageId).toBe(observed.languageId);
      expect(parsed.header.itsf.directoryOffset).toBe(observed.directoryOffset);
      expect(parsed.header.itsf.unknown4).toBe(observed.dataOffset);
      expect(parsed.header.lzxc.version).toBe(observed.controlVersion);
      expect(parsed.header.lzxc.windowSize).toBe(observed.windowSize);
      expect(parsed.header.lzxc.resetInterval).toBe(observed.resetInterval);
      expect(parsed.resetTable.blockCount).toBe(observed.frameCount);
      expect(parsed.resetTable.uncompressedLength).toBe(
        observed.uncompressedLength,
      );
      expect(parsed.contentOffset).toBe(observed.contentOffset);
      const firstWord = input.readUInt16LE(observed.contentOffset);
      const intelHeader = (firstWord & 0x8000) !== 0;
      expect(intelHeader).toBe(observed.intelHeader);
      const blockWord = input.readUInt16LE(
        observed.contentOffset + (intelHeader ? 4 : 0),
      );
      expect((blockWord >>> 12) & 7).toBe(observed.firstLzxBlockType);
      // Include metadata resources; only directory markers and DataSpace
      // implementation streams are outside 7-Zip's extractable resource set.
      const resources = [...parsed.directory.entries.keys()]
        .filter(name => !name.endsWith('/') && !name.startsWith('::'))
        .sort();
      expect(resources).toEqual(archive.files.map(file => file.name).sort());
      for (const file of archive.files) {
        expect(parsed.directory.entries.get(file.name)).toMatchObject({
          name: file.name,
          section: file.section,
          offset: file.offset,
          length: file.length,
        });
      }
    });

    test('every document and internal resource equals independent 7-Zip bytes', () => {
      const reader = new CHMArchive(input, { maxCacheBytes: 128 * 1024 });
      try {
        const users = archive.files
          .filter(file => !/^\/[#$]/.test(file.name))
          .map(file => file.name)
          .sort();
        expect(reader.listFiles()).toEqual(users);
        for (const file of archive.files) {
          const bytes = reader.readFile(file.name);
          expect(bytes, file.name).toEqual(oracleBytes(file));
          expect(sha256(bytes), file.name).toBe(file.sha256);
        }
        expect(reader.getCacheStats().bytes).toBeLessThanOrEqual(128 * 1024);
      } finally {
        reader.close();
      }
    });

    test('cold ranges/streams cross physical frame and reset boundaries', async () => {
      const reader = new CHMArchive(input, {
        cacheStrategy: CacheStrategy.None,
        maxCacheBytes: 0,
      });
      const selected = [...archive.files]
        .filter(file => file.section === 1 && file.length > 0)
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);
      expect(selected.length).toBe(3);
      try {
        for (const file of selected) {
          const expected = oracleBytes(file);
          const ranges: [number, number][] = [
            [0, Math.min(37, file.length)],
            [file.length, file.length],
            [Math.max(0, file.length - 97), file.length],
          ];
          for (const step of [32768, archive.observed!.resetInterval]) {
            for (
              let boundary = Math.ceil((file.offset + 1) / step) * step;
              boundary < file.offset + file.length;
              boundary += step
            ) {
              const local = boundary - file.offset;
              ranges.push([
                Math.max(0, local - 19),
                Math.min(file.length, local + 43),
              ]);
            }
          }
          for (const [start, end] of ranges) {
            expect(reader.readRange(file.name, start, end), file.name).toEqual(
              expected.subarray(start, end),
            );
            await consumeStream(
              reader.createReadStream(file.name, start, end),
              expected.subarray(start, end),
            );
          }
          await consumeStream(reader.createReadStream(file.name), expected);
        }
        expect(reader.getCacheStats().bytes).toBe(0);
      } finally {
        reader.close();
      }
    });

    test('materialization and range resource limits fail rather than clamp', async () => {
      const file = [...archive.files].sort((a, b) => b.length - a.length)[0]!;
      const reader = new CHMArchive(input, {
        maxFileSize: 1024,
        maxCacheBytes: 0,
        cacheStrategy: CacheStrategy.None,
      });
      try {
        expect(file.length).toBeGreaterThan(1024);
        expect(() => reader.readFile(file.name)).toThrow(/limit|exceed|size/i);
        expect(() => reader.readRange(file.name, 0, 1025)).toThrow();
        for (const [start, end] of [
          [-1, 0],
          [0, file.length + 1],
          [2, 1],
          [NaN, 1],
          [0, Infinity],
        ]) {
          expect(() => reader.readRange(file.name, start, end)).toThrow();
          expect(() =>
            reader.createReadStream(file.name, start, end),
          ).toThrow();
        }
        await consumeStream(
          reader.createReadStream(file.name),
          oracleBytes(file),
          1024,
        );
      } finally {
        reader.close();
      }
    });
  });
}

test('HTML charset decoding follows real producer bytes, not language ID alone', () => {
  for (const [name, encoding] of [
    ['putty-0.83.chm', 'ascii'],
    ['inno-myprog.chm', 'utf-8'],
    ['7zip-23.01.chm', 'windows-1252'],
  ]) {
    const archive = normalArchives.find(a => a.file === name)!;
    const file = archive.files.find(f => /\.html?$/.test(f.name))!;
    const reader = new CHMArchive(fixtureBytes(archive.file));
    try {
      expect(reader.readHTML(file.name)).toBe(
        new TextDecoder(encoding).decode(oracleBytes(file)),
      );
    } finally {
      reader.close();
    }
  }
});

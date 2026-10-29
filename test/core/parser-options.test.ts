import { test } from 'vitest';
import { deepStrictEqual as equal, ok, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { CHMParserFactory } from '../../src/core/parser/parser-factory';
import { CHMParserValidator } from '../../src/core/parser/parser-validator';
import { CHMStatisticsGenerator } from '../../src/core/parser/statistics-generator';
import { CHMFileStatistics } from '../../src/core/files/file-statistics';
import { CHMFileManager } from '../../src/core/files/file-manager';
import type { ParsedCHM } from '../../src/core/types';
import { BitReader } from '../../src/utils/io/bit-reader';
import { packFiles } from '../../src/encoder/archive-builder';

const archive = readFileSync(
  resolve(__dirname, '../fixtures/pychm-example/example.chm'),
);
const STORAGE = '::dataspace/storage/mscompressed/';
const original = () => new CHMParser().parse(new BitReader(archive));
const section0Archive = () =>
  packFiles(
    new Map([
      ['index.html', Buffer.from('<h1>Test</h1>')],
      ['empty.txt', Buffer.alloc(0)],
    ]),
    { compression: false },
  );

function entry(parsed: ParsedCHM, suffix: string) {
  return Array.from(parsed.directory.entries.values()).find(
    item => item.name.toLowerCase() === `${STORAGE}${suffix}`,
  )!;
}

function corruptControlData(): Buffer {
  const parsed = original();
  const buffer = Buffer.from(archive);
  buffer.write(
    'NOPE',
    parsed.header.itsf.unknown4 + entry(parsed, 'controldata').offset + 4,
  );
  return buffer;
}

function corruptResetTable(): Buffer {
  const parsed = original();
  const buffer = Buffer.from(archive);
  const reset = Array.from(parsed.directory.entries.values()).find(item =>
    item.name.endsWith('/ResetTable'),
  )!;
  buffer.writeUInt32LE(999, parsed.header.itsf.unknown4 + reset.offset);
  return buffer;
}

test('factory validates option types, rejects unsupported/unsafe options explicitly', () => {
  throws(
    () => CHMParserFactory.createWithOptions({ enableResetTable: false }),
    /not supported/,
  );
  for (const options of [
    null,
    [],
    true,
    1,
    'strict',
    { strictValidation: 'true' },
    { strictValidation: 1 },
    { enableResetTable: 0 },
    { enableResetTable: 'false' },
    { strictValidaton: true },
    { deep: true },
    JSON.parse('{"__proto__":{"strictValidation":true}}'),
    Object.create({ strictValidation: true }),
  ]) {
    throws(() => CHMParserFactory.createWithOptions(options as never));
  }
  const options = Object.freeze({
    enableResetTable: true,
    strictValidation: true,
  });
  ok(CHMParserFactory.createWithOptions(options) instanceof CHMParser);
  equal(options, { enableResetTable: true, strictValidation: true });
});

test('factory defaults, strict and lightweight parsers retain correct compressed parsing', () => {
  const expected = original();
  for (const parser of [
    CHMParserFactory.create(),
    CHMParserFactory.createWithOptions(),
    CHMParserFactory.createWithOptions({ strictValidation: false }),
    CHMParserFactory.createWithOptions({
      strictValidation: true,
      enableResetTable: true,
    }),
    CHMParserFactory.createLightweight(),
  ]) {
    equal(parser.parse(new BitReader(archive)), expected);
    const quick = {
      header: expected.header,
      directory: expected.directory,
      contentOffset: expected.contentOffset,
    };
    equal(parser.quickParse(new BitReader(archive)), quick);
    parser.reset();
    equal(parser.parse(new BitReader(archive)), expected);
  }
});

test('strict validation accepts section-0-only archives without invented LZXC metadata', () => {
  const bytes = section0Archive();
  const parser = CHMParserFactory.createWithOptions({ strictValidation: true });
  const parsed = parser.parse(new BitReader(bytes));
  equal(parsed.header.lzxc.signature, '');
  ok(
    CHMParserValidator.validate(parsed, {
      strict: true,
      fileSize: bytes.length,
    }),
  );
  equal(parsed.resetTable.blockCount, 0);
  equal(parser.quickParse(new BitReader(bytes)).header.lzxc.signature, '');
  ok(
    CHMStatisticsGenerator.getBriefStatistics(parsed).includes('压缩方法: 无'),
  );
  ok(CHMStatisticsGenerator.getHeaderStatistics(parsed).includes('无压缩'));
});

test('strict validation supports v2 data offsets and an empty section-0 directory', () => {
  for (const compression of [false, true]) {
    const bytes = packFiles(new Map([['index.html', Buffer.from('data')]]), {
      compression,
    });
    // v2 has no explicit data offset; the existing auxiliary section may follow a gap.
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(0x58, 8);
    const parsed = CHMParserFactory.createWithOptions({
      strictValidation: true,
    }).parse(new BitReader(bytes));
    equal(parsed.header.itsf.version, 2);
    equal(parsed.header.itsf.unknown4, 0);
    ok(
      CHMParserValidator.validate(parsed, {
        strict: true,
        fileSize: bytes.length,
      }),
    );
    if (!compression) {
      parsed.directory.entries.clear();
      ok(
        CHMParserValidator.validate(parsed, {
          strict: true,
          fileSize: bytes.length,
        }),
      );
    }
  }
});

for (const strictValidation of [false, true]) {
  test(`strictValidation=${strictValidation} never bypasses damaged compression metadata`, () => {
    for (const bytes of [
      corruptControlData(),
      corruptResetTable(),
      archive.subarray(0, 64),
    ]) {
      const parser = CHMParserFactory.createWithOptions({ strictValidation });
      throws(() => parser.parse(new BitReader(bytes)));
      throws(() => parser.quickParse(new BitReader(bytes)));
      equal(parser.parse(new BitReader(archive)), original());
      throws(() =>
        CHMParserFactory.createLightweight().quickParse(new BitReader(bytes)),
      );
    }
  });
}

test('strict options really invoke deep validation for parse and inherited quickParse', () => {
  const parsed = original();
  const invalid = { ...parsed, contentOffset: parsed.contentOffset + 1 };
  const baseParse = CHMParser.prototype.parse;
  CHMParser.prototype.parse = () => invalid;
  try {
    equal(
      CHMParserFactory.createWithOptions({ strictValidation: false }).parse(
        new BitReader(archive),
      ),
      invalid,
    );
    const strict = CHMParserFactory.createWithOptions({
      strictValidation: true,
    });
    throws(
      () => strict.parse(new BitReader(archive)),
      /Strict CHM validation failed/,
    );
    throws(
      () => strict.quickParse(new BitReader(archive)),
      /Strict CHM validation failed/,
    );
  } finally {
    CHMParser.prototype.parse = baseParse;
  }
});

test('validator rejects malformed data without throwing and validates finite, integral offsets', () => {
  for (const parsed of [null, {}, { header: {} }, { directory: {} }]) {
    ok(!CHMParserValidator.validate(parsed as never, { strict: true }));
    ok(!CHMParserValidator.validateHeaders(parsed as never));
    ok(!CHMParserValidator.validateDirectory(parsed as never));
    ok(!CHMParserValidator.validateContentOffset(parsed as never));
  }
  for (const offset of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const parsed = { ...original(), contentOffset: offset };
    ok(!CHMParserValidator.validate(parsed));
    ok(!CHMParserValidator.validateContentOffset(parsed));
  }
});

test('deep validator checks cross-structure offsets, file bounds and reset-table consistency', () => {
  const changes: ((parsed: ParsedCHM) => void)[] = [
    parsed => {
      parsed.contentOffset++;
    },
    parsed => {
      parsed.header.itsf.directoryLength++;
    },
    parsed => {
      parsed.header.itsp.lastPMGI = 99999;
    },
    parsed => {
      parsed.resetTable.compressedLength++;
    },
    parsed => {
      parsed.resetTable.uncompressedLength = 0;
    },
    parsed => {
      parsed.resetTable.entries[0]!.compressedLength = 1;
    },
    parsed => {
      parsed.resetTable.tableOffset = NaN;
    },
    parsed => {
      parsed.resetTable.entries = [];
    },
    parsed => {
      parsed.directory.entries.delete(entry(parsed, 'controldata').name);
    },
    parsed => {
      parsed.directory.entries.delete(entry(parsed, 'content').name);
    },
    parsed => {
      const compressed = Array.from(parsed.directory.entries.values()).find(
        item => item.section === 1,
      )!;
      compressed.offset = parsed.resetTable.uncompressedLength;
      compressed.length = 1;
      compressed.uncompressedLength = 1;
    },
    parsed => {
      entry(parsed, 'content').offset = Number.MAX_SAFE_INTEGER;
    },
  ];
  for (const change of changes) {
    const parsed = original();
    change(parsed);
    ok(
      !CHMParserValidator.validate(parsed, {
        strict: true,
        fileSize: archive.length,
      }),
    );
  }
  ok(
    !CHMParserValidator.validate(original(), {
      strict: true,
      fileSize: archive.length - 1,
    }),
  );
  for (const fileSize of [NaN, Infinity, -1, 0.5]) {
    ok(!CHMParserValidator.validate(original(), { strict: true, fileSize }));
  }
});

test('file statistics exclude system streams and directories, but retain empty user files', () => {
  const parsed = original();
  for (const name of [
    '/',
    '/docs/',
    '/#EXTRA',
    '/$EXTRA',
    '/::DataSpace/Extra',
    '/empty.txt',
  ]) {
    parsed.directory.entries.set(name, {
      name,
      isCompressed: false,
      section: 0,
      offset: 0,
      length: 0,
    });
  }
  const files = new CHMFileManager(parsed).getUserFileList();
  equal(files.length, 4);
  const statistics = new CHMFileStatistics(parsed);
  const compression = statistics.getCompressionStatistics();
  equal(compression.totalFiles, files.length);
  const userEntries = files.map(name => parsed.directory.entries.get(name)!);
  equal(
    compression.totalUncompressedSize,
    userEntries.reduce((sum, item) => sum + item.length, 0),
  );
  equal(
    compression.totalCompressedSize,
    entry(parsed, 'content').length +
      userEntries
        .filter(item => item.section === 0)
        .reduce((sum, item) => sum + item.length, 0),
  );
  ok(compression.totalCompressedSize !== compression.totalUncompressedSize);
  equal(
    compression.averageCompressionRatio,
    (entry(parsed, 'content').length / parsed.resetTable.uncompressedLength) *
      100,
  );
  equal(
    Array.from(statistics.getFileTypeStatistics().values()).reduce(
      (a, b) => a + b,
      0,
    ),
    files.length,
  );
  equal(
    Object.values(statistics.getSizeDistribution()).reduce((a, b) => a + b, 0),
    files.length,
  );
  ok(CHMStatisticsGenerator.getBriefStatistics(parsed).includes('文件总数: 4'));
  ok(
    CHMStatisticsGenerator.getDirectoryStatistics(parsed).includes(
      '总文件数: 4',
    ),
  );
  ok(CHMStatisticsGenerator.getStatistics(parsed).includes('总文件数: 4'));
  ok(statistics.getDetailedReport().includes('无法精确分摊'));
});

test('statistics use logical section-1 lengths and never sum them as physical compressed bytes', () => {
  const parsed = original();
  const compressed = Array.from(parsed.directory.entries.values()).find(
    item => item.section === 1 && item.name === '/page 1.html',
  )!;
  const before = new CHMFileStatistics(parsed).getCompressionStatistics();
  compressed.length += 2000;
  compressed.uncompressedLength = 0; // A stale legacy hint must not replace the section-1 logical length.
  const after = new CHMFileStatistics(parsed).getCompressionStatistics();
  equal(after.totalCompressedSize, before.totalCompressedSize);
  equal(after.totalUncompressedSize, before.totalUncompressedSize + 2000);
  equal(after.averageCompressionRatio, before.averageCompressionRatio);
});

test('empty directories, zero-size files and zero logical stream sizes yield finite statistics', () => {
  const bytes = section0Archive();
  const parsed = new CHMParser().parse(new BitReader(bytes));
  parsed.directory.entries.clear();
  const statistics = new CHMFileStatistics(parsed);
  equal(statistics.getCompressionStatistics(), {
    totalFiles: 0,
    compressedFiles: 0,
    uncompressedFiles: 0,
    totalCompressedSize: 0,
    totalUncompressedSize: 0,
    compressionRatio: 0,
    averageCompressionRatio: 0,
  });
  equal(statistics.getSizeDistribution(), {
    small: 0,
    medium: 0,
    large: 0,
    veryLarge: 0,
  });
  for (const section of [0, 1]) {
    parsed.directory.entries.set('/empty', {
      name: '/empty',
      section,
      isCompressed: section === 1,
      offset: 0,
      length: 0,
    });
    const compression = statistics.getCompressionStatistics();
    equal(compression.totalFiles, 1);
    equal(compression.compressionRatio, 0);
    equal(compression.averageCompressionRatio, 0);
    ok(!/NaN|Infinity/.test(statistics.getDetailedReport()));
  }
});

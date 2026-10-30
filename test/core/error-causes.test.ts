import { afterEach, beforeEach, test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/core/config';
import { CHMParser } from '../../src/core/parser/chm-parser';
import { packFiles } from '../../src/encoder/archive-builder';
import { ExtractorOperations } from '../../src/operations/extractor';
import { FileManagerOperations } from '../../src/operations/file-manager';
import { InfoOperations } from '../../src/operations/info';
import { ParserOperations } from '../../src/operations/parser';
import { CHMArchive } from '../../src/reader/chm-archive';
import { FileByteSource } from '../../src/reader/file-byte-source';

const packed = packFiles(new Map([['data.json', Buffer.from('{}')]]), {
  compression: false,
});
let root: string;
let archivePath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chm-error-causes-'));
  archivePath = join(root, 'input.chm');
  writeFileSync(archivePath, packed);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function hasCause(error: unknown, cause: unknown, message: RegExp): boolean {
  assert.ok(error instanceof Error);
  assert.notStrictEqual(error, cause);
  assert.strictEqual(error.cause, cause);
  assert.match(error.message, message);
  return true;
}

for (const cause of [new Error('original failure'), { code: 'E_CUSTOM' }]) {
  test(`strict config preserves ${cause instanceof Error ? 'Error' : 'non-Error'} cause identity`, () => {
    const configPath = join(root, 'config.json');
    writeFileSync(configPath, '{"cli":{"showProgress":false}}');
    assert.throws(
      () =>
        loadConfig({
          configPath,
          strict: true,
          onField: () => {
            throw cause;
          },
        }),
      error => hasCause(error, cause, /Failed to load config file/),
    );
  });
}

test('parser wrapping retains the original parser error', async () => {
  const cause = new Error('invalid header');
  vi.spyOn(CHMParser.prototype, 'parse').mockImplementation(() => {
    throw cause;
  });
  await assert.rejects(ParserOperations.parse(archivePath), error =>
    hasCause(error, cause, /CHM 文件解析失败/),
  );
});

const operations = [
  [
    'readFile',
    (path: string) => FileManagerOperations.readFile(path, 'data.json'),
    /读取文件失败/,
  ],
  [
    'listFiles',
    (path: string) => FileManagerOperations.listFiles(path),
    /列出文件失败/,
  ],
  [
    'getInfo',
    (path: string) => InfoOperations.getInfo(path),
    /获取 CHM 文件信息失败/,
  ],
] as const;
for (const [name, run, message] of operations) {
  test(`${name} retains the exact caught error and its existing cause chain`, async () => {
    const original = new Error('underlying I/O failure');
    const cause = new Error('parse failure', { cause: original });
    vi.spyOn(ParserOperations, 'parse').mockRejectedValue(cause);
    await assert.rejects(run(archivePath), error => {
      hasCause(error, cause, message);
      assert.strictEqual(cause.cause, original);
      return true;
    });
  });
}

test('extractor wrapping retains the original input-open error', async () => {
  const cause = new Error('input open failed');
  vi.spyOn(FileByteSource, 'open').mockRejectedValue(cause);
  await assert.rejects(
    ExtractorOperations.extract(archivePath, join(root, 'output')),
    error => hasCause(error, cause, /CHM 文件提取失败/),
  );
});

test('readJSON preserves SyntaxError type, path context and parser cause identity', () => {
  const archive = new CHMArchive(packed);
  const cause = new SyntaxError('invalid JSON');
  vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
    throw cause;
  });
  try {
    assert.throws(
      () => archive.readJSON('data.json'),
      error => {
        assert.ok(error instanceof SyntaxError);
        return hasCause(error, cause, /Invalid JSON in CHM file "data.json"/);
      },
    );
  } finally {
    archive.close();
  }
});

test('text decoding preserves the exact decoder error with path/encoding context', () => {
  const archive = new CHMArchive(packed);
  const cause = new TypeError('decoder failed');
  vi.spyOn(TextDecoder.prototype, 'decode').mockImplementationOnce(() => {
    throw cause;
  });
  try {
    assert.throws(
      () => archive.readText('data.json', 'utf-8'),
      error =>
        hasCause(error, cause, /Cannot decode CHM file "data.json" \(utf-8\)/),
    );
  } finally {
    archive.close();
  }
});

test('parser cancellation still propagates the original error without wrapping', async () => {
  const controller = new AbortController();
  const cause = new Error('cancel during parsing');
  vi.spyOn(CHMParser.prototype, 'parse').mockImplementation(() => {
    controller.abort(cause);
    throw cause;
  });
  await assert.rejects(
    ParserOperations.parse(archivePath, controller.signal),
    error => {
      assert.strictEqual(error, cause);
      return true;
    },
  );
});

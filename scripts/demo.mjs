import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CHMKit, CHMReader } from '../dist/esm/index.mjs';
import assert from 'node:assert/strict';

const directory = 'dist/demo';
await rm(directory, { recursive: true, force: true });
await mkdir(join(directory, 'input/docs'), { recursive: true });
const html =
  '<!doctype html><meta charset="utf-8"><title>CHMKit 实际效果</title><h1>你好，CHMKit</h1><p>边界条件：中文、全字节、空文件、跨帧读取。</p>';
const files = new Map([
  ['index.html', Buffer.from(html)],
  [
    'docs/边界.html',
    Buffer.from(
      '<meta charset="utf-8"><title>边界条件</title><p>空文件、中文路径与跨帧内容验证。</p>',
    ),
  ],
  [
    'all-bytes.bin',
    Buffer.from(Array.from({ length: 131075 }, (_, i) => i % 256)),
  ],
  ['empty.txt', Buffer.alloc(0)],
]);
for (const [name, data] of files)
  await writeFile(join(directory, 'input', name), data);
const archive = join(directory, 'sample.chm');
assert.equal(
  (
    await CHMKit.pack(join(directory, 'input'), archive, {
      title: 'CHMKit 实际效果',
    })
  ).success,
  true,
);
const extraction = await CHMKit.extract(archive, join(directory, 'extracted'), {
  preserveStructure: true,
});
assert.deepEqual(extraction.errors, []);
const results = [];
for (const [name, expected] of files) {
  const actual = await readFile(join(directory, 'extracted', name));
  assert.deepEqual(actual, expected);
  results.push({
    name,
    bytes: actual.length,
    sha256: createHash('sha256').update(actual).digest('hex'),
  });
}
const reader = await CHMReader.open(archive);
try {
  assert.equal(reader.readHTML('/index.html'), html);
  assert.deepEqual(
    reader.readRange('/all-bytes.bin', 32767, 65537),
    files.get('all-bytes.bin').subarray(32767, 65537),
  );
  const search = reader.search('边界条件', { pattern: '**/*.html' });
  const info = await CHMKit.getInfo(archive);
  const cliJson = execFileSync(
    process.execPath,
    ['dist/cjs/cli/index.js', 'info', archive, '--json'],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(JSON.parse(cliJson).fileCount, info.fileCount);
  await writeFile(join(directory, 'info.json'), cliJson);
  await writeFile(
    join(directory, 'toc.json'),
    JSON.stringify(reader.getTOC(), null, 2),
  );
  await writeFile(
    join(directory, 'search.json'),
    JSON.stringify(search, null, 2),
  );
  const report = {
    passed: true,
    originalBytes: [...files.values()].reduce(
      (sum, data) => sum + data.length,
      0,
    ),
    archiveBytes: (await readFile(archive)).length,
    verifiedFiles: results,
    rangeVerified: [32767, 65537],
    metadata: reader.getMetadata(),
    searchMatches: search.length,
    cliJsonVerified: true,
  };
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(
    '\nOpen dist/viewer/index.html directly in your browser and choose dist/demo/sample.chm. No local server is needed.',
  );
} finally {
  reader.close();
}

import { test } from 'vitest';
import { deepStrictEqual as equal, ok } from 'node:assert/strict';
import {
  formatTimestamp,
  getFileType,
  filterFiles,
  formatFileSize,
  isValidPath,
  normalizePath,
  formatProgress,
  createFilterFunction,
} from '../../src/utils/helpers';

test('formatTimestamp should return ISO string', () => {
  const result = formatTimestamp(0);
  ok(result.includes('1970'));
});

test('formatTimestamp should use current time when no arg', () => {
  const result = formatTimestamp();
  ok(result.includes('T'));
});

test('getFileType should return correct MIME types', () => {
  equal(getFileType('index.html'), 'text/html');
  equal(getFileType('style.css'), 'text/css');
  equal(getFileType('app.js'), 'application/javascript');
  equal(getFileType('data.json'), 'application/json');
  equal(getFileType('image.png'), 'image/png');
  equal(getFileType('photo.jpg'), 'image/jpeg');
  equal(getFileType('icon.gif'), 'image/gif');
  equal(getFileType('unknown.xyz'), 'application/octet-stream');
});

test('filterFiles should match glob patterns', () => {
  const files = ['index.html', 'style.css', 'app.js', 'page.html'];
  const result = filterFiles(files, '*.html');
  equal(result.length, 2);
  ok(result.includes('index.html'));
  ok(result.includes('page.html'));
});

test('filterFiles should be case-insensitive', () => {
  const files = ['INDEX.HTML', 'style.css'];
  const result = filterFiles(files, '*.html');
  equal(result.length, 1);
});

test('formatFileSize should format bytes', () => {
  equal(formatFileSize(500), '500.00 B');
  equal(formatFileSize(1024), '1.00 KB');
  equal(formatFileSize(1024 * 1024), '1.00 MB');
  equal(formatFileSize(1024 * 1024 * 1024), '1.00 GB');
});

test('isValidPath should validate paths', () => {
  ok(isValidPath('/some/path/file.txt'));
  ok(isValidPath('relative/path.txt'));
  ok(!isValidPath(''));
  ok(!isValidPath('   '));
  ok(!isValidPath('file<name>.txt'));
});

test('normalizePath should fix separators', () => {
  equal(normalizePath('path\\to\\file'), 'path/to/file');
  equal(normalizePath('path//to///file'), 'path/to/file');
});

test('formatProgress should return progress bar', () => {
  const result = formatProgress(50, 100, 20);
  ok(result.includes('50.0%'));
  ok(result.includes('50/100'));
});

test('formatProgress should handle edge cases', () => {
  const result0 = formatProgress(0, 100);
  ok(result0.includes('0.0%'));

  const result100 = formatProgress(100, 100);
  ok(result100.includes('100.0%'));
});

test('createFilterFunction should match patterns', () => {
  const filter = createFilterFunction(['*.html']);
  ok(filter('index.html'));
  ok(!filter('style.css'));
});

test('createFilterFunction should handle multiple patterns', () => {
  const filter = createFilterFunction(['*.html', '*.css']);
  ok(filter('index.html'));
  ok(filter('style.css'));
  ok(!filter('app.js'));
});

test('createFilterFunction with empty filters should match all', () => {
  const filter = createFilterFunction([]);
  ok(filter('anything.txt'));
});

test('glob escapes regex syntax and anchors the whole name', () => {
  const files = [
    'a+b[1](x).txt',
    'aaab1xXtxt',
    'prefix-a+b[1](x).txt',
    'a+b[1](x).txt.bak',
  ];
  equal(filterFiles(files, 'a+b[1](x).txt'), [files[0]]);
  equal(filterFiles(['file{a}^$.txt', 'filea.txt'], 'file{a}^$.txt'), [
    'file{a}^$.txt',
  ]);
});

test('glob supports basename *, single-character ?, and recursive **', () => {
  const files = [
    '/one.html',
    '/docs/two.html',
    '/docs/deep/three.html',
    '/docs/two.html.bak',
  ];
  equal(filterFiles(files, '*.html'), files.slice(0, 3));
  equal(filterFiles(files, '/docs/*.html'), ['/docs/two.html']);
  equal(filterFiles(files, '**/*.html'), files.slice(0, 3));
  equal(filterFiles(files, '/docs/**/*.html'), files.slice(1, 3));
  ok(createFilterFunction(['/docs/t?o.html'])('/DOCS/TWO.HTML'));
  ok(!createFilterFunction(['/docs/t?o.html'])('/docs/too-long.html'));
  ok(!createFilterFunction(['/docs/?.html'])('/docs/x/y.html'));
});

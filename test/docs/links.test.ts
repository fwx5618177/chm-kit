import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { expect, test } from 'vitest';

const root = resolve(__dirname, '../..');
const excluded = new Set([
  '.git',
  'node_modules',
  'dist',
  'test-results',
  'coverage',
  'fixtures',
]);

async function markdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith('.md')) result.push(path);
  }
  return result;
}

test('owned documentation relative links resolve without requiring generated builds or network access', async () => {
  const failures: string[] = [];
  let checked = 0;
  for (const file of await markdownFiles(root)) {
    const markdown = (await readFile(file, 'utf8')).replace(
      /```[\s\S]*?```/g,
      '',
    );
    for (const link of markdown.matchAll(
      /!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const target = link[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
      try {
        const path = decodeURIComponent(target.split(/[?#]/)[0]);
        if (!path) continue;
        await stat(resolve(dirname(file), path));
        checked++;
      } catch {
        failures.push(`${relative(root, file)} -> ${target}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(100);
  expect(failures).toEqual([]);
});

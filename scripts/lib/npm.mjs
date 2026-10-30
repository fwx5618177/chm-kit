import { execFileSync } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { consumerEnvironment } from './environment.mjs';

export async function runNpm(args, cwd, options = {}) {
  // Avoid .cmd shell wrappers and accidental use of npm from another Node.
  const directory = dirname(process.execPath);
  const candidates = [
    join(directory, 'node_modules/npm/bin/npm-cli.js'),
    resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const entry = await Promise.any(
    candidates.map(async path => {
      await lstat(path);
      return path;
    }),
  );
  const env = consumerEnvironment();
  return execFileSync(process.execPath, [entry, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

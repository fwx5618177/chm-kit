import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumerEnvironment } from '../../scripts/lib/environment.mjs';

export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const consumerSources = join(packageRoot, 'test/package/consumer');
export const tsc = join(packageRoot, 'node_modules/typescript/bin/tsc');

export function isolatedEnv(): NodeJS.ProcessEnv {
  return consumerEnvironment();
}

export function invoke(
  command: string,
  args: string[],
  cwd: string,
  timeout = 60_000,
): Buffer {
  const shell = process.platform === 'win32' && /\.cmd$/i.test(command);
  return execFileSync(
    command,
    shell ? args.map(argument => `"${argument}"`) : args,
    {
      cwd,
      env: isolatedEnv(),
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      shell,
    },
  );
}

export function invokePackageManager(
  name: 'npm' | 'pnpm',
  args: string[],
  cwd: string,
  timeout: number,
): string {
  const manager = process.env.npm_execpath;
  const managerName =
    name === 'pnpm'
      ? /^pnpm(?:\.[cm]?js|\.cmd|\.exe)?$/i
      : /^npm(?:-cli)?(?:\.[cm]?js|\.cmd|\.exe)?$/i;
  if (manager && managerName.test(basename(manager))) {
    const entry = resolve(packageRoot, manager);
    return /\.[cm]?js$/i.test(entry)
      ? invoke(process.execPath, [entry, ...args], cwd, timeout).toString(
          'utf8',
        )
      : invoke(entry, args, cwd, timeout).toString('utf8');
  }

  // npm ships beside Node on Windows and under ../lib on Unix installs.
  if (name === 'npm') {
    const nodeDirectory = dirname(process.execPath);
    const npm = [
      join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
      resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ].find(candidate => existsSync(candidate));
    if (npm)
      return invoke(process.execPath, [npm, ...args], cwd, timeout).toString(
        'utf8',
      );
  }

  return invoke(
    process.platform === 'win32' ? `${name}.cmd` : name,
    args,
    cwd,
    timeout,
  ).toString('utf8');
}

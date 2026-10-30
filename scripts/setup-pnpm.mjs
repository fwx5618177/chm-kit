import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './lib/npm.mjs';

// Bootstrap the exact packageManager version without a global install or
// pnpm/action-setup's intermediary pnpm. Development installs run on Node 24;
// the compatibility test runtime is selected only after dependencies exist.
assert.equal(process.argv.length, 2, 'Usage: node scripts/setup-pnpm.mjs');
assert.ok(
  process.env.RUNNER_TEMP && process.env.GITHUB_PATH,
  'This bootstrap is for GitHub Actions runners',
);
assert.equal(
  Number(process.versions.node.split('.')[0]),
  24,
  'Bootstrap pnpm using Node 24 before selecting the matrix Node',
);
const root = fileURLToPath(new URL('../', import.meta.url));
const { packageManager } = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
assert.match(
  packageManager,
  /^pnpm@\d+\.\d+\.\d+(?:\+sha(?:224|256|384|512)\.[a-f\d]+)?$/,
  'Pin an exact pnpm version in packageManager',
);
const spec = packageManager.split('+')[0];
const prefix = join(process.env.RUNNER_TEMP, 'chmkit-pnpm');
console.log(
  await runNpm(
    [
      'install',
      '--prefix',
      prefix,
      '--no-save',
      '--package-lock=false',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      spec,
    ],
    root,
  ),
);
await appendFile(
  process.env.GITHUB_PATH,
  `${join(prefix, 'node_modules', '.bin')}\n`,
);

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { isolatedEnv, packageRoot } from './support';

export default function setup(): void {
  execFileSync(process.execPath, [join(packageRoot, 'scripts/build.mjs')], {
    cwd: packageRoot,
    env: isolatedEnv(),
    timeout: 120_000,
    stdio: 'inherit',
  });
}

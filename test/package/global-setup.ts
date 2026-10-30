import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { isolatedEnv, packageRoot } from './support';

export default function setup(): void {
  for (const script of ['build.mjs', 'package.mjs']) {
    execFileSync(process.execPath, [join(packageRoot, 'scripts', script)], {
      cwd: packageRoot,
      env: isolatedEnv(),
      timeout: 120_000,
      stdio: 'inherit',
    });
  }
}

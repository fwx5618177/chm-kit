import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalSetup(): void {
  // One build for the entire run, before any project starts consuming dist.
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: resolve(__dirname, '../..'),
    stdio: 'inherit',
    timeout: 120_000,
  });
}

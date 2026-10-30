import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Runtime evidence is intentionally outside immutable fixtures and test sources.
export const artifactRoot = resolve(__dirname, '../../test-results/bench');

export function writeReport(name: string, report: unknown): void {
  if (!/^[a-z0-9-]+\.json$/.test(name))
    throw new Error(`Invalid report filename: ${name}`);
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(
    join(artifactRoot, name),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

export function temporaryDirectory(prefix: string): string {
  if (!/^[a-z0-9-]+$/.test(prefix))
    throw new Error(`Invalid temporary directory prefix: ${prefix}`);
  const root = join(artifactRoot, 'tmp');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `${prefix}-`));
}

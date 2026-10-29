import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function find7Zip(): string | null {
  const candidates = [process.env.CHM_7Z, '7zz', '7z'];
  if (process.platform === 'darwin') {
    for (const prefix of ['/opt/homebrew/bin', '/usr/local/bin']) {
      candidates.push(join(prefix, '7zz'), join(prefix, '7z'));
    }
  }
  if (process.platform === 'win32') {
    for (const directory of [
      process.env.ProgramFiles ?? 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      process.env.ProgramW6432,
    ]) {
      if (directory) candidates.push(join(directory, '7-Zip', '7z.exe'));
    }
  }
  for (const command of new Set(candidates)) {
    if (!command) continue;
    const result = spawnSync(command, ['i'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    if (!result.error && result.status === 0) return command;
  }
  return null;
}

// Module caching keeps the probe out of individual oracle test cases.
export const sevenZip: string | null = find7Zip();

if (process.env.CHM_REQUIRE_7Z === '1' && sevenZip === null) {
  throw new Error(
    'CHM_REQUIRE_7Z=1 but no working 7-Zip was found. Install 7zz/7z or set CHM_7Z to its executable path.',
  );
}

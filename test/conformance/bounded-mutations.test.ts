import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { sevenZip } from '../support/sevenzip';
import { temporaryDirectory, writeReport } from './artifacts';
import {
  fixtureBytes,
  malformedArchives,
  normalArchives,
  oracleBytes,
  seededRandom,
  sha256,
} from './corpus';

interface Mutation {
  id: string;
  bytes: Buffer;
  paths: string[];
  mustReject?: boolean;
  unchanged?: boolean;
}
interface Outcome {
  id: string;
  outcome: 'decoded' | 'openRejected' | 'readRejected';
  hashes?: Record<string, { length: number; sha256: string }>;
  total?: number;
  error?: string;
  errorType?: string;
}

function runIsolated(cases: Mutation[]): Outcome[] {
  const child = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=128',
      '--import',
      'tsx',
      resolve(__dirname, 'mutation-worker.ts'),
    ],
    {
      cwd: resolve(__dirname, '../..'),
      input: JSON.stringify(
        cases.map(item => ({
          id: item.id,
          bytes: item.bytes.toString('base64'),
          paths: item.paths,
        })),
      ),
      encoding: 'utf8',
      timeout: 15_000,
      killSignal: 'SIGKILL',
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  const outcomes = child.stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as Outcome);
  expect(outcomes.map(o => o.id)).toEqual(cases.map(item => item.id));
  for (const [index, outcome] of outcomes.entries()) {
    expect(['decoded', 'openRejected', 'readRejected']).toContain(
      outcome.outcome,
    );
    if (outcome.outcome === 'decoded') {
      expect(Object.keys(outcome.hashes!).sort()).toEqual(
        [...cases[index]!.paths].sort(),
      );
      expect(outcome.total).toBeLessThanOrEqual(256 * 1024);
    } else {
      expect(outcome.error!.length).toBeGreaterThan(0);
      expect(outcome.error!.length).toBeLessThan(8192);
      expect(outcome.errorType).toMatch(/Error$/);
    }
  }
  return outcomes;
}

const seed = 0xc41f2026;
const archive = normalArchives.find(a => a.file === 'inno-myprog.chm')!;
const pristine = fixtureBytes(archive.file);
const paths = archive.files.map(file => file.name);

function mutations(): Mutation[] {
  const result: Mutation[] = [];
  const changed = (
    id: string,
    edit: (copy: Buffer) => void,
    mustReject = true,
  ) => {
    const bytes = Buffer.from(pristine);
    edit(bytes);
    result.push({ id, bytes, paths, mustReject });
  };
  for (const length of [0, 4, 12, 87, 95, 119, 300, pristine.length - 1]) {
    result.push({
      id: `truncate-${length}`,
      bytes: pristine.subarray(0, length),
      paths,
      mustReject: true,
    });
  }
  changed('bad-magic', bytes => bytes.fill(0, 0, 4));
  changed('bad-version', bytes => bytes.writeUInt32LE(99, 4));
  changed('unsafe-directory-offset', bytes => bytes.fill(0xff, 0x48, 0x50));
  changed('huge-chunk-size', bytes =>
    bytes.writeUInt32LE(0xffffffff, archive.observed!.directoryOffset + 16),
  );
  const parsedDirectory = archive.observed!.directoryOffset;
  changed('huge-free-space', bytes =>
    bytes.writeUInt32LE(0xffffffff, parsedDirectory + 0x54 + 4),
  );
  // ControlData and ResetTable addresses are from the independent PMGL observation.
  const control = pristine.indexOf(Buffer.from('LZXC'));
  if (control < 0) throw new Error('Missing fixture control signature');
  changed('zero-reset-interval', bytes => bytes.writeUInt32LE(0, control + 8));
  changed('zero-window', bytes => bytes.writeUInt32LE(0, control + 12));
  const content = archive.observed!.contentOffset;
  if ((pristine[content + 1]! & 0x80) !== 0)
    throw new Error('Fixture unexpectedly uses an Intel-size LZX header');
  changed('invalid-lzx-block-type-zero', bytes => {
    bytes[content + 1] = bytes[content + 1]! & 0x8f;
  });
  for (let i = 0; i < 4; i++) {
    const bytes = Buffer.from(pristine);
    bytes.writeUInt32BE(0x10203040 + i, 0x10);
    result.push({ id: `timestamp-${i}`, bytes, paths, unchanged: true });
  }
  const random = seededRandom(seed);
  for (let i = 0; i < 32; i++) {
    const bytes = Buffer.from(pristine);
    // Include metadata, directory and compressed payload regions, not just padding.
    const base = i % 2 === 0 ? archive.observed!.contentOffset : 0;
    const position = base + (random() % (bytes.length - base));
    bytes[position] = bytes[position]! ^ (1 << (random() % 8));
    result.push({
      id: `seed-${seed.toString(16)}-bit-${i}-at-${position}`,
      bytes,
      paths,
    });
  }
  return result;
}

test('upstream libmspack malformed/CVE inputs reject in a bounded child', () => {
  const cases = malformedArchives.map(item => {
    const bytes = fixtureBytes(item.file);
    if (item.xorInMemory) {
      for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i]! ^ 0xff;
    }
    return { id: item.file, bytes, paths: [] };
  });
  const outcomes = runIsolated(cases);
  for (const outcome of outcomes) {
    expect(outcome.outcome, outcome.id).toBe('openRejected');
    // Several v2 upstream samples have an invalid ITSP directory length: they are
    // real upstream malformed bytes, not positive evidence of valid v2 support.
    expect(outcome.error).toMatch(
      /ITSF|ITSP|PMGL|LZXC|directory|name|ENCINT|range|compression|bounds/i,
    );
  }
});

test('seeded mutations reject corrupt structure or produce bounded output; metadata-only edits preserve every oracle', () => {
  const cases = mutations();
  expect(cases).toHaveLength(52);
  const outcomes = runIsolated(cases);
  for (const [index, outcome] of outcomes.entries()) {
    const mutation = cases[index]!;
    if (mutation.mustReject)
      expect(outcome.outcome, mutation.id).not.toBe('decoded');
    if (mutation.id === 'invalid-lzx-block-type-zero') {
      expect(outcome.outcome).toBe('readRejected');
      expect(outcome.error).toMatch(/LZX|block|块/i);
    }
    if (mutation.unchanged) {
      expect(outcome.outcome, mutation.id).toBe('decoded');
      for (const file of archive.files) {
        expect(outcome.hashes![file.name], file.name).toEqual({
          length: file.length,
          sha256: file.sha256,
        });
      }
    }
  }
  expect(
    outcomes.filter(o => o.outcome === 'decoded').length,
  ).toBeGreaterThanOrEqual(4);
  expect(
    outcomes.filter(o => o.outcome !== 'decoded').length,
  ).toBeGreaterThanOrEqual(15);
});

(sevenZip ? test : test.skip)(
  'seeded mutation differential: every mutually accepted decode matches fresh 7-Zip',
  () => {
    const cases = mutations().filter(item => !item.mustReject);
    const outcomes = runIsolated(cases);
    const deadline = performance.now() + 40_000;
    const oracleTimeout = () => {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) throw new Error('Mutation oracle deadline exceeded');
      return Math.min(5000, remaining);
    };
    const directory = temporaryDirectory('mutation-oracle');
    let compared = 0;
    const oracleRejected: string[] = [];
    const comparedIds: string[] = [];
    try {
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.outcome !== 'decoded') continue;
        const item = cases[index]!;
        const path = join(directory, 'mutant.chm');
        writeFileSync(path, item.bytes);
        const check = spawnSync(sevenZip!, ['t', path], {
          timeout: oracleTimeout(),
          killSignal: 'SIGKILL',
          maxBuffer: 512 * 1024,
          encoding: 'utf8',
        });
        expect(check.error, item.id).toBeUndefined();
        expect(check.signal, item.id).toBeNull();
        if (check.status !== 0) {
          // Rejection policies differ: only successful independent decodes are
          // byte oracles. A rejected mutation is never counted as a comparison.
          expect(check.status, check.stderr).toBeGreaterThan(0);
          oracleRejected.push(item.id);
          continue;
        }
        for (const file of archive.files) {
          const fresh = spawnSync(
            sevenZip!,
            ['x', '-so', '-spd', path, file.name.slice(1)],
            {
              timeout: oracleTimeout(),
              killSignal: 'SIGKILL',
              maxBuffer: 512 * 1024,
            },
          );
          expect(fresh.error, `${item.id}: ${file.name}`).toBeUndefined();
          expect(fresh.status, fresh.stderr.toString()).toBe(0);
          expect(
            outcome.hashes![file.name],
            `${item.id}: ${file.name}`,
          ).toEqual({
            length: fresh.stdout.length,
            sha256: sha256(fresh.stdout),
          });
          if (item.unchanged) expect(fresh.stdout).toEqual(oracleBytes(file));
        }
        compared++;
        comparedIds.push(item.id);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    expect(
      compared,
      'must compare at least four valid metadata-only variants',
    ).toBeGreaterThanOrEqual(4);
    writeReport('mutation-summary.json', {
      measuredAt: new Date().toISOString(),
      seed,
      input: archive.file,
      inputSha256: archive.sha256,
      totalMutationCases: mutations().length,
      differentialCandidates: cases.length,
      dutRejected: outcomes
        .filter(outcome => outcome.outcome !== 'decoded')
        .map(outcome => ({
          id: outcome.id,
          phase: outcome.outcome,
          error: outcome.error,
        })),
      oracleRejected,
      compared,
      comparedIds,
      comparedResourceCount: compared * archive.files.length,
      policy:
        'Mutually successful decodes must match; independent rejections are recorded, not counted as successful comparisons.',
    });
  },
  60_000,
);

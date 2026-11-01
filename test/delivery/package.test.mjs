import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'vitest';
import {
  consumerManifest,
  isVersion,
  publicTargets,
  validatePublicPath,
  verifyArtifacts,
} from '../../scripts/package.mjs';
import {
  assertUnpublished,
  publishTag,
  validateApprovalPolicy,
  validateReleaseHistory,
  validateReleaseInput,
} from '../../scripts/release.mjs';

const temporaryDirectories = [];
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

const source = {
  name: 'chmkit',
  version: '1.0.0',
  files: ['dist/cjs', 'dist/browser', 'dist/types', 'README.md', 'LICENSE'],
  scripts: {
    prepare: 'husky install',
    prepack: 'pnpm build',
    build: 'node scripts/build.mjs',
  },
  dependencies: { buffer: '^6.0.3' },
  devDependencies: { husky: '^8.0.0' },
  packageManager: 'pnpm@10.34.9',
  pnpm: { onlyBuiltDependencies: ['esbuild'] },
};

test('consumer metadata removes repository hooks and dev tooling without mutating source', () => {
  const result = consumerManifest(source);
  assert.equal(result.scripts, undefined);
  assert.equal(result.devDependencies, undefined);
  assert.equal(result.packageManager, undefined);
  assert.equal(result.pnpm, undefined);
  assert.deepEqual(result.dependencies, source.dependencies);
  assert.equal(source.scripts.prepare, 'husky install');
});

test('refuses private metadata, lifecycle installation and local runtime dependencies', () => {
  for (const patch of [
    { private: true },
    { name: 'other-package' },
    { files: ['src'] },
    ...['preinstall', 'install', 'postinstall'].map(hook => ({
      scripts: { [hook]: 'pnpm build' },
    })),
    ...[
      'file:../workspace',
      'workspace:*',
      'link:../lib',
      'git+https://host/lib',
      'https://host/lib.tgz',
      '/tmp/lib',
      '../lib',
      'owner/repo',
      'ssh://host/lib',
      'C:\\local\\lib',
    ].map(spec => ({ dependencies: { lib: spec } })),
    { optionalDependencies: { lib: 'file:../workspace' } },
    { peerDependencies: { lib: 'owner/repo' } },
  ])
    assert.throws(() => consumerManifest({ ...source, ...patch }));
});

test('public package paths cannot escape or include tests, source, demos or generated packages', () => {
  for (const path of [
    'dist/esm/index.mjs',
    './dist/types/worker.d.mts',
    'dist/browser/chunks/part-ABC.mjs',
    'README.en.md',
    'THIRD_PARTY_NOTICES.txt',
  ])
    assert.ok(validatePublicPath(path));
  for (const path of [
    '../package.json',
    '/etc/passwd',
    'dist/../secret',
    'dist\\cjs\\index.js',
    'test/fixture.chm',
    'dist/demo/file.chm',
    'dist/package/nested.tgz',
    'dist/declarations/index.d.ts',
    'dist/src/leak.ts',
    'node_modules/foo',
    '.env',
    'dist/*',
    'dist/./index.js',
  ])
    assert.throws(() => validatePublicPath(path));
});

test('nested conditional exports include future public entries without API enumeration', () => {
  assert.deepEqual(
    publicTargets({
      '.': {
        browser: {
          types: './dist/types/browser.d.mts',
          default: './dist/browser/root.mjs',
        },
        default: './dist/cjs/index.js',
      },
      './worker': ['./dist/browser/worker.mjs', null],
    }),
    [
      './dist/types/browser.d.mts',
      './dist/browser/root.mjs',
      './dist/cjs/index.js',
      './dist/browser/worker.mjs',
    ],
  );
  assert.throws(() => publicTargets(42));
});

test('release versions are exact, safe semantic versions (including prereleases)', () => {
  for (const version of ['0.0.0', '1.2.3', '2.0.0-rc.1', '2.0.0-alpha-beta.0'])
    assert.ok(isVersion(version));
  for (const version of [
    undefined,
    '',
    'v1.0.0',
    '1.2',
    '01.2.3',
    '1.2.3-01',
    '1.2.3+',
    '1.2.3+build',
    '1.2.3;exit',
    '1.2.3\n',
  ])
    assert.equal(isVersion(version), false);
});

test('release requires a pushed v<version> tag matching the package version', () => {
  const input = {
    version: '1.2.3',
    tag: 'v1.2.3',
    packageVersion: '1.2.3',
    ref: 'refs/tags/v1.2.3',
    event: 'push',
  };
  validateReleaseInput(input);
  for (const patch of [
    { tag: 'v1.2.4' },
    { version: '--dangerous' },
    { packageVersion: '1.2.2' },
    { ref: 'refs/heads/main' },
    { ref: 'refs/tags/v1.2.4' },
    { event: 'workflow_dispatch' },
    { event: 'pull_request' },
  ])
    assert.throws(() => validateReleaseInput({ ...input, ...patch }));
});

test('release tags must point to a commit that main already contains', () => {
  for (const status of ['identical', 'behind']) validateReleaseHistory(status);
  for (const status of ['ahead', 'diverged', undefined])
    assert.throws(() => validateReleaseHistory(status), /commit on main/);
});

test('release approval policy fails closed for missing reviewers and admin bypass', () => {
  const rule = {
    type: 'required_reviewers',
    prevent_self_review: true,
    reviewers: [{ type: 'User', reviewer: { login: 'release-reviewer' } }],
  };
  validateApprovalPolicy({
    can_admins_bypass: false,
    protection_rules: [rule],
  });
  // A solo maintainer approves their own release, so self-review stays allowed.
  validateApprovalPolicy({
    can_admins_bypass: false,
    protection_rules: [{ ...rule, prevent_self_review: false }],
  });
  for (const environment of [
    {},
    { protection_rules: [] },
    { can_admins_bypass: true, protection_rules: [rule] },
    {
      can_admins_bypass: false,
      protection_rules: [{ ...rule, reviewers: [] }],
    },
  ])
    assert.throws(() => validateApprovalPolicy(environment));
});

test('npm publishing uses the next tag for prereleases and latest otherwise', () => {
  assert.equal(publishTag('1.2.3'), 'latest');
  assert.equal(publishTag('2.0.0-rc.1'), 'next');
  assert.equal(publishTag('2.0.0-alpha-beta.0'), 'next');
});

test('npm publishing refuses any version the registry already serves', async () => {
  const respond = status => async url => {
    assert.equal(url, 'https://registry.npmjs.org/chmkit/1.2.3');
    return new Response('{}', { status });
  };
  await assertUnpublished({
    name: 'chmkit',
    version: '1.2.3',
    fetchImpl: respond(404),
  });
  await assert.rejects(
    assertUnpublished({
      name: 'chmkit',
      version: '1.2.3',
      fetchImpl: respond(200),
    }),
    /already published/,
  );
  await assert.rejects(
    assertUnpublished({
      name: 'chmkit',
      version: '1.2.3',
      fetchImpl: respond(503),
    }),
    /registry lookup failed with HTTP 503/,
  );
});

async function artifactFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'chmkit-artifact-test-'));
  temporaryDirectories.push(directory);
  const hash = data => createHash('sha256').update(data).digest('hex');
  const names = [
    'chmkit-1.0.0.tgz',
    'chmkit-1.0.0-cli.cjs',
    'chmkit-1.0.0-browser.tar.gz',
    'chmkit-1.0.0-USAGE.md',
    'THIRD_PARTY_NOTICES.txt',
  ];
  for (const name of names) await writeFile(join(directory, name), name);
  const manifest = {
    schemaVersion: 1,
    name: 'chmkit',
    version: '1.0.0',
    commit: 'a'.repeat(40),
    dirty: false,
    assets: names.map(name => ({
      name,
      bytes: Buffer.byteLength(name),
      sha256: hash(name),
    })),
  };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  const checksums = await Promise.all(
    [...names, 'manifest.json']
      .sort()
      .map(
        async name =>
          `${hash(await readFile(join(directory, name)))}  ${name}\n`,
      ),
  );
  await writeFile(join(directory, 'SHA256SUMS'), checksums.join(''));
  return { directory, manifest };
}

test('artifact verification checks exact source identity and all hashes', async () => {
  const { directory, manifest } = await artifactFixture();
  assert.deepEqual(
    await verifyArtifacts(directory, {
      version: '1.0.0',
      commit: 'a'.repeat(40),
      dirty: false,
    }),
    manifest,
  );
  await assert.rejects(
    verifyArtifacts(directory, { version: '2.0.0' }),
    /version mismatch/,
  );
  await assert.rejects(
    verifyArtifacts(directory, { commit: 'b'.repeat(40) }),
    /commit mismatch/,
  );
  await assert.rejects(
    verifyArtifacts(directory, { dirty: true }),
    /dirty mismatch/,
  );
});

test('corrupt assets, unexpected files and checksum lists fail verification', async () => {
  const { directory } = await artifactFixture();
  const asset = join(directory, 'chmkit-1.0.0-cli.cjs');
  await writeFile(asset, 'corrupted');
  await assert.rejects(verifyArtifacts(directory), /size mismatch/);
  await writeFile(asset, 'CHMKIT-1.0.0-CLI.CJS');
  await assert.rejects(verifyArtifacts(directory), /digest mismatch/);
  await writeFile(asset, 'chmkit-1.0.0-cli.cjs');
  await writeFile(join(directory, 'unexpected'), 'not an asset');
  await assert.rejects(verifyArtifacts(directory), /Unexpected release asset/);
  await rm(join(directory, 'unexpected'));
  await writeFile(join(directory, 'SHA256SUMS'), 'wrong');
  await assert.rejects(verifyArtifacts(directory), /Checksum list mismatch/);
});

test('unsafe asset names and symbolic links cannot be published', async () => {
  const { directory, manifest } = await artifactFixture();
  const asset = join(directory, manifest.assets[0].name);
  await rm(asset);
  await symlink(join(directory, 'SHA256SUMS'), asset);
  await assert.rejects(verifyArtifacts(directory), /Non-regular release file/);
  await rm(asset);
  await writeFile(asset, manifest.assets[0].name);
  manifest.assets[0].name = '../escape';
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyArtifacts(directory), /Missing consumer asset/);
});

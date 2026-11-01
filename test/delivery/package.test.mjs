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
  assertTrustedPublisher,
  assertUnpublished,
  bumpedConstants,
  bumpedManifest,
  nextVersion,
  publishTag,
  releaseNotes,
  releaseType,
} from '../../scripts/release.mjs';
import { readFileSync } from 'node:fs';
import { VERSION } from '../../src/constants';

const packageVersion = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

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

test('the exported library version matches package.json', () => {
  assert.equal(VERSION, packageVersion);
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

test('the version bump rewrites the real manifest and source constant', () => {
  const manifest = readFileSync(
    new URL('../../package.json', import.meta.url),
    'utf8',
  );
  const constants = readFileSync(
    new URL('../../src/constants.ts', import.meta.url),
    'utf8',
  );
  const nextVersionValue = '9.9.9';
  const bumped = bumpedManifest(manifest, nextVersionValue);
  assert.equal(JSON.parse(bumped).version, nextVersionValue);
  assert.equal(JSON.parse(bumped).name, JSON.parse(manifest).name);
  assert.equal(
    bumpedConstants(constants, nextVersionValue),
    constants.replace(
      /export const VERSION = '[^']+';/,
      `export const VERSION = '${nextVersionValue}';`,
    ),
  );
  assert.match(
    bumpedConstants(constants, nextVersionValue),
    /VERSION = '9\.9\.9'/,
  );
  assert.throws(() => bumpedManifest('{}', '9.9.9'), /version field/);
  assert.throws(() => bumpedConstants('nothing', '9.9.9'), /exported VERSION/);
});

test('conventional commits decide the release type', () => {
  assert.equal(releaseType('feat: add tunnel reader'), 'minor');
  assert.equal(releaseType('feat(cli): add flag'), 'minor');
  assert.equal(releaseType('fix: handle empty index'), 'patch');
  assert.equal(releaseType('perf: reuse buffer'), 'patch');
  assert.equal(releaseType('revert: "feat: add tunnel reader"'), 'patch');
  assert.equal(releaseType('feat!: drop Node 18'), 'major');
  assert.equal(releaseType('fix(core)!: rename option'), 'major');
  assert.equal(
    releaseType('chore: tidy scripts', 'BREAKING CHANGE: new layout'),
    'major',
  );
  for (const subject of [
    'docs: refresh install guide',
    'chore(release): 1.2.0 [skip ci]',
    'test: cover empty archives',
    'ci: pin actions',
    'Merge pull request #12 from topic',
    'not conventional',
  ])
    assert.equal(releaseType(subject), 'none', subject);
});

test('the highest commit type decides the next version', () => {
  const commits = subjects => subjects.map(subject => ({ subject, body: '' }));
  assert.equal(nextVersion('1.2.3', commits(['fix: a', 'fix: b'])), '1.2.4');
  assert.equal(nextVersion('1.2.3', commits(['fix: a', 'feat: b'])), '1.3.0');
  assert.equal(nextVersion('1.2.3', commits(['feat: a', 'fix!: b'])), '2.0.0');
  assert.equal(
    nextVersion(
      '1.2.3',
      commits(['docs: a', 'chore(release): 1.2.3 [skip ci]']),
    ),
    null,
  );
  assert.equal(nextVersion('1.2.3', []), null);
  assert.equal(nextVersion('0.9.9', commits(['feat: a'])), '0.10.0');
});

test('release notes group conventional commits and skip internal ones', () => {
  const notes = releaseNotes(
    '1.2.0',
    [
      { subject: 'feat: add tunnel reader', body: '' },
      { subject: 'fix: handle empty index', body: '' },
      { subject: 'docs: refresh install guide', body: '' },
      { subject: 'chore(release): 1.2.0 [skip ci]', body: '' },
    ],
    'v1.1.1',
  );
  assert.match(notes, /^# CHMKit 1\.2\.0/m);
  assert.match(notes, /Changes since v1\.1\.1/);
  assert.match(notes, /## Features\n\n- feat: add tunnel reader/);
  assert.match(notes, /## Fixes\n\n- fix: handle empty index/);
  assert.doesNotMatch(notes, /refresh install guide/);
  assert.match(releaseNotes('1.2.0', []), /Maintenance release/);
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

test('npm trusted publishing surfaces the registry rejection reason', async () => {
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://oidc.example/'))
      return new Response('{"value":"id-token"}', { status: 200 });
    return new Response(
      '{"message":"OIDC token exchange error - package not found"}',
      { status: 404 },
    );
  };
  await assert.rejects(
    assertTrustedPublisher({
      name: 'chmkit',
      requestUrl: 'https://oidc.example/token?api-version=2.0',
      requestToken: 'request-token',
      fetchImpl,
    }),
    /package not found/,
  );
  assert.match(calls[0].url, /audience=npm%3Aregistry\.npmjs\.org/);
  assert.equal(
    calls[1].url,
    'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/chmkit',
  );
});

test('npm trusted publishing needs OIDC permission and a publish token', async () => {
  const tokenFetch = async url =>
    String(url).startsWith('https://oidc.example/')
      ? new Response('{"value":"id"}', { status: 200 })
      : new Response('{"token":"publish-token"}', { status: 200 });
  await assertTrustedPublisher({
    name: 'chmkit',
    requestUrl: 'https://oidc.example/token',
    requestToken: 'request-token',
    fetchImpl: tokenFetch,
  });
  await assert.rejects(
    assertTrustedPublisher({ name: 'chmkit', fetchImpl: tokenFetch }),
    /id-token: write/,
  );
  await assert.rejects(
    assertTrustedPublisher({
      name: 'chmkit',
      requestUrl: 'https://oidc.example/token',
      requestToken: 'request-token',
      fetchImpl: async url =>
        String(url).startsWith('https://oidc.example/')
          ? new Response('{}', { status: 200 })
          : new Response('{"token":"x"}', { status: 200 }),
    }),
    /no OIDC token/,
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

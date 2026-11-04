import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVersion, verifyArtifacts } from './package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org';
const constantsFile = join(root, 'src/constants.ts');
const bumpOrder = { none: 0, patch: 1, minor: 2, major: 3 };
const bumpByType = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  revert: 'patch',
};

export function releaseType(subject, body = '') {
  const match = /^([a-z]+)(?:\([^)]*\))?(!)?: \S/.exec(subject);
  if (!match) return 'none';
  if (match[2] || /(?:^|\n)BREAKING[ -]CHANGE:/.test(body)) return 'major';
  return bumpByType[match[1]] ?? 'none';
}

export function nextVersion(version, commits) {
  const bump = commits
    .map(commit => releaseType(commit.subject, commit.body))
    .reduce(
      (previous, current) =>
        bumpOrder[current] > bumpOrder[previous] ? current : previous,
      'none',
    );
  if (bump === 'none') return null;
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  return {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
  }[bump];
}

const changelogFile = join(root, 'CHANGELOG.md');
const unreleasedHeading = '## Unreleased';

export function promoteUnreleased(source, version, date) {
  const start = source.indexOf(unreleasedHeading);
  if (start === -1) return null;
  const rest = source.slice(start + unreleasedHeading.length);
  const next = rest.search(/\n## /);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  const hasEntries = body.split('\n').some(line => {
    const text = line.trim();
    return text.length > 0 && !text.startsWith('#');
  });
  if (!hasEntries) return null;
  const tail = next === -1 ? '' : rest.slice(next);
  return {
    markdown: `${source.slice(0, start + unreleasedHeading.length)}\n\n## ${version} - ${date}\n\n${body}\n${tail}`,
    notes: body,
  };
}

export function bumpedManifest(source, version) {
  const next = source.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${version}"`,
  );
  assert.notEqual(next, source, 'package.json has no version field');
  return next;
}

export function bumpedConstants(source, version) {
  const next = source.replace(
    /export const VERSION = '[^']+';/,
    `export const VERSION = '${version}';`,
  );
  assert.notEqual(next, source, 'src/constants.ts has no exported VERSION');
  return next;
}

function noteHeading(subject, body) {
  const match = /^([a-z]+)(?:\([^)]*\))?(!)?: \S/.exec(subject);
  if (!match) return null;
  if (match[2] || /(?:^|\n)BREAKING[ -]CHANGE:/.test(body))
    return 'Breaking changes';
  return {
    feat: 'Features',
    fix: 'Fixes',
    perf: 'Performance',
    revert: 'Reverts',
  }[match[1]];
}

export function releaseNotes(version, commits, previous = '') {
  const lines = [
    `# CHMKit ${version}`,
    '',
    'The GitHub assets and the npm tarball are the same verified build.',
    '',
  ];
  if (previous) lines.push(`Changes since ${previous}:`, '');
  const sections = new Map();
  for (const commit of commits) {
    const heading = noteHeading(commit.subject, commit.body);
    if (!heading) continue;
    const items = sections.get(heading) ?? [];
    items.push(commit.subject);
    sections.set(heading, items);
  }
  if (sections.size === 0) lines.push('Maintenance release.', '');
  for (const [heading, items] of sections) {
    lines.push(`## ${heading}`, '');
    for (const item of items) lines.push(`- ${item}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function publishTag(version) {
  return version.includes('-') ? 'next' : 'latest';
}

// npm exchanges a GitHub OIDC token for a short-lived publish token and fails
// silently when the package has no matching trusted publisher. Surface the
// registry's reason instead of the generic "need auth" that follows.
export async function assertTrustedPublisher({
  name,
  requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
  requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  fetchImpl = fetch,
}) {
  assert.ok(
    requestUrl && requestToken,
    'npm publishing requires the id-token: write permission of the release workflow',
  );
  const audience = new URL(requestUrl);
  audience.searchParams.append('audience', `npm:${new URL(registry).hostname}`);
  const idResponse = await fetchImpl(audience, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requestToken}`,
    },
  });
  assert.ok(
    idResponse.ok,
    `GitHub OIDC token request failed with HTTP ${idResponse.status}`,
  );
  const { value } = await idResponse.json();
  assert.ok(value, 'GitHub returned no OIDC token');
  const exchange = await fetchImpl(
    new URL(
      `/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`,
      registry,
    ),
    {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${value}` },
    },
  );
  const body = await exchange.text();
  assert.ok(
    exchange.ok,
    `npm trusted publishing rejected this workflow with HTTP ${exchange.status}: ${body}`,
  );
  assert.ok(JSON.parse(body).token, 'npm returned no publish token');
}

export async function assertUnpublished({ name, version, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (response.status === 404) return;
  assert.ok(
    response.ok,
    `npm registry lookup failed with HTTP ${response.status}`,
  );
  await response.body?.cancel();
  assert.fail(`${name}@${version} is already published; bump the version`);
}

function git(args) {
  return execFileSync('git', ['--no-pager', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function gh(args) {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function record(file, line) {
  const path = process.env[file];
  if (path) await appendFile(path, `${line}\n`);
  else console.log(line);
}

function readVersion() {
  const version = process.env.RELEASE_VERSION;
  assert.ok(
    isVersion(version),
    'RELEASE_VERSION must be an exact semantic version without build metadata',
  );
  return version;
}

function repository() {
  const value = process.env.GITHUB_REPOSITORY;
  assert.match(value ?? '', /^[\w.-]+\/[\w.-]+$/, 'Missing GitHub repository');
  return value;
}

function lastReleaseTag() {
  try {
    return git([
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'v[0-9]*',
      'HEAD',
    ]).trim();
  } catch {
    return '';
  }
}

function commitsSince(tag) {
  return git(['log', '--format=%s%x00%b%x01', tag ? `${tag}..HEAD` : 'HEAD'])
    .split('\x01')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [subject = '', ...body] = record.split('\x00');
      return { subject: subject.trim(), body: body.join('\x00').trim() };
    });
}

async function commandNext() {
  const manifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  const tag = lastReleaseTag();
  const base = tag ? tag.slice(1) : manifest.version;
  assert.equal(
    manifest.version,
    base,
    'Version comes from the last release tag; do not bump package.json by hand',
  );
  const version = nextVersion(base, commitsSince(tag));
  if (!version) {
    console.log(`No release-worthy commits since ${tag || 'the first commit'}`);
    return;
  }
  console.log(`Next version: ${version} (from ${base}, tag ${tag || 'none'})`);
  await record('GITHUB_OUTPUT', `version=${version}`);
}

async function commandPrepare() {
  const version = readVersion();
  const packageFile = join(root, 'package.json');
  const manifest = await readFile(packageFile, 'utf8');
  const constants = await readFile(constantsFile, 'utf8');
  const changelog = await readFile(changelogFile, 'utf8');
  const previous = lastReleaseTag();
  const promoted = promoteUnreleased(
    changelog,
    version,
    new Date().toISOString().slice(0, 10),
  );
  const nextManifest = bumpedManifest(manifest, version);
  const nextConstants = bumpedConstants(constants, version);
  if (promoted) await writeFile(changelogFile, promoted.markdown);
  const notesFile = join(
    await mkdtemp(join(tmpdir(), 'chmkit-notes-')),
    'NOTES.md',
  );
  await writeFile(
    notesFile,
    promoted
      ? `# CHMKit ${version}\n\n${promoted.notes}\n\nThe GitHub assets and the npm tarball are the same verified build.\n`
      : releaseNotes(version, commitsSince(previous), previous),
  );
  await writeFile(packageFile, nextManifest);
  await writeFile(constantsFile, nextConstants);
  git(['add', 'package.json', 'src/constants.ts', 'CHANGELOG.md']);
  git([
    '-c',
    'user.name=github-actions[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit',
    '-m',
    `chore(release): ${version} [skip ci]`,
  ]);
  git(['push', 'origin', 'HEAD:main']);
  const commit = git(['rev-parse', 'HEAD']).trim();
  console.log(`Release commit ${commit} for ${version}`);
  await record('GITHUB_ENV', `CHMKIT_EXPECTED_COMMIT=${commit}`);
  await record('GITHUB_ENV', `CHMKIT_RELEASE_NOTES=${notesFile}`);
}

async function commandPublish() {
  const version = readVersion();
  const tag = `v${version}`;
  const commit = git(['rev-parse', 'HEAD']).trim();
  const directory = join(root, 'dist/package');
  const manifest = await verifyArtifacts(directory, {
    version,
    commit,
    dirty: false,
  });
  assert.equal(git(['tag', '--list', tag]).trim(), '', `Tag ${tag} exists`);
  const previous = lastReleaseTag();
  const prepared = process.env.CHMKIT_RELEASE_NOTES;
  const content = prepared
    ? (await readFile(prepared, 'utf8')).trim()
    : releaseNotes(version, commitsSince(previous), previous);
  assert.ok(content.length > 0, 'Release notes are empty');
  const notes = join(
    await mkdtemp(join(tmpdir(), 'chmkit-notes-')),
    'NOTES.md',
  );
  await writeFile(notes, `${content}\n`);
  git([
    '-c',
    'user.name=github-actions[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'tag',
    '-a',
    tag,
    '-m',
    `CHMKit ${version}`,
  ]);
  git(['push', 'origin', tag]);
  const args = [
    'release',
    'create',
    tag,
    '--repo',
    repository(),
    '--verify-tag',
    '--title',
    `CHMKit ${version}`,
    '--notes-file',
    notes,
  ];
  if (version.includes('-')) args.push('--prerelease');
  args.push(
    ...manifest.assets.map(asset => join(directory, asset.name)),
    join(directory, 'manifest.json'),
    join(directory, 'SHA256SUMS'),
  );
  console.log(gh(args));
}

async function commandNpm() {
  const version = readVersion();
  const metadata = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  const directory = join(root, 'dist/package');
  const tarball = join(directory, `chmkit-${version}.tgz`);
  const manifest = await verifyArtifacts(directory, {
    version,
    commit: git(['rev-parse', 'HEAD']).trim(),
    dirty: false,
  });
  assert.ok(
    manifest.assets.some(asset => asset.name === `chmkit-${version}.tgz`),
    `Unverified npm tarball: ${tarball}`,
  );
  await assertUnpublished({ name: metadata.name, version });
  await assertTrustedPublisher({ name: metadata.name });
  // Trusted publishing: npm exchanges the job's OIDC token, so no token secret
  // exists. The artifact is published byte-for-byte; scripts never run here.
  execFileSync(
    'npm',
    [
      'publish',
      tarball,
      '--provenance',
      '--access',
      'public',
      '--ignore-scripts',
      '--tag',
      publishTag(version),
      '--registry',
      registry,
    ],
    { cwd: root, stdio: 'inherit', timeout: 900000 },
  );
  console.log(`Published ${metadata.name}@${version} to ${registry}`);
}

async function main() {
  const command = process.argv[2];
  assert.ok(
    process.argv.length === 3 &&
      ['next', 'prepare', 'publish', 'npm'].includes(command),
    'Usage: node scripts/release.mjs next|prepare|publish|npm',
  );
  if (command === 'next') return commandNext();
  if (command === 'prepare') return commandPrepare();
  if (command === 'publish') return commandPublish();
  return commandNpm();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

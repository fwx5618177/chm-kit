import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVersion, verifyArtifacts } from './package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org';

export function validateReleaseInput({
  version,
  tag,
  packageVersion,
  ref,
  event,
}) {
  assert.ok(
    isVersion(version),
    'version must be an exact semantic version without build metadata',
  );
  assert.equal(
    tag,
    `v${version}`,
    'tag must be v<version>; tags are never created by this workflow',
  );
  assert.equal(
    version,
    packageVersion,
    'Update and commit package.json before tagging the release',
  );
  assert.equal(
    ref,
    `refs/tags/${tag}`,
    'Release runs from a pushed v<version> tag',
  );
  assert.equal(
    event,
    'push',
    'Release assets require the v<version> tag push event',
  );
}

export function validateReleaseHistory(status) {
  assert.ok(
    ['identical', 'behind'].includes(status),
    'Release tag must point to a commit on main',
  );
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

export function validateApprovalPolicy(environment) {
  const rule = environment.protection_rules?.find(
    rule => rule.type === 'required_reviewers',
  );
  assert.ok(
    rule?.reviewers?.length,
    'Configure required reviewers on the release environment first',
  );
  assert.equal(
    environment.can_admins_bypass,
    false,
    'Disable administrator bypass on the release environment',
  );
}

function gh(args) {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function preflight() {
  const metadata = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  const tag = process.env.GITHUB_REF_NAME ?? '';
  const version = tag.replace(/^v/, '');
  validateReleaseInput({
    version,
    tag,
    packageVersion: metadata.version,
    ref: process.env.GITHUB_REF ?? '',
    event: process.env.GITHUB_EVENT_NAME,
  });
  const repository = process.env.GITHUB_REPOSITORY;
  const commit = process.env.GITHUB_SHA;
  assert.match(
    repository ?? '',
    /^[\w.-]+\/[\w.-]+$/,
    'Missing GitHub repository context',
  );
  assert.match(commit ?? '', /^[a-f\d]{40}$/, 'Missing GitHub commit context');
  assert.equal(
    execFileSync('git', ['--no-pager', 'rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    }).trim(),
    commit,
    'Checkout differs from the tagged commit',
  );
  const environment = JSON.parse(
    gh(['api', `repos/${repository}/environments/release`]),
  );
  validateApprovalPolicy(environment);
  let target = JSON.parse(
    gh(['api', `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`]),
  ).object;
  for (let depth = 0; target.type === 'tag' && depth < 8; depth++)
    target = JSON.parse(
      gh(['api', `repos/${repository}/git/tags/${target.sha}`]),
    ).object;
  assert.equal(target.type, 'commit', 'Release tag must resolve to a commit');
  assert.equal(
    target.sha,
    commit,
    'Release tag must point to the checked out commit',
  );
  validateReleaseHistory(
    JSON.parse(gh(['api', `repos/${repository}/compare/main...${commit}`]))
      .status,
  );
  return { version, tag, repository, commit };
}

async function main() {
  const command = process.argv[2];
  assert.ok(
    process.argv.length === 3 &&
      ['validate', 'publish', 'npm'].includes(command),
    'Usage: node scripts/release.mjs validate|publish|npm',
  );
  const { version, tag, repository, commit } = await preflight();
  if (command === 'validate') {
    console.log(
      `Release prerequisites verified: ${repository} ${tag} @ ${commit}`,
    );
    return;
  }
  const directory = join(root, 'dist/package');
  const manifest = await verifyArtifacts(directory, {
    version,
    commit,
    dirty: false,
  });
  if (command === 'npm') {
    const metadata = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    );
    const tarball = join(directory, `chmkit-${version}.tgz`);
    assert.ok(
      manifest.assets.some(asset => asset.name === basename(tarball)),
      `Unverified npm tarball: ${basename(tarball)}`,
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
    return;
  }
  const notes = manifest.assets.find(asset => asset.name.endsWith('-USAGE.md'));
  const args = [
    'release',
    'create',
    tag,
    '--repo',
    repository,
    '--verify-tag',
    '--draft',
    '--title',
    `CHMKit ${version}`,
    '--notes-file',
    join(directory, notes.name),
  ];
  if (version.includes('-')) args.push('--prerelease');
  args.push(
    ...manifest.assets.map(asset => join(directory, asset.name)),
    join(directory, 'manifest.json'),
    join(directory, 'SHA256SUMS'),
  );
  // No --clobber, deployment or tag-creation fallback. npm publishing happens
  // only in the separate OIDC job, never through this token-authenticated path.
  console.log(gh(args));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

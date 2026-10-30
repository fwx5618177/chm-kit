import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVersion, verifyArtifacts } from './package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

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
    'Update and commit package.json before requesting release',
  );
  assert.equal(ref, 'refs/heads/main', 'Dispatch the release workflow on main');
  assert.equal(
    event,
    'workflow_dispatch',
    'Release assets require a dedicated manual dispatch',
  );
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
    rule.prevent_self_review,
    true,
    'Enable prevent self-review on the release environment',
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
  const version = process.env.RELEASE_VERSION;
  const tag = process.env.RELEASE_TAG;
  validateReleaseInput({
    version,
    tag,
    packageVersion: metadata.version,
    ref: process.env.GITHUB_REF,
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
    'Checkout differs from dispatched commit',
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
    'Existing release tag must point to the dispatched main commit',
  );
  return { version, tag, repository, commit };
}

async function main() {
  const command = process.argv[2];
  assert.ok(
    process.argv.length === 3 && ['validate', 'publish'].includes(command),
    'Usage: node scripts/release.mjs validate|publish',
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
  // No --clobber, npm token, npm publish, deployment or tag-creation fallback.
  // The protected environment gate is enforced by GitHub before this job starts.
  console.log(gh(args));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();

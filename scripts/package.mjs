import assert from 'node:assert/strict';
import { runNpm as npm } from './lib/npm.mjs';
import { consumerEnvironment } from './lib/environment.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { builtinModules, createRequire } from 'node:module';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist/package');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const publicFile =
  /^(?:dist\/(?!package\/|demo\/|declarations\/)[\w./-]+|README(?:\.en)?\.md|LICENSE|THIRD_PARTY_NOTICES\.txt)$/;
const dangerousSegment =
  /(?:^|\/)(?:\.\.?|node_modules|test|tests|fixtures|src|scripts|\.github)(?:\/|$)/;

export function isVersion(value) {
  if (typeof value !== 'string') return false;
  if (
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      value,
    )
  )
    return false;
  return !value
    .split('-')
    .slice(1)
    .join('-')
    .split('.')
    .some(part => /^0\d+$/.test(part));
}

export function validatePublicPath(path) {
  assert.equal(typeof path, 'string', 'Public file paths must be strings');
  const normalized = path.replace(/^\.\//, '');
  assert.ok(
    publicFile.test(normalized) && !dangerousSegment.test(normalized),
    `Unsafe/non-public package path: ${path}`,
  );
  return normalized;
}

export function publicTargets(value) {
  if (value === null) return [];
  if (typeof value === 'string') return [value];
  assert.ok(
    value && typeof value === 'object',
    'Invalid public entry metadata',
  );
  return Object.values(value).flatMap(publicTargets);
}

export function consumerManifest(source) {
  assert.equal(source.name, 'chmkit', 'Unexpected package name');
  assert.ok(
    isVersion(source.version),
    'Expected a semantic package version without build metadata',
  );
  assert.notEqual(
    source.private,
    true,
    'Refusing to package a private project',
  );
  assert.ok(
    Array.isArray(source.files) && source.files.length,
    'A public files allowlist is required',
  );
  source.files.forEach(validatePublicPath);
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, spec] of Object.entries(source[field] ?? {})) {
      assert.ok(
        typeof spec === 'string' &&
          /^[0-9A-Za-z_.*^~<>=|+ -]+$/.test(spec) &&
          !spec.startsWith('.'),
        `Expected a registry version/range for ${field}.${name}`,
      );
    }
  }
  for (const hook of ['preinstall', 'install', 'postinstall'])
    assert.ok(
      !source.scripts?.[hook],
      `Consumer install lifecycle is forbidden: ${hook}`,
    );
  // Repository automation must not reach consumers. In particular, husky's
  // prepare hook and prepack's pnpm/devDependencies are not install requirements.
  const manifest = { ...source };
  for (const field of [
    'scripts',
    'devDependencies',
    'packageManager',
    'pnpm',
    'lint-staged',
    'commitlint',
  ])
    delete manifest[field];
  return manifest;
}

async function copyPublic(path, destination) {
  validatePublicPath(path);
  const source = join(root, path);
  const stat = await lstat(source);
  assert.ok(!stat.isSymbolicLink(), `Symlink forbidden in package: ${path}`);
  if (stat.isDirectory()) {
    for (const entry of (await readdir(source)).sort())
      await copyPublic(`${path}/${entry}`, destination);
  } else {
    assert.ok(stat.isFile(), `Non-regular package file: ${path}`);
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await copyFile(source, join(destination, path));
  }
}

function run(command, args, cwd, options = {}) {
  const env = consumerEnvironment();
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

async function bundledNotices(dependencies) {
  const notices = [];
  const pending = Object.keys(dependencies ?? {}).map(name => [
    name,
    createRequire(import.meta.url),
  ]);
  const seen = new Set();
  while (pending.length) {
    const [name, require] = pending.shift();
    let entry;
    try {
      entry = require.resolve(`${name}/package.json`);
    } catch (error) {
      if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
      entry = require.resolve(name);
    }
    let directory = dirname(entry);
    let metadata;
    for (;;) {
      try {
        metadata = JSON.parse(
          await readFile(join(directory, 'package.json'), 'utf8'),
        );
        if (metadata.name === name) break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      assert.notEqual(
        dirname(directory),
        directory,
        `Cannot locate bundled package: ${name}`,
      );
      directory = dirname(directory);
    }
    const identity = `${metadata.name}@${metadata.version}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const license = (await readdir(directory)).find(name =>
      /^licen[cs]e(?:\.md|\.txt)?$/i.test(name),
    );
    assert.ok(license, `Missing bundled dependency license: ${identity}`);
    notices.push(
      `--- ${identity} ---\n${await readFile(join(directory, license), 'utf8')}`,
    );
    for (const dependency of Object.keys(metadata.dependencies ?? {}))
      pending.push([
        dependency,
        createRequire(join(directory, 'package.json')),
      ]);
  }
  return `${notices.join('\n\n')}\n`;
}

export async function verifyArtifacts(directory, expected = {}) {
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.schemaVersion, 1, 'Unknown artifact manifest schema');
  assert.equal(manifest.name, 'chmkit');
  assert.ok(isVersion(manifest.version));
  assert.match(manifest.commit, /^[a-f\d]{40}$/);
  for (const [key, value] of Object.entries(expected))
    assert.equal(manifest[key], value, `Artifact ${key} mismatch`);
  assert.ok(
    Array.isArray(manifest.assets) && manifest.assets.length >= 5,
    'Incomplete consumer assets',
  );
  for (const name of [
    `chmkit-${manifest.version}.tgz`,
    `chmkit-${manifest.version}-cli.cjs`,
    `chmkit-${manifest.version}-browser.tar.gz`,
    `chmkit-${manifest.version}-USAGE.md`,
    'THIRD_PARTY_NOTICES.txt',
  ])
    assert.ok(
      manifest.assets.some(asset => asset.name === name),
      `Missing consumer asset: ${name}`,
    );
  for (const name of await readdir(directory))
    assert.ok(
      (await lstat(join(directory, name))).isFile(),
      `Non-regular release file: ${name}`,
    );
  const names = new Set(['manifest.json', 'SHA256SUMS']);
  for (const asset of manifest.assets) {
    assert.match(asset.name, /^[\w][\w.-]*$/);
    assert.ok(!names.has(asset.name), 'Duplicate/reserved asset name');
    names.add(asset.name);
    const path = join(directory, asset.name);
    assert.ok(
      (await lstat(path)).isFile(),
      `Non-regular release asset: ${asset.name}`,
    );
    const bytes = await readFile(path);
    assert.equal(
      bytes.length,
      asset.bytes,
      `Asset size mismatch: ${asset.name}`,
    );
    assert.equal(
      sha256(bytes),
      asset.sha256,
      `Asset digest mismatch: ${asset.name}`,
    );
  }
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [...names].sort(),
    'Unexpected release asset',
  );
  const checksumFiles = [
    ...manifest.assets.map(asset => asset.name),
    'manifest.json',
  ].sort();
  const checksums = await Promise.all(
    checksumFiles.map(
      async name =>
        `${sha256(await readFile(join(directory, name)))}  ${name}\n`,
    ),
  );
  assert.equal(
    await readFile(join(directory, 'SHA256SUMS'), 'utf8'),
    checksums.join(''),
    'Checksum list mismatch',
  );
  return manifest;
}

async function packageAssets() {
  assert.equal(
    process.argv.length,
    2,
    'Usage: node scripts/package.mjs (run pnpm build first)',
  );
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifest = consumerManifest(source);
  manifest.files = [...manifest.files, 'THIRD_PARTY_NOTICES.txt'];
  const notices = await bundledNotices(manifest.dependencies);
  const commit = run('git', ['--no-pager', 'rev-parse', 'HEAD'], root).trim();
  assert.match(commit, /^[a-f\d]{40}$/);
  if (process.env.GITHUB_SHA)
    assert.equal(
      commit,
      process.env.GITHUB_SHA,
      'Build checkout differs from workflow commit',
    );
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(join(await realpath(tmpdir()), 'chmkit-assets-'));
  try {
    const stage = join(work, 'package');
    await mkdir(stage);
    for (const path of new Set([
      ...source.files,
      'README.md',
      'README.en.md',
      'LICENSE',
    ]))
      await copyPublic(path, stage);
    await writeFile(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices);
    await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
    await writeFile(
      join(stage, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const [packed] = JSON.parse(
      await npm(
        [
          'pack',
          '--ignore-scripts',
          '--foreground-scripts=false',
          '--json',
          '--pack-destination',
          output,
        ],
        stage,
      ),
    );
    assert.equal(packed.name, manifest.name);
    assert.equal(packed.version, manifest.version);
    const paths = new Set(packed.files.map(file => file.path));
    for (const path of paths)
      if (path !== 'package.json') validatePublicPath(path);
    for (const target of [
      manifest.main,
      manifest.module,
      manifest.browser,
      manifest.types,
      ...publicTargets(manifest.exports),
      ...publicTargets(manifest.bin),
    ]) {
      assert.equal(typeof target, 'string', 'Missing package entry');
      assert.ok(
        paths.has(target.replace(/^\.\//, '')),
        `Entry absent from tarball: ${target}`,
      );
    }

    const prefix = `${manifest.name}-${manifest.version}`;
    const cliName = `${prefix}-cli.cjs`;
    const { build } = await import('esbuild');
    const cli = await build({
      absWorkingDir: root,
      entryPoints: ['src/cli/index.ts'],
      outfile: join(output, cliName),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      legalComments: 'eof',
      metafile: true,
    });
    const builtins = new Set(
      builtinModules.flatMap(name => [name, `node:${name}`]),
    );
    for (const file of Object.values(cli.metafile.outputs))
      for (const dependency of file.imports)
        assert.ok(
          !dependency.external || builtins.has(dependency.path),
          `Standalone CLI has an external dependency: ${dependency.path}`,
        );
    await chmod(join(output, cliName), 0o755);
    // An actual consumer is outside the repository. No compiler, pnpm or
    // repository node_modules is available through its resolution ancestry.
    const consumer = join(work, 'consumer');
    await mkdir(consumer);
    await writeFile(join(consumer, 'package.json'), '{"private":true}\n');
    await npm(
      [
        'install',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        join(output, packed.filename),
      ],
      consumer,
    );
    const smoke = `const assert = require('node:assert/strict'); const kit = require('chmkit'); assert.equal(typeof kit.CHMKit, 'function'); const p = require('chmkit/package.json'); assert.equal(p.scripts, undefined); assert.equal(p.devDependencies, undefined);`;
    run(process.execPath, ['-e', smoke], consumer);
    for (const path of [
      join(output, cliName),
      ...new Set(
        Object.values(manifest.bin).map(path =>
          join(consumer, 'node_modules', manifest.name, path),
        ),
      ),
    ]) {
      assert.equal(
        run(process.execPath, [path, '--version'], consumer).trim(),
        manifest.version,
        'CLI version differs from package metadata',
      );
      assert.match(
        run(process.execPath, [path, '--help'], consumer),
        /extract/,
      );
    }
    const standalone = join(work, 'standalone');
    await mkdir(standalone);
    await copyFile(join(output, cliName), join(standalone, 'cli.cjs'));
    assert.equal(
      run(process.execPath, ['cli.cjs', '--version'], standalone).trim(),
      manifest.version,
    );
    assert.match(
      run(process.execPath, ['cli.cjs', '--help'], standalone),
      /extract/,
    );

    const browserName = `${prefix}-browser.tar.gz`;
    const viewer = join(work, 'viewer');
    await mkdir(join(viewer, 'dist/viewer'), { recursive: true });
    for (const name of [
      'index.html',
      'viewer.js',
      'reader.worker.js',
      'worker-client.js',
    ]) {
      await copyFile(
        join(root, 'dist/viewer', name),
        join(viewer, 'dist/viewer', name),
      );
    }
    // Preserve all browser chunks and all declarations, including future public
    // Worker/Electron entries from the canonical build; do not enumerate APIs.
    run(
      'tar',
      [
        '-czf',
        join(output, browserName),
        '-C',
        stage,
        'dist/browser',
        'dist/types',
        'LICENSE',
        'README.md',
        'README.en.md',
        'THIRD_PARTY_NOTICES.txt',
        '-C',
        viewer,
        'dist/viewer',
      ],
      root,
    );
    const usageName = `${prefix}-USAGE.md`;
    await writeFile(
      join(output, usageName),
      `# CHMKit ${manifest.version} prebuilt downloads\n\nSource commit: ${commit}\n\n- Install Node package: \`npm install ./${packed.filename}\`. Compiled CJS/ESM, CLI and declarations are already included; do not run build. Runtime dependencies are fetched from npm.\n- Standalone CLI: \`node ${cliName} --help\`. Requires ${manifest.engines?.node ?? 'a supported Node.js version'}, but no npm install, pnpm or compiler.\n- Browser viewer: extract \`${browserName}\` and open \`dist/viewer/index.html\` directly in a modern browser. No npm, build, Node.js or local server is required, and archive contents stay local. Library ESM/Worker integration instead uses HTTP(S)-served \`dist/browser/index.mjs\` or \`root.mjs\`; retain all relative paths/chunks. Declaration files are in \`dist/types/\`.\n- Verify files using \`sha256sum -c SHA256SUMS\` (macOS: \`shasum -a 256 -c SHA256SUMS\`). Windows PowerShell: \`Get-FileHash -Algorithm SHA256 <file>\`; compare to SHA256SUMS. Hashes detect corruption; obtain the manifest from a trusted source.\n\nThird-party dependency license notices are included in THIRD_PARTY_NOTICES.txt and the archives. These assets do not embed a Node executable or Electron runtime.\n`,
    );

    const assets = await Promise.all(
      (await readdir(output)).sort().map(async name => {
        const bytes = await readFile(join(output, name));
        return { name, bytes: bytes.length, sha256: sha256(bytes) };
      }),
    );
    await writeFile(
      join(output, 'manifest.json'),
      `${JSON.stringify({ schemaVersion: 1, name: manifest.name, version: manifest.version, commit, dirty: Boolean(run('git', ['--no-pager', '--no-optional-locks', 'status', '--porcelain'], root).trim()), node: process.version, packageManager: source.packageManager, assets, packageFiles: [...paths].sort() }, null, 2)}\n`,
    );
    const checksums = await Promise.all(
      [...assets.map(asset => asset.name), 'manifest.json']
        .sort()
        .map(
          async name =>
            `${sha256(await readFile(join(output, name)))}  ${name}\n`,
        ),
    );
    await writeFile(join(output, 'SHA256SUMS'), checksums.join(''));
    await verifyArtifacts(output, { version: manifest.version, commit });
    console.log(`Verified prebuilt consumer assets: ${output}`);
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await packageAssets();

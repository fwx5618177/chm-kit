import { build } from 'esbuild';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import { chmod, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 2)
  throw new Error(
    'Usage: node scripts/build.mjs (no options; builds all public entries)',
  );
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
// Rebuild package artifacts without deleting demo data or test evidence.
await Promise.all(
  ['cjs', 'esm', 'browser', 'types', 'declarations'].map(directory =>
    rm(`dist/${directory}`, { recursive: true, force: true }),
  ),
);
const nodeEntries = {
  index: 'src/index.ts',
  config: 'src/core/config.ts',
  reader: 'src/reader/chm-reader.ts',
  worker: 'src/worker/index.ts',
  'browser-resources': 'src/browser-resources.ts',
  electron: 'src/electron/index.ts',
  'electron-main': 'src/electron/main.ts',
  'electron-preload': 'src/electron/preload.ts',
};
for (const format of ['esm', 'cjs']) {
  await build({
    entryPoints:
      format === 'cjs'
        ? { ...nodeEntries, 'cli/index': 'src/cli/index.ts' }
        : nodeEntries,
    outdir: `dist/${format}`,
    outExtension: { '.js': format === 'esm' ? '.mjs' : '.js' },
    platform: 'node',
    target: 'node20',
    format,
    bundle: true,
    sourcemap: true,
    packages: 'external',
  });
}
await chmod('dist/cjs/cli/index.js', 0o755);
const browser = await build({
  entryPoints: {
    index: 'src/browser.ts',
    root: 'src/browser-root.ts',
    worker: 'src/worker/index.ts',
    resources: 'src/browser-resources.ts',
  },
  outdir: 'dist/browser',
  outExtension: { '.js': '.mjs' },
  chunkNames: 'chunks/[name]-[hash]',
  platform: 'browser',
  target: 'es2020',
  format: 'esm',
  bundle: true,
  splitting: true,
  sourcemap: true,
  metafile: true,
  inject: ['src/browser-buffer.ts'],
});
if (
  Object.keys(browser.metafile.inputs).some(path =>
    /src\/(?:logger|operations)\/|src\/reader\/chm-reader\.ts/.test(path),
  )
)
  throw new Error('Node-only dependency leaked into browser bundle');
if (
  Object.values(browser.metafile.outputs).some(output =>
    output.imports.some(item => item.external),
  )
)
  throw new Error('Browser bundle contains unresolved external dependencies');

try {
  execFileSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '--emitDeclarationOnly',
      '--outDir',
      'dist/declarations',
    ],
    { stdio: 'inherit', timeout: 120000 },
  );
  await mkdir('dist/types', { recursive: true });
  const entries = {
    index: 'index',
    browser: 'browser',
    'browser-root': 'browser-root',
    config: 'core/config',
    reader: 'reader/chm-reader',
    worker: 'worker/index',
    'browser-resources': 'browser-resources',
    electron: 'electron/index',
    'electron-main': 'electron/main',
    'electron-preload': 'electron/preload',
  };
  for (const [name, path] of Object.entries(entries)) {
    const bundle = await rollup({
      input: `dist/declarations/${path}.d.ts`,
      plugins: [dts()],
      onwarn(warning) {
        if (warning.code === 'UNRESOLVED_IMPORT')
          throw new Error(warning.message);
        console.warn(warning.message);
      },
    });
    try {
      await bundle.write({ file: `dist/types/${name}.d.ts`, format: 'es' });
    } finally {
      await bundle.close();
    }
    if (
      name.startsWith('browser') ||
      name === 'worker' ||
      name.startsWith('electron')
    ) {
      const declarations = await readFile(`dist/types/${name}.d.ts`, 'utf8');
      const surface = declarations.replace(/\/\*[\s\S]*?\*\//g, '');
      if (
        /\bBuffer\b|\bBufferEncoding\b|node:|reference types="node"/.test(
          surface,
        )
      )
        throw new Error(
          `${name} declarations depend on Node; fix the source type boundary`,
        );
    }
    await copyFile(`dist/types/${name}.d.ts`, `dist/types/${name}.d.mts`);
    await copyFile(`dist/types/${name}.d.ts`, `dist/types/${name}.d.cts`);
  }
} finally {
  await rm('dist/declarations', { recursive: true, force: true });
}
console.log('Built CHMKit (Node CJS/ESM + browser + declarations)');

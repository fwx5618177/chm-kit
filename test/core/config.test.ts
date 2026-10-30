import { test, beforeAll, afterAll } from 'vitest';
import {
  deepStrictEqual as equal,
  ok,
  strictEqual as is,
  throws,
} from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import {
  loadConfig,
  getConfig,
  resetConfigCache,
  defaultFullConfig,
  defaultChmFormatConfig,
  defaultLzxConfig,
  config,
} from '../../src/core/config';
import { logger } from '../../src/logger/logger';

let directory: string;
const originalWarn = logger.warn;
const originalError = logger.error;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'chmkit-config-'));
  logger.warn = () => {};
  logger.error = () => {};
});

afterAll(() => {
  logger.warn = originalWarn;
  logger.error = originalError;
  resetConfigCache();
  rmSync(directory, { recursive: true, force: true });
});

function load(value: unknown, validateConfig = true) {
  writeFileSync(join(directory, 'chmkit.config.json'), JSON.stringify(value));
  return loadConfig({ searchPaths: [directory], validateConfig });
}

function fallback(value: unknown) {
  const loaded = load(value);
  equal(loaded, defaultFullConfig);
  ok(loaded !== defaultFullConfig);
  ok(loaded.format !== defaultFullConfig.format);
}

test('partial configs merge deeply, replace arrays, and do not mutate inputs', () => {
  const input = {
    default: { maxMemory: 4096 },
    lzx: { windowSize: 0x10000, resetInterval: 0x10000, compressionLevel: 0 },
    format: {
      defaultFiles: { toc: 'custom.hhc' },
      supportedExtensions: ['.html', '.png'],
    },
    cli: { showProgress: false },
    performance: { compressionThreshold: 0 },
    validation: { strictMode: true },
  };
  const before = JSON.stringify(input);
  const loaded = load(input);
  equal(loaded.default, { ...defaultFullConfig.default, maxMemory: 4096 });
  equal(loaded.format!.defaultFiles, {
    ...defaultFullConfig.format!.defaultFiles,
    toc: 'custom.hhc',
  });
  equal(loaded.format!.supportedExtensions, ['.html', '.png']);
  equal(loaded.cli!.showProgress, false);
  equal(loaded.lzx!.compressionLevel, 0);
  equal(loaded.performance!.compressionThreshold, 0);
  equal(JSON.stringify(input), before);
  equal(defaultFullConfig.lzx, defaultLzxConfig);
});

for (const value of [null, [], 42, true, 'config']) {
  test(`invalid root ${JSON.stringify(value)} safely falls back`, () =>
    fallback(value));
}

const invalidSections: unknown[] = [null, [], false, 1, 'bad'];
for (const section of [
  'default',
  'lzx',
  'format',
  'cli',
  'performance',
  'validation',
]) {
  test(`invalid ${section} section types safely fall back`, () => {
    for (const value of invalidSections) fallback({ [section]: value });
  });
}

const invalidFields: [string, string, unknown[]][] = [
  ['default', 'logLevel', ['trace', 0, null]],
  ['default', 'tempDir', ['', '   ', 0, 'bad\0path']],
  [
    'default',
    'maxMemory',
    [0, -1, 0.5, '100', null, Number.MAX_SAFE_INTEGER + 1],
  ],
  ['default', 'logger', [{}, { error: 'function' }]],
  ['lzx', 'windowSize', [0, 0x4000, 0x9000, 0x400000, '32768']],
  [
    'lzx',
    'resetInterval',
    [0, -0x8000, 1, 0x8000 + 1, 0.5, 3 * 0x8000, 512 * 1024 * 1024],
  ],
  ['lzx', 'compressionLevel', [-1, 10, 1.5, '6']],
  ['format', 'itsfSignature', ['NOPE', 1]],
  ['format', 'itsfVersion', [1, 4, '3']],
  ['format', 'itspSignature', ['NOPE']],
  ['format', 'itspVersion', [0, 2]],
  ['format', 'lzxcSignature', ['NOPE']],
  ['format', 'lzxcVersion', [0, 3]],
  ['format', 'defaultFiles', [null, [], { toc: 1 }, { index: '' }]],
  [
    'format',
    'supportedExtensions',
    [null, '.html', [1], ['html'], ['.html/path']],
  ],
  ['cli', 'maxConcurrency', [0, -1, 1.5, '4']],
  ['cli', 'showProgress', [0, 1, 'false', null]],
  ['cli', 'colorOutput', ['true', {}]],
  ['cli', 'defaultOutputDir', ['', false]],
  ['cli', 'defaultOutputFile', ['', []]],
  ['cli', 'defaultTempDir', [null]],
  ['performance', 'chunkSize', [0, -1, 0.5]],
  ['performance', 'bufferSize', [0, '65536']],
  ['performance', 'maxFileSize', [0, Number.MAX_SAFE_INTEGER + 1]],
  ['performance', 'compressionThreshold', [-1, 0.5]],
  ['validation', 'validateHeaders', ['false', null]],
  ['validation', 'validateChecksums', [0]],
  ['validation', 'strictMode', [1]],
  ['validation', 'allowMissingFiles', [{}]],
];
for (const [section, field, invalid] of invalidFields) {
  test(`validates the type/range of ${section}.${field}`, () => {
    for (const value of invalid) fallback({ [section]: { [field]: value } });
  });
}

test('unknown fields are ignored in fresh objects without losing known values', () => {
  const loaded = load({
    ignored: 42,
    cli: { maxConcurrency: 2, ignored: true },
    format: { defaultFiles: { toc: 'toc.hhc', ignored: 'x' } },
  });
  equal(loaded.cli!.maxConcurrency, 2);
  equal(loaded.format!.defaultFiles!.toc, 'toc.hhc');
  ok(!Object.prototype.hasOwnProperty.call(loaded, 'ignored'));
  ok(!Object.prototype.hasOwnProperty.call(loaded.cli, 'ignored'));
  ok(
    !Object.prototype.hasOwnProperty.call(
      loaded.format!.defaultFiles,
      'ignored',
    ),
  );
});

test('rejects prototype-pollution keys at every supported nesting level', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const payload = JSON.parse(
      `{"${key}":{"prototype":{"chmkitPolluted":true},"chmkitPolluted":true}}`,
    );
    for (const value of [
      payload,
      { format: payload },
      { format: { defaultFiles: payload } },
    ]) {
      fallback(value);
      ok(!('chmkitPolluted' in {}));
      is(Object.getPrototypeOf(load(value)), Object.prototype);
    }
  }
});

test('malformed JSON, non-finite numbers and disabled validation fail safely', () => {
  for (const text of [
    '{',
    '{"default":{"maxMemory":1e400}}',
    '{"cli":{"maxConcurrency":NaN}}',
  ]) {
    writeFileSync(join(directory, 'chmkit.config.json'), text);
    equal(loadConfig({ searchPaths: [directory] }), defaultFullConfig);
  }
  equal(load({ cli: { maxConcurrency: 'unsafe' } }, false), defaultFullConfig);
  equal(
    load(JSON.parse('{"__proto__":{"chmkitPolluted":true}}'), false),
    defaultFullConfig,
  );
  ok(!('chmkitPolluted' in {}));
});

test('an invalid field rejects the whole config instead of partially applying it', () => {
  fallback({ cli: { maxConcurrency: 2 }, validation: { strictMode: 'false' } });
});

test('all load paths return isolated nested defaults and arrays', () => {
  const defaultsBefore = JSON.stringify(defaultFullConfig);
  const noFile = Object.freeze({
    searchPaths: Object.freeze([directory]) as unknown as string[],
    configFileName: 'missing.json',
  });
  for (const first of [loadConfig(noFile), load({}), load({ cli: null })]) {
    first.format!.defaultFiles!.toc = 'changed.hhc';
    first.format!.supportedExtensions!.push('.changed');
    first.lzx!.windowSize = 1;
    equal(JSON.stringify(defaultFullConfig), defaultsBefore);
    equal(loadConfig(noFile), defaultFullConfig);
  }
  ok(defaultFullConfig.format !== defaultChmFormatConfig);
  ok(
    defaultFullConfig.format!.defaultFiles !==
      defaultChmFormatConfig.defaultFiles,
  );
  ok(
    defaultFullConfig.format!.supportedExtensions !==
      defaultChmFormatConfig.supportedExtensions,
  );
  ok(config !== defaultFullConfig);
  ok(config.format !== defaultFullConfig.format);
});

test('config cache stays singleton until reset, without aliasing default templates', () => {
  resetConfigCache();
  const first = getConfig();
  is(getConfig(), first);
  ok(first !== defaultFullConfig);
  first.format!.supportedExtensions!.push('.cache-only');
  resetConfigCache();
  ok(getConfig() !== first);
  ok(!getConfig().format!.supportedExtensions!.includes('.cache-only'));
  ok(!defaultFullConfig.format!.supportedExtensions!.includes('.cache-only'));
});

test('explicit configuration paths override discovery and missing paths never silently fall back', () => {
  const explicit = join(directory, 'explicit.json');
  writeFileSync(explicit, JSON.stringify({ cli: { maxConcurrency: 7 } }));
  writeFileSync(join(directory, 'chmkit.config.json'), '{invalid');
  equal(
    loadConfig({ searchPaths: [directory], configPath: explicit, strict: true })
      .cli!.maxConcurrency,
    7,
  );
  throws(
    () => loadConfig({ configPath: join(directory, 'absent.json') }),
    /not found/,
  );
});

test('strict loading rejects invalid configuration and reports supplied known leaves without defaults', () => {
  writeFileSync(join(directory, 'chmkit.config.json'), '{invalid');
  throws(
    () => loadConfig({ searchPaths: [directory], strict: true }),
    /Failed to load/,
  );
  const fields: string[] = [];
  writeFileSync(
    join(directory, 'chmkit.config.json'),
    JSON.stringify({
      cli: { maxConcurrency: 3 },
      performance: { maxFileSize: 1024 },
    }),
  );
  const loaded = loadConfig({
    searchPaths: [directory],
    strict: true,
    onField: field => fields.push(field),
  });
  equal(fields, ['cli.maxConcurrency', 'performance.maxFileSize']);
  equal(loaded.cli!.maxConcurrency, 3);
  equal(loaded.cli!.showProgress, true);
});

test('logger catches failed ESM-only chalk loading in a CommonJS build', async () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/logger/logger.ts'),
    'utf8',
  );
  const output = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const messages: string[] = [];
  runInNewContext(output, {
    exports,
    require: (name: string) => {
      if (name === '../utils/helpers') return { formatTimestamp: () => 'time' };
      throw Object.assign(
        new Error('require() of ES Module chalk is not supported'),
        { code: 'ERR_REQUIRE_ESM' },
      );
    },
    console: { info: (message: string) => messages.push(message) },
  });
  const instance = exports.logger as { info(message: string): void };
  instance.info('before optional import settles');
  await new Promise<void>(resolve => setImmediate(resolve));
  instance.info('after optional import fails');
  equal(messages.length, 2);
  ok(messages[1]!.includes('after optional import fails'));
});

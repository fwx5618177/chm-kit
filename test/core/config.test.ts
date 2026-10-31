import { test, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
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
  getLzxConfig,
  getCliConfig,
  getPerformanceConfig,
  resetConfigCache,
  defaultFullConfig,
  defaultLzxConfig,
  defaultCliConfig,
  defaultPerformanceConfig,
} from '../../src/core/config';
import { logger } from '../../src/logger/logger';

let directory: string;
let warnings: string[];
let errors: string[];
const originalWarn = logger.warn;
const originalError = logger.error;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'chmkit-config-'));
});

beforeEach(() => {
  warnings = [];
  errors = [];
  logger.warn = (message: string) => {
    warnings.push(message);
  };
  logger.error = (message: string) => {
    errors.push(message);
  };
  resetConfigCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  logger.warn = originalWarn;
  logger.error = originalError;
  resetConfigCache();
  rmSync(directory, { recursive: true, force: true });
});

function writeRaw(text: string) {
  writeFileSync(join(directory, 'chmkit.config.json'), text);
}

function load(value: unknown, strict = false) {
  writeRaw(JSON.stringify(value));
  return loadConfig({ searchPaths: [directory], strict });
}

function fallback(value: unknown) {
  const loaded = load(value);
  equal(loaded, defaultFullConfig);
  ok(loaded !== defaultFullConfig);
  ok(loaded.lzx !== defaultFullConfig.lzx);
}

test('defaults expose exactly the effective lzx, cli and performance sections', () => {
  equal(Object.keys(defaultFullConfig).sort(), ['cli', 'lzx', 'performance']);
  equal(defaultFullConfig.lzx, defaultLzxConfig);
  equal(defaultFullConfig.cli, defaultCliConfig);
  equal(defaultFullConfig.performance, defaultPerformanceConfig);
  equal(defaultLzxConfig, {
    windowSize: 0x8000,
    resetInterval: 0x8000,
    compressionLevel: 6,
  });
});

test('missing config files return an isolated copy of the defaults', () => {
  const missing = { searchPaths: [join(directory, 'nothing-here')] };
  const first = loadConfig(missing);
  equal(first, defaultFullConfig);
  first.cli!.maxConcurrency = 99;
  first.lzx!.compressionLevel = 0;
  equal(loadConfig(missing), defaultFullConfig);
  ok(first.cli !== defaultFullConfig.cli);
});

test('partial configs merge deeply and never mutate the input or defaults', () => {
  const input = {
    lzx: { windowSize: 0x10000, compressionLevel: 0 },
    cli: { showProgress: false },
    performance: { chunkSize: 4096 },
  };
  const before = JSON.stringify(input);
  const loaded = load(input);
  equal(loaded.lzx, {
    windowSize: 0x10000,
    resetInterval: 0x8000,
    compressionLevel: 0,
  });
  equal(loaded.cli, { ...defaultCliConfig, showProgress: false });
  equal(loaded.performance, {
    ...defaultPerformanceConfig,
    chunkSize: 4096,
  });
  equal(JSON.stringify(input), before);
  equal(defaultLzxConfig.windowSize, 0x8000);
  equal(warnings, []);
});

test('an empty object keeps every default', () => {
  equal(load({}), defaultFullConfig);
  equal(warnings, []);
});

test('window size accepts only power-of-two LZX windows from 32KB to 2MB', () => {
  for (const windowSize of [0x8000, 0x10000, 0x100000, 0x200000]) {
    is(load({ lzx: { windowSize } }).lzx!.windowSize, windowSize);
  }
  for (const windowSize of [
    0,
    -0x8000,
    0x4000,
    0x9000,
    0x400000,
    0x8000 + 1,
    '32768',
    null,
    Number.NaN,
  ]) {
    fallback({ lzx: { windowSize } });
  }
});

test('reset interval accepts power-of-two values from 32KB to 256MB', () => {
  for (const resetInterval of [0x8000, 0x100000, 256 * 1024 * 1024]) {
    is(load({ lzx: { resetInterval } }).lzx!.resetInterval, resetInterval);
  }
  for (const resetInterval of [
    0,
    1,
    0.5,
    0x8000 + 1,
    3 * 0x8000,
    512 * 1024 * 1024,
    '32768',
  ]) {
    fallback({ lzx: { resetInterval } });
  }
});

test('compression level accepts the inclusive range 0 to 9', () => {
  for (const compressionLevel of [0, 1, 9]) {
    is(
      load({ lzx: { compressionLevel } }).lzx!.compressionLevel,
      compressionLevel,
    );
  }
  for (const compressionLevel of [-1, 10, 1.5, '6', null]) {
    fallback({ lzx: { compressionLevel } });
  }
});

test('cli string options reject empty, whitespace-only, NUL-containing and non-string values', () => {
  is(load({ cli: { defaultOutputDir: 'out' } }).cli!.defaultOutputDir, 'out');
  is(
    load({ cli: { defaultOutputFile: '/tmp/a.chm' } }).cli!.defaultOutputFile,
    '/tmp/a.chm',
  );
  for (const defaultOutputDir of ['', '   ', 'bad\0path', 0, false, []]) {
    fallback({ cli: { defaultOutputDir } });
  }
  for (const defaultOutputFile of ['', '\t', 'bad\0file', null]) {
    fallback({ cli: { defaultOutputFile } });
  }
});

test('cli maxConcurrency is a positive safe integer', () => {
  is(load({ cli: { maxConcurrency: 1 } }).cli!.maxConcurrency, 1);
  for (const maxConcurrency of [0, -1, 1.5, '4', Number.MAX_SAFE_INTEGER + 1]) {
    fallback({ cli: { maxConcurrency } });
  }
});

test('cli showProgress accepts only booleans', () => {
  is(load({ cli: { showProgress: false } }).cli!.showProgress, false);
  for (const showProgress of [0, 1, 'false', null]) {
    fallback({ cli: { showProgress } });
  }
});

test('performance chunkSize and maxFileSize are positive safe integers', () => {
  is(load({ performance: { chunkSize: 1 } }).performance!.chunkSize, 1);
  is(
    load({ performance: { maxFileSize: Number.MAX_SAFE_INTEGER } }).performance!
      .maxFileSize,
    Number.MAX_SAFE_INTEGER,
  );
  for (const chunkSize of [0, -1, 0.5, '32768']) {
    fallback({ performance: { chunkSize } });
  }
  for (const maxFileSize of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    fallback({ performance: { maxFileSize } });
  }
});

test('non-object section values fall back to defaults for the whole file', () => {
  for (const section of ['lzx', 'cli', 'performance']) {
    for (const value of [null, [], false, 1, 'bad']) {
      fallback({ [section]: value });
    }
  }
});

test('non-object root values fall back to defaults', () => {
  for (const value of [null, [], 42, true, 'config']) {
    fallback(value);
  }
});

test('removed or unknown keys are ignored with a warning and do not affect known values', () => {
  const loaded = load({
    default: { maxMemory: 4096 },
    format: { defaultFiles: { toc: 'custom.hhc' } },
    validation: { strictMode: true },
    cli: { maxConcurrency: 2, colorOutput: true },
    performance: { bufferSize: 1024, chunkSize: 4096 },
    lzx: { windowSize: 0x10000, extra: 1 },
    ignored: 42,
  });
  equal(loaded, {
    lzx: { ...defaultLzxConfig, windowSize: 0x10000 },
    cli: { ...defaultCliConfig, maxConcurrency: 2 },
    performance: { ...defaultPerformanceConfig, chunkSize: 4096 },
  });
  ok(!Object.prototype.hasOwnProperty.call(loaded, 'default'));
  ok(!Object.prototype.hasOwnProperty.call(loaded, 'format'));
  ok(!Object.prototype.hasOwnProperty.call(loaded, 'validation'));
  ok(!Object.prototype.hasOwnProperty.call(loaded.cli, 'colorOutput'));
  ok(!Object.prototype.hasOwnProperty.call(loaded.performance, 'bufferSize'));
  equal([...warnings].sort(), [
    "Unknown config key 'cli.colorOutput' will be ignored",
    "Unknown config key 'default' will be ignored",
    "Unknown config key 'format' will be ignored",
    "Unknown config key 'ignored' will be ignored",
    "Unknown config key 'lzx.extra' will be ignored",
    "Unknown config key 'performance.bufferSize' will be ignored",
    "Unknown config key 'validation' will be ignored",
  ]);
  equal(errors, []);
});

test('prototype-pollution keys are rejected at every nesting level', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const payload = JSON.parse(
      `{"${key}":{"prototype":{"chmkitPolluted":true},"chmkitPolluted":true}}`,
    );
    for (const value of [
      payload,
      { cli: payload },
      { performance: { ...payload } },
    ]) {
      fallback(value);
    }
  }
  ok(!('chmkitPolluted' in {}));
});

test('malformed JSON and non-finite numbers fall back without throwing when not strict', () => {
  for (const text of [
    '{',
    '{"cli":{"maxConcurrency":NaN}}',
    '{"performance":{"chunkSize":1e400}}',
  ]) {
    writeRaw(text);
    equal(loadConfig({ searchPaths: [directory] }), defaultFullConfig);
  }
  ok(errors.length >= 3);
  ok(
    warnings.includes(
      'Failed to load config file, using default configuration',
    ),
  );
});

test('an invalid field rejects the whole file instead of partially applying it', () => {
  fallback({ cli: { maxConcurrency: 2 }, lzx: { compressionLevel: 10 } });
});

test('strict loading throws for invalid files and reports the file path', () => {
  writeRaw('{invalid');
  throws(
    () => loadConfig({ searchPaths: [directory], strict: true }),
    /Failed to load config file/,
  );
  writeRaw(JSON.stringify({ cli: { maxConcurrency: 0 } }));
  throws(
    () => loadConfig({ searchPaths: [directory], strict: true }),
    /Invalid config value 'cli.maxConcurrency'/,
  );
});

test('an explicit configPath overrides discovery and a missing explicit path throws', () => {
  const explicit = join(directory, 'explicit.json');
  writeFileSync(explicit, JSON.stringify({ cli: { maxConcurrency: 7 } }));
  writeRaw('{invalid');
  equal(
    loadConfig({
      searchPaths: [directory],
      configPath: explicit,
      strict: true,
    }).cli!.maxConcurrency,
    7,
  );
  throws(
    () => loadConfig({ configPath: join(directory, 'absent.json') }),
    /Config file not found/,
  );
});

test('discovery uses the first search path that contains the config file', () => {
  const first = mkdtempSync(join(tmpdir(), 'chmkit-first-'));
  const second = mkdtempSync(join(tmpdir(), 'chmkit-second-'));
  try {
    writeFileSync(
      join(first, 'chmkit.config.json'),
      JSON.stringify({ cli: { maxConcurrency: 3 } }),
    );
    writeFileSync(
      join(second, 'chmkit.config.json'),
      JSON.stringify({ cli: { maxConcurrency: 9 } }),
    );
    equal(loadConfig({ searchPaths: [first, second] }).cli!.maxConcurrency, 3);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('custom configFileName is honored during discovery', () => {
  writeFileSync(
    join(directory, 'custom.json'),
    JSON.stringify({ performance: { chunkSize: 2048 } }),
  );
  equal(
    loadConfig({
      searchPaths: [directory],
      configFileName: 'custom.json',
    }).performance!.chunkSize,
    2048,
  );
});

function useDirectoryAsCwd() {
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
}

test('config cache is a singleton until reset and never aliases defaults', () => {
  useDirectoryAsCwd();
  writeRaw(JSON.stringify({ cli: { maxConcurrency: 5 } }));
  const first = getConfig();
  is(getConfig(), first);
  ok(first !== defaultFullConfig);
  equal(getCliConfig().maxConcurrency, 5);
  first.cli!.maxConcurrency = 8;
  equal(defaultCliConfig.maxConcurrency, 4);
  resetConfigCache();
  rmSync(join(directory, 'chmkit.config.json'));
  equal(getCliConfig().maxConcurrency, defaultCliConfig.maxConcurrency);
  ok(getConfig() !== first);
});

test('section accessors return the cached sections', () => {
  useDirectoryAsCwd();
  writeRaw('{}');
  resetConfigCache();
  const config = getConfig();
  is(getLzxConfig(), config.lzx);
  is(getCliConfig(), config.cli);
  is(getPerformanceConfig(), config.performance);
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

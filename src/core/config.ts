import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type {
  LZXConfig,
  CLIConfig,
  PerformanceConfig,
  CHMKitConfig,
  ConfigLoadOptions,
} from './types';
import { logger } from '../logger/logger';

/**
 * 默认 LZX 压缩配置
 */
export const defaultLzxConfig: LZXConfig = {
  windowSize: 0x8000, // 32KB
  resetInterval: 0x8000,
  compressionLevel: 6,
};

/**
 * 默认 CLI 配置
 */
export const defaultCliConfig: CLIConfig = {
  defaultOutputDir: './output',
  defaultOutputFile: './output.chm',
  maxConcurrency: 4,
  showProgress: true,
};

/**
 * 默认性能配置
 */
export const defaultPerformanceConfig: PerformanceConfig = {
  chunkSize: 0x8000, // 32KB
  maxFileSize: 1024 * 1024 * 500, // 500MB
};

/**
 * 完整的默认配置
 */
export const defaultFullConfig: CHMKitConfig = {
  lzx: cloneValue(defaultLzxConfig),
  cli: cloneValue(defaultCliConfig),
  performance: cloneValue(defaultPerformanceConfig),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function assertSafeKey(key: string): void {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new Error(`Unsafe config key '${key}'`);
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item)) as T;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      assertSafeKey(key);
      result[key] = cloneValue(value[key]);
    }
    return result as T;
  }
  return value;
}

/** Merge only own properties and never share mutable default/source values. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = cloneValue(target);
  for (const key of Object.keys(source)) {
    assertSafeKey(key);
    const sourceValue = source[key];
    if (sourceValue === undefined) continue;
    const targetValue = Object.prototype.hasOwnProperty.call(result, key)
      ? result[key]
      : undefined;
    result[key] =
      isPlainObject(targetValue) && isPlainObject(sourceValue)
        ? deepMerge(targetValue, sourceValue)
        : cloneValue(sourceValue);
  }
  return result;
}

type ConfigRule = (value: unknown) => boolean;
type ConfigSchema = { [key: string]: ConfigRule | ConfigSchema };

const positiveInteger: ConfigRule = value =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nonNegativeInteger: ConfigRule = value =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const nonEmptyString: ConfigRule = value =>
  typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const booleanValue: ConfigRule = value => typeof value === 'boolean';

const configSchema: ConfigSchema = {
  lzx: {
    windowSize: value =>
      positiveInteger(value) &&
      (value as number) >= 0x8000 &&
      (value as number) <= 0x200000 &&
      Number.isInteger(Math.log2(value as number)),
    resetInterval: value =>
      positiveInteger(value) &&
      (value as number) >= 0x8000 &&
      (value as number) <= 256 * 1024 * 1024 &&
      Number.isInteger(Math.log2(value as number)),
    compressionLevel: value =>
      nonNegativeInteger(value) && (value as number) <= 9,
  },
  cli: {
    defaultOutputDir: nonEmptyString,
    defaultOutputFile: nonEmptyString,
    maxConcurrency: positiveInteger,
    showProgress: booleanValue,
  },
  performance: {
    chunkSize: positiveInteger,
    maxFileSize: positiveInteger,
  },
};

/**
 * Validate a partial config into a new object. Unknown keys (including removed
 * compatibility fields) are warned about and omitted; known keys are type-checked.
 */
function validateConfig(
  value: unknown,
  schema: ConfigSchema,
  path = '',
): Record<string, unknown> {
  if (!isPlainObject(value))
    throw new Error(`Invalid config object '${path || 'root'}'`);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    assertSafeKey(key);
    const field = path ? `${path}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      logger.warn(`Unknown config key '${field}' will be ignored`);
      continue;
    }
    const rule = schema[key]!;
    const item = value[key];
    if (typeof rule === 'function') {
      if (!rule(item)) throw new Error(`Invalid config value '${field}'`);
      result[key] = cloneValue(item);
    } else {
      result[key] = validateConfig(item, rule, field);
    }
  }
  return result;
}

/**
 * 查找配置文件
 */
function findConfigFile(options: ConfigLoadOptions = {}): string | null {
  if (options.configPath !== undefined) {
    const path = resolve(options.configPath);
    if (!existsSync(path)) throw new Error(`Config file not found: ${path}`);
    return path;
  }
  const {
    searchPaths = [process.cwd()],
    configFileName = 'chmkit.config.json',
  } = options;

  for (const searchPath of searchPaths) {
    const configPath = resolve(searchPath, configFileName);
    if (existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * 从文件加载配置
 */
function loadConfigFromFile(
  configPath: string,
  options: ConfigLoadOptions,
): CHMKitConfig | null {
  try {
    const configContent = readFileSync(configPath, 'utf-8');
    return validateConfig(
      JSON.parse(configContent),
      configSchema,
    ) as CHMKitConfig;
  } catch (error) {
    if (options.strict) {
      throw new Error(
        `Failed to load config file ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    logger.error(`Failed to load config file: ${configPath}`, error);
    return null;
  }
}

/**
 * 加载并合并配置
 */
export function loadConfig(options: ConfigLoadOptions = {}): CHMKitConfig {
  const configPath = findConfigFile(options);

  if (!configPath) {
    // 没有找到配置文件，使用独立的默认配置副本
    return cloneValue(defaultFullConfig);
  }

  const userConfig = loadConfigFromFile(configPath, options);

  if (!userConfig) {
    // 配置文件加载失败，使用默认配置
    logger.warn('Failed to load config file, using default configuration');
    return cloneValue(defaultFullConfig);
  }

  // 合并用户配置和默认配置
  const mergedConfig = deepMerge(
    defaultFullConfig as Record<string, unknown>,
    userConfig as Record<string, unknown>,
  ) as CHMKitConfig;

  return mergedConfig;
}

/**
 * 获取配置（单例模式）
 */
let cachedConfig: CHMKitConfig | null = null;

export function getConfig(forceReload = false): CHMKitConfig {
  if (!cachedConfig || forceReload) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * 重置配置缓存
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

export function getLzxConfig(): LZXConfig {
  return getConfig().lzx!;
}

export function getCliConfig(): CLIConfig {
  return getConfig().cli!;
}

export function getPerformanceConfig(): PerformanceConfig {
  return getConfig().performance!;
}

export default getConfig;

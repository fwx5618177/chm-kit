import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type {
  CHMOptions,
  LZXConfig,
  CHMFormatConfig,
  CLIConfig,
  PerformanceConfig,
  ValidationConfig,
  CHMKitConfig,
  ConfigLoadOptions,
} from './types';
import { logger } from '../logger/logger';

/**
 * 默认 CHMKit 配置
 */
export const defaultConfig: CHMOptions = {
  logLevel: 'info',
  tempDir: './temp',
  maxMemory: 1024 * 1024 * 100, // 100MB
};

/**
 * 默认 LZX 压缩配置
 */
export const defaultLzxConfig: LZXConfig = {
  windowSize: 0x8000, // 32KB
  resetInterval: 0x8000,
  compressionLevel: 6,
};

/**
 * 默认 CHM 文件格式配置
 */
export const defaultChmFormatConfig: CHMFormatConfig = {
  // ITSF 头部配置
  itsfSignature: 'ITSF',
  itsfVersion: 3,

  // ITSP 头部配置
  itspSignature: 'ITSP',
  itspVersion: 1,

  // LZXC 头部配置
  lzxcSignature: 'LZXC',
  lzxcVersion: 2,

  // 默认文件名
  defaultFiles: {
    toc: 'Table of Contents.hhc',
    index: 'Index.hhk',
    project: 'Project.hhp',
  },

  // 支持的文件扩展名
  supportedExtensions: [
    '.html',
    '.htm',
    '.css',
    '.js',
    '.json',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.xml',
    '.txt',
    '.md',
  ],
};

/**
 * 默认 CLI 配置
 */
export const defaultCliConfig: CLIConfig = {
  defaultOutputDir: './output',
  defaultOutputFile: './output.chm',
  defaultTempDir: './temp',
  maxConcurrency: 4,
  showProgress: true,
  colorOutput: true,
};

/**
 * 默认性能配置
 */
export const defaultPerformanceConfig: PerformanceConfig = {
  chunkSize: 0x8000, // 32KB
  bufferSize: 0x10000, // 64KB
  maxFileSize: 1024 * 1024 * 500, // 500MB
  compressionThreshold: 1024, // 1KB
};

/**
 * 默认验证配置
 */
export const defaultValidationConfig: ValidationConfig = {
  validateHeaders: true,
  validateChecksums: true,
  strictMode: false,
  allowMissingFiles: false,
};

/**
 * 完整的默认配置
 */
export const defaultFullConfig: CHMKitConfig = {
  default: cloneValue(defaultConfig),
  lzx: cloneValue(defaultLzxConfig),
  format: cloneValue(defaultChmFormatConfig),
  cli: cloneValue(defaultCliConfig),
  performance: cloneValue(defaultPerformanceConfig),
  validation: cloneValue(defaultValidationConfig),
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
const oneOf =
  (...values: unknown[]): ConfigRule =>
  value =>
    values.includes(value);

function configSchema(): ConfigSchema {
  return {
    default: {
      logLevel: oneOf('error', 'warn', 'info', 'debug', 'verbose', 'success'),
      tempDir: nonEmptyString,
      maxMemory: positiveInteger,
      logger: value =>
        isPlainObject(value) &&
        ['error', 'warn', 'info', 'debug', 'verbose', 'success'].every(
          method => typeof value[method] === 'function',
        ),
    },
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
    format: {
      itsfSignature: oneOf('ITSF'),
      itsfVersion: oneOf(2, 3),
      itspSignature: oneOf('ITSP'),
      itspVersion: oneOf(1),
      lzxcSignature: oneOf('LZXC'),
      lzxcVersion: oneOf(1, 2),
      defaultFiles: {
        toc: nonEmptyString,
        index: nonEmptyString,
        project: nonEmptyString,
      },
      supportedExtensions: value =>
        Array.isArray(value) &&
        value.every(
          extension =>
            typeof extension === 'string' &&
            /^\.[a-z0-9][a-z0-9_-]*$/i.test(extension),
        ),
    },
    cli: {
      defaultOutputDir: nonEmptyString,
      defaultOutputFile: nonEmptyString,
      defaultTempDir: nonEmptyString,
      maxConcurrency: positiveInteger,
      showProgress: booleanValue,
      colorOutput: booleanValue,
    },
    performance: {
      chunkSize: positiveInteger,
      bufferSize: positiveInteger,
      maxFileSize: positiveInteger,
      compressionThreshold: nonNegativeInteger,
    },
    validation: {
      validateHeaders: booleanValue,
      validateChecksums: booleanValue,
      strictMode: booleanValue,
      allowMissingFiles: booleanValue,
    },
  };
}

/** Validate a partial config into a new object; unknown fields remain ignored. */
function validateConfig(
  value: unknown,
  schema: ConfigSchema,
  path = '',
  onField?: (path: string) => void,
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
      onField?.(field);
    } else {
      result[key] = validateConfig(item, rule, field, onField);
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
    // Safety/type checks are mandatory, even with validateConfig: false.
    return validateConfig(
      JSON.parse(configContent),
      configSchema(),
      '',
      options.onField,
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

/**
 * 获取指定类型的配置
 */
export function getDefaultConfig(): CHMOptions {
  return getConfig().default!;
}

export function getLzxConfig(): LZXConfig {
  return getConfig().lzx!;
}

export function getChmFormatConfig(): CHMFormatConfig {
  return getConfig().format!;
}

export function getCliConfig(): CLIConfig {
  return getConfig().cli!;
}

export function getPerformanceConfig(): PerformanceConfig {
  return getConfig().performance!;
}

export function getValidationConfig(): ValidationConfig {
  return getConfig().validation!;
}

/**
 * 导出默认配置（向后兼容）
 */
export const config = cloneValue(defaultFullConfig);

export default getConfig;

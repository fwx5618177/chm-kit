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
  default: defaultConfig,
  lzx: defaultLzxConfig,
  format: defaultChmFormatConfig,
  cli: defaultCliConfig,
  performance: defaultPerformanceConfig,
  validation: defaultValidationConfig,
};

/**
 * 深度合并两个对象
 */
function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue) as T[Extract<
          keyof T,
          string
        >];
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}

/**
 * 验证配置对象
 */
function validateConfig(config: any): config is CHMKitConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }

  // 验证顶级配置项
  const validKeys = [
    'default',
    'lzx',
    'format',
    'cli',
    'performance',
    'validation',
  ];
  for (const key in config) {
    if (!validKeys.includes(key)) {
      console.warn(`Warning: Unknown config key '${key}' will be ignored`);
      delete config[key];
    }
  }

  return true;
}

/**
 * 查找配置文件
 */
function findConfigFile(options: ConfigLoadOptions = {}): string | null {
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
function loadConfigFromFile(configPath: string): CHMKitConfig | null {
  try {
    const configContent = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    if (!validateConfig(config)) {
      console.error(`Invalid config file: ${configPath}`);
      return null;
    }

    return config;
  } catch (error) {
    console.error(`Failed to load config file: ${configPath}`, error);
    return null;
  }
}

/**
 * 加载并合并配置
 */
export function loadConfig(options: ConfigLoadOptions = {}): CHMKitConfig {
  const configPath = findConfigFile(options);

  if (!configPath) {
    // 没有找到配置文件，使用默认配置
    return defaultFullConfig;
  }

  const userConfig = loadConfigFromFile(configPath);

  if (!userConfig) {
    // 配置文件加载失败，使用默认配置
    console.warn('Failed to load config file, using default configuration');
    return defaultFullConfig;
  }

  // 合并用户配置和默认配置
  const mergedConfig = deepMerge(defaultFullConfig, userConfig);

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
export const config = defaultFullConfig;

export default getConfig;

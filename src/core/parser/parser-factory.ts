import { CHMParser } from './chm-parser';
import { CHMParserValidator } from './parser-validator';
import type { ParsedCHM } from '../types';
import type { ByteSource } from '../files/byte-source';

type ParserOptions = {
  enableResetTable?: boolean;
  strictValidation?: boolean;
};

class ConfiguredCHMParser extends CHMParser {
  constructor(private readonly strictValidation: boolean) {
    super();
  }

  override parseSource(source: ByteSource): ParsedCHM {
    const parsed = super.parseSource(source);
    if (
      this.strictValidation &&
      !CHMParserValidator.validate(parsed, {
        strict: true,
        fileSize: source.size,
      })
    ) {
      this.reset();
      throw new Error('Strict CHM validation failed');
    }
    return parsed;
  }
}

/** Factory options can add validation, never disable mandatory safety checks. */
export class CHMParserFactory {
  static create(): CHMParser {
    return new CHMParser();
  }

  static createWithOptions(options: ParserOptions = {}): CHMParser {
    if (
      options === null ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype &&
        Object.getPrototypeOf(options) !== null)
    ) {
      throw new Error('Invalid parser options');
    }
    for (const key of Object.keys(options)) {
      if (key !== 'enableResetTable' && key !== 'strictValidation') {
        throw new Error(`Unsupported parser option: ${key}`);
      }
      if (options[key] !== undefined && typeof options[key] !== 'boolean') {
        throw new Error(`Parser option '${key}' must be a boolean`);
      }
    }
    if (options.enableResetTable === false) {
      throw new Error(
        'enableResetTable: false is not supported; ResetTable validation is required for compressed archives',
      );
    }
    return new ConfiguredCHMParser(options.strictValidation === true);
  }

  /** Retain mandatory compression-metadata validation, including in quickParse. */
  static createLightweight(): CHMParser {
    return new CHMParser();
  }
}

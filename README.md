# CHMKit

A TypeScript library for reading, parsing, and compressing `.chm` files, providing both CLI tools and API interfaces.

**English** | [中文](README_zh.md)

## Introduction

CHMKit is a TypeScript library for reading, parsing, and compressing `.chm` files, providing both CLI tools and API interfaces.

## Installation

```bash
# Using npm
npm install -g chmkit

# Using pnpm
pnpm add -g chmkit

# Using yarn
yarn global add chmkit
```

## CLI Commands

```bash
# Show help
chmkit --help

# Extract CHM file contents
chmkit extract input.chm -o output/
chmkit extract input.chm --output ./docs --filter "*.html" --preserve-structure --verbose

# Pack directory to CHM file
chmkit pack ./docs -o help.chm
chmkit pack ./src --output manual.chm --title "User Manual" --compression --verbose

# Show CHM file information
chmkit info input.chm
chmkit info input.chm --json --verbose
```

## API Usage

```typescript
import { CHMKit } from 'chmkit';

// Parse CHM file
const chmData = await CHMKit.parse('input.chm');

// Extract file contents
await CHMKit.extract('input.chm', './output');

// Pack directory
await CHMKit.pack('./docs', 'help.chm');

// Get file information
const info = await CHMKit.getInfo('input.chm');
```

## Configuration

CHMKit supports customization through a `chmkit.config.json` configuration file in your project root. If no configuration file is found, default settings will be used.

### Basic Configuration

Create a `chmkit.config.json` file in your project root:

```json
{
  "default": {
    "logLevel": "info",
    "tempDir": "./temp",
    "maxMemory": 104857600
  },
  "cli": {
    "showProgress": true,
    "maxConcurrency": 4,
    "colorOutput": true
  },
  "performance": {
    "chunkSize": 32768,
    "bufferSize": 65536
  }
}
```

### Configuration Options

- **`default`** - Basic CHMKit settings (log level, temp directory, memory limits)
- **`lzx`** - LZX compression parameters (window size, compression level)
- **`format`** - CHM file format settings (signatures, versions, supported extensions)
- **`cli`** - CLI tool behavior (output settings, concurrency, progress display)
- **`performance`** - Performance tuning (chunk sizes, buffers, thresholds)
- **`validation`** - File validation settings (header checks, checksums, strict mode)

### Using Configuration in Code

```typescript
import { getConfig, getCliConfig } from 'chmkit/config';

// Get complete configuration
const config = getConfig();

// Get specific configuration section
const cliConfig = getCliConfig();

// Reload configuration
const newConfig = getConfig(true);
```

For detailed configuration options, see [CONFIG.md](CONFIG.md) and check the [example configuration file](chmkit.config.json.example).

## Node.js Requirements

- Node.js >= 20.10.0

## Development

```bash
# Clone the project
git clone <repository-url>
cd chmkit

# Install dependencies
pnpm install

# Development build
pnpm build

# Lint code
pnpm lint

# Format code
pnpm format
```

## License

MIT License - see the [LICENSE](LICENSE) file for details.

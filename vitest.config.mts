import { defineConfig } from 'vitest/config';

const node = {
  environment: 'node' as const,
  pool: 'forks' as const,
  // Binary safety tests temporarily instrument globals and decoder prototypes.
  fileParallelism: false,
  isolate: true,
  testTimeout: 60_000,
  hookTimeout: 120_000,
};

export default defineConfig({
  test: {
    fileParallelism: false,
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/vitest.json' },
    projects: [
      {
        test: {
          ...node,
          name: 'node',
          include: ['test/**/*.test.{ts,mjs}'],
          benchmark: {
            include: ['test/bench/**/*.bench.ts'],
            outputJson: 'test-results/bench/vitest-benchmark.json',
          },
          exclude: ['test/package/**', 'test/browser/**'],
        },
      },
      {
        test: {
          ...node,
          name: 'package',
          include: ['test/package/**/*.test.ts'],
          globalSetup: ['test/package/global-setup.ts'],
        },
      },
    ],
  },
});

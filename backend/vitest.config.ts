import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests share a single real Postgres (the CI service container
    // or one Docker container per process). Running test files in parallel
    // would race on the migration runner's CREATE EXTENSION. Force serial
    // execution: one fork at a time, no parallel file scheduling.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // entry point, exercised by integration test indirectly
        'src/**/*.test.ts',
        'src/db/migrate.ts', // CLI; covered indirectly by integration test
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});

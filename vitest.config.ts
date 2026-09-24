import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Each suite boots the API in a specific LAB_MODE and shares one SQLite
    // file, so the suites must not run at the same time.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30_000,
    testTimeout: 30_000,
    reporters: ['verbose'],
  },
});

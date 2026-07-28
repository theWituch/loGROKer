import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 15_000,
    coverage: {
      include: ['src/server/**/*.ts', 'src/web/**/*.ts', 'src/web/**/*.tsx'],
    },
  },
});

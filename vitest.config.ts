/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    // Run tests from both existing __tests__ dirs and new tests/ folder
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['node_modules/', 'dist/', 'src/**/__tests__/**']
    }
  }
});

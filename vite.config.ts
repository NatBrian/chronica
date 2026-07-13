import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
} as any);

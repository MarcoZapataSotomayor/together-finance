import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    setupFiles: ['./test/setup-env.ts'],
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});

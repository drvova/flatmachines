import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@memgrafter/flatagents': fileURLToPath(new URL('./packages/flatagents/src/index.ts', import.meta.url)),
      '@memgrafter/flatmachines': fileURLToPath(new URL('./packages/flatmachines/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});

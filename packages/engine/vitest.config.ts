import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Explicitly exclude Playwright E2E specs — those run via `pnpm test:docs`
    exclude: ['e2e-tests/**', '**/node_modules/**'],
    include: ['src/**/*.test.ts'],
  },
});

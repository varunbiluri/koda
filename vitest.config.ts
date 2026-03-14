import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    // Suppress dotenvx log spam: sets DOTENV_QUIET before any module loads
    setupFiles: ['./tests/setup.ts'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    // Suppress dotenvx log spam: sets DOTENV_QUIET before any module loads
    setupFiles: ['./tests/setup.ts'],
    server: {
      deps: {
        // natural@8 uses CJS internally and requires afinn-165 (ESM-only).
        // Force it through Vite's transform pipeline to resolve CJS/ESM on Node 18.
        inline: ['natural', 'afinn-165'],
      },
    },
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Every test runs fully offline: mock PayPal gateway, in-memory SQLite, no LLM key.
    env: { SELLERPILOT_DB: ':memory:', PAYPAL_MODE: 'mock', LLM_PROVIDER: 'offline', SEED_DEMO_DATA: 'false', APP_BASE_URL: 'http://localhost:3000', CRON_SECRET: 'test-secret' },
    restoreMocks: true,
  },
});

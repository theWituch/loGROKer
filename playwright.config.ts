import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm start -- --log ./log.log --grok ./pattern.cfg',
    port: 3000,
    reuseExistingServer: true,
  },
});

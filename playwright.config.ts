import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm start -- --log ./tests/fixtures/log.log --config ./tests/fixtures/config.yml --port ${port}`,
    port,
    reuseExistingServer: true,
  },
});

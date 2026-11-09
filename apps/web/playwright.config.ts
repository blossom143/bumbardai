import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90000,
  use: { baseURL: process.env.HALLWAY_APP_URL || 'http://localhost:3000', trace: 'retain-on-failure' },
});

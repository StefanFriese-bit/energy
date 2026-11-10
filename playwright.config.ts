import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4193/energy/', serviceWorkers: 'block', timezoneId: 'Africa/Johannesburg' },
  webServer: { command: 'npx vite preview --port 4193 --strictPort', url: 'http://localhost:4193/energy/', reuseExistingServer: false },
  projects: [
    { name: 'iphone-safari-engine', use: { ...devices['iPhone 15'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

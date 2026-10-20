const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './integration', timeout: 45000, workers: 1, retries: 0, maxFailures: 1,
  forbidOnly: Boolean(process.env.CI),
  globalSetup: require.resolve('./global-setup.cjs'),
  reporter: [['list'], ['json', { outputFile: 'out/integration.json' }]],
  outputDir: 'test-results',
  use: { headless: true, viewport: { width: 1366, height: 768 }, timezoneId: 'Asia/Shanghai', actionTimeout: 7000, trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'firefox', use: { browserName: 'firefox' } }, { name: 'webkit', use: { browserName: 'webkit' } }]
});

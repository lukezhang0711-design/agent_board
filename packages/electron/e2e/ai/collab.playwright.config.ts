import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const electronPackageDir = path.resolve(__dirname, '../..');
const testResultsDir = path.resolve(electronPackageDir, '../../e2e_test_output/test-results');
const htmlReportDir = path.resolve(electronPackageDir, '../../e2e_test_output/playwright-report');

/**
 * Isolated configuration for the durable collaboration gate.
 *
 * Other Electron E2E specs retain their existing convention of connecting to
 * a developer-managed Vite server. This gate owns its server so its npm
 * command remains self-contained in CI and on a clean checkout.
 */
export default defineConfig({
  testDir: path.resolve(electronPackageDir, 'e2e'),
  outputDir: testResultsDir,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: htmlReportDir }]],
  timeout: 120_000,
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron-collab',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
      testMatch: '**/ai/collab-chain.spec.ts',
    },
  ],
  webServer: {
    command: 'exec node e2e/ai/collab-web-server.mjs',
    cwd: electronPackageDir,
    url: 'http://127.0.0.1:5273',
    // Do not mask a developer-owned server or attach the gate to stale code.
    // Playwright reports the occupied URL before launching this command.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

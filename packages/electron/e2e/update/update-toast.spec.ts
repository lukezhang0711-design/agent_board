import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
} from '../helpers';
import path from 'path';
import fs from 'fs/promises';

test.describe.configure({ mode: 'serial' });

let testVersionCounter = 0;

function getUniqueVersion(): string {
  testVersionCounter += 1;
  return `2.0.${testVersionCounter}`;
}

async function triggerUpdateAvailable(page: Page, version: string, releaseNotes = 'Upstream fixes and improvements.'): Promise<void> {
  await page.evaluate(async ({ version, releaseNotes }) => {
    await window.electronAPI.invoke('test:trigger-update-available', {
      version,
      releaseNotes,
    });
  }, { version, releaseNotes });
}

test.describe('Update Toast', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();
    await fs.writeFile(path.join(workspacePath, 'test.md'), '# Test Document\n\nThis is a test.');

    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test.beforeEach(async () => {
    await page.keyboard.press('Escape');
    const container = page.locator('[data-testid="update-toast-container"]');
    if (await container.isVisible().catch(() => false)) {
      const dismiss = page.locator('[data-testid="update-toast-dismiss"]');
      if (await dismiss.isVisible().catch(() => false)) {
        await dismiss.click();
      }
      await expect(container).toHaveCount(0, { timeout: 2000 }).catch(() => undefined);
    }

    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:clear-update-suppression');
    });
  });

  test('shows an upstream version and notes without download controls', async () => {
    const version = getUniqueVersion();
    const releaseNotes = `# Version ${version}\n\n- Upstream fix one\n- Upstream fix two`;
    await triggerUpdateAvailable(page, version, releaseNotes);

    const toast = page.locator('[data-testid="update-available-toast"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="update-toast-version"]')).toContainText(version);
    await expect(page.locator('[data-testid="customized-build-notice"]')).toContainText(
      'This is a customized build; updates are review-and-merge, not auto-installed.',
    );
    await expect(page.locator('[data-testid="update-release-notes"]')).toContainText('Upstream fix one');
    await expect(page.locator('[data-testid="update-now-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="release-notes-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="remind-later-btn"]')).toBeVisible();
  });

  test('dismisses the notification when Remind me later is clicked', async () => {
    await triggerUpdateAvailable(page, getUniqueVersion());
    await expect(page.locator('[data-testid="update-available-toast"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="remind-later-btn"]').click();

    await expect(page.locator('[data-testid="update-toast-container"]')).toHaveCount(0, { timeout: 3000 });
  });

  test('dismisses the notification with the close button', async () => {
    await triggerUpdateAvailable(page, getUniqueVersion());
    await expect(page.locator('[data-testid="update-available-toast"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="update-toast-dismiss"]').click();

    await expect(page.locator('[data-testid="update-toast-container"]')).toHaveCount(0, { timeout: 3000 });
  });

  test('shows an error toast when an update check fails', async () => {
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-error', 'Network connection failed.');
    });

    await expect(page.locator('[data-testid="update-error-toast"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Network connection failed');
  });

  test('shows checking feedback for a manual check', async () => {
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-checking');
    });

    await expect(page.locator('[data-testid="update-checking-toast"]')).toBeVisible({ timeout: 3000 });
  });

  test('shows and then dismisses the up-to-date feedback', async () => {
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-up-to-date');
    });

    await expect(page.locator('[data-testid="update-up-to-date-toast"]')).toContainText("You're up to date");
    await expect(page.locator('[data-testid="update-toast-container"]')).toHaveCount(0, { timeout: 5000 });
  });

  test('transitions from checking to a notification-only available update', async () => {
    const version = getUniqueVersion();
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-checking');
    });
    await expect(page.locator('[data-testid="update-checking-toast"]')).toBeVisible({ timeout: 3000 });

    await triggerUpdateAvailable(page, version, 'Manual check release notes.');

    const toast = page.locator('[data-testid="update-available-toast"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Manual check release notes.');
    await expect(page.locator('[data-testid="update-now-btn"]')).toHaveCount(0);
  });
});

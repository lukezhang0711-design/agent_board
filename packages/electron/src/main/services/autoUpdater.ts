import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getReleaseChannel, store } from '../utils/store';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { AnalyticsService } from './analytics/AnalyticsService';
import { hasActiveStreamingSessions } from '../ipc/SessionStateHandlers';
import {
  categorizeDownloadDuration,
  classifyUpdateError,
  isWindowsRenameLockError,
} from './autoUpdaterUtils';
import { installAtomFeedFilter } from './electronUpdaterPatch';

// Install the atom-feed filter before any AutoUpdaterService is constructed
// (which is the first thing that triggers electron-updater to read the feed).
installAtomFeedFilter();

// Re-export the pure utilities so callers that already pulled them from this
// module keep working. Unit tests should import from `autoUpdaterUtils`
// directly to avoid the Electron app-global load chain.
export { classifyUpdateError, categorizeDownloadDuration, isWindowsRenameLockError };

// Reminder suppression duration: 24 hours
const REMINDER_SUPPRESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const GITHUB_UPDATE_PROVIDER = {
  provider: 'github' as const,
  owner: 'nimbalyst',
  repo: 'nimbalyst'
};

export class AutoUpdaterService {
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private isCheckingForUpdate = false;
  private isManualCheck = false; // Track if this is a user-initiated check (for showing up-to-date toast)
  private static isUpdating = false;
  // Dedup `update_error` analytics: the hourly background check produces a
  // fresh `error` event every poll on networks that can't reach the update
  // endpoint, which buries any real signal. Only emit when the
  // (stage, error_type) tuple changes within a process lifetime.
  private lastUpdateErrorKey: string | null = null;

  constructor() {
    // Configure electron-updater logger
    log.transports.file.level = 'info';
    autoUpdater.logger = log;

    // This customized build only reports upstream releases. It never downloads
    // or installs an official package because that package would replace local
    // customizations before they can be reviewed and merged.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    // Configure feed URL based on release channel
    this.configureFeedURL();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up IPC handlers for renderer communication
    this.setupIpcHandlers();
  }

  private configureFeedURL() {
    const channel = getReleaseChannel();

    if (channel === 'alpha') {
      log.info('Configuring alpha channel updates from GitHub prereleases');
      autoUpdater.allowPrerelease = true;
      autoUpdater.channel = 'alpha';
      autoUpdater.setFeedURL(GITHUB_UPDATE_PROVIDER);
    } else {
      log.info('Configuring stable channel updates from GitHub releases');
      autoUpdater.allowPrerelease = false;
      autoUpdater.channel = 'latest';
      autoUpdater.setFeedURL(GITHUB_UPDATE_PROVIDER);
    }
  }

  private setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for update...');
      this.isCheckingForUpdate = true;
      this.sendToAllWindows('update-checking');
    });

    autoUpdater.on('update-available', async (info) => {
      log.info('Update available:', info);
      this.isCheckingForUpdate = false;
      this.lastUpdateErrorKey = null;
      const isManualCheck = this.isManualCheck;
      this.isManualCheck = false;

      let releaseNotes = info.releaseNotes as string | undefined;
      const channel = getReleaseChannel();
      log.info(`Release channel: ${channel}, releaseNotes present: ${Boolean(releaseNotes)}`);

      log.info(`Final releaseNotes being sent to window: "${releaseNotes?.substring(0, 100)}..."`);

      // Surface the upstream version and notes for review. This customized build
      // does not download or install official releases from this notification.
      this.sendToFrontmostWindow('update-toast:show-available', {
        currentVersion: app.getVersion(),
        newVersion: info.version,
        releaseNotes,
        releaseDate: info.releaseDate,
        releaseChannel: channel,
        isManualCheck,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available:', info);
      this.isCheckingForUpdate = false;
      this.lastUpdateErrorKey = null;
      // Only show up-to-date toast for manual (user-initiated) checks
      if (this.isManualCheck) {
        this.sendToFrontmostWindow('update-toast:up-to-date');
        this.isManualCheck = false;
      }
      this.sendToAllWindows('update-not-available', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('Update error:', err);
      this.isCheckingForUpdate = false;
      // Capture before reset so the suppression below can distinguish
      // user-initiated checks from the hourly background poll.
      const wasManualCheck = this.isManualCheck;
      this.isManualCheck = false;

      const stage = 'check';
      const errorType = classifyUpdateError(err);
      const errorKey = `${stage}:${errorType}`;
      if (this.lastUpdateErrorKey !== errorKey) {
        this.lastUpdateErrorKey = errorKey;
        AnalyticsService.getInstance().sendEvent('update_error', {
          stage,
          error_type: errorType,
          release_channel: getReleaseChannel()
        });
      }
      // Suppress the user-facing toast for transient network errors on
      // automatic background checks (#56). Users on networks that can't
      // resolve the update endpoint (LAN-only, captive portal, restrictive
      // firewall) were getting an "Update Error: net::ERR_NAME_NOT_RESOLVED"
      // toast every hour because the auto-updater retries on a 60-minute
      // schedule. The error is still logged and reported to analytics.
      // Manual checks (`Check for Updates` menu item) still surface so the
      // user gets feedback when they asked for it.
      //
      // Same treatment for `release_pending` (404 on `latest-*.yml`): the
      // release workflow pushes the tag minutes before it uploads metadata,
      // so every alpha client polling during the build window would otherwise
      // see "Cannot find latest-mac.yml ... HttpError: 404" -- functionally
      // identical to "no update available". Background polls get nothing;
      // manual checks get a friendly "release is being published" toast
      // instead of the raw HttpError dump.
      const isTransientCheckError =
        stage === 'check' &&
        (errorType === 'network' || errorType === 'release_pending') &&
        !wasManualCheck;
      if (!isTransientCheckError) {
        const message =
          errorType === 'release_pending'
            ? 'A new release is being published. Check back in a few minutes.'
            : err.message;
        this.sendToFrontmostWindow('update-toast:error', { message });
      }

      this.sendToAllWindows('update-error', err.message);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      log.warn(`Ignoring download progress for official update at ${progressObj.percent}% in notification-only mode`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      // A notification-only build should never download an official package.
      // Ignore an unexpected/stale electron-updater event rather than exposing
      // a path that invites installation of that package.
      log.warn(`Ignoring downloaded official update ${info.version} in notification-only mode`);
    });
  }

  /**
   * Get the frontmost (focused) window, or the first workspace window if no window is focused
   */
  private getFrontmostWindow(): BrowserWindow | null {
    // First try to get the focused window
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) {
      return focused;
    }

    // Otherwise, find the first visible workspace window
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (!win.isDestroyed() && win.isVisible()) {
        // Check if it's a workspace window (not update window, settings window, etc.)
        const url = win.webContents.getURL();
        if (!url.includes('mode=') || url.includes('mode=workspace')) {
          return win;
        }
      }
    }

    // Last resort: return the first visible window
    return allWindows.find(w => !w.isDestroyed() && w.isVisible()) || null;
  }

  /**
   * Send a message to the frontmost window
   */
  private sendToFrontmostWindow(channel: string, data?: any) {
    const window = this.getFrontmostWindow();
    if (window && !window.isDestroyed()) {
      log.info(`Sending ${channel} to frontmost window`);
      window.webContents.send(channel, data);
    } else {
      log.warn(`No frontmost window available to send ${channel}`);
    }
  }

  public reconfigureFeedURL() {
    this.configureFeedURL();
  }

  private setupIpcHandlers() {
    safeHandle('check-for-updates', async () => {
      if (this.isCheckingForUpdate) {
        return { checking: true };
      }

      try {
        await this.checkForUpdatesWithUI();
        return { checking: false };
      } catch (error) {
        log.error('Failed to check for updates:', error);
        throw error;
      }
    });

    safeHandle('download-update', () => {
      log.warn('Ignoring download request in notification-only update mode');
      return { success: false, reason: 'Official updates must be reviewed and merged.' };
    });

    safeHandle('quit-and-install', () => {
      log.warn('Ignoring install request in notification-only update mode');
      return { success: false, reason: 'Official updates must be reviewed and merged.' };
    });

    safeHandle('get-current-version', () => {
      return app.getVersion();
    });

    // Toast-based update IPC handlers
    safeOn('update-toast:download', () => {
      log.warn('Ignoring update toast download request in notification-only update mode');
    });

    safeOn('update-toast:install', () => {
      log.warn('Ignoring update toast install request in notification-only update mode');
    });

    // Check if any AI sessions are currently active
    safeHandle('update:has-active-sessions', () => {
      return { hasActiveSessions: hasActiveStreamingSessions() };
    });

    // Deferred install: wait for all AI sessions to finish, then install
    safeOn('update-toast:install-when-idle', () => {
      log.warn('Ignoring deferred install request in notification-only update mode');
    });

    // Reminder suppression handlers
    safeHandle('update:check-reminder-suppression', (_event, version: string) => {
      const dismissedVersion = store.get('updateDismissedVersion');
      const dismissedAt = store.get('updateDismissedAt') as number | undefined;

      if (dismissedVersion !== version) {
        // Different version, don't suppress
        return { suppressed: false };
      }

      if (!dismissedAt) {
        return { suppressed: false };
      }

      const timeSinceDismissal = Date.now() - dismissedAt;
      if (timeSinceDismissal < REMINDER_SUPPRESSION_DURATION_MS) {
        log.info(`Update reminder suppressed for version ${version} (${Math.round(timeSinceDismissal / 1000 / 60)} minutes ago)`);
        return { suppressed: true };
      }

      // Suppression expired
      return { suppressed: false };
    });

    safeHandle('update:set-reminder-suppression', (_event, version: string) => {
      store.set('updateDismissedVersion', version);
      store.set('updateDismissedAt', Date.now());
      log.info(`Update reminder suppressed for version ${version}`);
      // User action tracking is done in renderer
      return { success: true };
    });
  }

  private sendToAllWindows(channel: string, data?: any) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send(channel, data);
    });
  }

  public startAutoUpdateCheck(intervalMinutes = 60) {
    // Initial check after 30 seconds
    setTimeout(() => {
      this.checkForUpdates();
    }, 30000);

    // Set up periodic checks
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMinutes * 60 * 1000);
  }

  public stopAutoUpdateCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  public static isUpdatingApp(): boolean {
    return AutoUpdaterService.isUpdating;
  }

  public async checkForUpdates() {
    if (this.isCheckingForUpdate) {
      log.info('Already checking for updates, skipping...');
      return;
    }

    try {
      log.info('Checking for updates...');
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      log.error('Failed to check for updates:', error);
    }
  }

  public async checkForUpdatesWithUI() {
    if (this.isCheckingForUpdate) {
      // Already checking, don't show anything - the checking toast is already visible
      return;
    }

    // In dev mode (not packaged), electron-updater skips the check without firing events
    // Show appropriate feedback to the user
    if (!app.isPackaged) {
      log.info('Skipping update check in dev mode (app not packaged)');
      this.sendToFrontmostWindow('update-toast:checking');
      // Brief delay so user sees the checking state, then show error
      setTimeout(() => {
        this.sendToFrontmostWindow('update-toast:error', {
          message: 'Update checking is not available in development mode'
        });
      }, 500);
      return;
    }

    // Mark this as a manual check so the event handlers know to show UI feedback
    this.isManualCheck = true;

    // Show checking toast
    this.sendToFrontmostWindow('update-toast:checking');

    try {
      // checkForUpdates() will fire either 'update-available' or 'update-not-available' events
      // The event handlers will send the appropriate toast messages
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.error('Failed to check for updates:', error);
      this.isManualCheck = false;
      this.sendToFrontmostWindow('update-toast:error', {
        message: error instanceof Error ? error.message : 'Failed to check for updates'
      });
    }
  }

}

// Export singleton instance
export const autoUpdaterService = new AutoUpdaterService();

// Test helpers - only used in test environment
if (process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT === '1') {
  safeHandle('test:trigger-update-available', (_event, updateInfo: { version: string; releaseNotes?: string; releaseDate?: string }) => {
    log.info('Test: Triggering update available');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:show-available', {
        currentVersion: app.getVersion(),
        newVersion: updateInfo.version,
        releaseNotes: updateInfo.releaseNotes || '',
        releaseDate: updateInfo.releaseDate
      });
    }
  });

  safeHandle('test:trigger-update-error', (_event, errorMessage: string) => {
    log.info('Test: Triggering update error');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:error', {
        message: errorMessage
      });
    }
  });

  safeHandle('test:trigger-update-checking', () => {
    log.info('Test: Triggering update checking');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:checking');
    }
  });

  safeHandle('test:trigger-update-up-to-date', () => {
    log.info('Test: Triggering up to date');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:up-to-date');
    }
  });

  safeHandle('test:clear-update-suppression', () => {
    log.info('Test: Clearing update suppression');
    store.delete('updateDismissedVersion');
    store.delete('updateDismissedAt');
  });
}

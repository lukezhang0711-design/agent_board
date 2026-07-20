import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const eventHandlers = new Map<string, (...args: any[]) => unknown>();
  const ipcHandlers = new Map<string, (...args: any[]) => unknown>();
  const ipcListeners = new Map<string, (...args: any[]) => unknown>();
  const webContents = {
    send: vi.fn(),
    getURL: vi.fn(() => 'http://localhost/?mode=workspace'),
  };
  const window = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    webContents,
  };
  const autoUpdater = {
    logger: undefined as unknown,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    channel: '',
    on: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
      eventHandlers.set(event, listener);
      return autoUpdater;
    }),
    setFeedURL: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  };

  return { autoUpdater, eventHandlers, ipcHandlers, ipcListeners, webContents, window };
});

vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '0.65.4-custom'),
    isPackaged: true,
    removeAllListeners: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => mocks.window),
    getAllWindows: vi.fn(() => [mocks.window]),
  },
  dialog: {},
}));

vi.mock('electron-log/main', () => ({
  default: {
    transports: { file: { level: 'info' } },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/store', () => ({
  getReleaseChannel: vi.fn(() => 'stable'),
  store: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
    mocks.ipcHandlers.set(channel, handler);
  }),
  safeOn: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
    mocks.ipcListeners.set(channel, listener);
  }),
}));

vi.mock('../analytics/AnalyticsService', () => ({
  AnalyticsService: {
    getInstance: vi.fn(() => ({ sendEvent: vi.fn() })),
  },
}));

vi.mock('../../ipc/SessionStateHandlers', () => ({
  hasActiveStreamingSessions: vi.fn(() => false),
}));

vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: vi.fn(),
}));

vi.mock('../../database/initialize', () => ({
  getDatabase: vi.fn(),
}));

vi.mock('../electronUpdaterPatch', () => ({
  installAtomFeedFilter: vi.fn(),
}));

describe('AutoUpdaterService notification-only policy', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.autoUpdater.autoDownload = true;
    mocks.autoUpdater.autoInstallOnAppQuit = true;
    mocks.autoUpdater.on.mockClear();
    mocks.autoUpdater.setFeedURL.mockClear();
    mocks.autoUpdater.checkForUpdatesAndNotify.mockReset();
    mocks.autoUpdater.checkForUpdates.mockReset();
    mocks.autoUpdater.downloadUpdate.mockReset();
    mocks.autoUpdater.quitAndInstall.mockReset();
    mocks.eventHandlers.clear();
    mocks.ipcHandlers.clear();
    mocks.ipcListeners.clear();
    mocks.webContents.send.mockClear();
  });

  it('disables automatic download and quit-time installation', async () => {
    await import('../autoUpdater');

    expect(mocks.autoUpdater.autoDownload).toBe(false);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('reports an available update with its version and notes without downloading it', async () => {
    await import('../autoUpdater');
    const updateAvailable = mocks.eventHandlers.get('update-available');

    expect(updateAvailable).toBeDefined();
    await updateAvailable?.({
      version: '0.68.1',
      releaseNotes: '## Official release notes\n\nA notable upstream change.',
      releaseDate: '2026-07-20T00:00:00.000Z',
    });

    expect(mocks.webContents.send).toHaveBeenCalledWith('update-toast:show-available', {
      currentVersion: '0.65.4-custom',
      newVersion: '0.68.1',
      releaseNotes: '## Official release notes\n\nA notable upstream change.',
      releaseDate: '2026-07-20T00:00:00.000Z',
      releaseChannel: 'stable',
      isManualCheck: false,
    });
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps a manual check notification-only', async () => {
    const { autoUpdaterService } = await import('../autoUpdater');
    mocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      const updateAvailable = mocks.eventHandlers.get('update-available');
      await updateAvailable?.({
        version: '0.68.1',
        releaseNotes: 'Manual check release notes.',
      });
    });

    await autoUpdaterService.checkForUpdatesWithUI();

    expect(mocks.webContents.send).toHaveBeenCalledWith('update-toast:show-available', {
      currentVersion: '0.65.4-custom',
      newVersion: '0.68.1',
      releaseNotes: 'Manual check release notes.',
      releaseDate: undefined,
      releaseChannel: 'stable',
      isManualCheck: true,
    });
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('does not surface an install prompt when a downloaded event is received', async () => {
    await import('../autoUpdater');
    const updateDownloaded = mocks.eventHandlers.get('update-downloaded');

    expect(updateDownloaded).toBeDefined();
    await updateDownloaded?.({ version: '0.68.1' });

    expect(mocks.webContents.send).not.toHaveBeenCalledWith('update-toast:show-ready', {
      version: '0.68.1',
    });
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('ignores an unexpected download progress event', async () => {
    await import('../autoUpdater');
    const downloadProgress = mocks.eventHandlers.get('download-progress');

    expect(downloadProgress).toBeDefined();
    await downloadProgress?.({
      bytesPerSecond: 1024,
      percent: 50,
      transferred: 1024,
      total: 2048,
    });

    expect(mocks.webContents.send).not.toHaveBeenCalledWith('update-toast:progress', expect.anything());
    expect(mocks.webContents.send).not.toHaveBeenCalledWith('update-download-progress', expect.anything());
  });

  it('blocks the legacy download and install IPC routes', async () => {
    await import('../autoUpdater');
    const downloadUpdate = mocks.ipcHandlers.get('download-update');
    const quitAndInstall = mocks.ipcHandlers.get('quit-and-install');
    const toastDownload = mocks.ipcListeners.get('update-toast:download');
    const toastInstall = mocks.ipcListeners.get('update-toast:install');
    const toastInstallWhenIdle = mocks.ipcListeners.get('update-toast:install-when-idle');

    expect(downloadUpdate).toBeDefined();
    expect(quitAndInstall).toBeDefined();
    expect(toastDownload).toBeDefined();
    expect(toastInstall).toBeDefined();
    expect(toastInstallWhenIdle).toBeDefined();
    await downloadUpdate?.();
    await quitAndInstall?.();
    toastDownload?.();
    toastInstall?.();
    toastInstallWhenIdle?.();

    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});

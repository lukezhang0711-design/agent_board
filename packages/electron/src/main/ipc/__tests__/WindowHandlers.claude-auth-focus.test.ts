import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  getCachedState: vi.fn(),
  recheckIfUnknownOnWindowFocus: vi.fn(),
  setWindowFocused: vi.fn(),
  sendEvent: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      mocks.listeners.set(event, listener);
    },
    isPackaged: false,
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: () => [],
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
  nativeImage: {},
  powerMonitor: { on: vi.fn() },
}));

vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: vi.fn(),
  safeOn: vi.fn(),
}));

vi.mock('../../window/WindowManager', () => ({
  windowStates: new Map(),
  windows: new Map(),
  getWindowId: vi.fn(),
}));

vi.mock('../../services/SyncManager', () => ({
  reportDesktopActivity: vi.fn(),
  setWindowFocused: mocks.setWindowFocused,
  setScreenLocked: vi.fn(),
  setIdleThresholdMs: vi.fn(),
  attemptReconnect: vi.fn(),
}));

vi.mock('../../services/NetworkAvailability', () => ({
  startNetworkAvailability: vi.fn(),
  onNetworkAvailable: vi.fn(),
  notifyNetworkAvailable: vi.fn(),
}));

vi.mock('../../services/analytics/AnalyticsService', () => ({
  AnalyticsService: {
    getInstance: () => ({ sendEvent: mocks.sendEvent }),
  },
}));

vi.mock('../../services/ClaudeAuthStateService', () => ({
  claudeAuthStateService: {
    getCachedState: mocks.getCachedState,
    recheckIfUnknownOnWindowFocus: mocks.recheckIfUnknownOnWindowFocus,
  },
}));

vi.mock('../../utils/appPaths', () => ({ getPackageRoot: vi.fn() }));

import { registerWindowHandlers } from '../WindowHandlers';

describe('Claude auth focus recheck', () => {
  const focusedWindow = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };

  beforeEach(() => {
    mocks.listeners.clear();
    mocks.getCachedState.mockReset();
    mocks.recheckIfUnknownOnWindowFocus.mockReset().mockResolvedValue(null);
    mocks.setWindowFocused.mockReset();
    mocks.sendEvent.mockReset();
    focusedWindow.webContents.send.mockReset();
    registerWindowHandlers();
  });

  it('forces one CLI recheck when focus returns while Claude auth is unknown', () => {
    mocks.getCachedState.mockReturnValue({ status: 'unknown' });

    mocks.listeners.get('browser-window-focus')?.({}, focusedWindow);

    expect(mocks.recheckIfUnknownOnWindowFocus).toHaveBeenCalledOnce();
  });

  it('does not run an auth check on focus when the shared state is logged in', () => {
    mocks.getCachedState.mockReturnValue({ status: 'logged-in' });

    mocks.listeners.get('browser-window-focus')?.({}, focusedWindow);

    expect(mocks.recheckIfUnknownOnWindowFocus).not.toHaveBeenCalled();
  });
});

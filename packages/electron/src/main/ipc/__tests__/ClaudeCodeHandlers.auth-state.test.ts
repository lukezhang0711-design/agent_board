import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  spawn: vi.fn(),
  getDetectorStatus: vi.fn(),
  clearDetectorCache: vi.fn(),
  getAuthState: vi.fn(),
  invalidateUsageCache: vi.fn(),
  refreshUsage: vi.fn(),
  resolveExecutable: vi.fn(),
  sendEvent: vi.fn(),
}));

vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: (channel: string, handler: (...args: any[]) => any) => {
    mocks.handlers.set(channel, handler);
  },
  safeOn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('../../services/ClaudeCodeDetector', () => ({
  claudeCodeDetector: {
    getStatus: mocks.getDetectorStatus,
    clearCache: mocks.clearDetectorCache,
  },
}));

vi.mock('../../services/ClaudeAuthStateService', () => ({
  claudeAuthStateService: {
    getState: mocks.getAuthState,
  },
}));

vi.mock('../../services/ClaudeUsageService', () => ({
  claudeUsageService: {
    invalidateCache: mocks.invalidateUsageCache,
    refresh: mocks.refreshUsage,
  },
}));

vi.mock('@nimbalyst/runtime/electron/claudeCodeEnvironment', () => ({
  setupClaudeCodeEnvironment: () => ({ PATH: '/test/bin' }),
  resolveClaudeCodeExecutablePath: mocks.resolveExecutable,
}));

vi.mock('../../services/analytics/AnalyticsService.ts', () => ({
  AnalyticsService: {
    getInstance: () => ({ sendEvent: mocks.sendEvent }),
  },
}));

vi.mock('../../utils/store', () => ({
  shouldShowClaudeCodeWindowsWarning: vi.fn(),
  dismissClaudeCodeWindowsWarning: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    ipc: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

import { registerClaudeCodeHandlers } from '../ClaudeCodeHandlers';

function handler(channel: string): (...args: any[]) => any {
  const registered = mocks.handlers.get(channel);
  if (!registered) throw new Error(`Missing handler: ${channel}`);
  return registered;
}

describe('ClaudeCodeHandlers shared authentication state', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.spawn.mockReset();
    mocks.getDetectorStatus.mockReset();
    mocks.clearDetectorCache.mockReset();
    mocks.getAuthState.mockReset();
    mocks.invalidateUsageCache.mockReset();
    mocks.refreshUsage.mockReset().mockResolvedValue({ provider: 'claude-code', pools: {} });
    mocks.resolveExecutable.mockReset().mockReturnValue('/test/bin/claude');
    mocks.sendEvent.mockReset();
    mocks.spawn.mockReturnValue({ unref: vi.fn() });
    registerClaudeCodeHandlers();
  });

  it('returns check-failed without pretending the login is expired', async () => {
    mocks.getAuthState.mockResolvedValue({
      status: 'check-failed',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
      error: 'auth status timed out',
    });

    const status = await handler('claude-code:check-login')({});

    expect(status).toMatchObject({
      isLoggedIn: false,
      hasOAuthToken: false,
      isExpired: false,
      authState: 'check-failed',
      error: 'auth status timed out',
    });
  });

  it('forces the shared state service to refresh when explicitly requested', async () => {
    mocks.getAuthState.mockResolvedValue({
      status: 'logged-in',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
    });

    await handler('claude-code:check-login')({}, { forceRefresh: true });

    expect(mocks.clearDetectorCache).toHaveBeenCalledOnce();
    expect(mocks.getAuthState).toHaveBeenCalledOnce();
    expect(mocks.invalidateUsageCache).toHaveBeenCalledOnce();
    expect(mocks.refreshUsage).toHaveBeenCalledOnce();
  });

  it.each(['claude-code:login', 'claude-code:logout'])('%s invalidates auth and Usage caches after starting the terminal action', async (channel) => {
    const result = await handler(channel)({});

    expect(result).toMatchObject({ success: true });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.clearDetectorCache).toHaveBeenCalledOnce();
    expect(mocks.invalidateUsageCache).toHaveBeenCalledOnce();
  });

  it('does not invalidate caches when the login action cannot start', async () => {
    mocks.resolveExecutable.mockReturnValue(null);

    await expect(handler('claude-code:login')({})).rejects.toThrow('native binary not found');

    expect(mocks.clearDetectorCache).not.toHaveBeenCalled();
    expect(mocks.invalidateUsageCache).not.toHaveBeenCalled();
  });
});

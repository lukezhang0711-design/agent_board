import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  set: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock('../../index', () => ({
  store: {
    set: testState.set,
  },
}));

vi.mock('../../../services/ErrorNotificationService', () => ({
  errorNotificationService: { showWarning: testState.showWarning },
}));

import { claudeAuthStateAtom } from '../../atoms/claudeAuthAtoms';
import { initClaudeAuthListeners, refreshClaudeAuthState } from '../claudeAuthListeners';

const loggedInState = {
  status: 'logged-in' as const,
  source: 'claude-cli-auth-status' as const,
  checkedAt: 100,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
};

describe('initClaudeAuthListeners', () => {
  const invoke = vi.fn();
  const unsubscribe = vi.fn();
  let authUpdate: ((state: unknown) => void) | undefined;
  const on = vi.fn((_channel: string, handler: (state: unknown) => void) => {
    authUpdate = handler;
    return unsubscribe;
  });

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({
      isLoggedIn: true,
      hasOAuthToken: true,
      isExpired: false,
      authState: 'logged-in',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
      tokenSource: 'claude.ai',
      apiKeySource: 'firstParty',
    });
    unsubscribe.mockReset();
    on.mockClear();
    testState.set.mockReset();
    testState.showWarning.mockReset();
    authUpdate = undefined;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { electronAPI: { invoke, on } },
    });
  });

  it('moves a main-process auth broadcast into the shared renderer atom', async () => {
    const cleanup = initClaudeAuthListeners();

    expect(on).toHaveBeenCalledWith('claude-auth:update', expect.any(Function));
    expect((window as Window & {
      __nimbalystRefreshClaudeAuthState?: unknown;
    }).__nimbalystRefreshClaudeAuthState).toBe(refreshClaudeAuthState);
    authUpdate?.(loggedInState);
    await Promise.resolve();

    expect(testState.set).toHaveBeenCalledWith(claudeAuthStateAtom, loggedInState);

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect((window as Window & {
      __nimbalystRefreshClaudeAuthState?: unknown;
    }).__nimbalystRefreshClaudeAuthState).toBeUndefined();
  });

  it('seeds the atom from one non-forced shared-state request at startup', async () => {
    initClaudeAuthListeners();

    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith('claude-code:check-login');
    expect(testState.set).toHaveBeenCalledWith(claudeAuthStateAtom, loggedInState);
  });

  it('keeps manual refresh as the centralized forced recheck entry point', async () => {
    await refreshClaudeAuthState();

    expect(invoke).toHaveBeenCalledWith('claude-code:check-login', { forceRefresh: true });
    expect(testState.set).toHaveBeenCalledWith(claudeAuthStateAtom, loggedInState);
  });

  it('warns when an external auth update changes a prior logged-in state to logged-out', async () => {
    initClaudeAuthListeners();
    authUpdate?.(loggedInState);
    authUpdate?.({
      status: 'unknown',
      source: 'claude-cli-auth-status',
      checkedAt: null,
    });
    authUpdate?.({
      status: 'logged-out',
      source: 'claude-cli-auth-status',
      checkedAt: 200,
      authMethod: 'none',
      apiProvider: 'firstParty',
    });

    expect(testState.showWarning).toHaveBeenCalledWith(
      'Claude sign-in changed',
      'Claude sign-in was changed outside Nimbalyst; run /login to restore your subscription session.',
    );
  });
});

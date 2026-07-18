import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FB-020: a Head-dispatched child session carries an explicit, meaningful title
 * (e.g. "X-queue-1"). The auto-naming path — the `nimbalyst-session-naming` MCP
 * tool `update_session_meta`, plus the claude-cli auto-namer, both of which land
 * in `SessionNamingService.applySessionTitle` — used to overwrite it with a
 * generic model-chosen name because line 239 renames with `{ force: true }`,
 * which deliberately bypasses the `hasBeenNamed` guard.
 *
 * `hasBeenNamed` is NOT the right marker to key off: it is set by many paths and
 * an agent renaming its own session later is intended behaviour. So dispatch
 * stamps a dedicated `titleSource: 'dispatch'` marker into session metadata and
 * the auto-naming path skips exactly those sessions.
 */

const testState = vi.hoisted(() => ({
  sessions: new Map<string, any>(),
  updateSessionTitle: vi.fn(),
  updateMetadata: vi.fn(),
}));

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('@nimbalyst/runtime/ai/server', () => ({
  SessionManager: class { async initialize() {} },
  ClaudeCodeProvider: {},
  OpenAICodexProvider: {},
  OpenAICodexACPProvider: {},
  OpenCodeProvider: {},
  setPreferredAgentLanguage: vi.fn(),
}));
vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: {
    get: async (id: string) => testState.sessions.get(id) ?? null,
    updateMetadata: (...args: unknown[]) => {
      testState.updateMetadata(...args);
      return Promise.resolve();
    },
    updateTitleIfNotNamed: async () => true,
  },
}));
vi.mock('../ai/claudeCliLauncherSingleton', () => ({ ClaudeCliLauncherConfig: {} }));
vi.mock('../ai/claudeCliSessionAutoNameSingleton', () => ({ setClaudeCliAutoNameApplyTitleFn: vi.fn() }));
vi.mock('../../mcp/sessionNamingServer', () => ({
  startSessionNamingServer: vi.fn(),
  setUpdateSessionTitleFn: vi.fn(),
  setUpdateSessionMetadataFn: vi.fn(),
  setGetWorkspaceTagsFn: vi.fn(),
  setGetSessionTagsFn: vi.fn(),
  setGetSessionTitleFn: vi.fn(),
  setGetSessionPhaseFn: vi.fn(),
  shutdownSessionNamingHttpServer: vi.fn(),
}));
vi.mock('../../database/initialize', () => ({ getDatabase: () => null }));
vi.mock('../WorktreeStore', () => ({ createWorktreeStore: vi.fn() }));
vi.mock('../../utils/store', () => ({ getPreferredAgentLanguage: () => 'en' }));

import { SessionNamingService } from '../SessionNamingService';

describe('SessionNamingService.applySessionTitle — dispatch title protection (FB-020)', () => {
  const service = SessionNamingService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
    testState.sessions.clear();
    (service as any).sessionManager = {
      updateSessionTitle: (...args: unknown[]) => {
        testState.updateSessionTitle(...args);
        return Promise.resolve();
      },
    };
  });

  it('does not rename a session whose title came from a Head dispatch', async () => {
    testState.sessions.set('child-1', {
      id: 'child-1',
      title: 'X-queue-1',
      hasBeenNamed: true,
      metadata: { titleSource: 'dispatch' },
    });

    await service.applySessionTitle('child-1', 'Investigate Flaky Login Tests');

    expect(testState.updateSessionTitle).not.toHaveBeenCalled();
  });

  it('still auto-names a session dispatched without an explicit title', async () => {
    testState.sessions.set('child-2', {
      id: 'child-2',
      title: 'Meta Task',
      hasBeenNamed: false,
      metadata: {},
    });

    await service.applySessionTitle('child-2', 'Investigate Flaky Login Tests');

    expect(testState.updateSessionTitle).toHaveBeenCalledWith(
      'child-2',
      'Investigate Flaky Login Tests',
      { force: true, markAsNamed: true },
    );
  });

  it('still auto-names an ordinary session that has no dispatch marker', async () => {
    testState.sessions.set('plain', { id: 'plain', title: 'New session', metadata: undefined });

    await service.applySessionTitle('plain', 'Refactor Billing Module');

    expect(testState.updateSessionTitle).toHaveBeenCalledWith(
      'plain',
      'Refactor Billing Module',
      { force: true, markAsNamed: true },
    );
  });
});

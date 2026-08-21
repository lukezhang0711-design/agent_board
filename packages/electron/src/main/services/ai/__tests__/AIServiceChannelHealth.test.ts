import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureClaudeCliSession: vi.fn(),
  submitClaudeCliPromptProduction: vi.fn(),
  getClaudeCliQueueAuthPrecheck: vi.fn(),
  clearClaudeCliQueueAuthPrecheck: vi.fn(),
  markClaudeCliChannelHealthSession: vi.fn(),
  clearClaudeCliChannelHealthSession: vi.fn(),
  clearClaudeCliTurnSummary: vi.fn(),
  takeClaudeCliTurnSummary: vi.fn(),
  terminalManager: {
    destroyTerminal: vi.fn(),
    getClaudeCliLiveTurnState: vi.fn(),
    isTerminalActive: vi.fn(),
  },
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  SessionManager: class {},
  ProviderFactory: { destroyProvider: vi.fn() },
  ModelRegistry: { clearCache: vi.fn() },
  isAskUserQuestionProvider: () => false,
  isAgentProvider: () => false,
  isSlashCommandCatalogProvider: () => false,
  ClaudeCodeProvider: { setCustomClaudeCodePathLoader: vi.fn() },
  OpenAICodexProvider: class {},
}));
vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: {},
  DocumentContextService: class {},
  SessionFilesRepository: {},
}));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/path'), on: vi.fn(), once: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => null) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), listenerCount: vi.fn(() => 0) },
}));
vi.mock('../../../utils/ipcRegistry', () => ({ safeHandle: vi.fn(), safeOn: vi.fn() }));
vi.mock('../tools', () => ({ ToolExecutor: class {}, toolRegistry: { register: vi.fn() }, BUILT_IN_TOOLS: [] }));
vi.mock('../MessageStreamingHandler', () => ({ MessageStreamingHandler: class {} }));
vi.mock('../HooklessAgentFileWatcher', () => ({ HooklessAgentFileWatcher: class {} }));
vi.mock('../../TerminalSessionManager', () => ({ getTerminalSessionManager: () => mocks.terminalManager }));
vi.mock('../../RepositoryManager', () => ({ getQueuedPromptsStore: vi.fn() }));
vi.mock('../../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../../database/PGLiteDatabaseWorker', () => ({ database: {} }));
vi.mock('../../../tray/TrayManager', () => ({ TrayManager: { getInstance: vi.fn() } }));
vi.mock('../../analytics/AnalyticsService.ts', () => ({ AnalyticsService: { getInstance: () => ({ sendEvent: vi.fn() }) } }));
vi.mock('../../SettingsService', () => ({ getSettingsService: () => ({ get: vi.fn(), set: vi.fn() }) }));
vi.mock('../../../utils/logger', () => ({ logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } }));
vi.mock('../claudeCliLauncherSingleton', () => ({
  ensureClaudeCliSession: mocks.ensureClaudeCliSession,
  claudeCliSessionSupportsPlugins: vi.fn(),
}));
vi.mock('../claudeCliSubmitSingleton', () => ({
  submitClaudeCliPromptProduction: mocks.submitClaudeCliPromptProduction,
}));
vi.mock('../ClaudeCliSessionLauncher', () => ({
  clearClaudeCliQueueAuthPrecheck: mocks.clearClaudeCliQueueAuthPrecheck,
  getClaudeCliQueueAuthPrecheck: mocks.getClaudeCliQueueAuthPrecheck,
}));
vi.mock('../claudeCliQueueFlushSingleton', () => ({ flushNextClaudeCliQueuedPromptForSession: vi.fn() }));
vi.mock('../claudeCliObservationSingleton', () => ({
  markClaudeCliChannelHealthSession: mocks.markClaudeCliChannelHealthSession,
  clearClaudeCliChannelHealthSession: mocks.clearClaudeCliChannelHealthSession,
}));
vi.mock('../claudeCliTurnSummary', () => ({
  clearClaudeCliTurnSummary: mocks.clearClaudeCliTurnSummary,
  takeClaudeCliTurnSummary: mocks.takeClaudeCliTurnSummary,
}));

import { AIService } from '../AIService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHealthService(): Record<string, any> {
  const session = {
    id: 'health-cli-session',
    model: undefined,
    workspacePath: '/workspace',
  };
  const service = Object.create(AIService.prototype) as Record<string, any>;
  Object.assign(service, {
    sessionManager: {
      getCurrentSession: vi.fn(() => null),
      createSession: vi.fn(async () => session),
    },
    // Transport tests deliberately isolate the CLI handshake. Catalog
    // validation has its own service/bridge coverage, so inject a verified
    // selection rather than constructing the full Electron catalog owner.
    resolveValidatedModelForNewSession: vi.fn(async () => 'claude-code-cli:sonnet'),
    disposeChannelHealthSession: vi.fn(),
  });
  return service;
}

describe('AIService channel-health Claude CLI transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureClaudeCliSession.mockResolvedValue({ success: true });
    mocks.submitClaudeCliPromptProduction.mockResolvedValue({ submitted: true });
    mocks.getClaudeCliQueueAuthPrecheck.mockReturnValue(undefined);
    mocks.terminalManager.destroyTerminal.mockResolvedValue(undefined);
    mocks.terminalManager.isTerminalActive.mockReturnValue(true);
    mocks.terminalManager.getClaudeCliLiveTurnState.mockResolvedValue('idle');
  });

  it('RED: waits for the initial idle boundary before injecting the health prompt into the real CLI PTY', async () => {
    const ready = deferred<void>();
    const service = createHealthService();
    service.waitForClaudeCliHealthReady = vi.fn(() => ready.promise);
    service.waitForClaudeCliHealthResponse = vi.fn(async () => ({
      firstResponseMs: 20,
      completionMs: 30,
      responseText: 'observed-cli-response',
    }));

    const healthPromise = service.runClaudeCliChannelHealthPrompt({
      channel: { id: 'claude-code-cli', displayName: 'Claude CLI', transport: 'claude-cli' },
      event: { sender: {} } as Electron.IpcMainInvokeEvent,
      workspacePath: '/workspace',
      prompt: 'Reply with one word: pong',
    });

    await vi.waitFor(() => {
      expect(mocks.ensureClaudeCliSession).toHaveBeenCalledOnce();
    });
    expect(mocks.submitClaudeCliPromptProduction).not.toHaveBeenCalled();

    ready.resolve();
    await expect(healthPromise).resolves.toMatchObject({ responseText: 'observed-cli-response' });
    expect(mocks.submitClaudeCliPromptProduction).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'health-cli-session',
      prompt: 'Reply with one word: pong',
    }));
  });

  it('RED: turns a real CLI exit before readiness into an engine error carrying its exit code', async () => {
    const service = createHealthService();
    mocks.terminalManager.isTerminalActive.mockReturnValue(false);
    mocks.ensureClaudeCliSession.mockImplementation(async (input: { onExit?: (exitCode: number) => void }) => {
      input.onExit?.(0);
      return { success: true };
    });

    await expect(service.runClaudeCliChannelHealthPrompt({
      channel: { id: 'claude-code-cli', displayName: 'Claude CLI', transport: 'claude-cli' },
      event: { sender: {} } as Electron.IpcMainInvokeEvent,
      workspacePath: '/workspace',
      prompt: 'Reply with one word: pong',
    })).rejects.toThrow(/exit code 0/);

    expect(mocks.submitClaudeCliPromptProduction).not.toHaveBeenCalled();
  });
});

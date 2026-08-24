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
  getDefaultAIModel: vi.fn(),
  setDefaultAIModel: vi.fn(),
  getAllWindows: vi.fn(),
  updateSessionMetadata: vi.fn(),
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
  AISessionsRepository: { updateMetadata: mocks.updateSessionMetadata },
  DocumentContextService: class {},
  SessionFilesRepository: {},
}));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/path'), on: vi.fn(), once: vi.fn() },
  BrowserWindow: { getAllWindows: mocks.getAllWindows, getFocusedWindow: vi.fn(() => null) },
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
vi.mock('../../../utils/store', () => ({
  getAIProviderOverrides: vi.fn(),
  saveAIProviderOverrides: vi.fn(),
  clearAIProviderOverrides: vi.fn(),
  getWorkspaceState: vi.fn(),
  getDefaultAIModel: mocks.getDefaultAIModel,
  setDefaultAIModel: mocks.setDefaultAIModel,
  incrementCompletedSessionsWithTools: vi.fn(),
  markCommunityPopupShown: vi.fn(),
  normalizeAIProviderOverrides: vi.fn(),
  shouldShowCommunityPopup: vi.fn(),
  wasCommunityPopupShownThisLaunch: vi.fn(),
  getDefaultEffortLevel: vi.fn(),
}));
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
    mocks.getDefaultAIModel.mockReturnValue(undefined);
    mocks.getAllWindows.mockReturnValue([]);
    mocks.updateSessionMetadata.mockResolvedValue(undefined);
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

  it('migrates a saved session model through the live resolved-model identity before validating it', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const awaitCatalog = vi.fn(async () => {});
    const validate = vi.fn(async () => {});
    Object.assign(service, {
      awaitModelCatalogForProvider: awaitCatalog,
      assertDynamicModelAvailable: validate,
      getDynamicCatalogModels: () => [{
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5[1m]',
      }],
    });

    await expect(service.resolveCurrentDynamicSessionModel(
      'claude-code',
      'claude-code:fable-1m',
      undefined,
      undefined,
      'legacy-session',
    )).resolves.toBe('claude-code:claude-fable-5-1m');
    expect(awaitCatalog).toHaveBeenCalledWith('claude-code');
    expect(validate).toHaveBeenCalledWith(
      'claude-code',
      'claude-code:claude-fable-5-1m',
      undefined,
    );
    expect(mocks.updateSessionMetadata).toHaveBeenCalledWith('legacy-session', {
      model: 'claude-code:claude-fable-5-1m',
    });
  });

  it('migrates a matching saved global default only after the live catalog proves its exact identity', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const awaitCatalog = vi.fn(async () => {});
    const validate = vi.fn(async () => {});
    mocks.getDefaultAIModel.mockReturnValue('claude-code:fable-1m');
    Object.assign(service, {
      awaitModelCatalogForProvider: awaitCatalog,
      assertCurrentDynamicModelAvailable: validate,
      getDynamicCatalogModels: () => [{
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5[1m]',
      }],
    });

    await expect(service.resolveValidatedModelForNewSession('claude-code')).resolves.toBe(
      'claude-code:claude-fable-5-1m',
    );
    expect(awaitCatalog).toHaveBeenCalledWith('claude-code');
    expect(validate).toHaveBeenCalledWith('claude-code', 'claude-code:claude-fable-5-1m');
    expect(mocks.setDefaultAIModel).toHaveBeenCalledWith('claude-code:claude-fable-5-1m');
  });

  it('broadcasts an equivalent default migration only after persistence succeeds', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const send = vi.fn();
    mocks.getDefaultAIModel.mockReturnValue('claude-code:fable-1m');
    mocks.getAllWindows.mockReturnValue([{
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send },
    }]);
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(async () => {}),
      assertCurrentDynamicModelAvailable: vi.fn(async () => {}),
      getDynamicCatalogModels: () => [{
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5[1m]',
      }],
    });

    await service.resolveValidatedModelForNewSession('claude-code');

    expect(mocks.setDefaultAIModel).toHaveBeenCalledWith('claude-code:claude-fable-5-1m');
    expect(send).toHaveBeenCalledWith('settings:default-ai-model-migrated', {
      from: 'claude-code:fable-1m',
      to: 'claude-code:claude-fable-5-1m',
    });
  });

  it('does not rewrite an ACP session to the shared Codex catalog prefix', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const validate = vi.fn(async () => {});
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(async () => {}),
      assertDynamicModelAvailable: validate,
      getDynamicCatalogModels: () => [{ id: 'openai-codex:gpt-5.5' }],
    });

    await expect(service.resolveCurrentDynamicSessionModel(
      'openai-codex-acp',
      'openai-codex-acp:gpt-5.5',
      undefined,
      undefined,
      'acp-session',
    )).resolves.toBe('openai-codex-acp:gpt-5.5');
    expect(mocks.updateSessionMetadata).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledWith('openai-codex-acp', 'openai-codex:gpt-5.5', undefined);
  });

  it('does not persist a candidate default until the live catalog validates it', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    mocks.getDefaultAIModel.mockReturnValue('claude-code:fable-1m');
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(async () => {}),
      assertCurrentDynamicModelAvailable: vi.fn(async () => {
        throw new Error('claude-code 模型目录不可用');
      }),
      getDynamicCatalogModels: () => [{
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5[1m]',
      }],
    });

    await expect(service.resolveValidatedModelForNewSession('claude-code')).rejects.toThrow(
      'claude-code 模型目录不可用',
    );
    expect(mocks.setDefaultAIModel).not.toHaveBeenCalled();
    expect(mocks.getAllWindows).not.toHaveBeenCalled();
  });

  it('does not overwrite a user default changed while the live catalog was loading', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const send = vi.fn();
    const catalogReady = deferred<void>();
    mocks.getDefaultAIModel
      .mockReturnValueOnce('claude-code:fable-1m')
      .mockReturnValueOnce('claude-code:claude-sonnet-4-5');
    mocks.getAllWindows.mockReturnValue([{
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send },
    }]);
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(() => catalogReady.promise),
      assertCurrentDynamicModelAvailable: vi.fn(async () => {}),
      getDynamicCatalogModels: () => [{
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5[1m]',
      }],
    });

    const resolution = service.resolveValidatedModelForNewSession('claude-code');
    catalogReady.resolve();

    await expect(resolution).resolves.toBe('claude-code:claude-fable-5-1m');
    expect(mocks.setDefaultAIModel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not apply a saved Claude default while resolving the Codex health channel', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const validate = vi.fn(async () => {});
    mocks.getDefaultAIModel.mockReturnValue('claude-code:fable-1m');
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(async () => {}),
      assertDynamicCatalogReady: vi.fn(async () => {}),
      assertCurrentDynamicModelAvailable: validate,
      getDynamicCatalogModels: () => [{
        id: 'openai-codex:gpt-5.6',
        isEngineDefault: true,
      }],
    });

    await expect(service.resolveValidatedModelForNewSession('openai-codex')).resolves.toBe(
      'openai-codex:gpt-5.6',
    );
    expect(validate).toHaveBeenCalledWith('openai-codex', 'openai-codex:gpt-5.6');
    expect(mocks.setDefaultAIModel).not.toHaveBeenCalled();
  });
});

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
  getDefaultEffortLevel: vi.fn(),
  setDefaultEffortLevel: vi.fn(),
  logInfo: vi.fn(),
  agentProviderList: vi.fn(),
  findAgentProvider: vi.fn(),
  getAllWindows: vi.fn(),
  updateSessionMetadata: vi.fn(),
  probeExtensionLogin: vi.fn(),
  codexGetStatus: vi.fn(),
  codexGetCliLoginStatus: vi.fn(),
  codexGetModelList: vi.fn(),
  claudeGetState: vi.fn(),
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
vi.mock('../../../extensions/AgentProviderRegistry', () => ({
  getAgentProviderRegistry: () => ({
    list: mocks.agentProviderList,
    findByContributionId: mocks.findAgentProvider,
  }),
}));
vi.mock('../../../extensions/extensionAgentBridge', () => ({
  refreshExtensionAgentProviderModels: vi.fn(),
  probeExtensionAgentProviderLogin: mocks.probeExtensionLogin,
}));
vi.mock('../../CodexAuthService', () => ({
  codexAuthService: {
    getStatus: mocks.codexGetStatus,
    getCliLoginStatus: mocks.codexGetCliLoginStatus,
    getModelList: mocks.codexGetModelList,
  },
}));
vi.mock('../../ClaudeAuthStateService', () => ({
  claudeAuthStateService: { getState: mocks.claudeGetState },
}));
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
vi.mock('../../../utils/logger', () => ({ logger: { main: { info: mocks.logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } }));
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
  getDefaultEffortLevel: mocks.getDefaultEffortLevel,
  setDefaultEffortLevel: mocks.setDefaultEffortLevel,
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

import { AIService, listChannelHealthChannels } from '../AIService';

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
    mocks.getDefaultEffortLevel.mockReturnValue(undefined);
    mocks.agentProviderList.mockReturnValue([]);
    mocks.findAgentProvider.mockReturnValue(undefined);
    mocks.getAllWindows.mockReturnValue([]);
    mocks.updateSessionMetadata.mockResolvedValue(undefined);
    mocks.codexGetModelList.mockResolvedValue({ models: [] });
    mocks.claudeGetState.mockResolvedValue({ status: 'logged-in' });
    mocks.codexGetStatus.mockResolvedValue({ account: { type: 'chatgpt' }, requiresOpenaiAuth: false });
    mocks.codexGetCliLoginStatus.mockResolvedValue('unknown');
    mocks.probeExtensionLogin.mockResolvedValue({ state: 'logged-in', completionMs: 4 });
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

  it('RED EO: preserves a saved unlisted Claude model exactly and does not wait on a catalog', async () => {
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
    )).resolves.toBe('claude-code:fable-1m');
    expect(awaitCatalog).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(mocks.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('RED EO: preserves a saved global Claude default instead of catalog-rewriting it', async () => {
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

    await expect(service.resolveValidatedModelForNewSession('claude-code')).resolves.toBe('claude-code:fable-1m');
    expect(awaitCatalog).not.toHaveBeenCalled();
    // The advisory hook may inspect a declared row, but it must not rewrite
    // or reject the value merely because it is absent from that row.
    expect(validate).toHaveBeenCalledWith('claude-code', 'claude-code:fable-1m');
    expect(mocks.setDefaultAIModel).not.toHaveBeenCalled();
  });

  it('does not broadcast a synthetic equivalent-model migration', async () => {
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

    expect(mocks.setDefaultAIModel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not rewrite or catalog-gate an ACP session model', async () => {
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
    expect(validate).not.toHaveBeenCalled();
  });

  it('keeps a saved default raw when the catalog has no declaration', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    mocks.getDefaultAIModel.mockReturnValue('claude-code:fable-1m');
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(async () => {}),
      assertCurrentDynamicModelAvailable: vi.fn(async () => {}),
      getDynamicCatalogModels: () => [{
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5[1m]',
      }],
    });

    await expect(service.resolveValidatedModelForNewSession('claude-code')).resolves.toBe('claude-code:fable-1m');
    expect(mocks.setDefaultAIModel).not.toHaveBeenCalled();
    expect(mocks.getAllWindows).not.toHaveBeenCalled();
  });

  it('does not load a catalog or overwrite a user default while resolving an explicit value', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const send = vi.fn();
    mocks.getDefaultAIModel
      .mockReturnValueOnce('claude-code:fable-1m')
      .mockReturnValueOnce('claude-code:claude-sonnet-4-5');
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

    await expect(service.resolveValidatedModelForNewSession('claude-code')).resolves.toBe('claude-code:fable-1m');
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

  it('GREEN EO: forwards a saved Claude Haiku effort raw instead of host-dropping it', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const awaitCatalog = vi.fn(async () => {});
    const validate = vi.fn(async () => {});
    Object.assign(service, {
      awaitModelCatalogForProvider: awaitCatalog,
      assertDynamicModelAvailable: validate,
      getDynamicCatalogModels: () => [{
        id: 'claude-code:haiku',
        supportsEffort: false,
        supportedEffortLevels: [],
      }],
    });

    await expect(service.resolveCurrentDynamicSessionModel(
      'claude-code',
      'claude-code:haiku',
      undefined,
      'high',
      'haiku-session',
    )).resolves.toBe('claude-code:haiku');

    expect(awaitCatalog).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(mocks.updateSessionMetadata).not.toHaveBeenCalled();
    expect(service.resolveCompatibleDynamicSessionEffortLevel(
      'claude-code', 'claude-code:haiku', 'high',
    )).toBe('high');
  });

  it('GREEN EO: forwards an undeclared Claude effort raw rather than replacing it', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(async () => {}),
      assertDynamicModelAvailable: vi.fn(async () => {}),
      getDynamicCatalogModels: () => [{
        id: 'claude-code:sonnet',
        supportsEffort: true,
        supportedEffortLevels: ['turbo', 'deep'],
        defaultEffortLevel: 'deep',
      }],
    });

    await expect(service.resolveCurrentDynamicSessionModel(
      'claude-code',
      'claude-code:sonnet',
      undefined,
      'ultra',
      'fallback-session',
    )).resolves.toBe('claude-code:sonnet');

    expect(mocks.updateSessionMetadata).not.toHaveBeenCalled();
    expect(service.resolveCompatibleDynamicSessionEffortLevel(
      'claude-code', 'claude-code:sonnet', 'ultra',
    )).toBe('ultra');
  });

  it('GREEN EO: uses the selected Claude model default when session effort is empty', () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    mocks.getDefaultEffortLevel.mockReturnValue('low');
    Object.assign(service, {
      getDynamicCatalogModels: () => [{
        id: 'claude-code:opus',
        supportedEffortLevels: ['low', 'high'],
        defaultEffortLevel: 'high',
      }],
    });

    expect(service.resolveCompatibleDynamicSessionEffortLevel(
      'claude-code', 'claude-code:opus', undefined,
    )).toBe('high');
  });

  it('GREEN EO: keeps a Claude app-wide effort raw without refreshing a normal send catalog', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    const pickerRefresh = vi.fn();
    const headRefresh = vi.fn();
    mocks.getDefaultEffortLevel.mockReturnValue('low');
    Object.assign(service, {
      awaitModelCatalogForProvider: vi.fn(async () => {}),
      assertDynamicModelAvailable: vi.fn(async () => {}),
      refreshModelCatalogsForPicker: pickerRefresh,
      refreshModelCatalogForHeadDispatch: headRefresh,
      getDynamicCatalogModels: () => [{
        id: 'claude-code:haiku',
        supportsEffort: false,
        supportedEffortLevels: [],
      }],
    });

    await expect(service.resolveCurrentDynamicSessionModel(
      'claude-code',
      'claude-code:haiku',
      undefined,
      undefined,
      'default-effort-session',
    )).resolves.toBe('claude-code:haiku');

    expect(mocks.setDefaultEffortLevel).not.toHaveBeenCalled();
    expect(mocks.updateSessionMetadata).not.toHaveBeenCalled();
    expect(pickerRefresh).not.toHaveBeenCalled();
    expect(headRefresh).not.toHaveBeenCalled();
  });

  it('GREEN EO: passes an unlisted Codex model through but omits its undeclared effort', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      getDynamicCatalogModels: () => [{
        id: 'openai-codex:gpt-listed',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'high'],
        defaultEffortLevel: 'low',
      }],
    });

    await expect(service.resolveCurrentDynamicSessionModel(
      'openai-codex',
      'openai-codex:gpt-user-entered',
      undefined,
      'ultra',
      'unlisted-codex-session',
    )).resolves.toBe('openai-codex:gpt-user-entered');

    expect(service.resolveCompatibleDynamicSessionEffortLevel(
      'openai-codex', 'openai-codex:gpt-user-entered', 'ultra',
    )).toBeUndefined();
    expect(mocks.updateSessionMetadata).toHaveBeenCalledWith('unlisted-codex-session', {
      metadata: { effortLevel: null },
    });
  });

  it('GREEN EO: uses Codex’s declared default, including when only the raw levels array is present', () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      getDynamicCatalogModels: () => [{
        id: 'openai-codex:gpt-future',
        supportedEffortLevels: ['low', 'turbo'],
        defaultEffortLevel: 'turbo',
      }],
    });

    expect(service.resolveCompatibleDynamicSessionEffortLevel(
      'openai-codex', 'openai-codex:gpt-future', undefined,
    )).toBe('turbo');
  });

  it('GREEN FB-116: picker refresh probes Codex, Claude, and a dynamic Gemini provider together', async () => {
    const gemini = {
      extensionId: 'gemini-antigravity',
      contributionId: 'antigravity-gemini-agent',
      extensionPath: '/extensions/gemini-antigravity',
      status: 'active',
      contribution: { modelDiscovery: 'dynamic' },
    } as any;
    mocks.agentProviderList.mockReturnValue([gemini]);
    mocks.findAgentProvider.mockImplementation((id) => (
      id === 'antigravity-gemini-agent' ? gemini : undefined
    ));
    const codexRefresh = vi.fn(async () => {});
    const claudeRefresh = vi.fn(async () => {});
    const geminiRefresh = vi.fn(async () => {});
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      getNormalizedProviderSettings: () => ({
        'openai-codex': { enabled: true },
        'claude-code': { enabled: true },
      }),
      codexModelRefreshService: { manualRetry: codexRefresh },
      claudeCodeModelCatalogService: { manualRetry: claudeRefresh },
      refreshDynamicExtensionCatalog: geminiRefresh,
    });

    await service.refreshModelCatalogsForPicker();

    expect(codexRefresh).toHaveBeenCalledOnce();
    expect(claudeRefresh).toHaveBeenCalledOnce();
    expect(geminiRefresh).toHaveBeenCalledWith('antigravity-gemini-agent');
  });

  it('GREEN FB-116: Head dispatch refreshes only the selected engine catalog', async () => {
    const gemini = {
      extensionId: 'gemini-antigravity',
      contributionId: 'antigravity-gemini-agent',
      extensionPath: '/extensions/gemini-antigravity',
      status: 'active',
      contribution: { modelDiscovery: 'dynamic' },
    } as any;
    mocks.findAgentProvider.mockImplementation((id) => (
      id === 'antigravity-gemini-agent' ? gemini : undefined
    ));
    const codexRefresh = vi.fn(async () => {});
    const claudeRefresh = vi.fn(async () => {});
    const geminiRefresh = vi.fn(async () => {});
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      codexModelRefreshService: { manualRetry: codexRefresh },
      claudeCodeModelCatalogService: { manualRetry: claudeRefresh },
      refreshDynamicExtensionCatalog: geminiRefresh,
    });

    await service.refreshModelCatalogForHeadDispatch('openai-codex');
    expect(codexRefresh).toHaveBeenCalledOnce();
    expect(claudeRefresh).not.toHaveBeenCalled();
    expect(geminiRefresh).not.toHaveBeenCalled();

    await service.refreshModelCatalogForHeadDispatch('claude-code');
    expect(claudeRefresh).toHaveBeenCalledOnce();
    expect(geminiRefresh).not.toHaveBeenCalled();

    await service.refreshModelCatalogForHeadDispatch('antigravity-gemini-agent');
    expect(geminiRefresh).toHaveBeenCalledWith('antigravity-gemini-agent');
  });
});

describe('AIService zero-inference channel probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claudeGetState.mockResolvedValue({ status: 'logged-in' });
    mocks.codexGetStatus.mockResolvedValue({ account: { type: 'chatgpt' }, requiresOpenaiAuth: false });
    mocks.probeExtensionLogin.mockResolvedValue({ state: 'logged-in', completionMs: 4 });
  });

  function probeService(): Record<string, any> {
    return Object.create(AIService.prototype) as Record<string, any>;
  }

  function input(id: string) {
    return {
      channel: { id, displayName: id, transport: 'streaming' as const },
      event: { sender: {} } as Electron.IpcMainInvokeEvent,
      workspacePath: '/workspace',
    };
  }

  it('GREEN EO: runs Claude, Codex, and Gemini through their native probes without a model turn', async () => {
    const service = probeService();

    await expect(service.runChannelHealthProbe(input('claude-code'))).resolves.toMatchObject({
      state: 'healthy', summary: '已登录',
    });
    await expect(service.runChannelHealthProbe(input('openai-codex'))).resolves.toMatchObject({
      state: 'healthy', summary: '订阅已登录',
    });
    await expect(service.runChannelHealthProbe(input('antigravity-gemini-agent'))).resolves.toMatchObject({
      state: 'healthy', summary: '已登录',
    });

    expect(mocks.claudeGetState).toHaveBeenCalledWith({ forceRefresh: true, trigger: 'manual' });
    expect(mocks.codexGetStatus).toHaveBeenCalledWith(false);
    expect(mocks.codexGetModelList).not.toHaveBeenCalled();
    expect(mocks.probeExtensionLogin).toHaveBeenCalledWith('antigravity-gemini-agent');
  });

  it('reports Codex transport failure as unknown rather than logged out', async () => {
    mocks.codexGetStatus.mockRejectedValueOnce(new Error('app-server timed out'));
    const result = await probeService().runChannelHealthProbe(input('openai-codex'));

    expect(result).toMatchObject({ state: 'unknown', failureKind: 'auth_check_unknown' });
    expect(result.failureKind).not.toBe('not_logged_in');
  });

  it('GREEN EO: uses only the read-only Codex CLI fallback when account/read transport fails', async () => {
    mocks.codexGetStatus.mockRejectedValueOnce(new Error('app-server unavailable'));
    mocks.codexGetCliLoginStatus.mockResolvedValueOnce('chatgpt');

    await expect(probeService().runChannelHealthProbe(input('openai-codex')))
      .resolves.toMatchObject({ state: 'healthy', summary: '订阅已登录（CLI）' });
    expect(mocks.codexGetCliLoginStatus).toHaveBeenCalledOnce();
    expect(mocks.codexGetModelList).not.toHaveBeenCalled();
  });

  it('labels the API-key account mode without misreporting a subscription login', async () => {
    mocks.codexGetStatus.mockResolvedValueOnce({ account: { type: 'apiKey' }, requiresOpenaiAuth: false });
    await expect(probeService().runChannelHealthProbe(input('openai-codex')))
      .resolves.toMatchObject({ state: 'healthy', summary: 'API key 模式' });
  });

  it('keeps an untrusted Gemini backend unknown for the startup retry path', async () => {
    mocks.probeExtensionLogin.mockResolvedValueOnce({ state: 'unknown', reason: 'not_started', completionMs: 1 });
    await expect(probeService().runChannelHealthProbe(input('antigravity-gemini-agent')))
      .resolves.toMatchObject({ state: 'unknown', failureKind: 'not_started' });
  });

  it('GREEN EO: includes a registered Gemini provider in “体检全部” unless explicitly disabled', () => {
    const registeredGemini = [{
      status: 'registered',
      contributionId: 'antigravity-gemini-agent',
      contribution: { displayName: 'Gemini' },
    }];

    expect(listChannelHealthChannels({}, registeredGemini).map((channel) => channel.id))
      .toContain('antigravity-gemini-agent');
    expect(listChannelHealthChannels({
      'antigravity-gemini-agent': { enabled: false },
    }, registeredGemini).find((channel) => channel.id === 'antigravity-gemini-agent'))
      .toMatchObject({ enabled: false });
  });
});

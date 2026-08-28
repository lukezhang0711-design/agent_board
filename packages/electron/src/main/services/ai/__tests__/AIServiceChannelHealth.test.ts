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
  logWarn: vi.fn(),
  agentProviderList: vi.fn(),
  findAgentProvider: vi.fn(),
  agentProviderListeners: new Set<(event: unknown) => void>(),
  safeHandlers: new Map<string, (...args: any[]) => unknown>(),
  refreshExtensionModels: vi.fn(),
  modelRegistryGetAllModels: vi.fn(),
  storeData: new Map<string, unknown>(),
  getAllWindows: vi.fn(),
  updateSessionMetadata: vi.fn(),
  probeExtensionLogin: vi.fn(),
  codexGetStatus: vi.fn(),
  codexGetCliLoginStatus: vi.fn(),
  codexGetModelList: vi.fn(),
  claudeGetState: vi.fn(),
  codexCatalogStart: vi.fn(),
  codexCatalogManualRetry: vi.fn(),
  claudeCatalogStart: vi.fn(),
  claudeCatalogManualRetry: vi.fn(),
  terminalManager: {
    destroyTerminal: vi.fn(),
    getClaudeCliLiveTurnState: vi.fn(),
    isTerminalActive: vi.fn(),
  },
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  SessionManager: class {
    cleanupAllSessions() {
      return 0;
    }
  },
  ProviderFactory: { destroyProvider: vi.fn(), destroyAll: vi.fn() },
  ModelRegistry: {
    clearCache: vi.fn(),
    getAllModels: mocks.modelRegistryGetAllModels,
  },
  isAskUserQuestionProvider: () => false,
  isAgentProvider: () => false,
  isSlashCommandCatalogProvider: () => false,
  ClaudeCodeProvider: {
    setCustomClaudeCodePathLoader: vi.fn(),
    setModelCatalogSnapshotResolver: vi.fn(),
  },
  OpenAICodexProvider: {
    setModelRefreshSnapshotResolver: vi.fn(),
    getKnownSlashCommands: vi.fn(() => []),
  },
}));
vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { updateMetadata: mocks.updateSessionMetadata },
  DocumentContextService: class {
    setPersistCallback() {}
  },
  SessionFilesRepository: {},
}));
vi.mock('../../../../../../runtime/src/index.ts', () => ({
  AISessionsRepository: { updateMetadata: mocks.updateSessionMetadata },
  DocumentContextService: class {
    setPersistCallback() {}
  },
  SessionFilesRepository: {},
}));
vi.mock('@nimbalyst/runtime/ai/services', () => ({
  DocumentContextService: class {
    setPersistCallback() {}
  },
}));
vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: { updateMetadata: mocks.updateSessionMetadata },
}));
vi.mock('@nimbalyst/runtime/storage/repositories/SessionFilesRepository', () => ({
  SessionFilesRepository: {},
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({ setDatabase: vi.fn() }),
}));
vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  ModelIdentifier: {
    registerExtensionProvider: vi.fn(),
    tryParse: (value: string | undefined) => {
      if (!value || !value.includes(':')) return null;
      const separator = value.indexOf(':');
      return {
        provider: value.slice(0, separator),
        model: value.slice(separator + 1),
      };
    },
  },
}));
vi.mock('@nimbalyst/runtime/ai/server/effortLevels', () => ({
  parseEffortLevel: (value: unknown) => (
    typeof value === 'string' && value.trim().length > 0 ? value : undefined
  ),
  resolveDeclaredEffortLevel: (
    requested: unknown,
    supported: readonly string[],
    defaultEffort?: string,
  ) => {
    const effort = typeof requested === 'string' && requested.trim().length > 0
      ? requested
      : undefined;
    if (!effort) return { outcome: 'none', effortLevel: undefined, requestedEffort: undefined };
    if (supported.includes(effort)) {
      return { outcome: 'accepted', effortLevel: effort, requestedEffort: effort };
    }
    if (defaultEffort && supported.includes(defaultEffort)) {
      return { outcome: 'fallback', effortLevel: defaultEffort, requestedEffort: effort };
    }
    return { outcome: 'dropped', effortLevel: undefined, requestedEffort: effort };
  },
}));
vi.mock('@nimbalyst/runtime/ai/server/toolLookupIds', () => ({
  getCodexToolLookupAliases: vi.fn(() => []),
  resolveGitCommitProposalLookup: vi.fn(() => null),
}));
vi.mock('@nimbalyst/runtime/ai/server/utils/modelConfigUtils', () => ({
  normalizeCodexProviderConfig: (value: unknown) => value,
  omitModelsField: (value: Record<string, unknown>) => {
    const { models: _models, ...rest } = value;
    return rest;
  },
  stripTransientProviderFields: (value: unknown) => value,
}));
vi.mock('@nimbalyst/runtime/ai/server/providers/ClaudeCodeCliProvider', () => ({
  ClaudeCodeCliProvider: {
    setModelCatalogSnapshotResolver: vi.fn(),
    getKnownSlashCommands: vi.fn(() => []),
  },
}));
vi.mock('../../CodexModelRefreshService', () => ({
  CodexModelRefreshService: class {
    registerIpcHandlers() {}

    getStatus() {
      return {
        modelSource: 'none',
        verified: false,
        lastSuccessAt: null,
        lastError: null,
        inFlight: false,
      };
    }

    getModels() {
      return [];
    }

    start() {
      mocks.codexCatalogStart();
      return Promise.resolve(this.getStatus());
    }

    manualRetry() {
      mocks.codexCatalogManualRetry();
      return Promise.resolve(this.getStatus());
    }

    shutdown() {}
  },
}));
vi.mock('../ClaudeCodeModelCatalogService', () => ({
  ClaudeCodeModelCatalogService: class {
    getStatus() {
      return {
        modelSource: 'none',
        verified: false,
        lastSuccessAt: null,
        lastError: null,
        inFlight: false,
      };
    }

    getModels() {
      return [];
    }

    getCliModels() {
      return [];
    }

    start() {
      mocks.claudeCatalogStart();
      return Promise.resolve(this.getStatus());
    }

    manualRetry() {
      mocks.claudeCatalogManualRetry();
      return Promise.resolve(this.getStatus());
    }

    shutdown() {}
  },
}));
vi.mock('electron-store', () => ({
  default: class {
    path = '/tmp/nimbalyst-ai-settings.json';

    get(key: string, fallback?: unknown) {
      return mocks.storeData.has(key) ? mocks.storeData.get(key) : fallback;
    }

    set(key: string, value: unknown) {
      mocks.storeData.set(key, value);
    }
  },
}));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/path'), on: vi.fn(), once: vi.fn() },
  BrowserWindow: { getAllWindows: mocks.getAllWindows, getFocusedWindow: vi.fn(() => null) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), listenerCount: vi.fn(() => 0) },
}));
vi.mock('../../../utils/ipcRegistry', () => ({
  safeHandle: (channel: string, handler: (...args: any[]) => unknown) => {
    mocks.safeHandlers.set(channel, handler);
  },
  safeOn: vi.fn(),
}));
vi.mock('../../../extensions/AgentProviderRegistry', () => ({
  getAgentProviderRegistry: () => ({
    list: mocks.agentProviderList,
    findByContributionId: mocks.findAgentProvider,
    onDidChange: (listener: (event: unknown) => void) => {
      mocks.agentProviderListeners.add(listener);
      return () => mocks.agentProviderListeners.delete(listener);
    },
  }),
}));
vi.mock('../../../extensions/extensionAgentBridge', () => ({
  refreshExtensionAgentProviderModels: mocks.refreshExtensionModels,
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
vi.mock('../HooklessAgentFileWatcher', () => ({
  HooklessAgentFileWatcher: class {
    destroy() {}
  },
}));
vi.mock('../../TerminalSessionManager', () => ({ getTerminalSessionManager: () => mocks.terminalManager }));
vi.mock('../MobileSessionControlHandler', () => ({ initMobileSessionControlHandler: vi.fn(() => () => {}) }));
vi.mock('../../SoundNotificationService', () => ({ SoundNotificationService: class {} }));
vi.mock('../../NotificationService', () => ({ notificationService: { notify: vi.fn() } }));
vi.mock('../../../window/WindowManager', () => ({
  windowStates: new Map(),
  findWindowByWorkspace: vi.fn(() => null),
  getWindowId: vi.fn(() => null),
  createWindow: vi.fn(() => null),
}));
vi.mock('../../../window/windowState', () => ({
  resolveActiveWorkspacePathForWindowId: vi.fn(() => null),
}));
vi.mock('../../SessionFileTracker', () => ({
  sessionFileTracker: {
    getFilesForSession: vi.fn(async () => []),
    trackSessionFiles: vi.fn(),
    clearSession: vi.fn(),
  },
}));
vi.mock('../../TranscriptToolCallEnricher', () => ({
  enrichTranscriptMessagesWithToolCallDiffs: vi.fn(async (_sessionId: string, messages: unknown[]) => messages),
}));
vi.mock('../tools/extractFilePath', () => ({ extractFilePath: vi.fn(() => null) }));
vi.mock('../../ToolCallMatcher', () => ({
  toolCallMatcher: {},
  unwrapShellCommand: vi.fn((value: unknown) => value),
}));
vi.mock('../../WorkspaceFileEditAttributionService', () => ({
  workspaceFileEditAttributionService: {
    recordToolCall: vi.fn(),
    ingestWatcherEvent: vi.fn(),
  },
}));
vi.mock('../../../HistoryManager', () => ({ historyManager: {} }));
vi.mock('../../../file/WorkspaceEventBus', () => ({ addGitignoreBypass: vi.fn() }));
vi.mock('../../AgentWorkflowService', () => ({
  getAgentWorkflowService: vi.fn(() => ({ listEntries: vi.fn(async () => []) })),
}));
vi.mock('../queuedPromptDispatcher', () => ({ tryClaimAndDispatchNextQueuedPrompt: vi.fn(async () => false) }));
vi.mock('../claudeCliQueueDispatch', () => ({ dispatchQueuedPromptToClaudeCli: vi.fn(async () => false) }));
vi.mock('../../FeatureUsageService.ts', () => ({
  FEATURES: { SESSION_CREATED: 'session_created' },
  FeatureUsageService: { getInstance: () => ({ recordUsage: vi.fn() }) },
}));
vi.mock('../../analytics/FeatureTrackingService', () => ({
  FeatureTrackingService: { getInstance: () => ({ trackFeatureFirstUse: vi.fn() }) },
}));
vi.mock('../../SessionEditQuota', () => ({ createSessionEditQuota: vi.fn(() => null) }));
vi.mock('../../RepositoryManager', () => ({ getQueuedPromptsStore: vi.fn() }));
vi.mock('../../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../../database/PGLiteDatabaseWorker', () => ({ database: {} }));
vi.mock('../../../tray/TrayManager', () => ({ TrayManager: { getInstance: vi.fn() } }));
vi.mock('../../analytics/AnalyticsService.ts', () => ({ AnalyticsService: { getInstance: () => ({ sendEvent: vi.fn() }) } }));
vi.mock('../../SettingsService', () => ({ getSettingsService: () => ({ get: vi.fn(), set: vi.fn() }) }));
vi.mock('../../../utils/logger', () => ({ logger: { main: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() } } }));
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

function geminiEntry(status: 'registered' | 'active' | 'pending-consent' | 'denied' = 'registered') {
  return {
    extensionId: 'gemini-antigravity',
    contributionId: 'antigravity-gemini-agent',
    extensionPath: '/extensions/gemini-antigravity',
    status,
    contribution: {
      displayName: 'Gemini',
      icon: 'auto_awesome',
      modelDiscovery: 'dynamic',
    },
    manifest: {},
    backendModuleId: 'antigravity-server',
  } as any;
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
    mocks.agentProviderListeners.clear();
    mocks.safeHandlers.clear();
    mocks.refreshExtensionModels.mockResolvedValue([]);
    mocks.modelRegistryGetAllModels.mockResolvedValue([]);
    mocks.storeData.clear();
    mocks.storeData.set('providerSettings', {
      'claude-code': { enabled: false },
      'claude-code-cli': { enabled: false },
      'openai-codex': { enabled: false },
      'openai-codex-acp': { enabled: false },
    });
    mocks.storeData.set('apiKeys', {});
    mocks.getAllWindows.mockReturnValue([]);
    mocks.updateSessionMetadata.mockResolvedValue(undefined);
    mocks.codexGetModelList.mockResolvedValue({ models: [] });
    mocks.claudeGetState.mockResolvedValue({ status: 'logged-in' });
    mocks.codexGetStatus.mockResolvedValue({ account: { type: 'chatgpt' }, requiresOpenaiAuth: false });
    mocks.codexGetCliLoginStatus.mockResolvedValue('unknown');
    mocks.probeExtensionLogin.mockResolvedValue({ state: 'logged-in', completionMs: 4 });
    mocks.codexCatalogStart.mockResolvedValue(undefined);
    mocks.codexCatalogManualRetry.mockResolvedValue(undefined);
    mocks.claudeCatalogStart.mockResolvedValue(undefined);
    mocks.claudeCatalogManualRetry.mockResolvedValue(undefined);
  });

  it('green ET: marks resolvedModel as display-only in the Head model catalog', async () => {
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      getNormalizedProviderSettings: () => ({
        'claude-code': { enabled: true },
        'openai-codex': { enabled: false },
      }),
      awaitModelCatalogsIfEnabled: vi.fn(async () => {}),
      claudeCodeModelCatalogService: {
        getStatus: () => ({ modelSource: 'runtime', verified: true, lastError: null }),
        getModels: () => [{
          id: 'claude-code:opus[1m]',
          provider: 'claude-code',
          name: 'Opus (1M)',
          resolvedModel: 'claude-opus-5[1m]',
          supportedEffortLevels: [],
        }],
        getCliModels: () => [],
      },
      codexModelRefreshService: {
        getStatus: () => ({ modelSource: 'placeholder', verified: false, lastError: null }),
        getModels: () => [],
      },
      getModelCatalogStatuses: () => ({
        'claude-code': { modelSource: 'runtime', verified: true, lastError: null },
        'claude-code-cli': { modelSource: 'runtime', verified: true, lastError: null },
        'openai-codex': { modelSource: 'placeholder', verified: false, lastError: null },
      }),
    });

    await expect(service.getCurrentModelCatalog()).resolves.toMatchObject({
      resolvedModelNote: 'resolvedModel is display-only; never put it in a model field. Use id for create_session and submit_plan.',
      models: [{
        id: 'claude-code:opus[1m]',
        resolvedModel: 'claude-opus-5[1m]',
      }],
    });
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
    const gemini = geminiEntry('active');
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

  it('RED FB-140: startup refreshes a registered dynamic extension provider without waiting for prior activation', async () => {
    const gemini = geminiEntry('registered');
    mocks.agentProviderList.mockReturnValue([gemini]);
    mocks.findAgentProvider.mockImplementation((id) => (
      id === 'antigravity-gemini-agent' ? gemini : undefined
    ));
    mocks.refreshExtensionModels.mockResolvedValueOnce([
      { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High' },
    ]);

    const service = new AIService({} as any) as AIService;
    try {
      await vi.waitFor(() => {
        expect(mocks.refreshExtensionModels).toHaveBeenCalledWith('antigravity-gemini-agent');
      });
    } finally {
      service.destroy();
    }
  });

  it('RED FB-140: a dynamic extension registered after the startup scan is still refreshed automatically', async () => {
    mocks.agentProviderList.mockReturnValue([]);
    const service = new AIService({} as any) as AIService;
    try {
      expect(mocks.refreshExtensionModels).not.toHaveBeenCalled();
      const gemini = geminiEntry('registered');
      mocks.agentProviderList.mockReturnValue([gemini]);
      mocks.findAgentProvider.mockImplementation((id) => (
        id === 'antigravity-gemini-agent' ? gemini : undefined
      ));
      mocks.refreshExtensionModels.mockResolvedValueOnce([
        { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High' },
      ]);

      for (const listener of mocks.agentProviderListeners) {
        listener({ type: 'registered', entry: gemini });
      }

      await vi.waitFor(() => {
        expect(mocks.refreshExtensionModels).toHaveBeenCalledWith('antigravity-gemini-agent');
      });
    } finally {
      service.destroy();
    }
  });

  it('RED FB-140: ai:getModels starts one background refresh for a never-read dynamic extension catalog', async () => {
    mocks.agentProviderList.mockReturnValue([]);
    const service = new AIService({} as any) as AIService;
    try {
      const gemini = geminiEntry('registered');
      mocks.agentProviderList.mockReturnValue([gemini]);
      mocks.findAgentProvider.mockImplementation((id) => (
        id === 'antigravity-gemini-agent' ? gemini : undefined
      ));
      const refresh = deferred<[{ id: string; name: string }]>();
      mocks.refreshExtensionModels.mockReturnValue(refresh.promise);

      const handler = mocks.safeHandlers.get('ai:getModels');
      expect(handler).toBeTypeOf('function');
      const first = await handler?.({} as Electron.IpcMainInvokeEvent) as any;

      expect(mocks.refreshExtensionModels).toHaveBeenCalledTimes(1);
      expect(first.grouped['antigravity-gemini-agent']).toBeUndefined();
      expect(first.catalogStatuses['antigravity-gemini-agent']).toMatchObject({
        modelSource: 'none',
        verified: false,
        inFlight: true,
      });

      await handler?.({} as Electron.IpcMainInvokeEvent);
      expect(mocks.refreshExtensionModels).toHaveBeenCalledTimes(1);

      refresh.resolve([{ id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High' }]);
      await vi.waitFor(() => {
        expect((service as any).getModelCatalogStatuses()['antigravity-gemini-agent'])
          .toMatchObject({ modelSource: 'runtime', verified: true, inFlight: false });
      });

      const afterSuccess = await handler?.({} as Electron.IpcMainInvokeEvent) as any;
      expect(mocks.refreshExtensionModels).toHaveBeenCalledTimes(1);
      expect(afterSuccess.grouped['antigravity-gemini-agent']).toEqual([
        expect.objectContaining({
          id: 'antigravity-gemini-agent:gemini-3.7-flash-high',
          name: 'Gemini 3.7 Flash High',
        }),
      ]);
    } finally {
      service.destroy();
    }
  });

  it('RED FB-140: dynamic extension catalog status exists before the first successful refresh', () => {
    const gemini = geminiEntry('registered');
    mocks.agentProviderList.mockReturnValue([gemini]);
    mocks.findAgentProvider.mockImplementation((id) => (
      id === 'antigravity-gemini-agent' ? gemini : undefined
    ));
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      extensionDynamicModelCatalogs: new Map(),
      claudeCodeModelCatalogService: {
        getStatus: () => ({ modelSource: 'none', verified: false, lastError: null }),
      },
      codexModelRefreshService: {
        getStatus: () => ({ modelSource: 'none', verified: false, lastError: null }),
      },
    });

    expect(service.getModelCatalogStatuses()['antigravity-gemini-agent']).toMatchObject({
      modelSource: 'none',
      verified: false,
      lastSuccessAt: null,
      lastError: null,
    });
  });

  it('RED FB-140: dynamic extension catalog refresh writes success and failure logs with the provider and raw error', async () => {
    const gemini = geminiEntry('registered');
    mocks.findAgentProvider.mockImplementation((id) => (
      id === 'antigravity-gemini-agent' ? gemini : undefined
    ));
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, { extensionDynamicModelCatalogs: new Map() });

    mocks.refreshExtensionModels.mockResolvedValueOnce([
      { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High' },
    ]);
    await service.refreshDynamicExtensionCatalog('antigravity-gemini-agent');
    expect(mocks.logInfo).toHaveBeenCalledWith(
      '[ExtensionDynamicModelCatalog] refreshModels succeeded',
      expect.objectContaining({
        provider: 'antigravity-gemini-agent',
        modelCount: 1,
      }),
    );

    mocks.refreshExtensionModels.mockRejectedValueOnce(new Error('agy models failed: offline'));
    await expect(
      service.refreshDynamicExtensionCatalog('antigravity-gemini-agent'),
    ).rejects.toThrow('agy models failed: offline');
    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[ExtensionDynamicModelCatalog] refreshModels failed',
      expect.objectContaining({
        provider: 'antigravity-gemini-agent',
        error: 'agy models failed: offline',
      }),
    );
  });

  it('GREEN FB-116: Head dispatch refreshes only the selected engine catalog', async () => {
    const gemini = geminiEntry('active');
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

describe('AIService persisted historical model migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSessionMetadata.mockResolvedValue(undefined);
  });

  it('GREEN ES: upgrades a persisted Opus 1M ID once on session load even when default shares its resolved model', async () => {
    const start = vi.fn(async () => ({}));
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      claudeCodeModelCatalogService: {
        start,
        getModels: () => [
          { id: 'claude-code:default', resolvedModel: 'claude-opus-5[1m]' },
          { id: 'claude-code:opus[1m]', resolvedModel: 'claude-opus-5[1m]' },
        ],
      },
    });
    const session = {
      id: 'legacy-opus-session',
      provider: 'claude-code',
      model: 'claude-code:opus-1m',
    };

    await service.migratePersistedHistoricalModelOnLoad(session);
    await service.migratePersistedHistoricalModelOnLoad(session);

    expect(start).toHaveBeenCalledOnce();
    expect(session.model).toBe('claude-code:opus[1m]');
    expect(mocks.updateSessionMetadata).toHaveBeenCalledTimes(1);
    expect(mocks.updateSessionMetadata).toHaveBeenCalledWith('legacy-opus-session', {
      model: 'claude-code:opus[1m]',
    });
  });

  it('GREEN ES: covers the Claude Code CLI namespace with the same product history', async () => {
    const start = vi.fn(async () => ({}));
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      claudeCodeModelCatalogService: {
        start,
        getCliModels: () => [{
          id: 'claude-code-cli:claude-fable-5[1m]',
          resolvedModel: 'claude-fable-5[1m]',
        }],
      },
    });
    const session = {
      id: 'legacy-cli-fable-session',
      provider: 'claude-code-cli',
      model: 'claude-code-cli:claude-fable-5-1m',
    };

    await service.migratePersistedHistoricalModelOnLoad(session);

    expect(start).toHaveBeenCalledOnce();
    expect(session.model).toBe('claude-code-cli:claude-fable-5[1m]');
    expect(mocks.updateSessionMetadata).toHaveBeenCalledWith('legacy-cli-fable-session', {
      model: 'claude-code-cli:claude-fable-5[1m]',
    });
  });

  it('GREEN ES: leaves an unknown persisted model untouched for the visible safety valve', async () => {
    const start = vi.fn(async () => ({}));
    const service = Object.create(AIService.prototype) as Record<string, any>;
    Object.assign(service, {
      claudeCodeModelCatalogService: { start },
    });
    const session = {
      id: 'unknown-legacy-session',
      provider: 'claude-code',
      model: 'claude-code:unknown-product-legacy-id',
    };

    await service.migratePersistedHistoricalModelOnLoad(session);

    expect(start).not.toHaveBeenCalled();
    expect(session.model).toBe('claude-code:unknown-product-legacy-id');
    expect(mocks.updateSessionMetadata).not.toHaveBeenCalled();
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

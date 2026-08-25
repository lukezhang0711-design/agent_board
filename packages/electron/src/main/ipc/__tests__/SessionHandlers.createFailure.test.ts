import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => Promise<any> | any>();

  return {
    handlers,
    initializeSessionManager: vi.fn(),
    create: vi.fn(),
    updateMetadata: vi.fn(),
    resolveDynamicModelCatalogSelection: vi.fn(),
    usesDynamicModelCatalog: vi.fn(),
    tryParse: vi.fn(),
    getDefaultModelId: vi.fn(),
    sendEvent: vi.fn(),
  };
});

vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: (channel: string, handler: (...args: any[]) => Promise<any> | any) => {
    mocks.handlers.set(channel, handler);
  },
  safeOn: vi.fn(),
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  SessionManager: class {
    initialize = mocks.initializeSessionManager;
  },
  ProviderFactory: {
    destroyProvider: vi.fn(),
  },
}));

vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: {
    create: mocks.create,
    updateMetadata: mocks.updateMetadata,
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
  TranscriptMigrationRepository: {
    hasService: vi.fn(() => false),
    getService: vi.fn(),
  },
}));

vi.mock('@nimbalyst/runtime/ai/server/toolLookupIds', () => ({
  parseCodexToolLookupId: vi.fn(),
}));

vi.mock('@nimbalyst/runtime/ai/server/transcript', () => ({
  TranscriptProjector: {
    project: vi.fn(),
  },
}));

vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  ModelIdentifier: {
    tryParse: mocks.tryParse,
    getDefaultModelId: mocks.getDefaultModelId,
  },
  shouldBlockStartedSessionProviderSwitch: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('../../utils/gitUncommittedFiles', () => ({
  getCachedUncommittedFiles: vi.fn(),
}));

vi.mock('../../utils/jsonColumn', () => ({
  parseJsonObjectColumn: vi.fn(() => ({})),
}));

vi.mock('../../tray/TrayManager', () => ({
  TrayManager: {
    getInstance: vi.fn(() => ({ onPromptResolved: vi.fn() })),
  },
}));

vi.mock('../../services/analytics/AnalyticsService', () => ({
  AnalyticsService: {
    getInstance: () => ({ sendEvent: mocks.sendEvent }),
  },
}));

vi.mock('../../mcp/tools/codexToolCallResolver', () => ({
  resolveRequestUserInputPromptTargets: vi.fn(),
}));

vi.mock('../../services/TranscriptToolCallEnricher', () => ({
  enrichTranscriptMessagesWithToolCallDiffs: vi.fn(),
}));

vi.mock('../../services/ai/pendingPromptPersistence', () => ({
  setSessionPendingPrompt: vi.fn(),
}));

vi.mock('../../services/ai/modelCatalogValidation', () => ({
  resolveDynamicModelCatalogSelection: mocks.resolveDynamicModelCatalogSelection,
  usesDynamicModelCatalog: mocks.usesDynamicModelCatalog,
}));

function registeredHandler(channel: string): (...args: any[]) => Promise<any> | any {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

function createEvent() {
  return {
    sender: {
      send: vi.fn(),
    },
  };
}

describe('SessionHandlers session creation failures', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.initializeSessionManager.mockReset().mockResolvedValue(undefined);
    mocks.create.mockReset().mockResolvedValue(undefined);
    mocks.updateMetadata.mockReset().mockResolvedValue(undefined);
    mocks.resolveDynamicModelCatalogSelection.mockReset().mockResolvedValue(undefined);
    mocks.usesDynamicModelCatalog.mockReset().mockReturnValue(true);
    mocks.tryParse.mockReset().mockImplementation((model: string) => {
      const [provider] = model.split(':');
      return model.includes(':') ? { provider } : null;
    });
    mocks.getDefaultModelId.mockReset().mockImplementation((provider: string) => `${provider}:default`);
    mocks.sendEvent.mockReset();

    const { registerSessionHandlers } = await import('../SessionHandlers');
    await registerSessionHandlers();
  });

  it('GREEN EO preserves an explicitly supplied unlisted raw model when creating a session', async () => {
    const rawModel = 'claude-code:future-native-model';
    const event = createEvent();

    const result = await registeredHandler('sessions:create')(event, {
      workspaceId: '/workspace',
      session: {
        id: 'unlisted-native-session',
        provider: 'claude-code',
        model: rawModel,
        title: 'Unlisted native model',
      },
    });

    expect(result).toEqual({ success: true, id: 'unlisted-native-session' });
    expect(mocks.resolveDynamicModelCatalogSelection).toHaveBeenCalledWith('claude-code', rawModel);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude-code',
      model: rawModel,
    }));
  });

  it('GREEN EO preserves an explicitly supplied unlisted raw model when creating a child session', async () => {
    const model = 'claude-code:future-native-child-model';
    const event = createEvent();

    const result = await registeredHandler('sessions:create-child')(event, {
      parentSessionId: 'parent-session',
      workspacePath: '/workspace',
      provider: 'claude-code',
      model,
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude-code',
      model,
    }));
    expect(event.sender.send).not.toHaveBeenCalledWith('sessions:create-failed', expect.anything());
  });
});

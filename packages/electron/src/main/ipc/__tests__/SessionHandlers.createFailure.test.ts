import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => Promise<any> | any>();

  return {
    handlers,
    initializeSessionManager: vi.fn(),
    create: vi.fn(),
    updateMetadata: vi.fn(),
    resolveDynamicModelCatalogSelection: vi.fn(),
    assertDynamicModelCatalogSelection: vi.fn(),
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
  assertDynamicModelCatalogSelection: mocks.assertDynamicModelCatalogSelection,
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
    mocks.assertDynamicModelCatalogSelection.mockReset().mockResolvedValue(undefined);
    mocks.tryParse.mockReset().mockImplementation((model: string) => {
      const [provider] = model.split(':');
      return model.includes(':') ? { provider } : null;
    });
    mocks.getDefaultModelId.mockReset().mockImplementation((provider: string) => `${provider}:default`);
    mocks.sendEvent.mockReset();

    const { registerSessionHandlers } = await import('../SessionHandlers');
    await registerSessionHandlers();
  });

  it('canonicalizes an explicitly supplied historical model through the live resolver before creating a session', async () => {
    const legacyModel = 'claude-code:fable-1m';
    const canonicalModel = 'claude-code:claude-fable-5-1m';
    mocks.resolveDynamicModelCatalogSelection.mockResolvedValue(canonicalModel);
    const event = createEvent();

    const result = await registeredHandler('sessions:create')(event, {
      workspaceId: '/workspace',
      session: {
        id: 'legacy-default-session',
        provider: 'claude-code',
        model: legacyModel,
        title: 'Legacy default',
      },
    });

    expect(result).toEqual({ success: true, id: 'legacy-default-session' });
    expect(mocks.resolveDynamicModelCatalogSelection).toHaveBeenCalledWith('claude-code', legacyModel);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude-code',
      model: canonicalModel,
    }));
  });

  it('sends the original unmappable-model error to the normal creation caller', async () => {
    const model = 'claude-code:truly-unmappable';
    const error = new Error(
      '已保存的模型“claude-code:truly-unmappable”不再属于当前 claude-code 模型目录。请重新选择模型；系统不会自动改为其他型号。',
    );
    mocks.assertDynamicModelCatalogSelection.mockRejectedValue(error);
    const event = createEvent();

    const result = await registeredHandler('sessions:create')(event, {
      workspaceId: '/workspace',
      session: {
        id: 'unmappable-session',
        provider: 'claude-code',
        model,
      },
    });

    expect(result).toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(event.sender.send).toHaveBeenCalledWith('sessions:create-failed', {
      error: error.message,
      provider: 'claude-code',
      model,
    });
  });

  it('sends the original unmappable-model error to the child-session caller', async () => {
    const model = 'claude-code:truly-unmappable-child';
    const error = new Error(
      '已保存的模型“claude-code:truly-unmappable-child”不再属于当前 claude-code 模型目录。请重新选择模型；系统不会自动改为其他型号。',
    );
    mocks.assertDynamicModelCatalogSelection.mockRejectedValue(error);
    const event = createEvent();

    const result = await registeredHandler('sessions:create-child')(event, {
      parentSessionId: 'parent-session',
      workspacePath: '/workspace',
      provider: 'claude-code',
      model,
    });

    expect(result).toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(event.sender.send).toHaveBeenCalledWith('sessions:create-failed', {
      error: error.message,
      provider: 'claude-code',
      model,
    });
  });
});

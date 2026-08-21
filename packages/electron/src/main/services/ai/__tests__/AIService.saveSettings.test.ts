import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: any[]) => any>(),
  settingsSet: vi.fn(),
  settingsGet: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../../utils/ipcRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/ipcRegistry')>();
  return {
    ...actual,
    safeHandle: (channel: string, handler: (...args: any[]) => any) => {
      mocks.ipcHandlers.set(channel, handler);
    },
  };
});

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  SessionManager: class {},
  ProviderFactory: { getProvider: vi.fn(), createProvider: vi.fn(), destroyProvider: vi.fn() },
  ModelRegistry: { clearCache: vi.fn(), getAllModels: vi.fn() },
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

vi.mock('../../../database/PGLiteDatabaseWorker', () => ({ database: {} }));
vi.mock('../../../tray/TrayManager', () => ({ TrayManager: { getInstance: vi.fn() } }));
vi.mock('../../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
    isReady: vi.fn(() => true),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => null) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), listenerCount: vi.fn(() => 0) },
}));
vi.mock('../tools', () => ({ ToolExecutor: class {}, toolRegistry: { register: vi.fn() }, BUILT_IN_TOOLS: [] }));
vi.mock('../MessageStreamingHandler', () => ({ MessageStreamingHandler: class {} }));
vi.mock('../HooklessAgentFileWatcher', () => ({ HooklessAgentFileWatcher: class {} }));
vi.mock('../../TerminalSessionManager', () => ({ getTerminalSessionManager: vi.fn() }));
vi.mock('../../RepositoryManager', () => ({ getQueuedPromptsStore: vi.fn() }));
vi.mock('../../analytics/AnalyticsService.ts', () => ({
  AnalyticsService: { getInstance: () => ({ sendEvent: vi.fn() }) },
}));
vi.mock('../../SettingsService', () => ({
  getSettingsService: () => ({ set: mocks.settingsSet, get: mocks.settingsGet }),
}));
vi.mock('../../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() } },
}));

import { AIService, listChannelHealthChannels } from '../AIService';
import {
  registerExtensionProviderSetting,
  syncExtensionProviderSettings,
} from '../../../../shared/settings/keys';

describe('AIService ai:saveSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ipcHandlers.clear();
  });

  afterEach(() => {
    syncExtensionProviderSettings([]);
  });

  it('RED: skips an unregistered extension provider slice without poisoning a following legitimate write', async () => {
    const persisted = new Map<string, unknown>();
    mocks.settingsSet.mockImplementation((key: string, value: unknown) => {
      if (key === 'ai.provider.unregistered-agent') {
        throw new Error('Unknown setting key: ai.provider.unregistered-agent');
      }
      persisted.set(key, value);
    });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      cachedNormalizedProviderSettings: null,
      streamingHandler: { handle: vi.fn() },
    });

    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:saveSettings');
    const result = await handler?.({} as Electron.IpcMainInvokeEvent, {
      providerSettings: {
        'unregistered-agent': {
          enabled: true,
          models: ['must-not-appear-in-the-log'],
        },
        claude: { enabled: true },
      },
    });

    expect(persisted).toEqual(new Map([
      ['ai.provider.claude', { enabled: true }],
    ]));
    expect(result).toEqual({
      success: false,
      savedKeys: ['ai.provider.claude'],
      skipped: [{
        key: 'ai.provider.unregistered-agent',
        reason: 'unknown_key',
      }],
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[ai:saveSettings] skipped key=ai.provider.unregistered-agent reason=unknown_key',
    );
    expect(String(mocks.logWarn.mock.calls)).not.toContain('must-not-appear-in-the-log');
  });

  it('GREEN: saves one selected Gemini model after the extension provider registers', async () => {
    const persisted = new Map<string, unknown>();
    mocks.settingsSet.mockImplementation((key: string, value: unknown) => {
      persisted.set(key, value);
    });
    registerExtensionProviderSetting('antigravity-gemini-agent');

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      cachedNormalizedProviderSettings: null,
      streamingHandler: { handle: vi.fn() },
    });
    (service as any).setupIpcHandlers();

    const handler = mocks.ipcHandlers.get('ai:saveSettings');
    const result = await handler?.({} as Electron.IpcMainInvokeEvent, {
      providerSettings: {
        'antigravity-gemini-agent': {
          enabled: true,
          models: ['antigravity-gemini-agent:gemini-3-flash-low'],
        },
      },
    });

    expect(persisted).toEqual(new Map([
      ['ai.provider.antigravity-gemini-agent', {
        enabled: true,
        models: ['antigravity-gemini-agent:gemini-3-flash-low'],
      }],
    ]));
    expect(result).toEqual({
      success: true,
      savedKeys: ['ai.provider.antigravity-gemini-agent'],
      skipped: [],
    });
    expect(mocks.logWarn).not.toHaveBeenCalled();
  });

  it('RED: includes a runtime-registered extension provider at the health-check moment, including late registration', () => {
    const gemini = {
      status: 'registered',
      contributionId: 'antigravity-gemini-agent',
      contribution: { displayName: 'Gemini' },
    };
    const runtimeProviders: typeof gemini[] = [];

    expect(listChannelHealthChannels(
      { 'antigravity-gemini-agent': { enabled: true } },
      runtimeProviders,
    )).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'antigravity-gemini-agent' }),
    ]));
    runtimeProviders.push(gemini);

    const enabled = listChannelHealthChannels(
      { 'antigravity-gemini-agent': { enabled: true } },
      runtimeProviders,
    );
    const disabled = listChannelHealthChannels(
      { 'antigravity-gemini-agent': { enabled: false } },
      runtimeProviders,
    );

    expect(enabled).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'antigravity-gemini-agent',
        displayName: 'Gemini',
        transport: 'streaming',
        enabled: true,
      }),
    ]));
    expect(disabled).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'antigravity-gemini-agent',
        enabled: false,
      }),
    ]));
  });

  it('GREEN: hides the Claude CLI and API rows by default when the API key is absent', () => {
    const channels = listChannelHealthChannels({
      'claude-code': { enabled: true },
      'claude-code-cli': { enabled: true },
      claude: { enabled: true },
    }, []);

    expect(channels.some((channel) => channel.id === 'claude-code-cli')).toBe(false);
    expect(channels.some((channel) => channel.id === 'claude')).toBe(false);
  });

  it('GREEN: restores the CLI row when advanced visibility is enabled and shows Claude API only with a key', () => {
    const channels = listChannelHealthChannels({
      'claude-code': { enabled: true },
      'claude-code-cli': { enabled: true },
      claude: { enabled: true },
    }, [], {
      showClaudeCliChannel: true,
      anthropicApiKey: 'sk-ant-fixture',
    });

    expect(channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude-code-cli', transport: 'claude-cli' }),
      expect.objectContaining({ id: 'claude', displayName: 'Claude API' }),
    ]));
  });

  it('GREEN: filters CLI models in the main new-session enumeration and restores them with the switch', async () => {
    const { ModelRegistry } = await import('@nimbalyst/runtime/ai/server');
    vi.mocked(ModelRegistry.getAllModels).mockResolvedValue([
      { id: 'claude-code:sonnet', name: 'Claude Agent · Sonnet', provider: 'claude-code' },
      { id: 'claude-code-cli:sonnet', name: 'Claude Code CLI · Sonnet', provider: 'claude-code-cli' },
    ] as any);
    mocks.settingsGet.mockReturnValue(false);

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      getNormalizedProviderSettings: () => ({
        'claude-code': { enabled: true },
        'claude-code-cli': { enabled: true },
      }),
      getSettingsStore: () => ({ get: (key: string) => key === 'apiKeys' ? {} : {} }),
      startCodexModelRefreshIfEnabled: vi.fn(),
      startClaudeCodeModelCatalogIfEnabled: vi.fn(),
      awaitModelCatalogsIfEnabled: vi.fn(async () => undefined),
      getModelCatalogStatuses: vi.fn(() => ({
        'claude-code': { modelSource: 'runtime', verified: true, lastError: null },
        'claude-code-cli': { modelSource: 'runtime', verified: true, lastError: null },
      })),
      getMissingDefaultModelWarning: vi.fn(() => null),
      streamingHandler: { handle: vi.fn() },
    });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:getModels');

    const hidden = await handler?.({} as Electron.IpcMainInvokeEvent);
    expect(hidden?.models).toEqual([
      expect.objectContaining({ id: 'claude-code:sonnet' }),
    ]);

    mocks.settingsGet.mockReturnValue(true);
    const visible = await handler?.({} as Electron.IpcMainInvokeEvent);
    expect(visible?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude-code:sonnet' }),
      expect.objectContaining({ id: 'claude-code-cli:sonnet' }),
    ]));
  });
});

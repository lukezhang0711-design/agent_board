import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDefaultAIModel: vi.fn<() => string | undefined>(() => undefined),
  setDefaultAIModel: vi.fn(),
  resolveDynamicModelCatalogSelection: vi.fn(),
  assertDynamicModelCatalogSelection: vi.fn(),
}));

// SettingsControlService imports from many other modules (electron, store,
// StytchAuthService, WindowManager). For these invariants we only need the
// exported constants, so stub the heavy modules to keep the test fast.

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../utils/store', () => ({
  ALLOWED_APP_KEYS: undefined, // not used here
  addToRecentItems: vi.fn(),
  clearPendingThemeFallback: vi.fn(),
  getAppSetting: vi.fn(() => undefined),
  getAppStore: vi.fn(() => ({ set: vi.fn(), get: vi.fn(() => undefined) })),
  getDefaultAIModel: mocks.getDefaultAIModel,
  getReleaseChannel: vi.fn(() => 'stable'),
  getSessionSyncConfig: vi.fn(() => undefined),
  getTheme: vi.fn(() => 'dark'),
  getWorkspaceState: vi.fn(() => ({})),
  getWorkspaceWindowState: vi.fn(() => undefined),
  isAnalyticsEnabled: vi.fn(() => false),
  isSettingsAgentToolsDisabled: vi.fn(() => false),
  setAnalyticsEnabled: vi.fn(),
  setAppSetting: vi.fn(),
  setDefaultAIModel: mocks.setDefaultAIModel,
  setPreferredAgentLanguage: vi.fn(),
  setSessionSyncConfig: vi.fn(),
  setTheme: vi.fn(),
  setWorkspaceTrusted: vi.fn(),
  updateWorkspaceState: vi.fn(),
}));

vi.mock('../StytchAuthService', () => ({
  isAuthenticated: vi.fn(() => false),
  getUserEmail: vi.fn(() => null),
  getPersonalOrgId: vi.fn(() => null),
  getPersonalUserId: vi.fn(() => null),
}));

vi.mock('../SessionNamingService', () => ({
  SessionNamingService: {
    getInstance: () => ({ setLanguage: vi.fn() }),
  },
}));

vi.mock('../../theme/ThemeManager', () => ({
  updateNativeTheme: vi.fn(),
  updateWindowTitleBars: vi.fn(),
}));

vi.mock('../../window/WindowManager', () => ({
  createWindow: vi.fn(),
  findWindowByWorkspace: vi.fn(() => null),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    store: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('../ai/modelCatalogValidation', () => ({
  resolveDynamicModelCatalogSelection: mocks.resolveDynamicModelCatalogSelection,
  assertDynamicModelCatalogSelection: mocks.assertDynamicModelCatalogSelection,
}));

import {
  ALLOWED_APP_KEYS,
  ALLOWED_WORKSPACE_KEYS,
  DENIED_APP_KEYS,
  SettingsControlService,
} from '../SettingsControlService';

describe('SettingsControlService allowlist invariants', () => {
  beforeEach(() => {
    mocks.getDefaultAIModel.mockReset().mockReturnValue(undefined);
    mocks.setDefaultAIModel.mockReset();
    mocks.resolveDynamicModelCatalogSelection.mockReset().mockResolvedValue(undefined);
    mocks.assertDynamicModelCatalogSelection.mockReset().mockResolvedValue(undefined);
  });

  it('does not include any DENIED_APP_KEYS in ALLOWED_APP_KEYS', () => {
    // The whole point of the deny list: if anyone ever adds, say, `apiKeys` to
    // the allow list (intentionally or via a bad merge), this fails in CI.
    const allow = new Set<string>(ALLOWED_APP_KEYS);
    for (const denied of DENIED_APP_KEYS) {
      expect(allow.has(denied), `denied key "${denied}" must NOT be in ALLOWED_APP_KEYS`).toBe(false);
    }
  });

  it('explicitly denies known secret-bearing keys', () => {
    // Sanity check the deny list itself didn't get accidentally emptied.
    const denied = new Set<string>(DENIED_APP_KEYS);
    expect(denied.has('apiKeys')).toBe(true);
    expect(denied.has('globalApiKeys')).toBe(true);
    expect(denied.has('stytchAuth')).toBe(true);
    expect(denied.has('shareKeys')).toBe(true);
  });

  it('only allows curated app-level keys', () => {
    // If you intentionally add a new allowed key, update this assertion. The
    // point is to make new additions a deliberate, visible diff.
    expect([...ALLOWED_APP_KEYS].sort()).toEqual(
      [
        'alphaFeatures',
        'analyticsEnabled',
        'betaFeatures',
        'completionSoundEnabled',
        'defaultAIModel',
        'developerFeatures',
        'extensionSettings',
        'osNotificationsEnabled',
        'preferredAgentLanguage',
        'sessionSync',
        'settingsAgentToolsDisabled',
        'spellcheckEnabled',
        'theme',
        'voiceMode',
      ].sort(),
    );
  });

  it('only allows curated workspace-level keys', () => {
    expect([...ALLOWED_WORKSPACE_KEYS].sort()).toEqual(
      ['agentPermissions', 'issueKeyPrefix', 'trackerSyncPolicies'].sort(),
    );
  });

  it('persists the live catalog ID when a legacy dynamic default resolves equivalently', async () => {
    const legacyModel = 'claude-code:fable-1m';
    const canonicalModel = 'claude-code:claude-fable-5-1m';
    mocks.getDefaultAIModel.mockReturnValue(legacyModel);
    mocks.resolveDynamicModelCatalogSelection.mockResolvedValue(canonicalModel);

    const result = await SettingsControlService.getInstance().setDefaultAIModel(
      'settings-model-migration-test',
      { providerModel: legacyModel },
    );

    expect(mocks.resolveDynamicModelCatalogSelection).toHaveBeenCalledWith('claude-code', legacyModel);
    expect(mocks.assertDynamicModelCatalogSelection).toHaveBeenCalledWith('claude-code', canonicalModel);
    expect(mocks.setDefaultAIModel).toHaveBeenCalledWith(canonicalModel);
    expect(mocks.setDefaultAIModel).not.toHaveBeenCalledWith(legacyModel);
    expect(result).toEqual({ ok: true, before: legacyModel, after: canonicalModel });
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_CODE_BUILTIN_MODEL_IDS,
  CLAUDE_CODE_CATALOG_FINGERPRINT,
  refreshClaudeCodeModelCatalog,
  type ClaudeCodeModelCatalogPersistence,
} from '../claudeCodeModelCatalogRefresh';

const OLD_SEVEN_MODEL_STOCK = [
  'claude-code:opus',
  'claude-code:opus-4-7',
  'claude-code:opus-4-6',
  'claude-code:sonnet',
  'claude-code:sonnet-1m',
  'claude-code:haiku',
  'claude-code:opus-1m',
];

function createPersistence(options: {
  models?: string[];
  knownVariants?: string[];
  fingerprint?: string;
  defaultModel?: string;
} = {}): ClaudeCodeModelCatalogPersistence & {
  setProviderSettings: ReturnType<typeof vi.fn>;
  setMigrations: ReturnType<typeof vi.fn>;
  setDefaultModel: ReturnType<typeof vi.fn>;
  logRefresh: ReturnType<typeof vi.fn>;
} {
  const providerSettings = {
    'claude-code': {
      enabled: true,
      models: options.models ?? CLAUDE_CODE_BUILTIN_MODEL_IDS,
      authMethod: 'login',
    },
  };
  const migrations = {
    knownClaudeCodeVariants: options.knownVariants ?? [
      'fable', 'opus', 'opus-5', 'opus-4-7', 'opus-4-6', 'sonnet', 'sonnet-5', 'haiku',
    ],
    claudeCodeModelCatalogFingerprint: options.fingerprint ?? CLAUDE_CODE_CATALOG_FINGERPRINT,
  };

  return {
    getProviderSettings: () => providerSettings,
    setProviderSettings: vi.fn(),
    getMigrations: () => migrations,
    setMigrations: vi.fn(),
    getDefaultModel: () => options.defaultModel,
    setDefaultModel: vi.fn(),
    logRefresh: vi.fn(),
  };
}

describe('refreshClaudeCodeModelCatalog', () => {
  it('RED: replaces the old seven-model stock with the built-in catalog at startup', () => {
    const persistence = createPersistence({
      models: OLD_SEVEN_MODEL_STOCK,
      knownVariants: ['opus', 'opus-4-7', 'opus-4-6', 'sonnet', 'haiku'],
      fingerprint: 'old-catalog',
    });

    refreshClaudeCodeModelCatalog(persistence);

    expect(persistence.setProviderSettings).toHaveBeenCalledWith({
      'claude-code': expect.objectContaining({
        models: CLAUDE_CODE_BUILTIN_MODEL_IDS,
      }),
    });
    expect(CLAUDE_CODE_BUILTIN_MODEL_IDS).toEqual(expect.arrayContaining([
      'claude-code:opus-5',
      'claude-code:sonnet-5',
      'claude-code:opus-5-1m',
      'claude-code:sonnet-5-1m',
    ]));
    expect(persistence.setMigrations).toHaveBeenCalledWith(expect.objectContaining({
      claudeCodeModelCatalogFingerprint: CLAUDE_CODE_CATALOG_FINGERPRINT,
      knownClaudeCodeVariants: expect.arrayContaining(['opus-5', 'sonnet-5']),
    }));
    expect(persistence.logRefresh).toHaveBeenCalledWith(expect.objectContaining({
      previousCount: OLD_SEVEN_MODEL_STOCK.length,
      nextCount: CLAUDE_CODE_BUILTIN_MODEL_IDS.length,
      previousFingerprint: 'old-catalog',
      nextFingerprint: CLAUDE_CODE_CATALOG_FINGERPRINT,
    }));
  });

  it('preserves a user default that remains in the built-in catalog', () => {
    const persistence = createPersistence({
      models: OLD_SEVEN_MODEL_STOCK,
      knownVariants: ['opus'],
      fingerprint: 'old-catalog',
      defaultModel: 'claude-code:sonnet-5-1m',
    });

    refreshClaudeCodeModelCatalog(persistence);

    expect(persistence.setDefaultModel).not.toHaveBeenCalled();
  });

  it('falls back when a user default points at a removed Claude Code variant', () => {
    const persistence = createPersistence({
      models: OLD_SEVEN_MODEL_STOCK,
      knownVariants: ['opus'],
      fingerprint: 'old-catalog',
      defaultModel: 'claude-code:retired-variant',
    });

    refreshClaudeCodeModelCatalog(persistence);

    expect(persistence.setDefaultModel).toHaveBeenCalledWith('claude-code:opus-1m');
  });

  it('does not write or log when the persisted catalog fingerprint already matches', () => {
    const persistence = createPersistence();

    refreshClaudeCodeModelCatalog(persistence);

    expect(persistence.setProviderSettings).not.toHaveBeenCalled();
    expect(persistence.setMigrations).not.toHaveBeenCalled();
    expect(persistence.setDefaultModel).not.toHaveBeenCalled();
    expect(persistence.logRefresh).not.toHaveBeenCalled();
  });
});

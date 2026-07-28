import {
  CLAUDE_CODE_VARIANTS_WITH_1M,
  DEFAULT_MODELS,
  normalizeClaudeCodeVariant,
} from '@nimbalyst/runtime/ai/modelConstants';
import { CLAUDE_CODE_VARIANTS } from '@nimbalyst/runtime/ai/server/types';

export const CLAUDE_CODE_BUILTIN_MODEL_IDS: readonly string[] = CLAUDE_CODE_VARIANTS.flatMap((variant) => [
  `claude-code:${variant}`,
  ...((CLAUDE_CODE_VARIANTS_WITH_1M as readonly string[]).includes(variant)
    ? [`claude-code:${variant}-1m`]
    : []),
]);

export const CLAUDE_CODE_KNOWN_VARIANTS: readonly string[] = [...CLAUDE_CODE_VARIANTS];

function fingerprint(modelIds: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of modelIds.join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

export const CLAUDE_CODE_CATALOG_FINGERPRINT = fingerprint(CLAUDE_CODE_BUILTIN_MODEL_IDS);

export interface ClaudeCodeModelCatalogRefreshLog {
  previousCount: number;
  nextCount: number;
  previousFingerprint: string;
  nextFingerprint: string;
}

export interface ClaudeCodeModelCatalogPersistence {
  getProviderSettings(): Record<string, unknown>;
  setProviderSettings(providerSettings: Record<string, unknown>): void;
  getMigrations(): Record<string, unknown>;
  setMigrations(migrations: Record<string, unknown>): void;
  getDefaultModel(): string | undefined;
  setDefaultModel(model: string): void;
  logRefresh(details: ClaudeCodeModelCatalogRefreshLog): void;
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : [];
}

function isCurrentClaudeCodeDefault(model: string | undefined): boolean {
  if (!model || !model.startsWith('claude-code:') || CLAUDE_CODE_BUILTIN_MODEL_IDS.includes(model)) {
    return true;
  }

  // Keep accepted aliases (for example the imported `opus-4-8` spelling) even
  // though the picker presents them through their current canonical row.
  const variantInput = model.slice('claude-code:'.length);
  const isExtendedContext = variantInput.endsWith('-1m');
  const variant = normalizeClaudeCodeVariant(
    isExtendedContext ? variantInput.slice(0, -'-1m'.length) : variantInput,
  );
  return !!variant && (!isExtendedContext
    || (CLAUDE_CODE_VARIANTS_WITH_1M as readonly string[]).includes(variant));
}

/**
 * Refresh the persisted Claude Agent picker inventory when the built-in catalog
 * changes. The picker reads this persisted whitelist, so it must track the
 * runtime catalog instead of remaining frozen at the first installed version.
 */
export function refreshClaudeCodeModelCatalog(
  persistence: ClaudeCodeModelCatalogPersistence,
): void {
  const providerSettings = persistence.getProviderSettings();
  const claudeCodeSettings = providerSettings['claude-code'];
  const currentSettings = claudeCodeSettings && typeof claudeCodeSettings === 'object'
    ? claudeCodeSettings as Record<string, unknown>
    : {};
  const previousModels = asStringArray(currentSettings.models);
  const migrations = persistence.getMigrations();
  const knownVariants = asStringArray(migrations.knownClaudeCodeVariants);
  const storedFingerprint = typeof migrations.claudeCodeModelCatalogFingerprint === 'string'
    ? migrations.claudeCodeModelCatalogFingerprint
    : fingerprint(previousModels);

  const modelsNeedRefresh = !sameItems(previousModels, CLAUDE_CODE_BUILTIN_MODEL_IDS);
  const migrationNeedsRefresh = storedFingerprint !== CLAUDE_CODE_CATALOG_FINGERPRINT
    || !sameItems(knownVariants, CLAUDE_CODE_KNOWN_VARIANTS);
  const defaultModel = persistence.getDefaultModel();
  const defaultNeedsFallback = !isCurrentClaudeCodeDefault(defaultModel);

  if (!modelsNeedRefresh && !migrationNeedsRefresh && !defaultNeedsFallback) {
    return;
  }

  if (modelsNeedRefresh) {
    persistence.setProviderSettings({
      ...providerSettings,
      'claude-code': {
        ...currentSettings,
        models: [...CLAUDE_CODE_BUILTIN_MODEL_IDS],
      },
    });
  }

  if (migrationNeedsRefresh) {
    persistence.setMigrations({
      ...migrations,
      knownClaudeCodeVariants: [...CLAUDE_CODE_KNOWN_VARIANTS],
      claudeCodeModelCatalogFingerprint: CLAUDE_CODE_CATALOG_FINGERPRINT,
    });
  }

  if (defaultNeedsFallback) {
    persistence.setDefaultModel(DEFAULT_MODELS['claude-code']);
  }

  if (modelsNeedRefresh || migrationNeedsRefresh) {
    persistence.logRefresh({
      previousCount: previousModels.length,
      nextCount: CLAUDE_CODE_BUILTIN_MODEL_IDS.length,
      previousFingerprint: storedFingerprint,
      nextFingerprint: CLAUDE_CODE_CATALOG_FINGERPRINT,
    });
  }
}

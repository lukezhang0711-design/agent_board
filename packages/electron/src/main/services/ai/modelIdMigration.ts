import type { AIModel } from '@nimbalyst/runtime/ai/server/types';

export interface EquivalentModelIdMigration {
  from: string;
  to: string;
  /** Present only when the live catalog declared a resolved engine identity. */
  resolvedModel?: string;
}

/**
 * Product-issued Claude identifiers. This deliberately records our release
 * history rather than parsing an engine value or inventing a new alias. The
 * selectableVariant is the exact current engine row emitted by the SDK.
 */
export interface LegacyClaudeModelIdMigration {
  selectableVariant: string;
  /** Historical resolved values only support the fallback below. */
  resolvedModels: readonly string[];
}

export const LEGACY_CLAUDE_MODEL_ID_MIGRATIONS: Readonly<
  Record<string, LegacyClaudeModelIdMigration>
> = {
  // Release 2026-03-23 (8d4e0eb0c) defaulted new Claude sessions to Opus 1M.
  'opus-1m': {
    selectableVariant: 'opus[1m]',
    resolvedModels: ['claude-opus-5[1m]'],
  },
  // Release 2026-06-12 (113b5f9d8, NIM-827) emitted the Fable 1M picker ID.
  'fable-1m': {
    selectableVariant: 'claude-fable-5[1m]',
    resolvedModels: ['claude-fable-5[1m]', 'claude-fable-5'],
  },
  // Release 2026-08-21 (3a788bbfe) persisted this pre-EO catalog spelling.
  'claude-fable-5-1m': {
    selectableVariant: 'claude-fable-5[1m]',
    resolvedModels: ['claude-fable-5[1m]', 'claude-fable-5'],
  },
  // Release 2026-04-16 (9f90ee52e) emitted the pinned Opus 4.7 ID.
  'opus-4-7': {
    selectableVariant: 'claude-opus-4-7',
    resolvedModels: ['claude-opus-4-7'],
  },
  // Release 2026-05-30 (6196e6e8f) emitted the pinned Opus 4.7 1M ID.
  'opus-4-7-1m': {
    selectableVariant: 'claude-opus-4-7[1m]',
    resolvedModels: ['claude-opus-4-7[1m]'],
  },
  // Release 2026-02-05 (9b810f619) emitted the pinned Opus 4.6 ID.
  'opus-4-6': {
    selectableVariant: 'claude-opus-4-6',
    resolvedModels: ['claude-opus-4-6'],
  },
  // Release 2026-04-20 (81de172a0) emitted the pinned Opus 4.6 1M ID.
  'opus-4-6-1m': {
    selectableVariant: 'claude-opus-4-6[1m]',
    resolvedModels: ['claude-opus-4-6[1m]'],
  },
  // Release 2026-02-18 (59660c444) emitted the pinned Sonnet 4.6 ID.
  'sonnet-4-6': {
    selectableVariant: 'claude-sonnet-4-6',
    resolvedModels: ['claude-sonnet-4-6'],
  },
  // Release 2026-07-12 (52b10cb37) emitted the pinned Sonnet 4.6 1M ID.
  'sonnet-4-6-1m': {
    selectableVariant: 'claude-sonnet-4-6[1m]',
    resolvedModels: ['claude-sonnet-4-6[1m]'],
  },
};

function legacyClaudeModelIdMigration(
  modelId: string,
): { provider: 'claude-code' | 'claude-code-cli'; record: LegacyClaudeModelIdMigration } | null {
  const match = /^(claude-code(?:-cli)?):(.+)$/.exec(modelId);
  if (!match) return null;
  const record = LEGACY_CLAUDE_MODEL_ID_MIGRATIONS[match[2]];
  if (!record) return null;
  return {
    provider: match[1] as 'claude-code' | 'claude-code-cli',
    record,
  };
}

export function isHistoricalClaudeModelId(modelId: string | undefined): boolean {
  return !!modelId && legacyClaudeModelIdMigration(modelId) !== null;
}

/**
 * Resolves a product-issued historical identifier to a live dynamic-catalog
 * row. The recorded selectable ID wins even when several rows share one
 * resolvedModel (for example `default` and `opus[1m]`). resolvedModel is only
 * a backward-compatible secondary route for an older row whose exact
 * selectable ID is no longer returned by the SDK.
 */
export function resolveEquivalentModelIdMigration(
  modelId: string | undefined,
  models: readonly Pick<AIModel, 'id' | 'resolvedModel'>[],
): EquivalentModelIdMigration | null {
  if (!modelId || models.some((model) => model.id === modelId)) return null;
  const historical = legacyClaudeModelIdMigration(modelId);
  if (!historical) return null;

  const selectableId = `${historical.provider}:${historical.record.selectableVariant}`;
  const directSelectableRow = models.find((model) => model.id === selectableId);
  if (directSelectableRow) {
    return {
      from: modelId,
      to: directSelectableRow.id,
      ...(directSelectableRow.resolvedModel
        ? { resolvedModel: directSelectableRow.resolvedModel }
        : {}),
    };
  }

  const candidates = models.filter((model) =>
    model.resolvedModel !== undefined && historical.record.resolvedModels.includes(model.resolvedModel),
  );
  if (candidates.length !== 1) return null;

  return { from: modelId, to: candidates[0].id, resolvedModel: candidates[0].resolvedModel! };
}

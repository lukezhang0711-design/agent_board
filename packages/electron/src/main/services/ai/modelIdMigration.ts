import type { AIModel } from '@nimbalyst/runtime/ai/server/types';

export interface EquivalentModelIdMigration {
  from: string;
  to: string;
  resolvedModel: string;
}

/**
 * Historical selectable IDs whose concrete engine identity was pinned when
 * they were issued. This is deliberately not a model catalog or a fallback:
 * a row remains migratable only when the live catalog proves the same
 * `resolvedModel` through one unambiguous selectable entry.
 */
const LEGACY_RESOLVED_MODEL_IDENTITIES: Readonly<Record<string, readonly string[]>> = {
  // The current SDK publishes the selectable `claude-fable-5[1m]` row with
  // the canonical engine value `claude-fable-5`; older catalog snapshots
  // exposed its context-qualified resolved value. Both are historical engine
  // identities for this one legacy selectable ID, and either still requires a
  // unique, live resolvedModel row below.
  'fable-1m': ['claude-fable-5[1m]', 'claude-fable-5'],
  'opus-4-7': ['claude-opus-4-7'],
  'opus-4-7-1m': ['claude-opus-4-7[1m]'],
  'opus-4-6': ['claude-opus-4-6'],
  'opus-4-6-1m': ['claude-opus-4-6[1m]'],
  'sonnet-4-6': ['claude-sonnet-4-6'],
  'sonnet-4-6-1m': ['claude-sonnet-4-6[1m]'],
};

function legacyResolvedModelIdentities(modelId: string): readonly string[] | undefined {
  const match = /^claude-code:(.+)$/.exec(modelId);
  return match ? LEGACY_RESOLVED_MODEL_IDENTITIES[match[1]] : undefined;
}

/**
 * Resolves a historical model identifier to a live dynamic-catalog row only
 * when its engine identity can be proven exactly.
 */
export function resolveEquivalentModelIdMigration(
  modelId: string | undefined,
  models: readonly Pick<AIModel, 'id' | 'resolvedModel'>[],
): EquivalentModelIdMigration | null {
  if (!modelId || models.some((model) => model.id === modelId)) return null;
  const resolvedModels = legacyResolvedModelIdentities(modelId);
  if (!resolvedModels) return null;

  const candidates = models.filter((model) =>
    model.resolvedModel !== undefined && resolvedModels.includes(model.resolvedModel),
  );
  if (candidates.length !== 1) return null;

  return { from: modelId, to: candidates[0].id, resolvedModel: candidates[0].resolvedModel! };
}

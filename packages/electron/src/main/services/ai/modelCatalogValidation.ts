import type { AIProviderType } from '@nimbalyst/runtime/ai/server/types';

type DynamicModelCatalogValidator = (
  provider: AIProviderType,
  modelId: string,
) => Promise<void>;

type DynamicModelCatalogSelectionResolver = (
  provider: AIProviderType,
  modelId: string | undefined,
) => Promise<string | undefined>;

type DynamicModelEffortNormalizer = (input: {
  provider: string;
  modelId: string;
  sessionId: string;
  sessionEffortLevel: unknown;
}) => Promise<void>;

/**
 * Read-only projection for persistence-only consumers such as mobile sync.
 * Keep this intentionally structural: the catalog services remain the single
 * owner of their detailed status types and no second inventory is created.
 */
export interface DynamicModelCatalogStatus {
  modelSource?: 'runtime' | 'cache' | 'placeholder' | 'none';
  verified?: boolean;
  /** A manual picker/Head refresh is running; retained runtime rows stay visible. */
  inFlight?: boolean;
  lastSuccessAt?: number | null;
  lastError?: { message?: string } | null;
}

type DynamicModelCatalogStatusReader = () => Record<string, DynamicModelCatalogStatus>;

let validator: DynamicModelCatalogValidator | null = null;
let selectionResolver: DynamicModelCatalogSelectionResolver | null = null;
let statusReader: DynamicModelCatalogStatusReader | null = null;
let effortNormalizer: DynamicModelEffortNormalizer | null = null;

export function usesDynamicModelCatalog(provider: string): provider is AIProviderType {
  return provider === 'claude-code'
    || provider === 'claude-code-cli'
    || provider === 'openai-codex'
    // ACP is hidden from the new-session picker, but direct/legacy creation
    // paths must still fail closed rather than reach its static fallback.
    || provider === 'openai-codex-acp';
}

/**
 * The AI service owns the live engine catalogs; session IPC owns several
 * persistence-only creation paths. This narrow bridge keeps their validation
 * identical without giving IPC code a second, static model inventory.
 */
export function setDynamicModelCatalogValidator(next: DynamicModelCatalogValidator | null): void {
  validator = next;
}

/**
 * Resolves an omitted dynamic model through the live catalog. This deliberately
 * has no package-model fallback: it may return only a model that the engine
 * currently marks as its own recommended row.
 */
export function setDynamicModelCatalogSelectionResolver(
  next: DynamicModelCatalogSelectionResolver | null,
): void {
  selectionResolver = next;
}

/**
 * Exposes catalog health without exposing executable model snapshots. Consumers
 * must use it to label an unavailable catalog rather than treating a cached or
 * first-install placeholder row as a verified selectable model.
 */
export function setDynamicModelCatalogStatusReader(
  next: DynamicModelCatalogStatusReader | null,
): void {
  statusReader = next;
}

/**
 * A model switch can expose an old per-session/default effort value as
 * unsupported. The live catalog owner installs this narrow correction hook so
 * persistence stays capability-safe without giving session IPC a second model
 * directory.
 */
export function setDynamicModelEffortNormalizer(
  next: DynamicModelEffortNormalizer | null,
): void {
  effortNormalizer = next;
}

export async function normalizeDynamicModelEffortAfterModelSwitch(input: {
  provider: string;
  modelId: string;
  sessionId: string;
  sessionEffortLevel: unknown;
}): Promise<void> {
  await effortNormalizer?.(input);
}

export function getDynamicModelCatalogStatuses(): Record<string, DynamicModelCatalogStatus> {
  return statusReader?.() ?? {};
}

export async function resolveDynamicModelCatalogSelection(
  provider: string,
  modelId: string | undefined,
): Promise<string | undefined> {
  if (!usesDynamicModelCatalog(provider)) return undefined;
  // A user-selected identifier is an engine input, not an application
  // allow-list entry. The live catalog improves the picker, but a missing or
  // stale declaration must never turn that explicit choice into a creation
  // error. The engine remains the authority for rejection and wording.
  if (modelId) return modelId;
  if (!selectionResolver) {
    return undefined;
  }
  try {
    // An omitted model may use an engine-declared default if one is available.
    // No package default is invented when the declaration cannot be read.
    return await selectionResolver(provider, undefined);
  } catch {
    return undefined;
  }
}

export async function assertDynamicModelCatalogSelection(
  provider: string,
  modelId: string | undefined,
): Promise<void> {
  if (!usesDynamicModelCatalog(provider)) return;
  if (!validator || !modelId) {
    return;
  }
  try {
    await validator(provider, modelId);
  } catch {
    // Catalog declarations are advisory at the execution boundary. Do not
    // reject an explicit model merely because discovery is unavailable or
    // has not listed it yet; surface the native engine response instead.
  }
}

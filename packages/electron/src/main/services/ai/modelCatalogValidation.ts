import type { AIProviderType } from '@nimbalyst/runtime/ai/server/types';

type DynamicModelCatalogValidator = (
  provider: AIProviderType,
  modelId: string,
) => Promise<void>;

type DynamicModelCatalogSelectionResolver = (
  provider: AIProviderType,
  modelId: string | undefined,
) => Promise<string | undefined>;

/**
 * Read-only projection for persistence-only consumers such as mobile sync.
 * Keep this intentionally structural: the catalog services remain the single
 * owner of their detailed status types and no second inventory is created.
 */
export interface DynamicModelCatalogStatus {
  modelSource?: 'runtime' | 'cache' | 'placeholder' | 'none';
  verified?: boolean;
  lastSuccessAt?: number | null;
  lastError?: { message?: string } | null;
}

type DynamicModelCatalogStatusReader = () => Record<string, DynamicModelCatalogStatus>;

let validator: DynamicModelCatalogValidator | null = null;
let selectionResolver: DynamicModelCatalogSelectionResolver | null = null;
let statusReader: DynamicModelCatalogStatusReader | null = null;

function needsDynamicCatalog(provider: string): provider is AIProviderType {
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

export function getDynamicModelCatalogStatuses(): Record<string, DynamicModelCatalogStatus> {
  return statusReader?.() ?? {};
}

export async function resolveDynamicModelCatalogSelection(
  provider: string,
  modelId: string | undefined,
): Promise<string | undefined> {
  if (!needsDynamicCatalog(provider)) return undefined;
  if (!selectionResolver) {
    throw new Error(`${provider} 模型目录尚未就绪。请等待目录获取完成后重新选择模型。`);
  }
  const resolved = await selectionResolver(provider, modelId);
  if (!resolved) {
    throw new Error(`${provider} 模型目录未返回已验证的默认型号。请在模型选择器中明确选择。`);
  }
  return resolved;
}

export async function assertDynamicModelCatalogSelection(
  provider: string,
  modelId: string | undefined,
): Promise<void> {
  if (!needsDynamicCatalog(provider)) return;
  if (!validator) {
    throw new Error(`${provider} 模型目录尚未就绪。请等待目录获取完成后重新选择模型。`);
  }
  await validator(provider, modelId ?? '');
}

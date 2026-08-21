/**
 * Model display utilities for renderer components.
 *
 * IMPORTANT — keep the iOS Swift mirror in sync:
 *   packages/ios/NimbalystNative/Sources/Utils/ModelLabel.swift
 *
 * When you add/rename/remove a Claude API model, an OpenAI model, or change
 * the provider switch in `parseModelInfo` /
 * `getModelShortName`, apply the equivalent change to ModelLabel.swift and
 * update its tests (`Tests/ModelLabelTests.swift`). The iOS session list
 * badge depends on both sides producing the same short label for a given
 * `(provider, model)` pair. Source-of-truth for the tables themselves is
 * still `packages/runtime/src/ai/modelConstants.ts` for chat models — the
 * Swift file mirrors the subset of that file it needs. Claude Agent models
 * come from the live SDK catalog and intentionally have no local table.
 */

import {
  CLAUDE_MODELS,
  OPENAI_MODELS,
} from '@nimbalyst/runtime/ai/modelConstants';
import { ModelIdentifier, isClaudeCodeFamily } from '@nimbalyst/runtime/ai/server/types';

export { type EffortLevel, EFFORT_LEVELS, DEFAULT_EFFORT_LEVEL, parseEffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';

interface ModelInfo {
  providerId: string;
  providerName: string;
  modelName: string;
  shortModelName: string;
}

/**
 * Extract Claude Code variant from a model ID using ModelIdentifier.
 * Returns the base variant (without suffix) or null if not a valid Claude Code model.
 */
export function extractClaudeCodeVariant(modelId?: string): string | null {
  if (!modelId) return null;

  // Try parsing with ModelIdentifier
  const parsed = ModelIdentifier.tryParse(modelId);
  if (parsed && isClaudeCodeFamily(parsed.provider)) {
    // Values are validated by the live SDK catalog before creation. This helper
    // is display-only and must not reintroduce a static allowlist.
    return parsed.baseVariant;
  }

  return null;
}

function formatVariantLabel(variant: string): string {
  return variant
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Family prefix shown before the variant in the long label. The SDK provider
 * stays "Claude Agent"; the genuine subscription CLI gets its own name so the
 * two providers are distinguishable in the picker.
 */
function getClaudeCodeFamilyPrefix(modelId?: string): string {
  const parsed = modelId ? ModelIdentifier.tryParse(modelId) : null;
  return parsed?.provider === 'claude-code-cli' ? 'Claude Code CLI' : 'Claude Agent';
}

export function getClaudeCodeModelLabel(modelId?: string): string {
  const variant = extractClaudeCodeVariant(modelId) ?? 'Unknown';
  const parsed = modelId ? ModelIdentifier.tryParse(modelId) : null;
  const suffix = parsed?.isExtendedContext ? ' (1M)' : '';
  return `${getClaudeCodeFamilyPrefix(modelId)} · ${formatVariantLabel(variant)}${suffix}`;
}

export function getClaudeCodeModelShortLabel(modelId?: string): string {
  const variant = extractClaudeCodeVariant(modelId) ?? 'Unknown';
  const parsed = modelId ? ModelIdentifier.tryParse(modelId) : null;
  const suffix = parsed?.isExtendedContext ? ' (1M)' : '';
  return `${formatVariantLabel(variant)}${suffix}`;
}

/**
 * Parse and format model information for display
 */
export function parseModelInfo(modelId?: string): ModelInfo | null {
  if (!modelId) return null;

  // Try parsing with ModelIdentifier
  const parsed = ModelIdentifier.tryParse(modelId);
  if (parsed) {
    // Special case for Claude Code family (SDK + subscription CLI)
    if (isClaudeCodeFamily(parsed.provider)) {
      const modelName = getClaudeCodeModelShortLabel(modelId);
      return {
        providerId: parsed.provider,
        providerName: getProviderDisplayName(parsed.provider),
        modelName,
        shortModelName: modelName
      };
    }

    // Get provider display name
    const providerName = getProviderDisplayName(parsed.provider);

    // Get model display names
    const modelName = getModelDisplayName(parsed.provider, parsed.model);
    const shortModelName = getModelShortName(parsed.provider, parsed.model);

    return {
      providerId: parsed.provider,
      providerName,
      modelName,
      shortModelName
    };
  }

  // Fallback for legacy/non-standard formats
  // Try to parse as provider:model format manually
  if (modelId.includes(':')) {
    const [provider, ...modelParts] = modelId.split(':');
    const model = modelParts.join(':');
    const providerName = getProviderDisplayName(provider);
    const modelName = getModelDisplayName(provider, model);
    const shortModelName = getModelShortName(provider, model);

    return {
      providerId: provider,
      providerName,
      modelName,
      shortModelName
    };
  }

  // If no colon, treat the whole string as a provider name (fallback display)
  return {
    providerId: modelId,
    providerName: getProviderDisplayName(modelId),
    modelName: modelId,
    shortModelName: modelId
  };
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: string): string {
  switch (provider) {
    case 'claude': return 'Claude';
    case 'claude-code': return 'Claude Agent';
    case 'claude-code-cli': return 'Claude Code CLI';
    case 'openai': return 'OpenAI';
    case 'lmstudio': return 'LMStudio';
    case 'copilot-cli': return 'GitHub Copilot';
    default: return provider;
  }
}

/**
 * Get provider short label for dropdowns
 */
export function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'claude': return 'Chat';
    case 'claude-code': return 'CODE';
    case 'claude-code-cli': return 'CLI';
    case 'openai': return 'GPT';
    case 'lmstudio': return 'LOCAL';
    default: return provider.toUpperCase();
  }
}

/**
 * Get model display name based on provider knowledge
 */
export function getModelDisplayName(provider: string, modelId: string): string {
  if (provider === 'claude') {
    const model = CLAUDE_MODELS.find(m => m.id === modelId);
    if (model) return model.displayName;
    // Fallback for unknown models
    return modelId.replace('claude-', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  
  if (provider === 'openai') {
    const model = OPENAI_MODELS.find(m => m.id === modelId);
    if (model) return model.displayName;
    // Fallback
    return modelId.toUpperCase().replace(/-/g, ' ');
  }

  if (provider === 'lmstudio') {
    // Format local model names
    return modelId
      .replace(/-GGUF$/i, '')
      .replace(/-Q[0-9]_K_[A-Z]/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  return modelId;
}

/**
 * Get short model name for compact displays
 */
export function getModelShortName(provider: string, modelId: string): string {
  if (provider === 'claude') {
    const model = CLAUDE_MODELS.find(m => m.id === modelId);
    if (model) return model.shortName;
    return modelId.replace('claude-', '');
  }
  
  if (provider === 'openai') {
    const model = OPENAI_MODELS.find(m => m.id === modelId);
    if (model) return model.shortName;
    return modelId;
  }

  if (provider === 'lmstudio') {
    // Truncate long local model names
    const clean = modelId.replace(/-GGUF$/i, '').replace(/-Q[0-9]_K_[A-Z]/i, '');
    if (clean.length > 15) return clean.substring(0, 12) + '...';
    return clean;
  }

  // Default truncation for unknown providers
  if (modelId.length > 15) return modelId.substring(0, 12) + '...';
  return modelId;
}

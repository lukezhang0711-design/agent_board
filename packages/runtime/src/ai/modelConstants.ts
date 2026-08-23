/**
 * Shared AI model constants available across hosts.
 */

export interface ModelDefinition {
  id: string;
  displayName: string;
  shortName: string;
  maxTokens: number;
  contextWindow: number;
}

export const CLAUDE_MODELS: ModelDefinition[] = [
  {
    id: 'claude-fable-5',
    displayName: 'Claude Fable 5 (1M)',
    shortName: 'Fable 5',
    maxTokens: 8192,
    // Fable 5 is the tier above Opus — 1M context natively, dateless alias.
    contextWindow: 1000000,
  },
  {
    id: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8 (1M)',
    shortName: 'Opus 4.8',
    maxTokens: 8192,
    // Opus 4.8 ships with a 1M context window natively (no beta header).
    // The API alias is dateless and pinned to this snapshot — see
    // platform.claude.com/docs/en/about-claude/models/overview.
    contextWindow: 1000000,
  },
  {
    id: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7 (1M)',
    shortName: 'Opus 4.7',
    maxTokens: 8192,
    // Opus 4.7 uses the 1M context window natively — no beta header required
    // (unlike Opus 4.6 which needed `context-1m-2025-08-07`).
    contextWindow: 1000000,
  },
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    shortName: 'Opus 4.6',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-5-20251101',
    displayName: 'Claude Opus 4.5',
    shortName: 'Opus 4.5',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-1-20250805',
    displayName: 'Claude Opus 4.1',
    shortName: 'Opus 4.1',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-opus-4-20250514',
    displayName: 'Claude Opus 4',
    shortName: 'Opus 4',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    displayName: 'Claude Sonnet 4.5',
    shortName: 'Sonnet 4.5',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    shortName: 'Sonnet 4',
    maxTokens: 8192,
    contextWindow: 200000,
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    displayName: 'Claude Sonnet 3.7',
    shortName: 'Sonnet 3.7',
    maxTokens: 8192,
    contextWindow: 200000,
  },
];

export const OPENAI_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-5.5',
    displayName: 'GPT-5.5',
    shortName: '5.5',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5.4',
    displayName: 'GPT-5.4',
    shortName: '5.4',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5.3-chat-latest',
    displayName: 'GPT-5.3 Chat',
    shortName: '5.3 Chat',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5.2',
    displayName: 'GPT-5.2',
    shortName: '5.2',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5.1',
    displayName: 'GPT-5.1',
    shortName: '5.1',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5',
    displayName: 'GPT-5',
    shortName: '5.0',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    shortName: '5 Mini',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-5-nano',
    displayName: 'GPT-5 Nano',
    shortName: '5 Nano',
    maxTokens: 128000,
    contextWindow: 400000,
  },
  {
    id: 'gpt-4.1',
    displayName: 'GPT-4.1',
    shortName: '4.1',
    maxTokens: 32768,
    contextWindow: 1047576,
  },
  {
    id: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    shortName: '4.1 Mini',
    maxTokens: 32768,
    contextWindow: 1047576,
  },
  {
    id: 'gpt-4.1-nano',
    displayName: 'GPT-4.1 Nano',
    shortName: '4.1 Nano',
    maxTokens: 32768,
    contextWindow: 1047576,
  },
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    shortName: '4o',
    maxTokens: 16384,
    contextWindow: 128000,
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    shortName: '4o Mini',
    maxTokens: 16384,
    contextWindow: 128000,
  },
];

/**
 * Safe silent fallback for the Claude Agent providers (#631 / NIM-848).
 *
 * Billing safety: 1M context is a PAID add-on, derived purely from a `-1m`
 * model string (which becomes `model[1m]` and triggers the SDK's 1M beta).
 * Whenever a session's model is unexpectedly empty/lost, resolution must fall
 * back to a STANDARD 200k model — never a `-1m` variant — so we never silently
 * bill the user for 1M context they didn't choose. `claude-code:opus` (plain
 * Opus) windows at 200k client-side; no `[1m]` suffix is emitted.
 *
 * This is intentionally distinct from the user-facing default
 * (`DEFAULT_MODELS['claude-code']`, currently `opus-1m`): new installs may
 * still default to the 1M tier as a visible, deliberate choice, but the
 * INVISIBLE fallback must never be a paid model.
 */
export const CLAUDE_CODE_SAFE_FALLBACK_MODEL = 'claude-code:opus' as const;

export const DEFAULT_MODELS = {
  claude: 'claude:claude-opus-4-8',
  openai: 'openai:gpt-5.5',
  'claude-code': 'claude-code:opus-1m',
  'claude-code-cli': 'claude-code-cli:opus-1m',
  'openai-codex': 'openai-codex:gpt-5.5',
  'openai-codex-acp': 'openai-codex-acp:gpt-5.5',
  lmstudio: 'lmstudio:local-model',
  opencode: 'opencode:anthropic/claude-sonnet-4-5',
  'copilot-cli': 'copilot-cli:default',
};

/**
 * Curated preset list of models for the OpenCode agent.
 *
 * OpenCode itself uses `<providerID>/<modelID>` (e.g. `anthropic/claude-sonnet-4-5`).
 * In Nimbalyst's model registry we wrap that with the `opencode:` prefix so the
 * provider-router knows which agent to dispatch to. The OpenCode protocol layer
 * strips the prefix before forwarding to the SDK.
 *
 * Keep this list small -- OpenCode supports hundreds of models. These are the
 * defaults users see in the picker before they configure custom providers.
 */
export interface OpenCodePresetModel {
  /** Full id with the `opencode:` registry prefix. */
  id: string;
  /** Human-readable label shown in pickers. */
  name: string;
  /** OpenCode provider id (the segment before the `/`). */
  providerID: string;
  /** OpenCode model id (the segment after the `/`). */
  modelID: string;
}

export const OPENCODE_PRESET_MODELS: OpenCodePresetModel[] = [
  {
    id: 'opencode:anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-5',
  },
  {
    id: 'opencode:anthropic/claude-opus-4-1',
    name: 'Claude Opus 4.1',
    providerID: 'anthropic',
    modelID: 'claude-opus-4-1',
  },
  {
    id: 'opencode:openai/gpt-5',
    name: 'GPT-5',
    providerID: 'openai',
    modelID: 'gpt-5',
  },
  {
    id: 'opencode:openai/gpt-5-mini',
    name: 'GPT-5 Mini',
    providerID: 'openai',
    modelID: 'gpt-5-mini',
  },
  {
    id: 'opencode:google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    providerID: 'google',
    modelID: 'gemini-2.5-pro',
  },
];

/** OpenCode provider id reserved for an LM Studio bridge written into opencode.json. */
export const OPENCODE_LMSTUDIO_PROVIDER_ID = 'lmstudio';

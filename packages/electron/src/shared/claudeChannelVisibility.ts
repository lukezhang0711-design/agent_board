/**
 * Visibility rules for the two Claude Code transports.
 *
 * This is deliberately presentation/session-entry policy. It does not change
 * provider registration, existing session records, or the CLI transport.
 */

export const CLAUDE_CLI_PROVIDER_ID = 'claude-code-cli';

export function isClaudeCliChannelVisible(showClaudeCliChannel: boolean | undefined): boolean {
  return showClaudeCliChannel === true;
}

export function isNewSessionProviderVisible(
  provider: string,
  showClaudeCliChannel: boolean | undefined,
): boolean {
  return provider !== CLAUDE_CLI_PROVIDER_ID || isClaudeCliChannelVisible(showClaudeCliChannel);
}

export function filterVisibleNewSessionModels<T extends { provider: string }>(
  models: readonly T[],
  showClaudeCliChannel: boolean | undefined,
): T[] {
  return models.filter((model) => isNewSessionProviderVisible(model.provider, showClaudeCliChannel));
}

export function filterVisibleChannelHealthResults<T extends { id: string }>(
  results: readonly T[],
  options: {
    showClaudeCliChannel: boolean | undefined;
    hasAnthropicApiKey: boolean;
  },
): T[] {
  return results.filter((result) => {
    if (result.id === CLAUDE_CLI_PROVIDER_ID && !isClaudeCliChannelVisible(options.showClaudeCliChannel)) {
      return false;
    }
    if (result.id === 'claude' && !options.hasAnthropicApiKey) {
      return false;
    }
    return true;
  });
}

/**
 * Resolve a persisted default model for a new session without rewriting the
 * persisted setting. Historical CLI sessions keep their original provider.
 */
export function resolveNewSessionModel(
  model: string,
  showClaudeCliChannel: boolean | undefined,
): string;
export function resolveNewSessionModel(
  model: null | undefined,
  showClaudeCliChannel: boolean | undefined,
): null | undefined;
export function resolveNewSessionModel(
  model: string | null | undefined,
  showClaudeCliChannel: boolean | undefined,
): string | null | undefined {
  if (!model || isClaudeCliChannelVisible(showClaudeCliChannel)) return model;
  return model.replace(/^claude-code-cli(?=:|$)/, 'claude-code');
}

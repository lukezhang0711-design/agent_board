import { ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';
import { resolveNewSessionModel } from '../../shared/claudeChannelVisibility';

export interface MetaAgentSessionResult {
  id: string;
  provider: string;
}

export function resolveMetaAgentModel(
  defaultModel: string | null,
  showClaudeCliChannel = false,
): string | null {
  if (defaultModel === null) return null;
  return resolveNewSessionModel(defaultModel, showClaudeCliChannel) ?? null;
}

/**
 * Create a meta-agent session via IPC.
 * Returns the session ID and resolved provider on success, null on failure.
 */
export async function createMetaAgentSession(
  workspacePath: string,
  defaultModel: string | null,
  showClaudeCliChannel = false,
): Promise<MetaAgentSessionResult | null> {
  const sessionId = crypto.randomUUID();
  const resolvedModel = resolveMetaAgentModel(defaultModel, showClaudeCliChannel);
  const parsedModel = resolvedModel ? ModelIdentifier.tryParse(resolvedModel) : null;
  const provider = parsedModel?.provider || 'claude-code';

  try {
    const result = await window.electronAPI.invoke('sessions:create', {
      session: {
        id: sessionId,
        provider,
        model: resolvedModel,
        title: 'Meta Agent',
        agentRole: 'meta-agent',
      },
      workspaceId: workspacePath,
    });

    if (result?.success && result.id) {
      return { id: result.id, provider };
    }
    return null;
  } catch (error) {
    console.error('[createMetaAgentSession] Failed:', error);
    return null;
  }
}

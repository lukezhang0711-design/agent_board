/**
 * Claude Code CLI provider — the genuine `claude` CLI running on the user's
 * Claude Pro/Max **subscription** (no API key / no metering). This is the
 * subscription/CLI half of the Claude Code provider family; `claude-code`
 * remains the Agent-SDK path billed to the user's API key.
 *
 * Two provider IDs, one vendor agent — mirrors the `openai-codex` /
 * `openai-codex-acp` precedent. The split keeps billing locked per session via
 * `shouldBlockStartedSessionProviderSwitch()` (a session can never flip between
 * the API-billed and subscription-billed paths once it has messages).
 *
 * Rollout is phased (see NIM-806 and
 * `nimbalyst-local/plans/terminal-session-type.md` → "Execution Modes, Safety,
 * and Fallback (B3 rollout)"):
 *
 * - Phase 0 (this file, initial): provider identity + model catalog wiring so
 *   the rest of the app can route, validate, and construct this provider. The
 *   actual CLI driving (`sendMessage`) lands in Phase 1.
 * - Phase 1+: spawn the interactive `claude` CLI in the ghostty-web terminal
 *   strip; observation backends (terminal-only → jsonl → proxy) reconstruct the
 *   native transcript.
 *
 * HARD SAFETY INVARIANT: this provider never reads API keys from the
 * environment and the observation axis (proxy → jsonl → terminal-only) never
 * crosses the billing axis. See CLAUDE.md.
 */

import { BaseAgentProvider } from './BaseAgentProvider';
import {
  AIModel,
  DocumentContext,
  ProviderConfig,
  StreamChunk,
} from '../types';
import {
  DEFAULT_MODELS,
} from '../../modelConstants';
import type { ProviderSessionData } from './ProviderSessionManager';

export class ClaudeCodeCliProvider extends BaseAgentProvider {
  static readonly DEFAULT_MODEL = DEFAULT_MODELS['claude-code-cli'];
  /** Host-owned output of Claude Agent SDK supportedModels(), mapped to CLI ids. */
  private static modelCatalogSnapshotResolver: (() => AIModel[]) | null = null;

  public static setModelCatalogSnapshotResolver(resolver: (() => AIModel[]) | null): void {
    ClaudeCodeCliProvider.modelCatalogSnapshotResolver = resolver;
  }

  getProviderName(): string {
    return 'claude-code-cli';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  // eslint-disable-next-line require-yield
  async *sendMessage(
    _message: string,
    _documentContext?: DocumentContext,
    _sessionId?: string,
    _messages?: unknown[],
    _workspacePath?: string,
    _attachments?: unknown[]
  ): AsyncIterableIterator<StreamChunk> {
    // Phase 1 wires this to the genuine `claude` CLI in the terminal strip.
    throw new Error(
      'claude-code-cli: the subscription CLI session is not yet implemented (Phase 1).'
    );
  }

  getProviderSessionData(sessionId: string): ProviderSessionData | null {
    const { providerSessionId } = this.sessions.getProviderSessionData(sessionId);
    return { providerSessionId };
  }

  /** Host-owned dynamic catalog under the separate subscription CLI namespace. */
  static async getModels(): Promise<AIModel[]> {
    return (ClaudeCodeCliProvider.modelCatalogSnapshotResolver?.() ?? []).map((model) => ({
      ...model,
      supportedEffortLevels: model.supportedEffortLevels && [...model.supportedEffortLevels],
    }));
  }

  static getDefaultModel(): string {
    return ClaudeCodeCliProvider.DEFAULT_MODEL;
  }
}

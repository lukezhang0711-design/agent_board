/**
 * Centralized Claude authentication listener.
 *
 * Main process broadcasts the CLI-authoritative state. Renderer components
 * read the atom and never each start their own status check.
 */

import { store } from '../index';
import {
  claudeAuthStateAtom,
  type ClaudeAuthState,
  type ClaudeAuthStateKind,
} from '../atoms/claudeAuthAtoms';

export const CLAUDE_AUTH_STATE_UPDATED_EVENT = 'claude-auth:state-updated';
const RUNTIME_AUTH_STATE_KEY = '__nimbalystClaudeAuthState';
const RUNTIME_AUTH_REFRESH_KEY = '__nimbalystRefreshClaudeAuthState';

interface ClaudeLoginCheckResponse {
  authState?: unknown;
  source?: unknown;
  checkedAt?: unknown;
  tokenSource?: unknown;
  apiKeySource?: unknown;
  email?: unknown;
  organization?: unknown;
  subscriptionType?: unknown;
  error?: unknown;
}

type RuntimeAuthWindow = Window & {
  [RUNTIME_AUTH_STATE_KEY]?: ClaudeAuthState;
  [RUNTIME_AUTH_REFRESH_KEY]?: () => Promise<ClaudeAuthState | null>;
};

function isAuthStateKind(value: unknown): value is ClaudeAuthStateKind {
  return value === 'logged-in'
    || value === 'logged-out'
    || value === 'check-failed'
    || value === 'unknown';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeAuthState(payload: unknown): ClaudeAuthState | null {
  if (!payload || typeof payload !== 'object') return null;

  const raw = payload as Record<string, unknown> & ClaudeLoginCheckResponse;
  const status = isAuthStateKind(raw.status) ? raw.status : raw.authState;
  if (!isAuthStateKind(status)) return null;

  return {
    status,
    source: 'claude-cli-auth-status',
    checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : null,
    authMethod: optionalString(raw.authMethod ?? raw.tokenSource),
    apiProvider: optionalString(raw.apiProvider ?? raw.apiKeySource),
    email: optionalString(raw.email),
    organization: optionalString(raw.organization),
    subscriptionType: optionalString(raw.subscriptionType),
    error: optionalString(raw.error),
  };
}

function publishToRendererState(state: ClaudeAuthState): void {
  store.set(claudeAuthStateAtom, state);

  // LoginRequiredWidget belongs to @nimbalyst/runtime and cannot import an
  // Electron renderer atom without creating a reverse package dependency.
  // Mirror this same atom state through a read-only browser event so it stays
  // on the centralized IPC path and never starts an independent check.
  const runtimeWindow = window as RuntimeAuthWindow;
  runtimeWindow[RUNTIME_AUTH_STATE_KEY] = state;
  if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(CLAUDE_AUTH_STATE_UPDATED_EVENT));
  }
}

function publishCheckFailure(error: unknown): ClaudeAuthState {
  const state: ClaudeAuthState = {
    status: 'check-failed',
    source: 'claude-cli-auth-status',
    checkedAt: Date.now(),
    error: error instanceof Error ? error.message : String(error),
  };
  publishToRendererState(state);
  return state;
}

async function requestClaudeAuthState(forceRefresh: boolean): Promise<ClaudeAuthState | null> {
  try {
    const response = forceRefresh
      ? await window.electronAPI.invoke('claude-code:check-login', { forceRefresh: true })
      : await window.electronAPI.invoke('claude-code:check-login');
    const state = normalizeAuthState(response);
    if (!state) {
      return publishCheckFailure(new Error('Claude authentication check returned an invalid response.'));
    }
    publishToRendererState(state);
    return state;
  } catch (error) {
    console.error('[ClaudeAuthListeners] Failed to get Claude authentication state:', error);
    return publishCheckFailure(error);
  }
}

/**
 * Start the sole renderer IPC subscription and seed it from the TTL-backed
 * main-process state. The subscription is installed first so its initial
 * broadcast cannot be missed.
 */
export function initClaudeAuthListeners(): () => void {
  const runtimeWindow = window as RuntimeAuthWindow;
  runtimeWindow[RUNTIME_AUTH_REFRESH_KEY] = refreshClaudeAuthState;
  const unsubscribe = window.electronAPI.on('claude-auth:update', (payload: unknown) => {
    const state = normalizeAuthState(payload);
    if (state) {
      publishToRendererState(state);
    }
  });

  void requestClaudeAuthState(false);

  return () => {
    unsubscribe?.();
    if (runtimeWindow[RUNTIME_AUTH_REFRESH_KEY] === refreshClaudeAuthState) {
      delete runtimeWindow[RUNTIME_AUTH_REFRESH_KEY];
    }
  };
}

/** Manual Refresh entry point for renderer consumers. */
export function refreshClaudeAuthState(): Promise<ClaudeAuthState | null> {
  return requestClaudeAuthState(true);
}

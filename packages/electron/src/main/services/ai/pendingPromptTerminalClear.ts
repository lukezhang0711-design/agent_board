const TERMINAL_SESSION_EVENT_TYPES = new Set([
  'session:completed',
  'session:error',
  'session:interrupted',
]);

export function isTerminalSessionEvent(type: string): boolean {
  return TERMINAL_SESSION_EVENT_TYPES.has(type);
}

/** Every pending bit is stale on process startup, regardless of session phase. */
export function findSessionsWithPendingPrompt(
  sessions: Array<{ id: string; metadata: Record<string, unknown> }>,
): string[] {
  return sessions
    .filter(({ metadata }) => metadata.hasPendingPrompt === true)
    .map(({ id }) => id);
}

/**
 * Keep a live user prompt visible. Only a session that has neither a live MCP
 * waiter nor an in-memory session can be safely reconciled mid-process.
 */
export function selectStalePendingPromptSessions(params: {
  sessionIds: readonly string[];
  hasLiveInteractivePrompt: (sessionId: string) => boolean;
  isSessionTracked: (sessionId: string) => boolean;
}): string[] {
  const { sessionIds, hasLiveInteractivePrompt, isSessionTracked } = params;
  return sessionIds.filter((id) => !hasLiveInteractivePrompt(id) && !isSessionTracked(id));
}

export interface PendingPromptTerminalClearDeps {
  readHasPendingPrompt: (sessionId: string) => Promise<boolean | null>;
  clearPendingPrompt: (sessionId: string) => Promise<void>;
  onError?: (err: unknown) => void;
}

export async function clearStalePendingPromptOnTerminal(
  event: { type: string; sessionId: string },
  deps: PendingPromptTerminalClearDeps,
): Promise<boolean> {
  if (!isTerminalSessionEvent(event.type) || !event.sessionId) return false;
  try {
    if (await deps.readHasPendingPrompt(event.sessionId) !== true) return false;
    await deps.clearPendingPrompt(event.sessionId);
    return true;
  } catch (err) {
    deps.onError?.(err);
    return false;
  }
}

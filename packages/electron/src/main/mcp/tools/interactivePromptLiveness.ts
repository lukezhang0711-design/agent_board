/** Per-session count of MCP prompts currently blocked on a user response. */
const liveInteractivePrompts = new Map<string, number>();

export function noteLiveInteractivePrompt(sessionKey: string): void {
  if (!sessionKey) return;
  liveInteractivePrompts.set(sessionKey, (liveInteractivePrompts.get(sessionKey) ?? 0) + 1);
}

export function clearLiveInteractivePrompt(sessionKey: string): void {
  if (!sessionKey) return;
  const next = (liveInteractivePrompts.get(sessionKey) ?? 0) - 1;
  if (next <= 0) liveInteractivePrompts.delete(sessionKey);
  else liveInteractivePrompts.set(sessionKey, next);
}

export function countLiveInteractivePrompts(sessionKey: string): number {
  return liveInteractivePrompts.get(sessionKey) ?? 0;
}

export function hasLiveInteractivePrompt(sessionKey: string): boolean {
  return countLiveInteractivePrompts(sessionKey) > 0;
}

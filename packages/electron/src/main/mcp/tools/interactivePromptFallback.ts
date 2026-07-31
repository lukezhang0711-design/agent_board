/** Per-session count of RequestUserInput waiters currently awaiting an answer. */
const pendingInteractiveWaiters = new Map<string, number>();

export function notePendingInteractiveWaiter(sessionKey: string): void {
  pendingInteractiveWaiters.set(sessionKey, (pendingInteractiveWaiters.get(sessionKey) ?? 0) + 1);
}

export function clearPendingInteractiveWaiter(sessionKey: string): void {
  const next = (pendingInteractiveWaiters.get(sessionKey) ?? 0) - 1;
  if (next <= 0) pendingInteractiveWaiters.delete(sessionKey);
  else pendingInteractiveWaiters.set(sessionKey, next);
}

export function countPendingInteractiveWaiters(sessionKey: string): number {
  return pendingInteractiveWaiters.get(sessionKey) ?? 0;
}

/** A session fallback is unambiguous only while it has one outstanding waiter. */
export function shouldSettleFromSessionFallback(params: {
  waiterPromptId: string;
  promptIdAliasSet: ReadonlySet<string>;
  responsePromptIds: readonly string[];
  pendingWaiterCountForSession: number;
}): boolean {
  if (params.waiterPromptId.startsWith('rui-')) return true;
  if (params.responsePromptIds.some((id) => params.promptIdAliasSet.has(id))) return true;
  return params.pendingWaiterCountForSession <= 1;
}

import { describe, expect, it } from 'vitest';
import {
  findSessionsWithPendingPrompt,
  selectStalePendingPromptSessions,
} from '../pendingPromptTerminalClear';

describe('pending prompt liveness repair', () => {
  it('clears every persisted pending bit at restart, regardless of phase', () => {
    expect(findSessionsWithPendingPrompt([
      { id: 'planning', metadata: { phase: 'planning', hasPendingPrompt: true } },
      { id: 'validating', metadata: { phase: 'validating', hasPendingPrompt: true } },
      { id: 'clean', metadata: { phase: 'complete', hasPendingPrompt: false } },
    ])).toEqual(['planning', 'validating']);
  });

  it('periodically clears only untracked sessions with no live MCP waiter', () => {
    expect(selectStalePendingPromptSessions({
      sessionIds: ['dead', 'blocked', 'tracked'],
      hasLiveInteractivePrompt: (id) => id === 'blocked',
      isSessionTracked: (id) => id === 'tracked',
    })).toEqual(['dead']);
  });
});

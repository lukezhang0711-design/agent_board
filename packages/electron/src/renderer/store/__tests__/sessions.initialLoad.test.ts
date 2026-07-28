import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import type { SessionData, TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import {
  loadSessionDataAtom,
  sessionLoadingAtom,
  sessionStoreAtom,
} from '../atoms/sessions';

const aiLoadSession = vi.fn();
const SESSION_ID = 'perf-initial-load-10k';
const WORKSPACE_PATH = '/ws/perf-initial-load';

function makeTenThousandMessageSession(): SessionData {
  const createdAt = Date.now();
  const messages: TranscriptViewMessage[] = Array.from({ length: 10_000 }, (_, index) => ({
    id: index + 1,
    sequence: index + 1,
    createdAt: new Date(createdAt),
    type: index % 2 === 0 ? 'user_message' : 'assistant_message',
    text: `seed-${index + 1}`,
    subagentId: null,
  }));

  return {
    id: SESSION_ID,
    provider: 'claude-code',
    model: 'claude-code:sonnet',
    messages,
    createdAt,
    updatedAt: createdAt,
  };
}

beforeEach(() => {
  aiLoadSession.mockReset();
  vi.stubGlobal('window', { electronAPI: { aiLoadSession } });
});

afterEach(() => {
  sessionStoreAtom.remove(SESSION_ID);
  sessionLoadingAtom.remove(SESSION_ID);
  vi.unstubAllGlobals();
});

describe('PERF-1 initial transcript load', () => {
  it('performs one initial read for a 10k-message session', async () => {
    const session = makeTenThousandMessageSession();
    aiLoadSession.mockResolvedValue(session);

    await store.set(loadSessionDataAtom, {
      sessionId: SESSION_ID,
      workspacePath: WORKSPACE_PATH,
    });

    expect(aiLoadSession).toHaveBeenCalledTimes(1);
    expect(aiLoadSession).toHaveBeenCalledWith(SESSION_ID, WORKSPACE_PATH);
    expect(store.get(sessionStoreAtom(SESSION_ID))?.messages).toHaveLength(10_000);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateMetadata = vi.fn();
vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { updateMetadata: (...args: unknown[]) => updateMetadata(...args) },
}));
vi.mock('../../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../../utils/logger', () => ({ logger: { main: { warn: vi.fn() } } }));

import {
  getSessionsWithPendingPrompt,
  resetPendingPromptTracking,
  setSessionPendingPrompt,
} from '../pendingPromptPersistence';

describe('pending prompt in-memory mirror', () => {
  beforeEach(() => {
    resetPendingPromptTracking();
    updateMetadata.mockReset().mockResolvedValue(undefined);
  });

  it('tracks only bits that were persisted and removes them when cleared', async () => {
    await setSessionPendingPrompt('s1', true);
    expect(getSessionsWithPendingPrompt()).toEqual(['s1']);
    await setSessionPendingPrompt('s1', false);
    expect(getSessionsWithPendingPrompt()).toEqual([]);
  });
});

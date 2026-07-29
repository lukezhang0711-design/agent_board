import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai/vanilla';
import {
  loadMoreSessionListAtom,
  refreshSessionListAtom,
  sessionListHasMoreAtom,
  sessionListLoadingMoreAtom,
  sessionListWorkspaceAtom,
  sessionRegistryAtom,
} from '../atoms/sessions';

function session(id: string, updatedAt: number, childCount = 0) {
  return {
    id,
    title: id,
    createdAt: updatedAt - 1,
    updatedAt,
    provider: 'claude-code',
    sessionType: 'session',
    childCount,
    isArchived: false,
    isPinned: false,
    parentSessionId: null,
    worktreeId: null,
  };
}

describe('session-list keyset renderer state', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges a continuation page without duplicate rows or regressing parent activity', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        sessions: [session('parent', 50, 2), session('first', 40)],
        nextCursor: 'cursor-1',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        success: true,
        // A parent may be hydrated beside a later child-source window.
        sessions: [session('parent', 30, 1), session('second', 20)],
        nextCursor: null,
        hasMore: false,
      });
    vi.stubGlobal('window', { electronAPI: { invoke } });
    store.set(sessionListWorkspaceAtom, '/workspace');

    await store.set(refreshSessionListAtom, { sortBy: 'updated' });
    expect(store.get(sessionListHasMoreAtom)).toBe(true);

    await store.set(loadMoreSessionListAtom);

    const registry = store.get(sessionRegistryAtom);
    expect([...registry.keys()]).toEqual(['parent', 'first', 'second']);
    expect(registry.get('parent')?.updatedAt).toBe(50);
    expect(registry.get('parent')?.childCount).toBe(2);
    expect(store.get(sessionListHasMoreAtom)).toBe(false);
    expect(store.get(sessionListLoadingMoreAtom)).toBe(false);
    expect(invoke).toHaveBeenNthCalledWith(1, 'sessions:list', '/workspace', {
      includeArchived: false,
      pagination: true,
      limit: 75,
      sortBy: 'updated',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'sessions:list', '/workspace', {
      includeArchived: false,
      pagination: true,
      cursor: 'cursor-1',
      limit: 75,
      sortBy: 'updated',
    });
  });
});

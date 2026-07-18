import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'jotai';
import type { SessionMeta } from '@nimbalyst/runtime';
import {
  refreshSessionListAtom,
  sessionListWorkspaceAtom,
  sessionRegistryAtom,
} from '../atoms/sessions';
import { sessionDispatchQueuedAtom } from '../atoms/sessionKanban';

/**
 * FB-019: a dispatch waiting for a Head Agent slot owns a placeholder session
 * row. It is not processing and has no messages, so without an explicit queued
 * signal the board renders it as an ordinary idle session that never started.
 *
 * The flag is derived from the session registry rather than pushed by its own
 * IPC listener, so it survives a renderer reload — the registry is refreshed
 * from the database, which is where `dispatchQueued` actually lives.
 */
function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'session-1',
    title: 'Queued task',
    provider: 'claude-code',
    sessionType: 'session',
    workspaceId: '/workspace',
    worktreeId: null,
    parentSessionId: null,
    childCount: 0,
    uncommittedCount: 0,
    createdAt: 1,
    updatedAt: 2,
    messageCount: 0,
    isArchived: false,
    isPinned: false,
    ...overrides,
  } as SessionMeta;
}

describe('sessionDispatchQueuedAtom (FB-019)', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function seed(metas: SessionMeta[]): void {
    store.set(sessionRegistryAtom, new Map(metas.map((m) => [m.id, m])));
  }

  it('is true for a session still waiting for a dispatch slot', () => {
    seed([makeMeta({ id: 'queued-1', dispatchQueued: true })]);
    expect(store.get(sessionDispatchQueuedAtom('queued-1'))).toBe(true);
  });

  it('preserves the queued flag through the sessions:list registry refresh', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      sessions: [
        {
          id: 'queued-from-list',
          title: 'Queued through IPC',
          createdAt: 1,
          updatedAt: 2,
          provider: 'claude-code',
          dispatchQueued: true,
        },
      ],
    });
    vi.stubGlobal('window', { electronAPI: { invoke } });
    store.set(sessionListWorkspaceAtom, '/workspace');

    await store.set(refreshSessionListAtom);

    expect(invoke).toHaveBeenCalledWith('sessions:list', '/workspace', {
      includeArchived: false,
    });
    expect(store.get(sessionRegistryAtom).get('queued-from-list')?.dispatchQueued).toBe(true);
    expect(store.get(sessionDispatchQueuedAtom('queued-from-list'))).toBe(true);
  });

  it('is false once the dispatch has started and the flag is cleared', () => {
    seed([makeMeta({ id: 'started-1', dispatchQueued: false })]);
    expect(store.get(sessionDispatchQueuedAtom('started-1'))).toBe(false);
  });

  it('is false for an ordinary session that was never queued', () => {
    seed([makeMeta({ id: 'plain-1' })]);
    expect(store.get(sessionDispatchQueuedAtom('plain-1'))).toBe(false);
  });

  it('is false for a session the registry does not know about', () => {
    seed([]);
    expect(store.get(sessionDispatchQueuedAtom('missing'))).toBe(false);
  });

  it('flips to false when the registry is refreshed after dispatch', () => {
    seed([makeMeta({ id: 'queued-2', dispatchQueued: true })]);
    expect(store.get(sessionDispatchQueuedAtom('queued-2'))).toBe(true);

    seed([makeMeta({ id: 'queued-2', dispatchQueued: false })]);
    expect(store.get(sessionDispatchQueuedAtom('queued-2'))).toBe(false);
  });
});

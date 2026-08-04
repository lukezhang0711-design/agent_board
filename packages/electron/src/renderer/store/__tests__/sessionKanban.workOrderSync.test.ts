import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import type { SessionMeta } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import {
  sessionKanbanFilterAtom,
  sessionsByPhaseAtom,
  sessionWorkOrderAttemptNumberAtom,
  sessionWorkOrderFailedAtom,
} from '../atoms/sessionKanban';
import { sessionRegistryAtom } from '../atoms/sessions';

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'session-1',
    title: 'Work order session',
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

function makeWorkOrder(
  status: string,
  sessionId: string,
  overrides: Partial<TrackerRecord> = {},
): TrackerRecord {
  return {
    id: `work-order-${sessionId}`,
    primaryType: 'work-order',
    typeTags: ['work-order'],
    source: 'native',
    archived: false,
    syncStatus: 'local',
    system: {
      workspace: '/workspace',
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:01.000Z',
      linkedSessions: [sessionId],
    },
    fields: {
      title: 'Work order',
      status,
      childSessionId: sessionId,
    },
    ...overrides,
  };
}

describe('session kanban work-order phase projection (FB-082)', () => {
  const store = createStore();

  beforeEach(() => {
    store.set(sessionKanbanFilterAtom, { search: '', tags: [], showComplete: true });
    store.set(sessionRegistryAtom, new Map());
    store.set(trackerItemsMapAtom, new Map());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves a stale planning card to COMPLETE when its work order is completed', () => {
    const session = makeSession({ phase: 'planning' });
    store.set(sessionRegistryAtom, new Map([[session.id, session]]));
    store.set(trackerItemsMapAtom, new Map([
      ['work-order-session-1', makeWorkOrder('completed', session.id)],
    ]));

    expect(store.get(sessionsByPhaseAtom).get('complete')).toEqual([session]);
    expect(store.get(sessionsByPhaseAtom).get('planning')).toEqual([]);
  });

  it.each(['queued', 'dispatched'] as const)(
    'places a %s work order in Planning',
    (status) => {
      const session = makeSession({ phase: undefined });
      store.set(sessionRegistryAtom, new Map([[session.id, session]]));
      store.set(trackerItemsMapAtom, new Map([
        ['work-order-session-1', makeWorkOrder(status, session.id)],
      ]));

      expect(store.get(sessionsByPhaseAtom).get('planning')).toEqual([session]);
      expect(store.get(sessionsByPhaseAtom).get('unphased')).toEqual([]);
    },
  );

  it('places a running work order in Implementing even when metadata is stale', () => {
    const session = makeSession({ phase: 'planning' });
    store.set(sessionRegistryAtom, new Map([[session.id, session]]));
    store.set(trackerItemsMapAtom, new Map([
      ['work-order-session-1', makeWorkOrder('running', session.id)],
    ]));

    expect(store.get(sessionsByPhaseAtom).get('implementing')).toEqual([session]);
    expect(store.get(sessionsByPhaseAtom).get('planning')).toEqual([]);
  });

  it('keeps a failed work order visible and exposes its failure marker', () => {
    const session = makeSession();
    store.set(sessionRegistryAtom, new Map([[session.id, session]]));
    store.set(trackerItemsMapAtom, new Map([
      ['work-order-session-1', makeWorkOrder('failed', session.id)],
    ]));

    expect(store.get(sessionsByPhaseAtom).get('implementing')).toEqual([session]);
    expect(store.get(sessionWorkOrderFailedAtom(session.id))).toBe(true);
  });

  it('aligns a historical completed work order with no session phase', () => {
    const session = makeSession({ phase: undefined });
    store.set(sessionRegistryAtom, new Map([[session.id, session]]));
    store.set(trackerItemsMapAtom, new Map([
      ['work-order-session-1', makeWorkOrder('completed', session.id)],
    ]));

    expect(store.get(sessionsByPhaseAtom).get('complete')).toEqual([session]);
    expect(store.get(sessionsByPhaseAtom).get('unphased')).toEqual([]);
  });

  it('shows only the current session when a reused card retains the old session link', () => {
    const oldSession = makeSession({ id: 'session-old', title: 'Module 1 old run', phase: 'planning' });
    const currentSession = makeSession({ id: 'session-current', title: 'Module 1 retry', phase: 'planning' });
    const workOrder = makeWorkOrder('completed', currentSession.id, {
      system: {
        workspace: '/workspace',
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:02.000Z',
        linkedSessions: [oldSession.id, currentSession.id],
      },
    });
    store.set(sessionRegistryAtom, new Map([
      [oldSession.id, oldSession],
      [currentSession.id, currentSession],
    ]));
    store.set(trackerItemsMapAtom, new Map([[workOrder.id, workOrder]]));

    expect(store.get(sessionsByPhaseAtom).get('planning')).toEqual([]);
    expect(store.get(sessionsByPhaseAtom).get('complete')).toEqual([currentSession]);
  });

  it('derives the visible attempt number from attempts and the latest status', () => {
    const session = makeSession();
    store.set(sessionRegistryAtom, new Map([[session.id, session]]));
    store.set(trackerItemsMapAtom, new Map([
      ['work-order-session-1', makeWorkOrder('completed', session.id, {
        fields: {
          title: 'Work order',
          status: 'completed',
          childSessionId: session.id,
          attempts: [
            { attempt: 1, engine: 'claude-code', model: 'haiku', startedAt: '2026-08-04T00:00:00.000Z', endedAt: '2026-08-04T00:00:01.000Z', outcome: 'failure' },
            { attempt: 2, engine: 'claude-code', model: 'claude-code:haiku', startedAt: '2026-08-04T00:00:02.000Z', endedAt: '2026-08-04T00:00:03.000Z', outcome: 'success' },
          ],
        },
      })],
    ]));

    expect(store.get(sessionWorkOrderAttemptNumberAtom(session.id))).toBe(2);
  });
});

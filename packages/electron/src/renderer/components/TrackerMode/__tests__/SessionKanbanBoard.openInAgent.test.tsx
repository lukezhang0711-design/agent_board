// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { SessionMeta } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { SessionKanbanBoard } from '../SessionKanbanBoard';
import { sessionRegistryAtom } from '../../../store/atoms/sessions';
import { workOrderSourceRefFor } from '../../../store/atoms/sessionKanban';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-material-icon={icon}>{icon}</span>,
  ProviderIcon: () => <span data-testid="provider-icon" />,
}));

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: () => null,
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => null,
}));

vi.mock('../../AgenticCoding/SessionContextMenu', () => ({
  SessionContextMenu: () => null,
}));

vi.mock('../../AgentMode/ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: () => null,
}));

vi.mock('../../../hooks/useArchiveWorktreeDialog', () => ({
  useArchiveWorktreeDialog: () => ({
    dialogState: null,
    showDialog: vi.fn(),
    closeDialog: vi.fn(),
    confirmArchive: vi.fn(),
  }),
}));

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'session-1',
    title: 'A card',
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
    phase: 'implementing',
    ...overrides,
  } as SessionMeta;
}

function makeWorkOrder(sessionId: string, overrides: Partial<TrackerRecord> = {}): TrackerRecord {
  return {
    id: `work-order-${sessionId}`,
    primaryType: 'work-order',
    typeTags: ['work-order'],
    source: 'native',
    sourceRef: workOrderSourceRefFor(sessionId),
    archived: false,
    syncStatus: 'local',
    system: {
      workspace: '/workspace',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:01.000Z',
      linkedSessions: [sessionId],
    },
    fields: {
      title: 'Dispatched module',
      status: 'running',
      childSessionId: sessionId,
    },
    ...overrides,
  };
}

function renderBoard(
  metas: SessionMeta[],
  records: TrackerRecord[] = [],
  onSessionOpen = vi.fn(),
) {
  const store = createStore();
  store.set(sessionRegistryAtom, new Map(metas.map((meta) => [meta.id, meta])));
  store.set(trackerItemsMapAtom, new Map(records.map((record) => [record.id, record])));
  render(
    <Provider store={store}>
      <SessionKanbanBoard onSessionOpen={onSessionOpen} />
    </Provider>,
  );
  return onSessionOpen;
}

describe('SessionKanbanBoard Open in Agent entry (FB-133)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the entry only on cards a Head dispatched, and opens that session', () => {
    const onSessionOpen = renderBoard(
      [
        makeMeta({ id: 'dispatched-1', title: 'Dispatched card' }),
        makeMeta({ id: 'plain-1', title: 'Plain card' }),
      ],
      [makeWorkOrder('dispatched-1')],
    );

    const entries = screen.getAllByTestId('session-kanban-open-in-agent');
    expect(entries).toHaveLength(1);
    expect(entries[0].getAttribute('data-session-id')).toBe('dispatched-1');

    fireEvent.click(entries[0]);
    expect(onSessionOpen).toHaveBeenCalledWith('dispatched-1');
  });

  it('keeps the entry on a retried card, whose source_ref still names the first run', () => {
    // A retry reuses the work order: `source_ref` keeps the original child id
    // while `childSessionId` re-points at the new run.
    renderBoard(
      [makeMeta({ id: 'retry-2', title: 'Retried card' })],
      [
        makeWorkOrder('retry-2', {
          sourceRef: workOrderSourceRefFor('retry-1'),
          fields: { title: 'Dispatched module', status: 'running', childSessionId: 'retry-2' },
        }),
      ],
    );

    const entries = screen.getAllByTestId('session-kanban-open-in-agent');
    expect(entries).toHaveLength(1);
    expect(entries[0].getAttribute('data-session-id')).toBe('retry-2');
  });

  it('does not show the entry when the board holds no dispatched cards', () => {
    renderBoard([makeMeta({ id: 'plain-1', title: 'Plain card' })]);

    expect(screen.queryByTestId('session-kanban-open-in-agent')).toBeNull();
  });
});

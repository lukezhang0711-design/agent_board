// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { SessionMeta } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { SessionKanbanBoard } from '../SessionKanbanBoard';
import { sessionRegistryAtom } from '../../../store/atoms/sessions';

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
    title: 'Queued inbox task',
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

function renderBoard(metas: SessionMeta[], records: TrackerRecord[] = []): void {
  const store = createStore();
  store.set(sessionRegistryAtom, new Map(metas.map((meta) => [meta.id, meta])));
  store.set(trackerItemsMapAtom, new Map(records.map((record) => [record.id, record])));
  render(
    <Provider store={store}>
      <SessionKanbanBoard />
    </Provider>,
  );
}

function getInboxColumn(): HTMLElement {
  const inbox = document.querySelector<HTMLElement>(
    '[data-testid="session-kanban-column"][data-phase="unphased"]',
  );
  if (!inbox) throw new Error('Inbox column was not rendered');
  return inbox;
}

describe('SessionKanbanBoard interrupted and Inbox states', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a warning queued badge on a collapsed Inbox that contains queued work', () => {
    renderBoard([makeMeta({ dispatchQueued: true })]);

    const queuedBadge = within(getInboxColumn()).getByText('1 queued');
    expect(queuedBadge.className).toContain('text-[var(--nim-warning)]');
    expect(within(getInboxColumn()).getByText('schedule')).toBeTruthy();

    fireEvent.click(getInboxColumn());
    expect(screen.getByText('Queued inbox task')).toBeTruthy();
    expect(screen.queryByText('1 queued')).toBeNull();
  });

  it('does not show a collapsed Inbox queued badge when no contained session is queued', () => {
    renderBoard([makeMeta({ dispatchQueued: false })]);

    expect(within(getInboxColumn()).queryByText(/queued/)).toBeNull();
  });

  it('explains that child sessions are grouped under their parent workstreams', () => {
    const parentCards = Array.from({ length: 139 }, (_, index) => makeMeta({
      id: `parent-${index}`,
      title: `Parent card ${index}`,
      phase: 'planning',
    }));
    const childSessions = Array.from({ length: 5 }, (_, index) => makeMeta({
      id: `child-${index}`,
      title: `Child session ${index}`,
      parentSessionId: `parent-${index}`,
      phase: 'planning',
    }));

    renderBoard([...parentCards, ...childSessions]);

    expect(screen.getByText('139 cards · 5 child sessions grouped under parent workstreams')).toBeTruthy();
  });

  it('shows a persisted Head interruption as an orange card state', () => {
    renderBoard([
      makeMeta({
        id: 'interrupted-card',
        title: 'Interrupted delegated task',
        phase: 'backlog',
        interruptedByHead: true,
      }),
    ]);

    const card = screen.getByTestId('session-kanban-card');
    const badge = within(card).getByText('interrupted');
    expect(badge.className).toContain('bg-orange-500/10');
    expect(within(card).getByText('cancel')).toBeTruthy();
  });

  it('shows a linked failed work order as a visible red card state', () => {
    const session = makeMeta({
      id: 'failed-card',
      title: 'Failed delegated task',
      phase: 'planning',
    });
    const workOrder: TrackerRecord = {
      id: 'work-order-failed-card',
      primaryType: 'work-order',
      typeTags: ['work-order'],
      source: 'native',
      archived: false,
      syncStatus: 'local',
      system: {
        workspace: '/workspace',
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:01.000Z',
        linkedSessions: [session.id],
      },
      fields: { status: 'failed', childSessionId: session.id },
    };

    renderBoard([session], [workOrder]);

    const card = screen.getByTestId('session-kanban-card');
    expect(card.dataset.workOrderStatus).toBe('failed');
    expect(card.dataset.workOrderFailed).toBe('true');
    const badge = within(card).getByText('failed');
    expect(badge.className).toContain('bg-red-500/10');
    expect(within(card).getByText('error')).toBeTruthy();
  });

  it('shows the current attempt and latest work-order status on the card', () => {
    const session = makeMeta({
      id: 'retry-card',
      title: 'Module 1',
      phase: 'planning',
    });
    const workOrder: TrackerRecord = {
      id: 'work-order-retry-card',
      primaryType: 'work-order',
      typeTags: ['work-order'],
      source: 'native',
      archived: false,
      syncStatus: 'local',
      system: {
        workspace: '/workspace',
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:01.000Z',
        linkedSessions: [session.id],
      },
      fields: {
        status: 'completed',
        childSessionId: session.id,
        attempts: [
          {
            attempt: 1,
            engine: 'claude-code',
            model: 'haiku',
            startedAt: '2026-08-04T00:00:00.000Z',
            endedAt: '2026-08-04T00:00:01.000Z',
            outcome: 'failure',
            failureReason: 'Model identifier must be in "provider:model" format: haiku',
          },
          {
            attempt: 2,
            engine: 'claude-code',
            model: 'claude-code:haiku',
            startedAt: '2026-08-04T00:00:02.000Z',
            endedAt: '2026-08-04T00:00:03.000Z',
            outcome: 'success',
          },
        ],
      },
    };

    renderBoard([session], [workOrder]);

    const card = screen.getByTestId('session-kanban-card');
    expect(within(card).getByTestId('work-order-attempt-summary').textContent).toBe(
      '第 2 次尝试 · 最近状态：completed',
    );
  });
});

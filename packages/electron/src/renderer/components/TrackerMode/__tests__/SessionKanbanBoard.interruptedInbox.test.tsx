// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { SessionMeta } from '@nimbalyst/runtime';
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

function renderBoard(metas: SessionMeta[]): void {
  const store = createStore();
  store.set(sessionRegistryAtom, new Map(metas.map((meta) => [meta.id, meta])));
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
});

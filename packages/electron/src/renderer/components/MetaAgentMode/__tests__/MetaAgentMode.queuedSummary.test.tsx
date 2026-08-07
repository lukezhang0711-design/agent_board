// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MetaAgentMode } from '../MetaAgentMode';

const invoke = vi.fn();

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => null,
}));

vi.mock('../../UnifiedAI/SessionTranscript', () => ({
  SessionTranscript: (props: Record<string, unknown>) => (
    <div
      data-testid="session-transcript"
      data-emergency-stop={String(props.showStopAndClearQueue)}
    />
  ),
}));

vi.mock('../../../utils/metaAgentUtils', () => ({
  createMetaAgentSession: vi.fn(),
}));

function makeSpawnedSession(status: string, sessionId: string) {
  return {
    sessionId,
    title: `${status} task`,
    provider: 'claude-code',
    model: 'claude-code:sonnet',
    status,
    lastActivity: null,
    originalPrompt: null,
    lastResponse: null,
    editedFiles: [],
    pendingPrompt: null,
    createdAt: 1,
    updatedAt: 2,
    worktreeId: null,
  };
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((channel: string) => {
    if (channel === 'sessions:get') {
      return Promise.resolve({
        success: true,
        session: {
          id: 'meta-1',
          agentRole: 'meta-agent',
          isArchived: false,
        },
      });
    }
    return Promise.resolve({
      success: true,
      sessions: [
        makeSpawnedSession('running', 'running-1'),
        makeSpawnedSession('queued', 'queued-1'),
      ],
    });
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      invoke,
      sessionState: {
        onStateChange: vi.fn(),
        removeStateChangeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

describe('MetaAgentMode queued summary', () => {
  it('does not expose delegated sessions or a meta-agent badge for a standard session', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'sessions:get') {
        return Promise.resolve({
          success: true,
          session: {
            id: 'standard-1',
            agentRole: 'standard',
            isArchived: false,
          },
        });
      }
      return Promise.resolve({ success: true, sessions: [] });
    });

    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="standard-1" />
      </Provider>,
    );

    await waitFor(() => expect(screen.getByText('Unable to initialize meta-agent mode.')).toBeTruthy());
    expect(screen.queryByTestId('meta-agent-dashboard')).toBeNull();
    expect(screen.queryByTestId('meta-agent-identity-badge')).toBeNull();
  });

  it('shows the delegated panel and identity badge only for a verified meta-agent session', async () => {
    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    expect(await screen.findByTestId('meta-agent-dashboard')).toBeTruthy();
    expect(screen.getByTestId('meta-agent-identity-badge').textContent).toBe('META AGENT');
  });

  it('shows queued delegated sessions in the summary', async () => {
    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    expect(await screen.findByText('1 queued')).toBeTruthy();
    expect(screen.getByText('1 running')).toBeTruthy();
    expect(screen.getByText('0 waiting')).toBeTruthy();
  });

  it('hides the queued summary when no delegated session is queued', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'sessions:get') {
        return Promise.resolve({
          success: true,
          session: {
            id: 'meta-1',
            agentRole: 'meta-agent',
            isArchived: false,
          },
        });
      }
      return Promise.resolve({
        success: true,
        sessions: [makeSpawnedSession('running', 'running-only')],
      });
    });

    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    expect(await screen.findByText('1 running')).toBeTruthy();
    expect(screen.queryByText('0 queued')).toBeNull();
  });

  it('renders interrupted delegated sessions with the warning tone', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'sessions:get') {
        return Promise.resolve({
          success: true,
          session: {
            id: 'meta-1',
            agentRole: 'meta-agent',
            isArchived: false,
          },
        });
      }
      return Promise.resolve({
        success: true,
        sessions: [makeSpawnedSession('interrupted', 'interrupted-1')],
      });
    });

    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    const badge = await screen.findByText('interrupted');
    expect(badge.className).toContain('text-[var(--nim-warning)]');
    expect(badge.className).toContain('bg-[rgba(245,158,11,0.16)]');
  });

  it('keeps emergency stop available while child sessions make the Head wait', async () => {
    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    expect(await screen.findByText('1 running')).toBeTruthy();
    expect(screen.getByTestId('session-transcript').dataset.emergencyStop).toBe('true');
  });

  it('derives the count pills from the same snapshot rendered as cards', async () => {
    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    expect(await screen.findAllByTestId('meta-agent-child-card')).toHaveLength(2);
    expect(screen.getByText('1 running')).toBeTruthy();
    expect(screen.getByText('1 queued')).toBeTruthy();
  });
});

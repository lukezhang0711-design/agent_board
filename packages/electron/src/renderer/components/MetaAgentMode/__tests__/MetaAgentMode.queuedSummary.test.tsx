// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MetaAgentMode } from '../MetaAgentMode';

const invoke = vi.fn();

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => null,
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('../../UnifiedAI/SessionTranscript', () => ({
  SessionTranscript: (props: Record<string, unknown>) => (
    <div
      data-testid="session-transcript"
      data-emergency-stop={String(props.showStopAndClearQueue)}
      data-disable-mode-toggle={String(props.disableModeToggle)}
    />
  ),
}));

vi.mock('../../../utils/metaAgentUtils', () => ({
  createMetaAgentSession: vi.fn(),
}));

function makeSpawnedSession(status: string, sessionId: string, editedFiles: string[] = []) {
  return {
    sessionId,
    title: `${status} task`,
    provider: 'claude-code',
    model: 'claude-code:sonnet',
    status,
    lastActivity: null,
    originalPrompt: null,
    lastResponse: null,
    editedFiles,
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

describe('MetaAgentMode Head workbench', () => {
  it('does not expose the Head workbench or a meta-agent badge for a standard session', async () => {
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
    expect(screen.queryByTestId('file-preview-rail-toggle')).toBeNull();
    expect(screen.queryByTestId('meta-agent-identity-badge')).toBeNull();
  });

  it('shows the identity badge and a collapsed preview rail for a verified meta-agent session', async () => {
    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    expect((await screen.findByTestId('meta-agent-identity-badge')).textContent).toBe('META AGENT');
    // The rail is collapsed: only its edge handle exists, no panel.
    expect(screen.getByTestId('file-preview-rail-toggle')).toBeTruthy();
    expect(screen.queryByTestId('file-preview-rail')).toBeNull();
  });

  it('disables the engine Plan/Agent toggle in the Head transcript', async () => {
    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    expect((await screen.findByTestId('session-transcript')).getAttribute('data-disable-mode-toggle')).toBe('true');
  });

  it('keeps emergency stop available while running or queued delegated sessions make the Head wait', async () => {
    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('session-transcript').dataset.emergencyStop).toBe('true'),
    );
  });

  it('withdraws emergency stop when no delegated session is running or queued', async () => {
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

    const transcript = await screen.findByTestId('session-transcript');
    await waitFor(() => expect(transcript.dataset.emergencyStop).toBe('false'));
  });

  it('feeds the artifact shelf from the same delegated-session snapshot', async () => {
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
          makeSpawnedSession('completed', 'child-1', ['docs/one.md']),
          makeSpawnedSession('completed', 'child-2', ['docs/two.sql']),
        ],
      });
    });

    render(
      <Provider store={createStore()}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    (await screen.findByTestId('file-preview-rail-toggle')).click();

    const shelf = await screen.findByTestId('file-preview-shelf');
    await waitFor(() =>
      expect(shelf.querySelectorAll('[data-testid="file-preview-shelf-item"]')).toHaveLength(2),
    );
  });
});

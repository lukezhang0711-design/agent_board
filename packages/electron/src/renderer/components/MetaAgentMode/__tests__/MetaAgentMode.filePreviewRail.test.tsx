// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { MetaAgentMode } from '../MetaAgentMode';
import { agentModeLayoutAtomFamily, filePreviewWidthAtom } from '../../../store/atoms/agentMode';
import { activeWorkspacePathAtom } from '../../../store/atoms/openProjects';

const invoke = vi.fn();

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-material-icon={icon} />,
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

// The Head transcript is stubbed down to the one wire this ticket is about:
// a file link that hands an absolute path to whatever handler the Head
// workbench installs. Before FA that handler was never installed.
vi.mock('../../UnifiedAI/SessionTranscript', () => ({
  SessionTranscript: (props: Record<string, any>) => (
    <div
      data-testid="session-transcript"
      data-has-file-click={String(typeof props.onFileClick === 'function')}
    >
      <button
        type="button"
        data-testid="transcript-file-link"
        onClick={() => props.onFileClick?.('/workspace/plans/2026-08-27-report.sql')}
      >
        2026-08-27-report.sql
      </button>
      <button
        type="button"
        data-testid="transcript-missing-link"
        onClick={() => props.onFileClick?.('/workspace/gone/missing.md')}
      >
        missing.md
      </button>
      <button
        type="button"
        data-testid="widget-relative-open"
        onClick={() => props.onFileClick?.('plans/2026-08-27-report.sql')}
      >
        widget openFile
      </button>
    </div>
  ),
}));

vi.mock('../../../utils/metaAgentUtils', () => ({
  createMetaAgentSession: vi.fn(),
}));

function makeSpawnedSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'child-1',
    title: 'Module 1',
    provider: 'claude-code',
    model: 'claude-code:sonnet',
    status: 'completed',
    lastActivity: null,
    originalPrompt: null,
    lastResponse: null,
    editedFiles: [],
    pendingPrompt: null,
    createdAt: 1,
    updatedAt: 2,
    worktreeId: null,
    ...overrides,
  };
}

let spawnedSessions: Array<Record<string, unknown>> = [];
let fileContents: Record<string, string | null> = {};

beforeEach(() => {
  spawnedSessions = [];
  fileContents = {
    '/workspace/plans/2026-08-27-report.sql': 'SELECT 1;',
  };
  invoke.mockReset();
  invoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'sessions:get') {
      return Promise.resolve({
        success: true,
        session: { id: 'meta-1', agentRole: 'meta-agent', isArchived: false },
      });
    }
    if (channel === 'meta-agent:list-spawned-sessions') {
      return Promise.resolve({ success: true, sessions: spawnedSessions });
    }
    if (channel === 'read-file-content') {
      const path = args[0] as string;
      const content = fileContents[path];
      if (content === undefined || content === null) return Promise.resolve(null);
      return Promise.resolve({ success: true, content, isBinary: false });
    }
    if (channel === 'app-settings:get') {
      return Promise.resolve(false);
    }
    return Promise.resolve({ success: true });
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      invoke,
      sessionState: { onStateChange: vi.fn(), removeStateChangeListener: vi.fn() },
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.clearAllMocks();
});

function renderHead(extraProps: Record<string, unknown> = {}) {
  const store = createStore();
  store.set(activeWorkspacePathAtom, '/workspace');
  render(
    <Provider store={store}>
      <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" {...extraProps} />
    </Provider>,
  );
  return store;
}

describe('Head workbench right rail — file preview', () => {
  it('starts fully collapsed: no preview rail occupies the layout', async () => {
    renderHead();

    await screen.findByTestId('session-transcript');
    expect(screen.queryByTestId('file-preview-rail')).toBeNull();
  });

  it('opens the preview rail from a transcript file link without leaving the conversation', async () => {
    renderHead();

    const transcript = await screen.findByTestId('session-transcript');
    expect(transcript.dataset.hasFileClick).toBe('true');

    fireEvent.click(screen.getByTestId('transcript-file-link'));

    const rail = await screen.findByTestId('file-preview-rail');
    expect(rail).toBeTruthy();
    // The conversation is still mounted and still the same session.
    expect(screen.getByTestId('session-transcript')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('file-preview-path').textContent).toContain('2026-08-27-report.sql'),
    );
  });

  // `host.openFile` (interactive widgets) shares this prop and passes paths
  // the widget happens to hold, which are often workspace-relative.
  it('resolves a workspace-relative path handed over by a widget', async () => {
    renderHead();

    await screen.findByTestId('session-transcript');
    fireEvent.click(screen.getByTestId('widget-relative-open'));

    await waitFor(() =>
      expect(screen.getByTestId('file-preview-path').textContent).toBe(
        '/workspace/plans/2026-08-27-report.sql',
      ),
    );
    expect(screen.queryByTestId('file-preview-missing')).toBeNull();
  });

  it('shows a visible notice in the panel when the file is gone', async () => {
    renderHead();

    await screen.findByTestId('session-transcript');
    fireEvent.click(screen.getByTestId('transcript-missing-link'));

    const missing = await screen.findByTestId('file-preview-missing');
    expect(missing.textContent).toContain('文件不存在或已移动');
    expect(missing.textContent).toContain('/workspace/gone/missing.md');
  });

  it('collapses on Escape and restores the last previewed file when reopened', async () => {
    renderHead();

    await screen.findByTestId('session-transcript');
    fireEvent.click(screen.getByTestId('transcript-file-link'));
    await screen.findByTestId('file-preview-rail');

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByTestId('file-preview-rail')).toBeNull());

    fireEvent.click(screen.getByTestId('file-preview-rail-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('file-preview-path').textContent).toContain('2026-08-27-report.sql'),
    );
  });

  it('lists the Head artifact shelf from work-order edited records when opened with no file', async () => {
    spawnedSessions = [
      makeSpawnedSession({ sessionId: 'child-1', title: 'Module 1', editedFiles: ['plans/a.md', 'src/b.ts'] }),
      makeSpawnedSession({ sessionId: 'child-2', title: 'Module 2', editedFiles: ['plans/a.md'] }),
    ];
    fileContents['/workspace/plans/a.md'] = '# A';

    renderHead();

    await screen.findByTestId('session-transcript');
    fireEvent.click(await screen.findByTestId('file-preview-rail-toggle'));

    const shelf = await screen.findByTestId('file-preview-shelf');
    const items = shelf.querySelectorAll('[data-testid="file-preview-shelf-item"]');
    expect(Array.from(items).map((item) => item.getAttribute('data-file-path'))).toEqual([
      'plans/a.md',
      'src/b.ts',
    ]);

    fireEvent.click(items[0]);
    await waitFor(() =>
      expect(screen.getByTestId('file-preview-path').textContent).toContain('plans/a.md'),
    );
  });

  it('goes back to the shelf after a file has been previewed', async () => {
    spawnedSessions = [
      makeSpawnedSession({ sessionId: 'child-1', title: 'Module 1', editedFiles: ['plans/a.md'] }),
    ];
    fileContents['/workspace/plans/a.md'] = '# A';
    renderHead();

    await screen.findByTestId('session-transcript');
    fireEvent.click(screen.getByTestId('transcript-file-link'));
    await screen.findByTestId('file-preview-rail');

    fireEvent.click(screen.getByTestId('file-preview-show-shelf'));

    const shelf = await screen.findByTestId('file-preview-shelf');
    expect(shelf.querySelectorAll('[data-testid="file-preview-shelf-item"]')).toHaveLength(1);
  });

  it('opens at the width this workspace last left the rail at', async () => {
    const store = createStore();
    store.set(activeWorkspacePathAtom, '/workspace');
    const layoutAtom = agentModeLayoutAtomFamily('/workspace');
    store.set(layoutAtom, { ...store.get(layoutAtom), filePreviewWidth: 610 });
    expect(store.get(filePreviewWidthAtom)).toBe(610);

    render(
      <Provider store={store}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>,
    );

    fireEvent.click(await screen.findByTestId('file-preview-rail-toggle'));

    const rail = await screen.findByTestId('file-preview-rail');
    expect(rail.dataset.width).toBe('610');
    expect(rail.style.width).toBe('610px');
  });

  it('does not render the retired FILES-page preview exit', async () => {
    renderHead();

    await screen.findByTestId('session-transcript');
    fireEvent.click(screen.getByTestId('transcript-file-link'));
    await screen.findByTestId('file-preview-rail');

    expect(screen.queryByTestId('file-preview-open-in-files')).toBeNull();
  });

  it('drops the always-on Delegated Sessions panel', async () => {
    spawnedSessions = [makeSpawnedSession({ status: 'running' })];
    renderHead();

    await screen.findByTestId('session-transcript');
    expect(screen.queryByTestId('meta-agent-dashboard')).toBeNull();
    expect(screen.queryByText('Delegated Sessions')).toBeNull();
  });
});

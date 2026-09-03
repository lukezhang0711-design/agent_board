// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import * as fs from 'fs';
import * as path from 'path';

import { MetaAgentMode } from '../MetaAgentMode';

const invoke = vi.fn();

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
    <span data-material-icon={icon} data-testid={`material-symbol-${icon}`} className={className}>
      {icon}
    </span>
  ),
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('../../UnifiedAI/SessionTranscript', () => ({
  SessionTranscript: (props: Record<string, any>) => (
    <div
      data-testid="session-transcript"
      data-emergency-stop={String(props.showStopAndClearQueue)}
      data-disable-mode-toggle={String(props.disableModeToggle)}
    >
      {props.showStopAndClearQueue && (
        <button
          type="button"
          data-testid="transcript-emergency-stop-control"
          onClick={() => props.onStopAndClearQueue?.()}
        >
          transcript stop
        </button>
      )}
    </div>
  ),
}));

vi.mock('../../../utils/metaAgentUtils', () => ({
  createMetaAgentSession: vi.fn(),
}));

vi.mock('../../help', () => ({
  HelpTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../NavigationGutter/UserMenuPopover', () => ({
  UserMenuPopover: () => <div data-testid="user-menu-popover" />,
}));

vi.mock('../../NavigationGutter/GutterContextMenu', () => ({
  GutterContextMenu: () => <div data-testid="gutter-context-menu" />,
}));

vi.mock('../../../extensions/panels/usePanels', () => ({
  useExtensionGutterButtons: () => [],
  useExtensionBottomPanelButtons: () => [],
}));

vi.mock('../../ThemeToggleButton/ThemeToggleButton', () => ({
  ThemeToggleButton: () => <div data-testid="theme-toggle-button" />,
}));

vi.mock('../../ExtensionDevIndicator', () => ({
  ExtensionDevIndicator: () => <div data-testid="extension-dev-indicator" />,
}));

vi.mock('../../SyncStatusButton/SyncStatusButton', () => ({
  SyncStatusButton: () => <div data-testid="sync-status-button" />,
}));

vi.mock('../../TrustIndicator', () => ({
  TrustIndicator: () => <div data-testid="trust-indicator" />,
}));

vi.mock('../../UsageIndicator/AIUsageIndicator', () => ({
  AIUsageIndicator: () => <div data-testid="ai-usage-indicator" />,
}));

vi.mock('../../BackgroundTaskIndicator/BackgroundTaskIndicator', () => ({
  BackgroundTaskIndicator: () => <div data-testid="background-task-indicator" />,
}));

function makeSpawnedSession(status: string, sessionId: string, title = `${status} task`) {
  return {
    sessionId,
    title,
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

describe('施工单 GJ — 任务一：主窗口去掉重复的「全部停下」按钮（FB-171）', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
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
      if (channel === 'app-settings:get') {
        return Promise.resolve(false);
      }
      if (channel === 'meta-agent:list-spawned-sessions') {
        return Promise.resolve({
          success: true,
          sessions: [
            makeSpawnedSession('running', 'run-1', 'FX-001 模块实现'),
          ],
        });
      }
      return Promise.resolve({ success: true, sessions: [] });
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

  it('红/绿代码静态分析: 断言 MetaAgentMode.tsx 中 handleEmergencyStop 恰好出现 3 次', () => {
    const metaSource = fs.readFileSync(
      path.resolve(__dirname, '../MetaAgentMode.tsx'),
      'utf8'
    );
    const matches = metaSource.match(/handleEmergencyStop/g);
    // 恰好出现 3 次：声明处、页头 onClick、SessionTranscript 的 onStopAndClearQueue
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(3);
  });

  it('绿①: 有活在跑的夹具下，主窗口只渲染出一个停止控件（meta-agent-stop-all 存在，会话页停止控件不存在）', async () => {
    render(
      <Provider store={store}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>
    );

    // 页头的全部停下按钮存在
    const headerStopBtn = await screen.findByTestId('meta-agent-stop-all');
    expect(headerStopBtn).toBeTruthy();
    expect(headerStopBtn.textContent).toBe('全部停下');

    // 反向断言：会话页 SessionTranscript 的停止控件不存在
    await waitFor(() => {
      expect(screen.queryByTestId('transcript-emergency-stop-control')).toBeNull();
    });

    // 断言 SessionTranscript 传参 showStopAndClearQueue 为 false
    const transcriptEl = screen.getByTestId('session-transcript');
    expect(transcriptEl.getAttribute('data-emergency-stop')).toBe('false');
  });

  it('绿②: 点击页头按钮仍触发 handleEmergencyStop（行为零回归）', async () => {
    render(
      <Provider store={store}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>
    );

    const headerStopBtn = await screen.findByTestId('meta-agent-stop-all');
    fireEvent.click(headerStopBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('meta-agent:stop-and-clear', 'meta-1', '/workspace');
    });
  });

  it('绿③: 无活时页头按钮置灰且不可点', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'sessions:get') {
        return Promise.resolve({
          success: true,
          session: { id: 'meta-1', agentRole: 'meta-agent', isArchived: false },
        });
      }
      if (channel === 'app-settings:get') return Promise.resolve(false);
      if (channel === 'meta-agent:list-spawned-sessions') {
        return Promise.resolve({ success: true, sessions: [] });
      }
      return Promise.resolve({ success: true });
    });

    render(
      <Provider store={store}>
        <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
      </Provider>
    );

    const headerStopBtn = await screen.findByTestId('meta-agent-stop-all');
    await waitFor(() => {
      expect(headerStopBtn.getAttribute('disabled')).not.toBeNull();
      expect(headerStopBtn.className).toContain('cursor-not-allowed');
      expect(headerStopBtn.className).toContain('opacity-50');
    });
  });

  it('绿④: 反向断言——SessionTranscript 组件本身未被改动', () => {
    const transcriptPath = path.resolve(
      __dirname,
      '../../UnifiedAI/SessionTranscript.tsx'
    );
    expect(fs.existsSync(transcriptPath)).toBe(true);
    const content = fs.readFileSync(transcriptPath, 'utf8');
    expect(content).toContain('showStopAndClearQueue?: boolean;');
    expect(content).toContain('showStopAndClearQueue = false,');
    expect(content).toContain('{(isLoading || showStopAndClearQueue) && (');
  });

  it('绿⑤: 反向断言——其它使用 SessionTranscript 的屏组件源码中，仍然完整保留停止按钮渲染逻辑', () => {
    const transcriptPath = path.resolve(
      __dirname,
      '../../UnifiedAI/SessionTranscript.tsx'
    );
    const content = fs.readFileSync(transcriptPath, 'utf8');
    // SessionTranscript 仍依据 isLoading || showStopAndClearQueue 渲染停止栏与 Stop & clear queue 按钮
    expect(content).toMatch(/\{\(isLoading\s*\|\|\s*showStopAndClearQueue\s*\|\|\s*cancelFeedback\.phase\s*!==\s*'idle'\)\s*&&/);
    expect(content).toContain('Stop &amp; clear queue');
    expect(content).toContain('data-testid="session-stop-status"');
    
    // AgentSessionPanel 作为另一处复用屏，包含 SessionTranscript 引用
    const agentSessionPath = path.resolve(
      __dirname,
      '../../AgentMode/AgentSessionPanel.tsx'
    );
    const agentPanelContent = fs.readFileSync(agentSessionPath, 'utf8');
    expect(agentPanelContent).toContain('<SessionTranscript');
  });
});

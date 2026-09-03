// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import * as fs from 'fs';
import * as path from 'path';

import { MetaAgentMode } from '../MetaAgentMode';
import { AgentBusyIndicator, getAvatarPalette } from '../../common/AgentBusyIndicator';
import { NavigationGutter } from '../../NavigationGutter/NavigationGutter';
import { scanFileViolations } from '../../../styles/__tests__/visualTokensGuard.test';

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
      <button
        type="button"
        data-testid="transcript-file-link"
        onClick={() => props.onFileClick?.('/workspace/plans/report.sql')}
      >
        report.sql
      </button>
      <button
        type="button"
        data-testid="transcript-emergency-stop-trigger"
        onClick={() => props.onStopAndClearQueue?.()}
      >
        transcript stop
      </button>
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

function makeSpawnedSession(status: string, sessionId: string, title = `${status} task`, editedFiles: string[] = []) {
  return {
    sessionId,
    title,
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

describe('施工单 GC: 总指挥主窗口 + 侧边栏（补派）红绿验收套件', () => {
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
            makeSpawnedSession('running', 'run-1', 'FX-001 基础设计'),
            makeSpawnedSession('running', 'run-2', 'FY-002 版面收敛'),
            makeSpawnedSession('waiting_for_input', 'wait-1', '审批工单'),
            makeSpawnedSession('queued', 'queue-1', '排队工单'),
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

  describe('绿①: 页头统一使用 PageHeader，标题「总指挥」，副信息包含工作区与状态，彻底移除 META AGENT 徽章', () => {
    it('逐字段断言 PageHeader 内容与反向断言 META AGENT 徽章消失', async () => {
      render(
        <Provider store={store}>
          <MetaAgentMode workspacePath="/Users/project/myapp" sessionId="meta-1" />
        </Provider>
      );

      const pageHeader = await screen.findByTestId('page-header');
      expect(pageHeader).toBeTruthy();

      // 标题为「总指挥」
      const title = pageHeader.querySelector('.page-header-title');
      expect(title?.textContent).toBe('总指挥');

      // 副信息一行：工作区名 · N 个在跑 · N 个等你确认
      await waitFor(() => {
        const subtitle = pageHeader.querySelector('.page-header-subtitle');
        expect(subtitle?.textContent).toContain('myapp');
        expect(subtitle?.textContent).toContain('2 个在跑');
        expect(subtitle?.textContent).toContain('1 个等你确认');
      });

      // 反向断言：META AGENT 字样与徽章彻底消失
      expect(screen.queryByTestId('meta-agent-identity-badge')).toBeNull();
      expect(screen.queryByText('META AGENT')).toBeNull();
    });
  });

  describe('绿②: 忙碌指示改成头像叠放，N 个在跑渲染 N 个头像，同一会话 ID 两次渲染取到同一颜色', () => {
    it('有 N 个会话在跑时渲染出 N 个头像', () => {
      render(
        <AgentBusyIndicator
          runningCount={3}
          activeSessions={[
            { id: 'sess-A', title: 'FX-101 模块A', provider: 'claude-code', status: 'running' },
            { id: 'sess-B', title: 'FY-202 模块B', provider: 'openai-codex', status: 'running' },
            { id: 'sess-C', title: 'FZ-303 模块C', provider: 'gemini', status: 'running' },
          ]}
        />
      );

      const avatars = screen.getAllByTestId('agent-avatar');
      expect(avatars).toHaveLength(3);

      // 头像提取前两位字符
      expect(avatars[0].textContent).toBe('FX');
      expect(avatars[1].textContent).toBe('FY');
      expect(avatars[2].textContent).toBe('FZ');

      // 包含数量文字
      expect(screen.getByTestId('agent-busy-text').textContent).toBe('3 agents working');
    });

    it('同一会话 id 两次渲染取到完全一致的颜色 (确定性取模映射，无外部哈希库)', () => {
      const paletteFirst = getAvatarPalette('session-unique-xyz');
      const paletteSecond = getAvatarPalette('session-unique-xyz');
      expect(paletteFirst).toBe(paletteSecond);
      expect(typeof paletteFirst).toBe('string');
      expect(paletteFirst).toMatch(/bg-nim-[a-z]+-subtle|bg-\[var\(--nim-/);
    });
  });

  describe('绿③: 悬停头像出现该会话标题与状态，浮层走 @floating-ui/react（反向断言无手写坐标）', () => {
    it('悬停头像显示 FloatingPortal 弹出的标题与状态', async () => {
      render(
        <AgentBusyIndicator
          runningCount={1}
          activeSessions={[
            { id: 'sess-test', title: 'FB-164 施工单主窗口', provider: 'claude-code', status: 'running' },
          ]}
        />
      );

      const avatar = screen.getByTestId('agent-avatar');
      expect(avatar).toBeTruthy();

      // 悬停前无 popover
      expect(screen.queryByTestId('agent-avatar-popover')).toBeNull();

      // 触发鼠标进入
      fireEvent.mouseEnter(avatar);

      const popover = await screen.findByTestId('agent-avatar-popover');
      expect(popover).toBeTruthy();
      expect(screen.getByTestId('agent-avatar-popover-title').textContent).toBe('FB-164 施工单主窗口');
      expect(screen.getByTestId('agent-avatar-popover-status').textContent).toBe('running');

      // 移出后消失
      fireEvent.mouseLeave(avatar);
      await waitFor(() => {
        expect(screen.queryByTestId('agent-avatar-popover')).toBeNull();
      });
    });

    it('反向断言：本屏组件无手写 position: fixed 坐标计算', () => {
      const busySource = fs.readFileSync(
        path.resolve(__dirname, '../../common/AgentBusyIndicator.tsx'),
        'utf8'
      );
      const metaSource = fs.readFileSync(
        path.resolve(__dirname, '../MetaAgentMode.tsx'),
        'utf8'
      );

      // 不许手写 getBoundingClientRect 算坐标
      expect(busySource).not.toMatch(/getBoundingClientRect\(\)\.(?:top|left|bottom|right)\s*[\+\-]/);
      expect(metaSource).not.toMatch(/getBoundingClientRect\(\)\.(?:top|left|bottom|right)\s*[\+\-]/);

      // 必须使用 @floating-ui/react
      expect(busySource).toContain("from '@floating-ui/react'");
      expect(busySource).toContain('useFloating');
    });
  });

  describe('绿④: 测试模式渲染为页头内 StatusBadge 警示档而非通栏横幅', () => {
    it('断言不再有通栏元素，且徽章位于 PageHeader 的 actions 内', async () => {
      invoke.mockImplementation((channel: string) => {
        if (channel === 'sessions:get') {
          return Promise.resolve({
            success: true,
            session: { id: 'meta-1', agentRole: 'meta-agent', isArchived: false },
          });
        }
        if (channel === 'app-settings:get') {
          return Promise.resolve(true); // 开启测试模式
        }
        return Promise.resolve({ success: true, sessions: [] });
      });

      render(
        <Provider store={store}>
          <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
        </Provider>
      );

      const badge = await screen.findByTestId('meta-agent-test-mode-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('测试模式：方案将自动批准');

      // 属于 StatusBadge 警示档 (waiting 状态)
      expect(badge.getAttribute('data-status')).toBe('waiting');

      // 反向断言：不再存在通栏全宽 bg-amber-500 样式条
      expect(badge.className).not.toContain('bg-amber-500');
      expect(badge.className).not.toContain('w-full');

      // 断言徽章在页头 actions 内
      const actions = screen.getByTestId('page-header-actions');
      expect(actions.contains(badge)).toBe(true);
    });
  });

  describe('绿⑤: 文件架关闭状态下常驻渲染约 40px 窄边与文件数，点击后展开', () => {
    it('文件架关闭状态下渲染出窄边与文件数，点击后展开', async () => {
      invoke.mockImplementation((channel: string) => {
        if (channel === 'sessions:get') {
          return Promise.resolve({
            success: true,
            session: { id: 'meta-1', agentRole: 'meta-agent', isArchived: false },
          });
        }
        if (channel === 'meta-agent:list-spawned-sessions') {
          return Promise.resolve({
            success: true,
            sessions: [
              makeSpawnedSession('completed', 'c-1', '工单1', ['src/app.ts', 'src/util.ts']),
              makeSpawnedSession('completed', 'c-2', '工单2', ['src/extra.ts']),
            ],
          });
        }
        return Promise.resolve({ success: true, sessions: [] });
      });

      render(
        <Provider store={store}>
          <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
        </Provider>
      );

      // 关闭状态下的常驻窄边存在
      const collapsedRail = await screen.findByTestId('file-preview-rail-collapsed');
      expect(collapsedRail).toBeTruthy();
      expect(collapsedRail.className).toContain('w-10'); // 40px

      // 文件总数显示 (3 个交付文件)
      const count = screen.getByTestId('file-preview-collapsed-count');
      expect(count.textContent).toBe('3');

      // 展开前大架子不存在
      expect(screen.queryByTestId('file-preview-rail')).toBeNull();

      // 点击窄边展开
      fireEvent.click(collapsedRail);

      // 大架子展开成功
      const fullRail = await screen.findByTestId('file-preview-rail');
      expect(fullRail).toBeTruthy();
    });
  });

  describe('绿⑥: 侧边栏底部分成两组且组间有分隔线，格子数量与图标完全未变', () => {
    it('分组结构、分隔线及反向断言格子与图标未变', () => {
      render(
        <Provider store={store}>
          <NavigationGutter
            contentMode="files"
            onContentModeChange={vi.fn()}
            onOpenSettings={vi.fn()}
            workspacePath="/test/workspace"
          />
        </Provider>
      );

      // 第一组 (工具组)
      const groupTools = screen.getByTestId('gutter-group-tools');
      expect(groupTools).toBeTruthy();
      expect(groupTools.contains(screen.getByTestId('ai-usage-indicator'))).toBe(true);
      expect(groupTools.contains(screen.getByTestId('gutter-skill-library-button'))).toBe(true);

      // 分隔线存在
      const divider = screen.getByTestId('gutter-bottom-divider');
      expect(divider).toBeTruthy();
      expect(divider.className).toContain('border-t');

      // 第二组 (个性化/用户组)
      const groupUser = screen.getByTestId('gutter-group-user');
      expect(groupUser).toBeTruthy();
      expect(groupUser.contains(screen.getByTestId('theme-toggle-button'))).toBe(true);
      expect(groupUser.contains(screen.getByTestId('gutter-feedback-button'))).toBe(true);
      expect(groupUser.contains(screen.getByTestId('gutter-user-button'))).toBe(true);

      // 反向断言：所有图标与格子数量未变 (技能库 school, 反馈 feedback, 用户 person)
      expect(screen.getByTestId('material-symbol-school')).toBeTruthy();
      expect(screen.getByTestId('material-symbol-feedback')).toBeTruthy();
      expect(screen.getByTestId('material-symbol-person')).toBeTruthy();
    });
  });

  describe('绿⑦: 本屏零违规（硬字号、硬颜色、表外圆角、半档间距四类），已全部进入 TARGET_FILES', () => {
    const targetFiles = [
      'components/MetaAgentMode/FilePreviewBody.tsx',
      'components/MetaAgentMode/FilePreviewRail.tsx',
      'components/MetaAgentMode/MetaAgentMode.tsx',
      'components/MetaAgentMode/filePreviewFormat.ts',
      'components/NavigationGutter/GutterContextMenu.tsx',
      'components/NavigationGutter/NavigationGutter.tsx',
      'components/NavigationGutter/UserMenuPopover.tsx',
      'components/NavigationGutter/index.ts',
    ];

    it('所有 8 个组件文件 100% 遵守设计令牌规范（0 违规）', () => {
      const rendererRoot = path.resolve(__dirname, '../../..');
      for (const rel of targetFiles) {
        const fullPath = path.join(rendererRoot, rel);
        expect(fs.existsSync(fullPath)).toBe(true);
        const content = fs.readFileSync(fullPath, 'utf8');
        const violations = scanFileViolations(content);

        expect(violations.pxFonts, `pxFonts in ${rel}`).toEqual([]);
        expect(violations.rawColors, `rawColors in ${rel}`).toEqual([]);
        expect(violations.nonStdRounded, `nonStdRounded in ${rel}`).toEqual([]);
        expect(violations.halfGap, `halfGap in ${rel}`).toEqual([]);
      }
    });

    it('8 个文件均已收录于 visualTokensGuard 的 TARGET_FILES 白名单', () => {
      const guardTestFile = path.resolve(__dirname, '../../../styles/__tests__/visualTokensGuard.test.ts');
      const guardContent = fs.readFileSync(guardTestFile, 'utf8');
      for (const rel of targetFiles) {
        expect(guardContent, `Must whitelist ${rel}`).toContain(`'${rel}'`);
      }
    });
  });

  describe('绿⑧: 既有行为零回归（派发、停止、文件预览、会话刷新行为未变）', () => {
    it('右上角「全部停下」按钮与 transcript 停止链路行为一致', async () => {
      render(
        <Provider store={store}>
          <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
        </Provider>
      );

      const stopButton = await screen.findByTestId('meta-agent-stop-all');
      expect(stopButton).toBeTruthy();
      expect(stopButton.textContent).toBe('全部停下');

      // 点击全部停下
      fireEvent.click(stopButton);

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('meta-agent:stop-and-clear', 'meta-1', '/workspace');
      });
    });

    it('点击 transcript 中的文件链接仍能正常调起文件预览', async () => {
      render(
        <Provider store={store}>
          <MetaAgentMode workspacePath="/workspace" sessionId="meta-1" />
        </Provider>
      );

      const fileLink = await screen.findByTestId('transcript-file-link');
      fireEvent.click(fileLink);

      // 文件预览被打开
      const previewRail = await screen.findByTestId('file-preview-rail');
      expect(previewRail).toBeTruthy();
      expect(screen.getByTestId('file-preview-path').textContent).toContain('report.sql');
    });
  });
});

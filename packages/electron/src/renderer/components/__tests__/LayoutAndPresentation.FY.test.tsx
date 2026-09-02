// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PageHeader } from '../common/PageHeader';
import { EmptyStateMessage } from '../common/EmptyStateMessage';
import { AgentBusyIndicator } from '../common/AgentBusyIndicator';
import { WorkOrderAttempts, formatAttemptsForClipboard } from '../TrackerMode/WorkOrderAttempts';
import { SkillLibraryPanel } from '../Settings/SkillLibraryPanel';
import { ChannelHealthPanel } from '../Settings/ChannelHealthPanel';
import { UsagePoolList } from '../UsageIndicator/UsagePoolList';
import { FilePreviewRail } from '../MetaAgentMode/FilePreviewRail';
import { KanbanBoard } from '../TrackerMode/KanbanBoard';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import * as clipboardModule from '@nimbalyst/runtime';

vi.mock('@nimbalyst/runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
      <span aria-label={icon} className={className} data-testid={`icon-${icon}`} />
    ),
    ProviderIcon: ({ provider }: { provider: string }) => (
      <span aria-label={provider} data-testid={`provider-icon-${provider}`} />
    ),
    copyToClipboard: vi.fn().mockResolvedValue(true),
  };
});

const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'dispatch-skills:list') return { skills: [] };
    if (channel === 'channel-health:get-snapshot') return { running: false, lastRun: null, results: [] };
    if (channel === 'app-settings:get') return undefined;
    return undefined;
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { invoke },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('施工单 FY — 展示与排版 (FB-164)', () => {
  describe('绿①: 统一页头模板 (PageHeader) 在各处结构一致，且无常驻机制解释', () => {
    it('PageHeader 渲染一致的 图标 + 标题 + 计数 + 右上主按钮 结构', () => {
      const { container } = render(
        <PageHeader
          icon="extension"
          title="技能库"
          count={12}
          actions={<button data-testid="test-action-btn">+ 新建</button>}
        />
      );

      expect(screen.getByTestId('page-header')).toBeTruthy();
      expect(screen.getByTestId('icon-extension')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('技能库');
      expect(screen.getByTestId('page-header-count').textContent).toBe('12');
      expect(screen.getByTestId('test-action-btn')).toBeTruthy();
    });

    it('技能库与通道体检均采用统一页头，且不包含常驻说明文案（反向断言）', async () => {
      render(<SkillLibraryPanel workspacePath="/workspace" />);

      expect(await screen.findByTestId('page-header')).toBeTruthy();
      expect(screen.getByText('技能库')).toBeTruthy();

      // 反向断言：常驻机制解释已彻底移除
      expect(screen.queryByText(/库级禁用后，该技能会从所有包移除/)).toBeNull();
      expect(screen.queryByText(/Child sessions created by this meta-agent/i)).toBeNull();
    });

    it('通道体检页头使用统一 PageHeader 并包含体检操作按钮', async () => {
      render(<ChannelHealthPanel workspacePath="/workspace" />);

      expect(await screen.findByTestId('page-header')).toBeTruthy();
      expect(screen.getByText('通道体检')).toBeTruthy();
      expect(screen.getByTestId('channel-health-run-all')).toBeTruthy();
      expect(screen.getByTestId('channel-health-run-deep')).toBeTruthy();
    });
  });

  describe('绿②: 看板卡片主次信息分层明确', () => {
    it('看板卡片标题限行最多两行 (line-clamp-2)，描述截断，底部一行收纳次要信息', () => {
      const dummyRecord: TrackerRecord = {
        id: 'rec-1',
        schemaVersion: '1.0.0',
        issueKey: 'PROJ-101',
        primaryType: 'task',
        typeTags: ['task', 'frontend'],
        system: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        fields: {
          title: '超长卡片标题用于验证在看板展示时最多渲染两行并且截断超出内容保证紧凑排版',
          description: '首行描述详细说明，次要信息收进单行截断展示，不与主标题抢占视觉层级。',
          status: 'in_progress',
          priority: 'high',
          assignee: 'worker-01',
        },
      } as any;

      const { container } = render(
        <KanbanBoard
          filterType="all"
          overrideItems={[dummyRecord]}
          selectedItemId={null}
          onItemSelect={() => {}}
        />
      );

      const card = screen.getByTestId('tracker-kanban-card');
      expect(card).toBeTruthy();

      // 标题包含 line-clamp-2
      const titleEl = card.querySelector('.line-clamp-2');
      expect(titleEl).toBeTruthy();
      expect(titleEl?.textContent).toContain('超长卡片标题');

      // 描述单行截断 truncate
      const descEl = card.querySelector('.truncate');
      expect(descEl).toBeTruthy();
      expect(descEl?.textContent).toContain('首行描述详细说明');

      // 底部一行
      const bottomRow = card.querySelector('.border-t');
      expect(bottomRow).toBeTruthy();
      expect(bottomRow?.textContent).toContain('task');
      expect(bottomRow?.textContent).toContain('frontend');
    });
  });

  describe('绿③: 五处空状态各渲染明确的"标题 + 下一步提示"两行结构', () => {
    it('1. 技能库无技能 / 搜索无结果时渲染两行空状态', async () => {
      render(<SkillLibraryPanel workspacePath="/workspace" />);

      // 无技能
      const emptyEl = await screen.findByTestId('skill-library-empty');
      expect(emptyEl).toBeTruthy();
      expect(screen.getByText('暂无可用技能')).toBeTruthy();
      expect(screen.getByText('请在工作区或全局添加技能文件（SKILL.md），刷新后即可在此启用。')).toBeTruthy();
    });

    it('2. 技能包为空时渲染两行空状态与新建入口', async () => {
      render(<SkillLibraryPanel workspacePath="/workspace" />);

      const bundleGuide = await screen.findByTestId('bundle-empty-guide');
      expect(bundleGuide).toBeTruthy();
      expect(screen.getByText('暂无技能包')).toBeTruthy();
      expect(screen.getByText('选中几个技能，存成一个包')).toBeTruthy();
    });

    it('3. 看板无卡片时渲染两行空状态', () => {
      // 3.1 看板全局为空
      const { rerender } = render(
        <KanbanBoard
          filterType="all"
          overrideItems={[]}
          selectedItemId={null}
          onItemSelect={() => {}}
        />
      );

      expect(screen.getByTestId('tracker-kanban-board-empty')).toBeTruthy();
      expect(screen.getByText('暂无看板卡片')).toBeTruthy();
      expect(screen.getByText('在工作区创建事项或等待任务派发，事项将在此处按状态流转。')).toBeTruthy();

      // 3.2 某一阶段列为空
      const dummyRecord: TrackerRecord = {
        id: 'rec-1',
        schemaVersion: '1.0.0',
        issueKey: 'PROJ-101',
        primaryType: 'task',
        typeTags: ['task'],
        system: { createdAt: Date.now(), updatedAt: Date.now() },
        fields: { title: '测试任务', status: 'to-do' },
      } as any;

      rerender(
        <KanbanBoard
          filterType="all"
          overrideItems={[dummyRecord]}
          selectedItemId={null}
          onItemSelect={() => {}}
        />
      );

      const colEmpty = screen.getAllByTestId('tracker-kanban-column-empty');
      expect(colEmpty.length).toBeGreaterThan(0);
      expect(screen.getAllByText('该阶段暂无卡片')[0]).toBeTruthy();
      expect(screen.getAllByText('可拖拽卡片至此列，或新建事项')[0]).toBeTruthy();
    });

    it('4. 产物架为空时渲染两行空状态', () => {
      render(
        <FilePreviewRail
          open={true}
          filePath={null}
          width={400}
          onWidthChange={() => {}}
          onOpen={() => {}}
          onClose={() => {}}
          shelfItems={[]}
          shelfLoading={false}
          onSelectShelfItem={() => {}}
          onShowShelf={() => {}}
        />
      );

      expect(screen.getByTestId('file-preview-shelf-empty')).toBeTruthy();
      expect(screen.getByText('暂无交付产物')).toBeTruthy();
      expect(screen.getByText('工人修改或交付文件后，将自动汇总在此处供快速预览与跳转。')).toBeTruthy();
    });

    it('5. 用量浮窗无数据时渲染两行空状态', () => {
      render(
        <UsagePoolList
          pools={{}}
          emptyMessage="暂无 Claude 额度数据"
          emptyActionHint="请确认已登录对应账号并点击右上角刷新，或发起会话后重试。"
        />
      );

      expect(screen.getByTestId('usage-pool-list-empty')).toBeTruthy();
      expect(screen.getByText('暂无 Claude 额度数据')).toBeTruthy();
      expect(screen.getByText('请确认已登录对应账号并点击右上角刷新，或发起会话后重试。')).toBeTruthy();
    });
  });

  describe('绿④: 全局忙碌度收敛为一句话 + 图标组，无常驻机制说明', () => {
    it('AgentBusyIndicator 渲染一句话与图标组，不出现常驻解释', () => {
      render(
        <AgentBusyIndicator
          runningCount={3}
          totalCount={5}
          queuedCount={1}
          activeSessions={[
            { id: 's1', title: 'Worker 1', provider: 'claude-code' },
            { id: 's2', title: 'Worker 2', provider: 'openai-codex' },
          ]}
        />
      );

      expect(screen.getByTestId('agent-busy-indicator')).toBeTruthy();
      expect(screen.getByTestId('agent-busy-text').textContent).toBe('3 agents working');
      expect(screen.getByTestId('agent-avatar-stack')).toBeTruthy();
      expect(screen.getByText('+1 queued')).toBeTruthy();

      // 反向断言
      expect(screen.queryByText(/Child sessions created by this meta-agent/i)).toBeNull();
    });

    it('空闲时渲染 0 agents working', () => {
      render(<AgentBusyIndicator runningCount={0} />);
      expect(screen.getByTestId('agent-busy-text').textContent).toBe('0 agents working');
    });
  });

  describe('绿⑤: 执行记录支持类型筛选与一键复制全部', () => {
    const fixtureFields = {
      attempts: [
        {
          attempt: 1,
          engine: 'claude-code',
          model: 'claude-3-7-sonnet',
          startedAt: '2026-08-01T10:00:00.000Z',
          endedAt: '2026-08-01T10:05:00.000Z',
          outcome: 'failure',
          failureReason: '上下文超限',
        },
        {
          attempt: 2,
          engine: 'openai-codex',
          model: 'gpt-5.4-mini',
          startedAt: '2026-08-01T10:10:00.000Z',
          endedAt: '2026-08-01T10:15:00.000Z',
          outcome: 'success',
          retryReason: '更换为 Codex 模型重试',
        },
      ],
    };

    it('支持按 成功 / 失败 状态进行筛选', () => {
      render(<WorkOrderAttempts fields={fixtureFields} />);

      // 初始：全部 2 条
      expect(screen.getAllByTestId('work-order-attempt')).toHaveLength(2);
      expect(screen.getByTestId('work-order-attempts-density-bar')).toBeTruthy();

      // 筛选失败
      fireEvent.click(screen.getByTestId('filter-failure'));
      expect(screen.getAllByTestId('work-order-attempt')).toHaveLength(1);
      expect(screen.getByText('第 1 次尝试')).toBeTruthy();
      expect(screen.queryByText('第 2 次尝试')).toBeNull();

      // 筛选成功
      fireEvent.click(screen.getByTestId('filter-success'));
      expect(screen.getAllByTestId('work-order-attempt')).toHaveLength(1);
      expect(screen.getByText('第 2 次尝试')).toBeTruthy();
      expect(screen.queryByText('第 1 次尝试')).toBeNull();

      // 切回全部
      fireEvent.click(screen.getByTestId('filter-all'));
      expect(screen.getAllByTestId('work-order-attempt')).toHaveLength(2);
    });

    it('点击「复制全部」可复制格式化后的执行日志并给予反馈', async () => {
      render(<WorkOrderAttempts fields={fixtureFields} />);

      const copyBtn = screen.getByTestId('work-order-attempts-copy-all');
      expect(copyBtn).toBeTruthy();

      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(clipboardModule.copyToClipboard).toHaveBeenCalledTimes(1);
      const copiedText = (clipboardModule.copyToClipboard as any).mock.calls[0][0];
      expect(copiedText).toContain('第 1 次尝试 [失败]');
      expect(copiedText).toContain('第 2 次尝试 [成功]');
      expect(copiedText).toContain('上下文超限');

      // 提示反馈
      expect(screen.getByText('已复制')).toBeTruthy();
    });
  });
});

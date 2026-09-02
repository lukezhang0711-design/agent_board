import React, { useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  PageHeader,
  EmptyStateMessage,
  AgentBusyIndicator,
  SettingsSection,
  ItemCard,
  StatusBadge,
  Toolbar,
} from '../common';

/**
 * ComponentShowcase - Developer Dashboard view displaying all seven shared UI components.
 *
 * Used for visual verification and chief reviewer / stakeholder acceptance.
 * Only accessible via Developer Dashboard (windowMode === 'developer-dashboard').
 */
export const ComponentShowcase: React.FC = () => {
  const [searchValue, setSearchValue] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');

  return (
    <div
      className="component-showcase flex flex-col gap-6 p-6 overflow-y-auto h-full bg-[var(--nim-bg)] text-[var(--nim-text)]"
      data-testid="component-showcase"
    >
      {/* Overview Header */}
      <div className="flex flex-col gap-1 pb-4 border-b border-[var(--nim-border)]">
        <h1 className="text-ui-headline font-bold m-0 tracking-tight text-[var(--nim-text)]">
          通用零件展示板 (Shared UI Components)
        </h1>
        <p className="text-ui-compact text-[var(--nim-text-muted)] m-0">
          全产品共用的 7 个通用展示零件全部状态一览。100% 基于 DESIGN.md 令牌，双主题自适应。
        </p>
      </div>

      {/* 1. StatusBadge (状态徽章) */}
      <section className="flex flex-col gap-3" data-testid="showcase-status-badge">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-subhead font-semibold m-0 text-[var(--nim-text)]">
            1. StatusBadge（状态徽章 - 五种固定状态）
          </h2>
        </div>
        <div className="flex items-center flex-wrap gap-3 p-4 rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          <StatusBadge status="running" />
          <StatusBadge status="waiting" />
          <StatusBadge status="completed" />
          <StatusBadge status="failed" />
          <StatusBadge status="idle" />
          <StatusBadge
            status="running"
            label="自定义在跑文案"
            icon={<MaterialSymbol icon="sync" size={12} className="animate-spin" />}
          />
        </div>
      </section>

      {/* 2. AgentBusyIndicator (全局忙碌度指示器) */}
      <section className="flex flex-col gap-3" data-testid="showcase-agent-busy">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-subhead font-semibold m-0 text-[var(--nim-text)]">
            2. AgentBusyIndicator（忙碌度指示器 - 0个/1个/多个）
          </h2>
        </div>
        <div className="flex items-center flex-wrap gap-4 p-4 rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          {/* 0 agents (idle) */}
          <div className="flex flex-col gap-1">
            <span className="text-ui-caption text-[var(--nim-text-muted)]">空闲态 (0 agents)</span>
            <AgentBusyIndicator runningCount={0} totalCount={0} />
          </div>

          {/* 1 agent working */}
          <div className="flex flex-col gap-1">
            <span className="text-ui-caption text-[var(--nim-text-muted)]">单代理执行 (1 agent)</span>
            <AgentBusyIndicator
              runningCount={1}
              totalCount={3}
              activeSessions={[{ id: 'w1', title: 'Worker-GA', provider: 'gemini' }]}
            />
          </div>

          {/* Multiple agents working + queued */}
          <div className="flex flex-col gap-1">
            <span className="text-ui-caption text-[var(--nim-text-muted)]">多代理并发 + 排队 (3 agents, 2 queued)</span>
            <AgentBusyIndicator
              runningCount={3}
              totalCount={8}
              queuedCount={2}
              activeSessions={[
                { id: 'w1', title: 'Worker 1', provider: 'claude-code' },
                { id: 'w2', title: 'Worker 2', provider: 'openai-codex' },
                { id: 'w3', title: 'Worker 3', provider: 'gemini' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* 3. PageHeader (统一页头模板) */}
      <section className="flex flex-col gap-3" data-testid="showcase-page-header">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-subhead font-semibold m-0 text-[var(--nim-text)]">
            3. PageHeader（统一页头模板）
          </h2>
        </div>
        <div className="flex flex-col gap-4 p-4 rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          {/* With count & actions */}
          <div className="flex flex-col gap-1">
            <span className="text-ui-caption text-[var(--nim-text-muted)]">有计数 + 有操作按钮</span>
            <PageHeader
              icon="extension"
              title="技能库"
              count={24}
              subtitle="工作区技能管理与配置"
              actions={
                <button
                  type="button"
                  className="px-3 py-2 rounded-ui-base bg-[var(--nim-primary)] text-[var(--nim-on-primary)] text-ui-compact font-medium"
                >
                  + 新建技能
                </button>
              }
            />
          </div>

          {/* Without count & without actions */}
          <div className="flex flex-col gap-1">
            <span className="text-ui-caption text-[var(--nim-text-muted)]">无计数 + 无操作按钮</span>
            <PageHeader
              icon="tune"
              title="偏好设置"
              subtitle="客户端基础行为与外观控制"
            />
          </div>
        </div>
      </section>

      {/* 4. Toolbar (工具条) */}
      <section className="flex flex-col gap-3" data-testid="showcase-toolbar">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-subhead font-semibold m-0 text-[var(--nim-text)]">
            4. Toolbar（工具条 - 搜索 + 筛选 + 排序固定间距）
          </h2>
        </div>
        <div className="p-4 rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          <Toolbar
            search={
              <div className="relative flex items-center w-full">
                <span className="absolute left-2.5 text-[var(--nim-text-muted)] flex items-center">
                  <MaterialSymbol icon="search" size={16} />
                </span>
                <input
                  type="text"
                  placeholder="搜索事项、技能或工单..."
                  value={searchValue}
                  onChange={e => setSearchValue(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 text-ui-compact rounded-ui-base border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] placeholder:text-[var(--nim-text-muted)] outline-none focus:border-[var(--nim-border-focus)]"
                />
              </div>
            }
            filters={
              <div className="flex items-center gap-1">
                {['all', 'active', 'closed'].map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSelectedFilter(f)}
                    className={`px-3 py-1 text-ui-caption rounded-ui-base border transition-colors ${
                      selectedFilter === f
                        ? 'bg-[var(--nim-bg-selected)] border-[var(--nim-primary)] text-[var(--nim-primary)] font-medium'
                        : 'border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]'
                    }`}
                  >
                    {f === 'all' ? '全部' : f === 'active' ? '进行中' : '已关闭'}
                  </button>
                ))}
              </div>
            }
            sort={
              <button
                type="button"
                className="flex items-center gap-1 px-3 py-1 text-ui-caption rounded-ui-base border border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]"
              >
                <MaterialSymbol icon="sort" size={14} />
                <span>更新时间</span>
              </button>
            }
            actions={
              <button
                type="button"
                className="flex items-center gap-1 px-3 py-1 text-ui-caption rounded-ui-base bg-[var(--nim-primary)] text-[var(--nim-on-primary)] font-medium"
              >
                <MaterialSymbol icon="refresh" size={14} />
                <span>刷新</span>
              </button>
            }
          />
        </div>
      </section>

      {/* 5. ItemCard (卡片) */}
      <section className="flex flex-col gap-3" data-testid="showcase-item-card">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-subhead font-semibold m-0 text-[var(--nim-text)]">
            5. ItemCard（卡片 - 固定四段层级与超长截断）
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          {/* Card 1: Single line title */}
          <ItemCard
            idNumber="PROJ-101"
            statusBadge={<StatusBadge status="running" />}
            title="优化渲染性能与帧率"
            description="针对长列表进行虚拟滚动重构以降低内存开销"
            assignee={
              <>
                <div className="w-4 h-4 rounded-ui-full bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-ui-micro">
                  <MaterialSymbol icon="person" size={12} />
                </div>
                <span>张工</span>
              </>
            }
            time="10分钟前"
          />

          {/* Card 2: Two-line title */}
          <ItemCard
            idNumber="PROJ-102"
            statusBadge={<StatusBadge status="waiting" />}
            title="方案待审批：针对多工作区事件总线的断线自动重连与健康探测机制"
            description="待主管确认探测频次与退避策略参数"
            assignee={
              <>
                <div className="w-4 h-4 rounded-ui-full bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-ui-micro">
                  <MaterialSymbol icon="person" size={12} />
                </div>
                <span>李工</span>
              </>
            }
            time="1小时前"
          />

          {/* Card 3: Super long title clamped to 2 lines, super long description clamped to 1 line */}
          <ItemCard
            idNumber="PROJ-103"
            statusBadge={<StatusBadge status="completed" />}
            title="这是一条极其漫长的事项标题旨在严格测试双行截断能力在任何窗口宽度下都绝不允许撑破卡片高度或者产生多余的行数溢出导致看板整体对齐破坏"
            description="这是一条超长的一句说明文案它包含了大量的背景原因与参数解释但是在卡片上必须被严格截断到单行显示以保障界面的沉静与紧凑节奏"
            assignee={
              <>
                <div className="w-4 h-4 rounded-ui-full bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-ui-micro">
                  <MaterialSymbol icon="person" size={12} />
                </div>
                <span>王工</span>
              </>
            }
            time="昨天"
          />

          {/* Card 4: Failed status card */}
          <ItemCard
            idNumber="PROJ-104"
            statusBadge={<StatusBadge status="failed" />}
            title="通道体检遇到鉴权超时"
            description="提供商密钥已过期或配额已耗尽，请检查控制台"
            assignee={
              <>
                <div className="w-4 h-4 rounded-ui-full bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-ui-micro">
                  <MaterialSymbol icon="smart_toy" size={12} />
                </div>
                <span>Worker-DE</span>
              </>
            }
            time="2天前"
          />
        </div>
      </section>

      {/* 6. SettingsSection (设置区块) */}
      <section className="flex flex-col gap-3" data-testid="showcase-settings-section">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-subhead font-semibold m-0 text-[var(--nim-text)]">
            6. SettingsSection（设置区块 - 小标题 + 说明 + 控件 + 分隔线）
          </h2>
        </div>
        <div className="p-4 rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          <SettingsSection
            title="代码生成与智能提示"
            description="控制代理在编写代码时所使用的推理引擎与补全策略。"
            hasDivider={true}
          >
            <div className="flex items-center justify-between p-2 rounded-ui-base bg-[var(--nim-bg)] border border-[var(--nim-border)]">
              <div className="flex flex-col">
                <span className="text-ui-body font-medium text-[var(--nim-text)]">启用行内上下文感知</span>
                <span className="text-ui-caption text-[var(--nim-text-muted)]">在键入时实时索引邻近文件定义</span>
              </div>
              <input type="checkbox" defaultChecked className="rounded-ui-base" />
            </div>
            <div className="flex items-center justify-between p-2 rounded-ui-base bg-[var(--nim-bg)] border border-[var(--nim-border)]">
              <div className="flex flex-col">
                <span className="text-ui-body font-medium text-[var(--nim-text)]">严格遵循设计令牌门禁</span>
                <span className="text-ui-caption text-[var(--nim-text-muted)]">保存时自动检查表外圆角与硬编码字号</span>
              </div>
              <input type="checkbox" defaultChecked className="rounded-ui-base" />
            </div>
          </SettingsSection>

          <SettingsSection
            title="网络与代理"
            description="配置全局 HTTP/SOCKS 代理与超时设置。"
            hasDivider={false}
          >
            <div className="flex items-center justify-between p-2 rounded-ui-base bg-[var(--nim-bg)] border border-[var(--nim-border)]">
              <div className="flex flex-col">
                <span className="text-ui-body font-medium text-[var(--nim-text)]">跟随系统网络代理设置</span>
                <span className="text-ui-caption text-[var(--nim-text-muted)]">自动继承系统 PAC 与环境变量配置</span>
              </div>
              <input type="checkbox" defaultChecked className="rounded-ui-base" />
            </div>
          </SettingsSection>
        </div>
      </section>

      {/* 7. EmptyStateMessage (两行空状态) */}
      <section className="flex flex-col gap-3" data-testid="showcase-empty-state">
        <div className="flex items-center gap-2">
          <h2 className="text-ui-subhead font-semibold m-0 text-[var(--nim-text)]">
            7. EmptyStateMessage（两行空状态 - 有按钮 / 无按钮）
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-ui-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          {/* With action button */}
          <EmptyStateMessage
            icon="inventory_2"
            title="暂无可用技能包"
            actionHint="在工作区添加技能文件后刷新即可在此启用。"
            action={
              <button
                type="button"
                className="px-3 py-2 rounded-ui-base bg-[var(--nim-primary)] text-[var(--nim-on-primary)] text-ui-compact font-medium"
              >
                + 添加首个技能
              </button>
            }
          />

          {/* Without action button */}
          <EmptyStateMessage
            icon="inbox"
            title="暂无待办事项"
            actionHint="当前看板阶段无流动卡片，创建事项或等待任务派发。"
          />
        </div>
      </section>
    </div>
  );
};

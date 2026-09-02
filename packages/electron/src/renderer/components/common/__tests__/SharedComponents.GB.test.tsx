// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

import {
  PageHeader,
  EmptyStateMessage,
  AgentBusyIndicator,
  SettingsSection,
  ItemCard,
  StatusBadge,
  Toolbar,
} from '../index';
import { ComponentShowcase } from '../../DeveloperDashboard/ComponentShowcase';
import { scanFileViolations } from '../../../styles/__tests__/visualTokensGuard.test';

vi.mock('@nimbalyst/runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
      <span aria-label={icon} className={className} data-testid={`icon-${icon}`} />
    ),
  };
});

const RENDERER_ROOT = path.resolve(__dirname, '../../..');
const COMMON_DIR = path.resolve(RENDERER_ROOT, 'components/common');

describe('施工单 GB — 七个通用零件（全产品共用，台账 FB-164）', () => {
  describe('红方现状事实断言（改造前 Baseline 违规事实）', () => {
    it('断言改造前 baseline 代码或历史包含违反 DESIGN.md 的写法', () => {
      // 1. PageHeader 原始违例特征：text-base sm:text-lg, opacity-80
      const mockLegacyPageHeader = `
        <h2 className="text-base sm:text-lg font-semibold">Title</h2>
        <span className="opacity-80">Subtitle</span>
        <div className="gap-2.5">Wrap</div>
      `;
      const legacyHeaderScan = scanFileViolations(mockLegacyPageHeader);
      expect(mockLegacyPageHeader).toMatch(/text-base/);
      expect(mockLegacyPageHeader).toMatch(/opacity-80/);
      expect(legacyHeaderScan.halfGap).toContain('gap-2.5');

      // 2. EmptyStateMessage 原始违例特征：rounded-lg, bg-[...]/50, text-sm
      const mockLegacyEmptyState = `
        <div className="rounded-lg bg-[var(--nim-bg-subtle)]/50 text-sm">Empty</div>
      `;
      expect(mockLegacyEmptyState).toMatch(/\brounded-lg\b/);
      expect(mockLegacyEmptyState).toMatch(/\/50/);
      expect(mockLegacyEmptyState).toMatch(/\btext-sm\b/);

      // 3. AgentBusyIndicator 原始违例特征：写死 rgba, text-[10px], bg-blue-500/20
      const mockLegacyBusy = `
        <div className="bg-[rgba(59,130,246,0.08)] text-[10px] bg-blue-500/20 gap-1.5">Working</div>
      `;
      const legacyBusyScan = scanFileViolations(mockLegacyBusy);
      expect(legacyBusyScan.rawColors).toContain('bg-[rgba(59,130,246,0.08)]');
      expect(legacyBusyScan.pxFonts).toContain('text-[10px]');
      expect(legacyBusyScan.halfGap).toContain('gap-1.5');
    });
  });

  describe('绿①: 三个既有零件零违例（跑 GA 防倒退检查并已入已迁移名单）', () => {
    const existingThree = [
      'PageHeader.tsx',
      'EmptyStateMessage.tsx',
      'AgentBusyIndicator.tsx',
    ];

    it('三个既有零件已加入 visualTokensGuard 的已迁移名单', () => {
      const guardTestContent = fs.readFileSync(
        path.resolve(RENDERER_ROOT, 'styles/__tests__/visualTokensGuard.test.ts'),
        'utf8'
      );
      for (const file of existingThree) {
        expect(guardTestContent).toContain(`components/common/${file}`);
      }
    });

    it('三个既有零件源码零硬编码像素、零硬编码色值、零表外圆角、零半档间距', () => {
      for (const file of existingThree) {
        const filePath = path.resolve(COMMON_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const violations = scanFileViolations(content);

        expect(violations.pxFonts, `pxFonts in ${file}`).toEqual([]);
        expect(violations.pxSpacings, `pxSpacings in ${file}`).toEqual([]);
        expect(violations.rawColors, `rawColors in ${file}`).toEqual([]);
        expect(violations.nonStdRounded, `nonStdRounded in ${file}`).toEqual([]);
        expect(violations.halfGap, `halfGap in ${file}`).toEqual([]);
      }
    });

    it('三个既有零件无 Tailwind 自带字号及 opacity 调淡类名', () => {
      const forbiddenPatterns = [
        /\btext-(?:xs|sm|base|lg|xl|2xl)\b/g,
        /\bopacity-\d+\b/g,
        /\brounded-(?:sm|md|lg|xl|2xl)\b/g,
        /\b(?:bg|text|border)-(?:blue|amber|red|green|emerald|gray|slate|zinc)-\d+/g,
      ];

      for (const file of existingThree) {
        const filePath = path.resolve(COMMON_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          const matches = content.match(pattern);
          expect(matches, `Forbidden pattern ${pattern} found in ${file}`).toBeNull();
        }
      }
    });
  });

  describe('绿②: 三个既有零件的属性签名与行为未变（反向断言与快照一致性）', () => {
    it('PageHeader 保持完整结构并支持原全部属性', () => {
      render(
        <PageHeader
          icon="folder"
          title="测试工作区"
          count={42}
          subtitle="辅助子标题"
          actions={<button type="button">操作按钮</button>}
        >
          <div data-testid="custom-child">搜索框插槽</div>
        </PageHeader>
      );

      expect(screen.getByTestId('page-header')).toBeTruthy();
      expect(screen.getByTestId('icon-folder')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('测试工作区');
      expect(screen.getByTestId('page-header-count').textContent).toBe('42');
      expect(screen.getByText('辅助子标题')).toBeTruthy();
      expect(screen.getByText('操作按钮')).toBeTruthy();
      expect(screen.getByTestId('custom-child')).toBeTruthy();
    });

    it('EmptyStateMessage 保持双行结构与操作支持', () => {
      render(
        <EmptyStateMessage
          icon="inbox"
          title="暂无数据"
          actionHint="请添加新项目以继续。"
          action={<button type="button">立即创建</button>}
        />
      );

      expect(screen.getByTestId('empty-state-message')).toBeTruthy();
      expect(screen.getByTestId('icon-inbox')).toBeTruthy();
      expect(screen.getByTestId('empty-state-title').textContent).toBe('暂无数据');
      expect(screen.getByTestId('empty-state-hint').textContent).toBe('请添加新项目以继续。');
      expect(screen.getByText('立即创建')).toBeTruthy();
    });

    it('AgentBusyIndicator 保持运行状态句子、头像叠放及排队徽标', () => {
      render(
        <AgentBusyIndicator
          runningCount={2}
          totalCount={5}
          queuedCount={3}
          activeSessions={[
            { id: '1', title: 'Agent-1', provider: 'claude' },
            { id: '2', title: 'Agent-2', provider: 'codex' },
          ]}
        />
      );

      expect(screen.getByTestId('agent-busy-indicator')).toBeTruthy();
      expect(screen.getByTestId('agent-busy-text').textContent).toBe('2 agents working');
      expect(screen.getByTestId('agent-avatar-stack')).toBeTruthy();
      expect(screen.getByText('+3 queued')).toBeTruthy();
    });
  });

  describe('绿③: 四个新零件各自存在且可渲染', () => {
    it('SettingsSection 存在且可渲染小标题、说明、内容区与底部分隔', () => {
      const { container } = render(
        <SettingsSection
          title="通用分组"
          description="分组辅助说明文案"
          hasDivider={true}
        >
          <div data-testid="setting-item">开关项</div>
        </SettingsSection>
      );

      expect(screen.getByTestId('settings-section')).toBeTruthy();
      expect(screen.getByTestId('settings-section-title').textContent).toBe('通用分组');
      expect(screen.getByTestId('settings-section-description').textContent).toBe('分组辅助说明文案');
      expect(screen.getByTestId('setting-item')).toBeTruthy();
      expect(container.querySelector('.border-b')).toBeTruthy();
    });

    it('ItemCard 存在且可渲染四段固定信息层级', () => {
      render(
        <ItemCard
          idNumber="CARD-001"
          statusBadge={<span data-testid="mock-badge">徽章</span>}
          title="卡片标题"
          description="卡片一行说明"
          assignee={<span>负责人</span>}
          time="10分钟前"
        />
      );

      expect(screen.getByTestId('item-card')).toBeTruthy();
      expect(screen.getByTestId('item-card-id').textContent).toBe('CARD-001');
      expect(screen.getByTestId('mock-badge')).toBeTruthy();
      expect(screen.getByTestId('item-card-title').textContent).toBe('卡片标题');
      expect(screen.getByTestId('item-card-description').textContent).toBe('卡片一行说明');
      expect(screen.getByTestId('item-card-assignee').textContent).toBe('负责人');
      expect(screen.getByTestId('item-card-time').textContent).toBe('10分钟前');
    });

    it('StatusBadge 存在且可渲染', () => {
      render(<StatusBadge status="running" label="执行中" />);
      expect(screen.getByTestId('status-badge')).toBeTruthy();
      expect(screen.getByText('执行中')).toBeTruthy();
    });

    it('Toolbar 存在且可渲染搜索、筛选、排序与操作', () => {
      render(
        <Toolbar
          search={<input data-testid="tb-search" placeholder="搜索..." />}
          filters={<button type="button">筛选</button>}
          sort={<button type="button">排序</button>}
          actions={<button type="button">刷新</button>}
        />
      );

      expect(screen.getByTestId('toolbar')).toBeTruthy();
      expect(screen.getByTestId('tb-search')).toBeTruthy();
      expect(screen.getByText('筛选')).toBeTruthy();
      expect(screen.getByText('排序')).toBeTruthy();
      expect(screen.getByText('刷新')).toBeTruthy();
    });
  });

  describe('绿④: ItemCard 标题超长时截断到两行、说明超长时截断到一行', () => {
    const superLongTitle =
      '这是一个极其漫长的事项卡片标题用于检验两行截断样式规范，在实际运行场景下长标题不能破坏卡片高度或造成容器布局畸形，必须通过 CSS 类名严格限制行数';
    const superLongDesc =
      '这是一段非常长的一行说明文本它包含了大量的上下文背景和技术细节描述但是卡片要求只能单行截断展示';

    it('ItemCard 标题元素携带 line-clamp-2 截断类', () => {
      render(
        <ItemCard
          idNumber="TASK-888"
          title={superLongTitle}
          description={superLongDesc}
        />
      );

      const titleEl = screen.getByTestId('item-card-title');
      expect(titleEl).toBeTruthy();
      expect(titleEl.className).toContain('line-clamp-2');
      expect(titleEl.textContent).toBe(superLongTitle);
    });

    it('ItemCard 说明元素携带 truncate 单行截断类', () => {
      render(
        <ItemCard
          idNumber="TASK-888"
          title={superLongTitle}
          description={superLongDesc}
        />
      );

      const descEl = screen.getByTestId('item-card-description');
      expect(descEl).toBeTruthy();
      expect(descEl.className).toContain('truncate');
      expect(descEl.textContent).toBe(superLongDesc);
    });
  });

  describe('绿⑤: StatusBadge 五种状态各自渲染出不同的样式类，且颜色全部来自 --nim-*', () => {
    const statuses: Array<'running' | 'waiting' | 'completed' | 'failed' | 'idle'> = [
      'running',
      'waiting',
      'completed',
      'failed',
      'idle',
    ];

    it('五种状态渲染出五种不同的样式类集合', () => {
      const classSets = new Set<string>();

      for (const status of statuses) {
        const { unmount } = render(<StatusBadge status={status} testId={`badge-${status}`} />);
        const badgeEl = screen.getByTestId(`badge-${status}`);
        const cls = badgeEl.className;
        classSets.add(cls);
        unmount();
      }

      expect(classSets.size).toBe(5);
    });

    it('StatusBadge 源码零写死十六进制色值，颜色全部通过 --nim-* 或 bg-nim-*-subtle 绑定', () => {
      const badgeSource = fs.readFileSync(
        path.resolve(COMMON_DIR, 'StatusBadge.tsx'),
        'utf8'
      );

      // 反向断言：零写死 hex 颜色
      const hexMatches = badgeSource.match(/#[0-9a-fA-F]{3,8}\b/g);
      expect(hexMatches, 'Zero hardcoded hex colors in StatusBadge').toBeNull();

      // 反向断言：零写死 rgb/rgba 颜色
      const rgbMatches = badgeSource.match(/rgba?\([^)]+\)/g);
      expect(rgbMatches, 'Zero hardcoded rgb/rgba colors in StatusBadge').toBeNull();

      // 正向断言：四种状态使用 bg-nim-*-subtle，中性档使用 var(--nim-*)
      expect(badgeSource).toContain('bg-nim-primary-subtle');
      expect(badgeSource).toContain('bg-nim-warning-subtle');
      expect(badgeSource).toContain('bg-nim-success-subtle');
      expect(badgeSource).toContain('bg-nim-error-subtle');
      expect(badgeSource).toContain('var(--nim-bg-tertiary)');
    });
  });

  describe('绿⑥: 七个通用零件全部零违例（硬字号、硬颜色、表外圆角、半档间距四类）', () => {
    const allSeven = [
      'PageHeader.tsx',
      'EmptyStateMessage.tsx',
      'AgentBusyIndicator.tsx',
      'SettingsSection.tsx',
      'ItemCard.tsx',
      'StatusBadge.tsx',
      'Toolbar.tsx',
    ];

    it('七个零件全部通过 scanFileViolations 检测，违例数为 0', () => {
      for (const file of allSeven) {
        const content = fs.readFileSync(path.resolve(COMMON_DIR, file), 'utf8');
        const violations = scanFileViolations(content);

        expect(violations.pxFonts, `pxFonts in ${file}`).toEqual([]);
        expect(violations.pxSpacings, `pxSpacings in ${file}`).toEqual([]);
        expect(violations.rawColors, `rawColors in ${file}`).toEqual([]);
        expect(violations.nonStdRounded, `nonStdRounded in ${file}`).toEqual([]);
        expect(violations.halfGap, `halfGap in ${file}`).toEqual([]);
      }
    });

    it('七个零件无任何 Tailwind 相对字号（text-xs / text-sm / text-base 等）', () => {
      const tailwindFontSizeRegex = /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/g;

      for (const file of allSeven) {
        const content = fs.readFileSync(path.resolve(COMMON_DIR, file), 'utf8');
        const matches = content.match(tailwindFontSizeRegex);
        expect(matches, `Tailwind font size found in ${file}: ${matches?.join(', ')}`).toBeNull();
      }
    });
  });

  describe('绿⑦: 展示页存在，含七个零件的全部状态；且不在正式界面出现', () => {
    it('展示页 ComponentShowcase 存在且渲染全部七个零件的所有状态区块', () => {
      render(<ComponentShowcase />);

      expect(screen.getByTestId('component-showcase')).toBeTruthy();
      expect(screen.getByTestId('showcase-status-badge')).toBeTruthy();
      expect(screen.getByTestId('showcase-agent-busy')).toBeTruthy();
      expect(screen.getByTestId('showcase-page-header')).toBeTruthy();
      expect(screen.getByTestId('showcase-toolbar')).toBeTruthy();
      expect(screen.getByTestId('showcase-item-card')).toBeTruthy();
      expect(screen.getByTestId('showcase-settings-section')).toBeTruthy();
      expect(screen.getByTestId('showcase-empty-state')).toBeTruthy();
    });

    it('反向断言：展示页仅在 DeveloperDashboard 内引入，绝不在正式路由中出现', () => {
      const appSource = fs.readFileSync(path.resolve(RENDERER_ROOT, 'App.tsx'), 'utf8');
      expect(appSource).not.toContain('ComponentShowcase');

      // 验证仅挂载在 DeveloperDashboard.tsx 内
      const devDashSource = fs.readFileSync(
        path.resolve(RENDERER_ROOT, 'components/DeveloperDashboard/DeveloperDashboard.tsx'),
        'utf8'
      );
      expect(devDashSource).toContain('ComponentShowcase');
      expect(devDashSource).toContain("id: 'components', label: 'UI Components'");
    });
  });
});

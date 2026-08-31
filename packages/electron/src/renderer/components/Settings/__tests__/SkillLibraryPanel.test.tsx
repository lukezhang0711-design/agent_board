// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DISPATCH_SKILL_SETTINGS_KEY,
  SKILL_CATEGORIES,
  type DispatchSkillSettings,
} from '../../../utils/dispatchSkillLibrary';
import * as dispatchSkillLibraryModule from '../../../utils/dispatchSkillLibrary';
import { SkillLibraryPanel } from '../SkillLibraryPanel';

const invoke = vi.fn();

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span aria-label={icon} />,
}));

const fixtureSkills = [
  {
    id: 'codex:user:implement',
    engine: 'codex' as const,
    name: 'implement',
    source: 'user' as const,
    scope: 'global' as const,
    category: '开发实现' as const,
    summaryZh: '依据 PRD 需求或 Issue 任务清单编写代码实现',
  },
  {
    id: 'codex:user:review',
    engine: 'codex' as const,
    name: 'review',
    source: 'user' as const,
    scope: 'global' as const,
    category: '质量保障' as const,
    summaryZh: '对比指定基准节点，对代码改动开展全面审查',
  },
];

function savedSettings(): DispatchSkillSettings[] {
  return invoke.mock.calls
    .filter(([channel, key]) => channel === 'app-settings:set' && key === DISPATCH_SKILL_SETTINGS_KEY)
    .map(([, , value]) => value as DispatchSkillSettings);
}

function bundleSkillCheckbox(skillName: string): HTMLInputElement {
  const labels = screen.getAllByText(skillName)
    .map((node) => node.closest('label'))
    .filter((label): label is HTMLLabelElement => Boolean(label));
  const bundleLabel = labels.find((label) => !label.textContent?.includes('启用'));
  const checkbox = bundleLabel?.querySelector('input[type="checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error(`Missing bundle checkbox for ${skillName}`);
  }
  return checkbox;
}

function libraryEnableCheckbox(skillName: string): HTMLInputElement {
  const labels = screen.getAllByText(skillName)
    .map((node) => node.closest('label'))
    .filter((label): label is HTMLLabelElement => Boolean(label));
  const libraryLabel = labels.find((label) => label.textContent?.includes('启用'));
  const checkbox = libraryLabel?.querySelector('input[type="checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error(`Missing library checkbox for ${skillName}`);
  }
  return checkbox;
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string, key?: string) => {
    if (channel === 'dispatch-skills:list') {
      return { skills: fixtureSkills };
    }
    if (channel === 'app-settings:get' && key === DISPATCH_SKILL_SETTINGS_KEY) {
      return undefined;
    }
    if (channel === 'app-settings:set') {
      return true;
    }
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

describe('SkillLibraryPanel', () => {
  it('绿②: 八类类名与施工单固定表逐字一致', () => {
    const expected = [
      '规划决策',
      '开发实现',
      '质量保障',
      '界面设计',
      '文档写作',
      '发布部署',
      '安全管控',
      '工具环境',
    ];
    expect(SKILL_CATEGORIES).toEqual(expected);
  });

  it('绿⑧: 前缀分组代码与测试已删除 (反向断言 groupSkillsByFamily 不存在)', () => {
    expect((dispatchSkillLibraryModule as any).groupSkillsByFamily).toBeUndefined();
  });

  it('绿⑤: 默认视图不渲染任何技能卡片，只渲染八个分类行 (卡片数为 0)', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByText('规划决策')).toBeTruthy();
    expect(screen.getByText('开发实现')).toBeTruthy();
    expect(screen.getByText('质量保障')).toBeTruthy();
    expect(screen.getByText('界面设计')).toBeTruthy();
    expect(screen.getByText('文档写作')).toBeTruthy();
    expect(screen.getByText('发布部署')).toBeTruthy();
    expect(screen.getByText('安全管控')).toBeTruthy();
    expect(screen.getByText('工具环境')).toBeTruthy();

    // In default collapsed view, zero skill cards are rendered
    expect(screen.queryByTestId('skill-card-implement')).toBeNull();
    expect(screen.queryByTestId('skill-card-review')).toBeNull();
  });

  it('绿⑥: 展开一类后只有该类卡片可见；再点另一类，前一类收起', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);

    await screen.findByText('开发实现');

    // Click '开发实现' row to expand
    fireEvent.click(screen.getByText('开发实现'));
    expect(await screen.findByTestId('skill-card-implement')).toBeTruthy();
    expect(screen.queryByTestId('skill-card-review')).toBeNull();

    // Click '质量保障' row -> '开发实现' collapses and '质量保障' expands
    fireEvent.click(screen.getByText('质量保障'));
    expect(await screen.findByTestId('skill-card-review')).toBeTruthy();
    expect(screen.queryByTestId('skill-card-implement')).toBeNull();

    // Click '质量保障' row again -> collapses
    fireEvent.click(screen.getByText('质量保障'));
    expect(screen.queryByTestId('skill-card-review')).toBeNull();
  });

  it('绿⑦: 搜索命中跨分类的技能 (包含未展开分类里的技能)', async () => {
    const multiCategorySkills = [
      {
        id: 'claude:user:browse',
        engine: 'claude' as const,
        name: 'browse',
        source: 'user' as const,
        scope: 'global' as const,
        category: '工具环境' as const,
        description: 'Fast headless browser for QA testing',
        summaryZh: '启动快速无头浏览器，用于页面测试与交互验证',
      },
      {
        id: 'claude:user:plan-ceo-review',
        engine: 'claude' as const,
        name: 'plan-ceo-review',
        source: 'user' as const,
        scope: 'global' as const,
        category: '规划决策' as const,
        description: 'CEO plan review mode',
        summaryZh: '以 CEO 视角重新审视业务目标与核心产品价值',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: multiCategorySkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);
    await screen.findByText('工具环境');

    // Initially collapsed
    expect(screen.queryByTestId('skill-card-browse')).toBeNull();

    // Search for 'browse'
    const searchInput = screen.getByPlaceholderText('搜索技能名称或说明...');
    fireEvent.change(searchInput, { target: { value: 'browse' } });

    // Directly visible in cross-category search results
    expect(await screen.findByTestId('skill-card-browse')).toBeTruthy();
    expect(screen.queryByTestId('skill-card-plan-ceo-review')).toBeNull();
  });

  it('绿④: 无说明的技能显示"这个技能没有自带说明"；生成失败的保留英文原文并有标记', async () => {
    const descriptiveSkills = [
      {
        id: 'gemini:config:no-desc-skill',
        engine: 'gemini' as const,
        name: 'no-desc-skill',
        source: 'config' as const,
        scope: 'config' as const,
        category: '工具环境' as const,
        summaryZh: '这个技能没有自带说明',
      },
      {
        id: 'claude:user:failed-gen-skill',
        engine: 'claude' as const,
        name: 'failed-gen-skill',
        source: 'user' as const,
        scope: 'global' as const,
        category: '工具环境' as const,
        description: 'Some complex English raw instructions',
        summaryZh: 'Some complex English raw instructions',
        enrichmentFailed: true,
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: descriptiveSkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);
    await screen.findByText('工具环境');

    // Click '工具环境' to expand
    fireEvent.click(screen.getByText('工具环境'));

    const noDescCard = await screen.findByTestId('skill-card-no-desc-skill');
    expect(noDescCard.textContent).toContain('这个技能没有自带说明');

    const failedCard = screen.getByTestId('skill-card-failed-gen-skill');
    expect(failedCard.textContent).toContain('[生成未成功]');
    expect(failedCard.textContent).toContain('Some complex English raw instructions');
  });

  it('绿⑨ / green FD-2: creates, renames, edits, disables, deletes, and persists skill bundles', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByText('施工包')).toBeTruthy();
    expect(screen.getByText('调研包')).toBeTruthy();
    expect(screen.getByText('文档包')).toBeTruthy();

    // Expand '开发实现' to see implement card
    fireEvent.click(screen.getByText('开发实现'));
    expect(await screen.findByTestId('skill-card-implement')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('新包名'), { target: { value: '自定义包' } });
    fireEvent.click(screen.getByText('新建'));

    await waitFor(() => {
      expect(savedSettings().at(-1)?.bundles.some((bundle) => bundle.name === '自定义包')).toBe(true);
    });

    fireEvent.change(screen.getByDisplayValue('自定义包'), { target: { value: '改名包' } });
    await waitFor(() => {
      expect(savedSettings().at(-1)?.bundles.some((bundle) => bundle.name === '改名包')).toBe(true);
    });

    fireEvent.click(bundleSkillCheckbox('implement'));
    await waitFor(() => {
      const customBundle = savedSettings().at(-1)?.bundles.find((bundle) => bundle.name === '改名包');
      expect(customBundle?.skillIds).toContain('codex:user:implement');
    });

    fireEvent.click(libraryEnableCheckbox('implement'));
    await waitFor(() => {
      const latest = savedSettings().at(-1);
      expect(latest?.disabledSkillIds).toContain('codex:user:implement');
      expect(latest?.bundles.flatMap((bundle) => bundle.skillIds)).not.toContain('codex:user:implement');
    });

    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => {
      expect(savedSettings().at(-1)?.bundles.some((bundle) => bundle.name === '改名包')).toBe(false);
    });
  });

  it('绿⑨ / GREEN ②: merges same-name skills across engines into one card with engine badges', async () => {
    const multiEngineSkills = [
      {
        id: 'claude:user:handoff',
        engine: 'claude' as const,
        name: 'handoff',
        source: 'user' as const,
        scope: 'global' as const,
        category: '文档写作' as const,
        description: 'Handoff to other agents',
        summaryZh: '压缩当前会话上下文，生成供下一位交接的文档',
        content: 'same-content',
      },
      {
        id: 'codex:user:handoff',
        engine: 'codex' as const,
        name: 'handoff',
        source: 'user' as const,
        scope: 'global' as const,
        category: '文档写作' as const,
        description: 'Handoff to other agents',
        summaryZh: '压缩当前会话上下文，生成供下一位交接的文档',
        content: 'same-content',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: multiEngineSkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);
    await screen.findByText('文档写作');

    fireEvent.click(screen.getByText('文档写作'));

    expect(await screen.findByTestId('skill-card-handoff')).toBeTruthy();
    expect(screen.getAllByTestId('skill-card-handoff')).toHaveLength(1);

    const card = screen.getByTestId('skill-card-handoff');
    expect(card.textContent).toContain('Claude ✓');
    expect(card.textContent).toContain('Codex ✓');
    expect(card.textContent).toContain('Gemini ✗');
  });

  it('绿⑨ / GREEN ③: compares file content across engines (same -> 内容一致, different -> 两家内容不一样)', async () => {
    const compareSkills = [
      {
        id: 'claude:user:grilling',
        engine: 'claude' as const,
        name: 'grilling',
        source: 'user' as const,
        scope: 'global' as const,
        category: '规划决策' as const,
        description: 'Grilling instructions',
        summaryZh: '高强度追问和压力测试方案中的漏洞与盲点',
        content: 'exact same prompt text',
      },
      {
        id: 'codex:user:grilling',
        engine: 'codex' as const,
        name: 'grilling',
        source: 'user' as const,
        scope: 'global' as const,
        category: '规划决策' as const,
        description: 'Grilling instructions',
        summaryZh: '高强度追问和压力测试方案中的漏洞与盲点',
        content: 'exact same prompt text',
      },
      {
        id: 'claude:user:deep-planning',
        engine: 'claude' as const,
        name: 'deep-planning',
        source: 'user' as const,
        scope: 'global' as const,
        category: '规划决策' as const,
        description: 'Claude deep planning prompt',
        summaryZh: '需要深度思考与方案权衡时，制定详尽架构规划',
        content: 'Claude version content',
      },
      {
        id: 'codex:user:deep-planning',
        engine: 'codex' as const,
        name: 'deep-planning',
        source: 'user' as const,
        scope: 'global' as const,
        category: '规划决策' as const,
        description: 'Codex deep planning prompt',
        summaryZh: '需要深度思考与方案权衡时，制定详尽架构规划',
        content: 'Codex different version content',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: compareSkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);
    await screen.findByText('规划决策');

    fireEvent.click(screen.getByText('规划决策'));

    const grillingCard = await screen.findByTestId('skill-card-grilling');
    expect(grillingCard.textContent).toContain('内容一致');
    expect(grillingCard.textContent).not.toContain('两家内容不一样');

    const deepPlanningCard = screen.getByTestId('skill-card-deep-planning');
    expect(deepPlanningCard.textContent).toContain('两家内容不一样');
    expect(deepPlanningCard.textContent).not.toContain('内容一致');
  });

  it('绿⑨ / GREEN ⑥: displays total skills and token ledger numbers, and surfaces CODEX_SKILL_CONTROL_NOTICE', async () => {
    const skills = [
      {
        id: 'codex:user:implement',
        engine: 'codex' as const,
        name: 'implement',
        source: 'user' as const,
        scope: 'global' as const,
        category: '开发实现' as const,
        description: 'Implement functionality',
        summaryZh: '依据 PRD 需求或 Issue 任务清单编写代码实现',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByText(/1 个技能 · 约 \d+ token/)).toBeTruthy();
    expect(screen.getByText(/Codex：技能管控只能会话级禁用、无逐次审批。/)).toBeTruthy();
  });

  it('绿⑨ / GREEN ⑦: surfaces scanning errors faithfully when scanner fails instead of silently showing empty', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') {
        return {
          success: false,
          skills: [],
          errors: ['配置 JSON 解析失败 (~/.gemini/settings.json): Unexpected token in JSON at position 12'],
        };
      }
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByText(/配置 JSON 解析失败 \(~\/\.gemini\/settings\.json\): Unexpected token/)).toBeTruthy();
  });
});


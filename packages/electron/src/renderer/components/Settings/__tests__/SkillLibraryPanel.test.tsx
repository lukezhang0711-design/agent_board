// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DISPATCH_SKILL_SETTINGS_KEY,
  SKILL_CATEGORIES,
  readDispatchSkillSettings,
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

function libraryEnableCheckbox(skillName: string): HTMLInputElement {
  const card = screen.getByTestId(`skill-card-${skillName}`);
  const enableLabel = Array.from(card.querySelectorAll('label')).find((l) => l.textContent?.includes('启用'));
  const checkbox = enableLabel?.querySelector('input[type="checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error(`Missing library enable checkbox for ${skillName}`);
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
  it('绿①: 清空后读取，bundles 为空数组；反向断言 DEFAULT_DISPATCH_SKILL_BUNDLES 不存在', () => {
    expect((dispatchSkillLibraryModule as any).DEFAULT_DISPATCH_SKILL_BUNDLES).toBeUndefined();
    expect(readDispatchSkillSettings(undefined)).toEqual({ disabledSkillIds: [], bundles: [] });
    expect(readDispatchSkillSettings({})).toEqual({ disabledSkillIds: [], bundles: [] });
  });

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

  it('绿①: 设置存在自定义分类时按数据渲染，不再读取八类常量', async () => {
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'dispatch-skills:list') return { skills: fixtureSkills };
      if (channel === 'app-settings:get' && key === DISPATCH_SKILL_SETTINGS_KEY) {
        return {
          disabledSkillIds: [],
          bundles: [],
          taxonomy: {
            categories: ['老板自定义'],
            skills: {
              implement: { category: '老板自定义', summaryZh: '按需求完成实现' },
              review: { category: '老板自定义', summaryZh: '检查代码改动' },
            },
          },
        };
      }
      return true;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);
    expect(await screen.findByText('老板自定义')).toBeTruthy();
    expect(screen.queryByText('开发实现')).toBeNull();
  });

  it('绿①: 没有分类设置时，仍按八个出厂默认分类渲染', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByText('开发实现')).toBeTruthy();
    expect(screen.getByText('工具环境')).toBeTruthy();
  });

  it('绿②: 收到批准后的设置广播后立即按新分类重排，不重新读取页面', async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        invoke,
        on: (channel: string, listener: (...args: any[]) => void) => {
          listeners.set(channel, listener);
          return () => listeners.delete(channel);
        },
      },
    });
    render(<SkillLibraryPanel workspacePath="/workspace" />);
    expect(await screen.findByText('开发实现')).toBeTruthy();

    act(() => {
      listeners.get('dispatch-skill-library:changed')?.({
        settings: {
          disabledSkillIds: [],
          bundles: [],
          taxonomy: {
            categories: ['批准后的分类'],
            skills: {
              implement: { category: '批准后的分类', summaryZh: '实现需求' },
              review: { category: '批准后的分类', summaryZh: '检查改动' },
            },
          },
        },
      });
    });

    expect(await screen.findByText('批准后的分类')).toBeTruthy();
    expect(screen.queryByText('开发实现')).toBeNull();
  });

  it('绿②: 包为空时显示引导与新建入口，且不渲染任何包标签', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByTestId('bundle-empty-guide')).toBeTruthy();
    expect(screen.getByText('选中几个技能，存成一个包')).toBeTruthy();
    expect(screen.getByTestId('create-bundle-btn')).toBeTruthy();
    expect(screen.queryByTestId('bundle-tags-list')).toBeNull();
  });

  it('绿③: 新建、改名、删除、勾选技能四项在新交互下均可用', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);

    // 1. 新建包
    expect(await screen.findByTestId('create-bundle-btn')).toBeTruthy();
    fireEvent.click(screen.getByTestId('create-bundle-btn'));

    await waitFor(() => {
      expect(savedSettings().at(-1)?.bundles.some((bundle) => bundle.name.includes('新技能包'))).toBe(true);
    });

    // 2. 改名
    const renameInput = screen.getByTestId('bundle-rename-input');
    fireEvent.change(renameInput, { target: { value: '我的工作包' } });
    fireEvent.click(screen.getByTestId('bundle-rename-save-btn'));

    await waitFor(() => {
      expect(savedSettings().at(-1)?.bundles.some((bundle) => bundle.name === '我的工作包')).toBe(true);
    });

    // 3. 勾选技能进包 (展开分类并勾选卡片上的复选框)
    fireEvent.click(screen.getByText('开发实现'));
    const skillCheckbox = await screen.findByTestId('bundle-skill-checkbox-implement');
    expect(skillCheckbox).toBeTruthy();
    fireEvent.click(skillCheckbox);

    await waitFor(() => {
      const currentBundle = savedSettings().at(-1)?.bundles.find((b) => b.name === '我的工作包');
      expect(currentBundle?.skillIds).toContain('codex:user:implement');
    });

    // 4. 删除包
    fireEvent.click(screen.getByTestId('bundle-delete-btn'));
    await waitFor(() => {
      expect(savedSettings().at(-1)?.bundles.some((bundle) => bundle.name === '我的工作包')).toBe(false);
    });
  });

  it('绿④: 改名入口是笔形图标，默认不渲染输入框，点击后才出现', async () => {
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'dispatch-skills:list') return { skills: fixtureSkills };
      if (channel === 'app-settings:get' && key === DISPATCH_SKILL_SETTINGS_KEY) {
        return { disabledSkillIds: [], bundles: [{ id: 'b1', name: '已有包', skillIds: [] }] };
      }
      return true;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    // Click bundle tag to enter editing mode
    const tag = await screen.findByTestId('bundle-tag-b1');
    fireEvent.click(tag);

    expect(await screen.findByTestId('bundle-editing-bar')).toBeTruthy();
    // Default: rename input does not exist, pencil icon exists
    expect(screen.queryByTestId('bundle-rename-input')).toBeNull();
    expect(screen.getByTestId('bundle-rename-btn')).toBeTruthy();

    // Click pencil icon -> input appears
    fireEvent.click(screen.getByTestId('bundle-rename-btn'));
    expect(screen.getByTestId('bundle-rename-input')).toBeTruthy();
  });

  it('绿⑤: 编辑态下卡片墙仍分类折叠、仍可搜索；每个分类行显示已选 N；页面上只存在一份技能列表', async () => {
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'dispatch-skills:list') return { skills: fixtureSkills };
      if (channel === 'app-settings:get' && key === DISPATCH_SKILL_SETTINGS_KEY) {
        return { disabledSkillIds: [], bundles: [{ id: 'b1', name: '全能包', skillIds: ['codex:user:implement'] }] };
      }
      return true;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    const tag = await screen.findByTestId('bundle-tag-b1');
    fireEvent.click(tag);

    expect(await screen.findByTestId('bundle-editing-bar')).toBeTruthy();
    // Category row shows '已选 1' for 开发实现 and '已选 0' for other categories
    expect(screen.getByText('开发实现')).toBeTruthy();
    expect(screen.getByText('已选 1')).toBeTruthy();
    expect(screen.getAllByText('已选 0').length).toBe(7);

    // Cards are initially collapsed
    expect(screen.queryByTestId('skill-card-implement')).toBeNull();

    // Expand category
    fireEvent.click(screen.getByText('开发实现'));
    const implementCard = await screen.findByTestId('skill-card-implement');
    expect(implementCard).toBeTruthy();
    expect(screen.getByTestId('bundle-skill-checkbox-implement')).toBeTruthy();

    // Check search still works in editing mode
    const searchInput = screen.getByPlaceholderText('搜索技能名称或说明...');
    fireEvent.change(searchInput, { target: { value: 'review' } });
    expect(await screen.findByTestId('skill-card-review')).toBeTruthy();
    expect(screen.queryByTestId('skill-card-implement')).toBeNull();

    // Assert there are no duplicate flat checkbox lists
    expect(screen.queryAllByTestId(/^skill-card-/).length).toBe(1);
  });

  it('绿⑥: 编辑态有常驻横条且能退出 (点击完成或再次点击标签)', async () => {
    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'dispatch-skills:list') return { skills: fixtureSkills };
      if (channel === 'app-settings:get' && key === DISPATCH_SKILL_SETTINGS_KEY) {
        return { disabledSkillIds: [], bundles: [{ id: 'b1', name: '包A', skillIds: [] }] };
      }
      return true;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    const tag = await screen.findByTestId('bundle-tag-b1');
    fireEvent.click(tag);

    // Enters editing mode
    expect(await screen.findByTestId('bundle-editing-bar')).toBeTruthy();

    // Click finish button -> exits editing mode
    fireEvent.click(screen.getByTestId('bundle-finish-btn'));
    expect(screen.queryByTestId('bundle-editing-bar')).toBeNull();

    // Click tag again -> enters editing mode
    fireEvent.click(screen.getByTestId('bundle-tag-b1'));
    expect(await screen.findByTestId('bundle-editing-bar')).toBeTruthy();

    // Click same tag again -> exits editing mode
    fireEvent.click(screen.getByTestId('bundle-tag-b1'));
    expect(screen.queryByTestId('bundle-editing-bar')).toBeNull();
  });

  it('绿⑦: 搜索结果可一键存成包，新包内容等于当时的结果集', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);
    await screen.findByText('规划决策');

    const searchInput = screen.getByPlaceholderText('搜索技能名称或说明...');
    fireEvent.change(searchInput, { target: { value: 'implement' } });

    expect(await screen.findByTestId('save-search-to-bundle-btn')).toBeTruthy();
    fireEvent.click(screen.getByTestId('save-search-to-bundle-btn'));

    await waitFor(() => {
      const lastBundle = savedSettings().at(-1)?.bundles.at(-1);
      expect(lastBundle?.name).toBe('implement包');
      expect(lastBundle?.skillIds).toContain('codex:user:implement');
      expect(lastBundle?.skillIds).not.toContain('codex:user:review');
    });
  });

  it('绿⑨: 未生成出中文的技能 enrichmentFailed === true 且界面标出"未翻译" (不许静默显示英文)', async () => {
    const untranslatedSkills = [
      {
        id: 'claude:user:untranslated-skill',
        engine: 'claude' as const,
        name: 'untranslated-skill',
        source: 'user' as const,
        scope: 'global' as const,
        category: '工具环境' as const,
        description: 'Raw untranslated English description',
        summaryZh: 'Raw untranslated English description',
        enrichmentFailed: true,
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: untranslatedSkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);
    await screen.findByText('工具环境');

    fireEvent.click(screen.getByText('工具环境'));

    const card = await screen.findByTestId('skill-card-untranslated-skill');
    expect(card.textContent).toContain('[未翻译]');
    expect(card.textContent).toContain('Raw untranslated English description');
  });

  it('绿⑩: 既有行为零回归 (库级启停、同名合并、内容比对、Codex 提示、扫描报错)', async () => {
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

    // Codex notice exists
    expect(screen.getByText(/Codex：技能管控只能会话级禁用、无逐次审批。/)).toBeTruthy();

    // Default collapsed
    expect(screen.queryByTestId('skill-card-handoff')).toBeNull();

    // Expand
    fireEvent.click(screen.getByText('文档写作'));
    const card = await screen.findByTestId('skill-card-handoff');
    expect(card.textContent).toContain('Claude ✓');
    expect(card.textContent).toContain('Codex ✓');
    expect(card.textContent).toContain('Gemini ✗');
    expect(card.textContent).toContain('内容一致');

    // Disable skill at library level
    fireEvent.click(libraryEnableCheckbox('handoff'));
    await waitFor(() => {
      const last = savedSettings().at(-1);
      expect(last?.disabledSkillIds).toContain('claude:user:handoff');
      expect(last?.disabledSkillIds).toContain('codex:user:handoff');
    });
  });

  it('绿⑩: 补充覆盖卡片展开/收起、两家内容不一样、无说明文案、扫描报错', async () => {
    const mixedSkills = [
      {
        id: 'claude:user:diff-skill',
        engine: 'claude' as const,
        name: 'diff-skill',
        source: 'user' as const,
        scope: 'global' as const,
        category: '规划决策' as const,
        description: 'Claude prompt version with long text',
        summaryZh: '规划决策说明',
        content: 'content A',
      },
      {
        id: 'codex:user:diff-skill',
        engine: 'codex' as const,
        name: 'diff-skill',
        source: 'user' as const,
        scope: 'global' as const,
        category: '规划决策' as const,
        description: 'Codex prompt version with different text',
        summaryZh: '规划决策说明',
        content: 'content B',
      },
      {
        id: 'gemini:config:no-desc',
        engine: 'gemini' as const,
        name: 'no-desc',
        source: 'config' as const,
        scope: 'config' as const,
        category: '工具环境' as const,
        summaryZh: '这个技能没有自带说明',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') {
        return {
          skills: mixedSkills,
          errors: ['扫描报错示例: /path/to/invalid/skill'],
        };
      }
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    // Scan error displayed
    expect(await screen.findByText(/扫描报错示例: \/path\/to\/invalid\/skill/)).toBeTruthy();

    // Expand 规划决策
    fireEvent.click(screen.getByText('规划决策'));
    const diffCard = await screen.findByTestId('skill-card-diff-skill');
    expect(diffCard.textContent).toContain('两家内容不一样');

    // Expand description
    expect(screen.queryByText('Claude prompt version with long text')).toBeNull();
    fireEvent.click(screen.getByText('展开说明'));
    expect(screen.getByText(/Claude prompt version with long text/)).toBeTruthy();
    fireEvent.click(screen.getByText('收起说明'));
    expect(screen.queryByText('Claude prompt version with long text')).toBeNull();

    // Expand 工具环境 to check no description notice
    fireEvent.click(screen.getByText('工具环境'));
    const noDescCard = await screen.findByTestId('skill-card-no-desc');
    expect(noDescCard.textContent).toContain('这个技能没有自带说明');
  });
});

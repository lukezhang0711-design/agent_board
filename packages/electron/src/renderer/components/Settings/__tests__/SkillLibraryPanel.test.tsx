// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DISPATCH_SKILL_SETTINGS_KEY, type DispatchSkillSettings } from '../../../utils/dispatchSkillLibrary';
import { SkillLibraryPanel } from '../SkillLibraryPanel';

const invoke = vi.fn();

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span aria-label={icon} />,
}));

const fixtureSkills = [
  {
    id: 'codex:user:implement',
    engine: 'codex',
    name: 'implement',
    source: '/Users/test/.codex/skills/implement/SKILL.md',
    scope: 'global',
  },
  {
    id: 'codex:user:review',
    engine: 'codex',
    name: 'review',
    source: '/Users/test/.codex/skills/review/SKILL.md',
    scope: 'global',
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
  it('green FD-2: creates, renames, edits, disables, deletes, and persists skill bundles', async () => {
    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByText('施工包')).toBeTruthy();
    expect(screen.getByText('调研包')).toBeTruthy();
    expect(screen.getByText('文档包')).toBeTruthy();
    expect(screen.getAllByText('implement').length).toBeGreaterThan(0);
    expect(screen.getAllByText('review').length).toBeGreaterThan(0);

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

  it('GREEN ②: merges same-name skills across engines into one card with engine badges', async () => {
    const multiEngineSkills = [
      {
        id: 'claude:user:handoff',
        engine: 'claude' as const,
        name: 'handoff',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Handoff to other agents',
        content: 'same-content',
      },
      {
        id: 'codex:user:handoff',
        engine: 'codex' as const,
        name: 'handoff',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Handoff to other agents',
        content: 'same-content',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: multiEngineSkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByTestId('skill-card-handoff')).toBeTruthy();
    expect(screen.getAllByTestId('skill-card-handoff')).toHaveLength(1);

    const card = screen.getByTestId('skill-card-handoff');
    expect(card.textContent).toContain('Claude ✓');
    expect(card.textContent).toContain('Codex ✓');
    expect(card.textContent).toContain('Gemini ✗');
  });

  it('GREEN ③: compares file content across engines (same -> 内容一致, different -> 两家内容不一样)', async () => {
    const compareSkills = [
      {
        id: 'claude:user:grilling',
        engine: 'claude' as const,
        name: 'grilling',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Grilling instructions',
        content: 'exact same prompt text',
      },
      {
        id: 'codex:user:grilling',
        engine: 'codex' as const,
        name: 'grilling',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Grilling instructions',
        content: 'exact same prompt text',
      },
      {
        id: 'claude:user:deep-planning',
        engine: 'claude' as const,
        name: 'deep-planning',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Claude deep planning prompt',
        content: 'Claude version content',
      },
      {
        id: 'codex:user:deep-planning',
        engine: 'codex' as const,
        name: 'deep-planning',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Codex deep planning prompt',
        content: 'Codex different version content',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: compareSkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    const grillingCard = await screen.findByTestId('skill-card-grilling');
    expect(grillingCard.textContent).toContain('内容一致');
    expect(grillingCard.textContent).not.toContain('两家内容不一样');

    const deepPlanningCard = screen.getByTestId('skill-card-deep-planning');
    expect(deepPlanningCard.textContent).toContain('两家内容不一样');
    expect(deepPlanningCard.textContent).not.toContain('内容一致');
  });

  it('GREEN ④: displays description, estimated tokens, sources/bundles, and handles missing description faithfully', async () => {
    const descriptiveSkills = [
      {
        id: 'claude:user:design-review',
        engine: 'claude' as const,
        name: 'design-review',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Review interface design and UX patterns.',
        content: 'Review interface design and UX patterns.',
      },
      {
        id: 'gemini:config:gemini-custom',
        engine: 'gemini' as const,
        name: 'gemini-custom',
        source: 'config' as const,
        scope: 'config' as const,
      },
    ];

    invoke.mockImplementation(async (channel: string, key?: string) => {
      if (channel === 'dispatch-skills:list') return { skills: descriptiveSkills };
      if (channel === 'app-settings:get' && key === DISPATCH_SKILL_SETTINGS_KEY) {
        return {
          disabledSkillIds: [],
          bundles: [{ id: 'b1', name: '施工包', skillIds: ['claude:user:design-review'] }],
        };
      }
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    const designCard = await screen.findByTestId('skill-card-design-review');
    expect(designCard.textContent).toContain('Review interface design and UX patterns.');
    expect(designCard.textContent).toContain('token (估算)');
    expect(designCard.textContent).toContain('在「施工包」中');

    const geminiCard = screen.getByTestId('skill-card-gemini-custom');
    expect(geminiCard.textContent).toContain('这个技能没有自带说明');
  });

  it('GREEN ⑤: filters skills via search box and groups same-root skills by family', async () => {
    const familySkills = [
      {
        id: 'claude:user:grill-me',
        engine: 'claude' as const,
        name: 'grill-me',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Grill me on the requirements',
      },
      {
        id: 'claude:user:grilling',
        engine: 'claude' as const,
        name: 'grilling',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Grilling execution skill',
      },
      {
        id: 'claude:user:design-review',
        engine: 'claude' as const,
        name: 'design-review',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Review interface design',
      },
      {
        id: 'claude:user:design-shotgun',
        engine: 'claude' as const,
        name: 'design-shotgun',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Rapid design exploration',
      },
      {
        id: 'claude:user:standalone-skill',
        engine: 'claude' as const,
        name: 'standalone-skill',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Single isolated skill',
      },
    ];

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') return { skills: familySkills };
      return undefined;
    });

    render(<SkillLibraryPanel workspacePath="/workspace" />);

    expect(await screen.findByText('grill 家族')).toBeTruthy();
    expect(screen.getByText('design 家族')).toBeTruthy();

    const searchInput = screen.getByPlaceholderText('搜索技能名称或说明...');
    fireEvent.change(searchInput, { target: { value: 'shotgun' } });

    expect(screen.getByTestId('skill-card-design-shotgun')).toBeTruthy();
    expect(screen.queryByTestId('skill-card-grill-me')).toBeNull();
  });

  it('GREEN ⑥: displays total skills and token ledger numbers, and surfaces CODEX_SKILL_CONTROL_NOTICE', async () => {
    const skills = [
      {
        id: 'codex:user:implement',
        engine: 'codex' as const,
        name: 'implement',
        source: 'user' as const,
        scope: 'global' as const,
        description: 'Implement functionality',
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

  it('GREEN ⑦: surfaces scanning errors faithfully when scanner fails instead of silently showing empty', async () => {
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

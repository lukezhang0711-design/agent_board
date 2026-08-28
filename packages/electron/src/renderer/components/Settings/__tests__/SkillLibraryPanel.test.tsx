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
});

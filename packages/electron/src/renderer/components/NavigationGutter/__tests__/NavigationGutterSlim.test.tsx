// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NavigationGutter } from '../NavigationGutter';
import {
  syncConfigAtom,
} from '../../../store/atoms/appSettings';
import { projectStateAtom, defaultProjectState } from '../../../store/atoms/projectState';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
    <span data-testid={`material-symbol-${icon}`} className={className}>
      {icon}
    </span>
  ),
}));

vi.mock('../../help', () => ({
  HelpTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../UserMenuPopover', () => ({
  UserMenuPopover: () => <div data-testid="user-menu-popover" />,
}));

vi.mock('../GutterContextMenu', () => ({
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
  TrustIndicator: ({ workspacePath }: { workspacePath: string | null }) => {
    // Mirrors TrustIndicator's internal check: only renders if workspacePath and permissionMode is non-default
    const mode = (window as unknown as { __mockPermissionMode?: string }).__mockPermissionMode;
    if (!workspacePath || !mode || mode === 'ask') return null;
    return <div data-testid="trust-indicator-rendered">{mode}</div>;
  },
}));

describe('NavigationGutter Slimming (施工单 FJ)', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(projectStateAtom, { ...defaultProjectState, hiddenGutterButtons: [] });
    (window as unknown as { __mockPermissionMode?: string }).__mockPermissionMode = undefined;
    window.electronAPI = {
      invoke: vi.fn().mockResolvedValue({}),
      openExternal: vi.fn(),
    } as unknown as typeof window.electronAPI;
  });

  it('GREEN ①: renders exactly ONE consolidated AI usage indicator, not three separate ones', () => {
    render(
      <Provider store={store}>
        <NavigationGutter
          contentMode="files"
          onContentModeChange={vi.fn()}
          onOpenSettings={vi.fn()}
          workspacePath="/test/workspace"
        />
      </Provider>,
    );

    // Consolidated indicator is present
    expect(screen.getByTestId('ai-usage-indicator')).toBeTruthy();

    // The old 3 separate indicators are NOT present
    expect(screen.queryByTestId('claude-usage-indicator')).toBeNull();
    expect(screen.queryByTestId('codex-usage-indicator')).toBeNull();
    expect(screen.queryByTestId('gemini-usage-indicator')).toBeNull();
  });

  it('GREEN ⑤: Cloud sync icon is NOT rendered when sync is unconfigured (enabled: false or serverUrl: "")', () => {
    store.set(syncConfigAtom, {
      enabled: false,
      serverUrl: '',
      enabledProjects: [],
      idleTimeoutMinutes: 5,
    });

    render(
      <Provider store={store}>
        <NavigationGutter
          contentMode="files"
          onContentModeChange={vi.fn()}
          onOpenSettings={vi.fn()}
          workspacePath="/test/workspace"
        />
      </Provider>,
    );

    expect(screen.queryByTestId('sync-status-button')).toBeNull();
  });

  it('GREEN ⑤: Cloud sync icon IS rendered when sync is configured with serverUrl and project enabled', () => {
    store.set(syncConfigAtom, {
      enabled: true,
      serverUrl: 'https://sync.nimbalyst.com',
      enabledProjects: ['/test/workspace'],
      idleTimeoutMinutes: 5,
    });

    render(
      <Provider store={store}>
        <NavigationGutter
          contentMode="files"
          onContentModeChange={vi.fn()}
          onOpenSettings={vi.fn()}
          workspacePath="/test/workspace"
        />
      </Provider>,
    );

    expect(screen.getByTestId('sync-status-button')).toBeTruthy();
  });

  it('GREEN ⑥: Permission indicator is NOT rendered in default "ask" mode', () => {
    (window as unknown as { __mockPermissionMode?: string }).__mockPermissionMode = 'ask';

    render(
      <Provider store={store}>
        <NavigationGutter
          contentMode="files"
          onContentModeChange={vi.fn()}
          onOpenSettings={vi.fn()}
          workspacePath="/test/workspace"
        />
      </Provider>,
    );

    expect(screen.queryByTestId('trust-indicator-rendered')).toBeNull();
  });

  it('GREEN ⑥: Permission indicator IS rendered in non-default mode (e.g. bypass-all / allow-all)', () => {
    (window as unknown as { __mockPermissionMode?: string }).__mockPermissionMode = 'bypass-all';

    render(
      <Provider store={store}>
        <NavigationGutter
          contentMode="files"
          onContentModeChange={vi.fn()}
          onOpenSettings={vi.fn()}
          workspacePath="/test/workspace"
        />
      </Provider>,
    );

    expect(screen.getByTestId('trust-indicator-rendered')).toBeTruthy();
    expect(screen.getByText('bypass-all')).toBeTruthy();
  });

  it('GREEN ①: Skill library entry button is rendered with school icon and navigates to skill-library settings on click', () => {
    const onNavigateSettings = vi.fn();
    render(
      <Provider store={store}>
        <NavigationGutter
          contentMode="files"
          onContentModeChange={vi.fn()}
          onOpenSettings={vi.fn()}
          onNavigateSettings={onNavigateSettings}
          workspacePath="/test/workspace"
        />
      </Provider>,
    );

    const button = screen.getByTestId('gutter-skill-library-button');
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('技能库');
    expect(screen.getByTestId('material-symbol-school')).toBeTruthy();

    button.click();
    expect(onNavigateSettings).toHaveBeenCalledWith('user', 'skill-library');
  });
});

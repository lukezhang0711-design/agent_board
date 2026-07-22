// @vitest-environment jsdom

import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
import { claudeUsageAtom } from '../../../store/atoms/claudeUsageAtoms';
import { claudeAuthStateAtom } from '../../../store/atoms/claudeAuthAtoms';
import { ClaudeUsagePopover } from '../ClaudeUsagePopover';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => <span />,
}));

vi.mock('../../../hooks/useSetting', () => ({
  useSetSetting: () => vi.fn(),
}));

vi.mock('../../../hooks/useFloatingMenu', () => ({
  FloatingPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFloatingMenu: () => ({
    refs: { setReference: vi.fn(), setFloating: vi.fn() },
    floatingStyles: {},
    getFloatingProps: () => ({}),
  }),
}));

vi.mock('../../UsageIndicator/UsagePoolList', () => ({
  UsagePoolList: () => <div />,
  formatUsageLastUpdated: () => 'just now',
}));

describe('ClaudeUsagePopover authentication context', () => {
  it('keeps a Usage authorization refusal distinct when CLI auth is logged in', () => {
    const store = createStore();
    store.set(claudeUsageAtom, {
      provider: 'claude-code',
      pools: {},
      lastUpdated: null,
      error: 'Usage authorization failed. Claude Code is logged in, but the quota API rejected the current credentials.',
    });
    store.set(claudeAuthStateAtom, {
      status: 'logged-in',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
    });

    render(
      <Provider store={store}>
        <ClaudeUsagePopover anchorRef={createRef<HTMLElement>()} onClose={vi.fn()} onRefresh={vi.fn()} />
      </Provider>,
    );

    expect(screen.getByText(/Usage authorization failed/)).toBeDefined();
    expect(screen.getByText('Claude is signed in, but the Usage API rejected quota authorization.')).toBeDefined();
    expect(screen.queryByText(/Sign in again/)).toBeNull();
  });
});

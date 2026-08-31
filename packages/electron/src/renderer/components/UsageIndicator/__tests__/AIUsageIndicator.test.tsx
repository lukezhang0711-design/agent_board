// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AIUsageIndicator } from '../AIUsageIndicator';
import { claudeUsageAtom } from '../../../store/atoms/claudeUsageAtoms';
import { codexUsageAtom } from '../../../store/atoms/codexUsageAtoms';
import { geminiUsageAtom } from '../../../store/atoms/geminiUsageAtoms';
import type { ClaudeUsageData, CodexUsageData } from '../../../../shared/usage';
import type { GeminiUsageData } from '../../../store/atoms/geminiUsageAtoms';

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

vi.mock('../../hooks/useFloatingMenu', () => ({
  useFloatingMenu: () => ({
    refs: { setReference: vi.fn(), setFloating: vi.fn() },
    floatingStyles: {},
    getFloatingProps: () => ({}),
  }),
  FloatingPortal: ({ children }: { children: React.ReactNode }) => <div data-testid="floating-portal">{children}</div>,
}));

vi.mock('../../../store/listeners/claudeUsageListeners', () => ({
  refreshClaudeUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../store/listeners/codexUsageListeners', () => ({
  refreshCodexUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../store/listeners/geminiUsageListeners', () => ({
  refreshGeminiUsage: vi.fn().mockResolvedValue(undefined),
}));

describe('AIUsageIndicator & AIUsagePopover', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    window.electronAPI = {
      openExternal: vi.fn(),
      invoke: vi.fn(),
    } as unknown as typeof window.electronAPI;
  });

  it('GREEN ①: renders a single usage entrance with speed icon and opens a unified 3-engine popover', () => {
    const { container } = render(
      <Provider store={store}>
        <AIUsageIndicator />
      </Provider>,
    );

    const button = screen.getByTestId('ai-usage-indicator');
    expect(button).toBeTruthy();
    expect(screen.getByTestId('material-symbol-speed')).toBeTruthy();

    // Popover is closed initially
    expect(screen.queryByTestId('ai-usage-popover')).toBeNull();

    // Click opens the unified popover
    fireEvent.click(button);

    expect(screen.getByTestId('ai-usage-popover')).toBeTruthy();
    expect(screen.getByTestId('ai-usage-section-claude')).toBeTruthy();
    expect(screen.getByTestId('ai-usage-section-codex')).toBeTruthy();
    expect(screen.getByTestId('ai-usage-section-gemini')).toBeTruthy();
  });

  it('GREEN ②: window names and counts faithfully reflect engine return values', () => {
    // Claude fixture: 2 windows ("5-hour", "Weekly")
    const mockClaudeUsage: ClaudeUsageData = {
      provider: 'claude-code',
      lastUpdated: Date.now(),
      pools: {
        'claude-code:five_hour': {
          key: 'claude-code:five_hour',
          provider: 'claude-code',
          limitId: 'five_hour',
          name: '5-hour',
          utilization: 42,
          resetsAt: '2026-08-31T18:00:00Z',
          windowMinutes: 300,
          updatedAt: Date.now(),
          stale: false,
        },
        'claude-code:seven_day': {
          key: 'claude-code:seven_day',
          provider: 'claude-code',
          limitId: 'seven_day',
          name: 'Weekly',
          utilization: 15,
          resetsAt: '2026-09-07T00:00:00Z',
          windowMinutes: 10080,
          updatedAt: Date.now(),
          stale: false,
        },
      },
    };

    // Codex fixture: 1 window ("primary")
    const mockCodexUsage: CodexUsageData = {
      provider: 'openai-codex',
      lastUpdated: Date.now(),
      pools: {
        'openai-codex:primary': {
          key: 'openai-codex:primary',
          provider: 'openai-codex',
          limitId: 'primary',
          name: 'primary',
          utilization: 75,
          resetsAt: null,
          windowMinutes: 300,
          updatedAt: Date.now(),
          stale: false,
        },
      },
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: 250,
      },
    };

    store.set(claudeUsageAtom, mockClaudeUsage);
    store.set(codexUsageAtom, mockCodexUsage);

    render(
      <Provider store={store}>
        <AIUsageIndicator />
      </Provider>,
    );

    fireEvent.click(screen.getByTestId('ai-usage-indicator'));

    // Assert Claude's 2 exact window names are rendered
    expect(screen.getByText('5-hour')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('Weekly')).toBeTruthy();
    expect(screen.getByText('15%')).toBeTruthy();

    // Assert Codex's 1 exact window name is rendered
    expect(screen.getByText('primary')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('250 remaining')).toBeTruthy();
  });

  it('GREEN ② (empty state): displays honest empty text when engines return 0 windows', () => {
    store.set(claudeUsageAtom, {
      provider: 'claude-code',
      pools: {},
      lastUpdated: Date.now(),
    });
    store.set(codexUsageAtom, {
      provider: 'openai-codex',
      pools: {},
      lastUpdated: Date.now(),
    });

    render(
      <Provider store={store}>
        <AIUsageIndicator />
      </Provider>,
    );

    fireEvent.click(screen.getByTestId('ai-usage-indicator'));

    expect(screen.getByText('No Claude quota pools returned by the Usage API.')).toBeTruthy();
    expect(screen.getByText('No Codex quota pools found in recent session data.')).toBeTruthy();
  });

  it('GREEN ③: reverse assertion - NO warning badge, red dot, or warning colors on the indicator button', () => {
    // Set high utilization on all engines
    store.set(claudeUsageAtom, {
      provider: 'claude-code',
      lastUpdated: Date.now(),
      pools: {
        'claude-code:five_hour': {
          key: 'claude-code:five_hour',
          provider: 'claude-code',
          limitId: 'five_hour',
          name: '5-hour',
          utilization: 99,
          resetsAt: null,
          windowMinutes: 300,
          updatedAt: Date.now(),
          stale: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <AIUsageIndicator />
      </Provider>,
    );

    const button = screen.getByTestId('ai-usage-indicator');

    // Button should be neutral (no warning badge / dot)
    expect(button.querySelector('.badge')).toBeNull();
    expect(button.querySelector('.dot')).toBeNull();
    expect(button.className).not.toContain('bg-red');
    expect(button.className).not.toContain('text-red');
    expect(button.className).not.toContain('warning');
    expect(button.className).not.toContain('error');
  });

  it('GREEN ④: Gemini dual-branch - Branch A (desktop quota readable with 2 groups)', () => {
    const mockGeminiUsage: GeminiUsageData = {
      fiveHour: { utilization: 20, resetsAt: null },
      sevenDay: { utilization: 10, resetsAt: null },
      limitsAvailable: true,
      available: true,
      lastUpdated: Date.now(),
      groups: [
        {
          groupName: 'Gemini Models',
          models: [
            {
              model: 'gemini-2.5-flash',
              label: 'Gemini 2.5 Flash',
              utilization: 25,
              resetsAt: '2026-08-31T20:00:00Z',
            },
            {
              model: 'gemini-2.5-pro',
              label: 'Gemini 2.5 Pro',
              utilization: 60,
              resetsAt: '2026-08-31T22:00:00Z',
            },
          ],
        },
        {
          groupName: 'Claude & GPT Models',
          models: [
            {
              model: 'claude-3-5-sonnet',
              label: 'Claude 3.5 Sonnet',
              utilization: 85,
              resetsAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      ],
    };

    store.set(geminiUsageAtom, mockGeminiUsage);

    render(
      <Provider store={store}>
        <AIUsageIndicator />
      </Provider>,
    );

    fireEvent.click(screen.getByTestId('ai-usage-indicator'));

    expect(screen.getByTestId('gemini-desktop-quota')).toBeTruthy();
    expect(screen.getByText('Gemini Models')).toBeTruthy();
    expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('Gemini 2.5 Pro')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();

    expect(screen.getByText('Claude & GPT Models')).toBeTruthy();
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeTruthy();
    expect(screen.getByText('85%')).toBeTruthy();
  });

  it('GREEN ④: Gemini dual-branch - Branch B (desktop unavailable -> token fallback without progress bars)', () => {
    const mockGeminiUsage: GeminiUsageData = {
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: { utilization: 0, resetsAt: null },
      limitsAvailable: false,
      available: false,
      lastUpdated: Date.now(),
      error: 'Antigravity 桌面版未运行。请先打开 Antigravity 并确认已登录，然后重新打开用量浮窗。',
      tokenUsage: {
        totalTokens: 64210,
        lastTokens: 1200,
      },
    };

    store.set(geminiUsageAtom, mockGeminiUsage);

    render(
      <Provider store={store}>
        <AIUsageIndicator />
      </Provider>,
    );

    fireEvent.click(screen.getByTestId('ai-usage-indicator'));

    const fallbackSection = screen.getByTestId('gemini-token-fallback');
    expect(fallbackSection).toBeTruthy();
    expect(screen.getByText('64,210')).toBeTruthy();
    expect(screen.getByText('（本次会话累计消耗，非剩余额度）')).toBeTruthy();
    expect(screen.getByText('原因：Antigravity 桌面版未运行。请先打开 Antigravity 并确认已登录，然后重新打开用量浮窗。')).toBeTruthy();

    // Visual distinction: NO progress bar inside the fallback section
    expect(fallbackSection.querySelectorAll('.rounded-full').length).toBe(0);
    expect(screen.queryByTestId('gemini-desktop-quota')).toBeNull();
  });
});

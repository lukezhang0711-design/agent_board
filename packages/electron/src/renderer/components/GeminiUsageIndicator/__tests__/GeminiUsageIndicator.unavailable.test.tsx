// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
import { geminiUsageAtom } from '../../../store/atoms/geminiUsageAtoms';
import { GeminiUsageIndicator } from '../GeminiUsageIndicator';

vi.mock('../../../hooks/useSetting', () => ({
  useSetting: () => true,
}));

vi.mock('../../../store/listeners/geminiUsageListeners', () => ({
  refreshGeminiUsage: vi.fn(),
}));

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => <span />,
}));

vi.mock('../GeminiUsagePopover', () => ({
  GeminiUsagePopover: () => null,
}));

describe('GeminiUsageIndicator unavailable state', () => {
  it('GREEN FF-138: shows -- and the official no-usage-source tooltip for Antigravity', () => {
    const store = createStore();
    store.set(geminiUsageAtom, {
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: { utilization: 0, resetsAt: null },
      limitsAvailable: false,
      available: false,
      lastUpdated: 1,
      error: 'Antigravity 未提供用量查询',
    });

    render(
      <Provider store={store}>
        <GeminiUsageIndicator />
      </Provider>,
    );

    const indicator = screen.getByTestId('gemini-usage-indicator');
    expect(indicator.textContent).toBe('--');
    expect(indicator.getAttribute('title')).toBe('Antigravity 未提供用量查询');
  });
});

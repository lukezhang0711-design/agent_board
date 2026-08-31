// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OverviewDashboard } from '../OverviewDashboard';
import { HistoricalGraph } from '../HistoricalGraph';
import { ModelComparison } from '../ModelComparison';

vi.mock('recharts', async () => {
  const React = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    React.createElement('div', null, children)
  );
  const series = (kind: string) => ({ dataKey }: { dataKey?: string }) => (
    React.createElement('span', { 'data-testid': `${kind}-${dataKey}` }, dataKey)
  );
  return {
    ResponsiveContainer: passthrough,
    LineChart: passthrough,
    BarChart: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
    CartesianGrid: passthrough,
    Tooltip: passthrough,
    Legend: passthrough,
    Line: series('line'),
    Bar: series('bar'),
  };
});

const reportedOverall = {
  totalInputTokens: 100,
  totalOutputTokens: 20,
  totalTokens: 120,
  sessionCount: 1,
  messageCount: 0,
  totalCacheReadInputTokens: 80,
  totalCacheCreationInputTokens: 10,
  cacheHitRate: 80 / 190,
  cacheDataIncomplete: false,
};

const reportedProvider = {
  provider: 'claude',
  model: 'claude-sonnet-4',
  sessionCount: 1,
  totalInputTokens: 100,
  totalOutputTokens: 20,
  totalTokens: 120,
  totalCacheReadInputTokens: 80,
  totalCacheCreationInputTokens: 10,
  cacheHitRate: 80 / 190,
  cacheDataIncomplete: false,
  averageFirstResponseMs: 120,
  averageTotalDurationMs: 420,
  turnCount: 1,
};

function installApi(overrides: { overall?: unknown; providers?: unknown[]; series?: unknown[] } = {}) {
  (window as any).electronAPI = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'usage-analytics:get-overall-stats') return overrides.overall ?? reportedOverall;
      if (channel === 'usage-analytics:get-usage-by-provider') return overrides.providers ?? [reportedProvider];
      if (channel === 'usage-analytics:get-all-session-count') return 1;
      if (channel === 'usage-analytics:get-time-series') {
        return overrides.series ?? [{
          timestamp: Date.UTC(2026, 5, 3),
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          sessionCount: 1,
          cacheReadInputTokens: 80,
          cacheCreationInputTokens: 10,
          cacheHitRate: 80 / 190,
          cacheDataIncomplete: false,
        }];
      }
      throw new Error(`Unexpected IPC channel: ${channel}`);
    }),
  };
}

describe('AI usage cache breakdown', () => {
  beforeEach(() => {
    installApi();
  });

  afterEach(() => {
    cleanup();
    delete (window as any).electronAPI;
  });

  it('renders normal input, cache read, cache creation, and the cache hit rate', async () => {
    render(<OverviewDashboard />);

    expect((await screen.findByTestId('normal-input-tokens')).textContent).toContain('100');
    expect(screen.getByTestId('cache-read-input-tokens').textContent).toContain('80');
    expect(screen.getByTestId('cache-creation-input-tokens').textContent).toContain('10');
    expect(screen.getByTestId('cache-hit-rate').textContent).toContain('42.1%');
  });

  it('keeps unreported cache data blank and explains that it is not zero', async () => {
    installApi({
      overall: {
        ...reportedOverall,
        totalCacheReadInputTokens: null,
        totalCacheCreationInputTokens: null,
        cacheHitRate: null,
        cacheDataIncomplete: true,
      },
      providers: [{
        ...reportedProvider,
        totalCacheReadInputTokens: null,
        totalCacheCreationInputTokens: null,
        cacheHitRate: null,
        cacheDataIncomplete: true,
      }],
    });
    render(<OverviewDashboard />);

    expect((await screen.findByTestId('cache-read-input-tokens')).textContent).toBe('—');
    expect(screen.getByTestId('cache-creation-input-tokens').textContent).toBe('—');
    expect(screen.getByTestId('cache-hit-rate').textContent).toBe('—');
    expect(screen.getByTestId('cache-data-note').textContent).toContain('did not report');
    expect(screen.getByTestId('cache-data-note').textContent).not.toContain('0');
  });

  it('keeps the historical and model charts on the three-way input split', async () => {
    const { unmount } = render(<HistoricalGraph />);
    await screen.findByTestId('line-Normal Input');
    expect(screen.getByTestId('line-Cache Read')).toBeTruthy();
    expect(screen.getByTestId('line-Cache Creation')).toBeTruthy();
    expect(screen.getByTestId('line-Output')).toBeTruthy();
    unmount();

    render(<ModelComparison />);
    await screen.findByTestId('bar-Normal Input');
    expect(screen.getByTestId('bar-Cache Read')).toBeTruthy();
    expect(screen.getByTestId('bar-Cache Creation')).toBeTruthy();
    expect(screen.getByTestId('bar-Output')).toBeTruthy();
  });
});

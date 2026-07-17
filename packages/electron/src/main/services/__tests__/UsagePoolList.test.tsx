// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UsagePoolList } from '../../../renderer/components/UsageIndicator/UsagePoolList';
import type { UsagePoolMap } from '../../../shared/usage';

vi.mock('@nimbalyst/runtime', () => ({ MaterialSymbol: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UsagePoolList', () => {
  it('renders every provider pool as its own row with exact values and stale timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T06:01:00.000Z'));
    const pools: UsagePoolMap = {
      'openai-codex:codex': {
        key: 'openai-codex:codex',
        provider: 'openai-codex',
        limitId: 'codex',
        name: 'codex',
        utilization: 63,
        resetsAt: '2026-07-17T10:00:00.000Z',
        windowMinutes: 300,
        updatedAt: Date.parse('2026-07-17T06:00:00.000Z'),
        stale: true,
      },
      'openai-codex:codex_bengalfox': {
        key: 'openai-codex:codex_bengalfox',
        provider: 'openai-codex',
        limitId: 'codex_bengalfox',
        name: 'codex_bengalfox',
        utilization: 0,
        resetsAt: null,
        windowMinutes: 10_080,
        updatedAt: Date.parse('2026-07-17T06:01:00.000Z'),
        stale: false,
      },
    };

    const { container } = render(<UsagePoolList pools={pools} emptyMessage="No pools" />);

    expect(container.querySelectorAll('.usage-pool-row')).toHaveLength(2);
    expect(screen.getByText('63%')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('Stale · Last updated 1 minute ago')).toBeTruthy();
    expect(screen.getByText('Reset time unavailable')).toBeTruthy();
  });

  it('shows the missing-data message without inventing a zero percentage', () => {
    render(<UsagePoolList pools={{}} emptyMessage="No quota pools available" />);

    expect(screen.getByText('No quota pools available')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../ClaudeAuthStateService', () => ({
  claudeAuthStateService: {
    getState: vi.fn(),
  },
}));

import { mapClaudeUsageResponse } from '../ClaudeUsageService';

describe('ClaudeUsageService pool mapping', () => {
  it('maps the reliable five_hour, seven_day, and seven_day_opus fields into independent pools', () => {
    const updatedAt = Date.parse('2026-07-17T06:00:00.000Z');

    const usage = mapClaudeUsageResponse({
      five_hour: {
        utilization: 12,
        resets_at: '2026-07-17T10:00:00.000Z',
      },
      seven_day: {
        utilization: 34,
        resets_at: '2026-07-24T06:00:00.000Z',
      },
      seven_day_opus: {
        utilization: 56,
        resets_at: '2026-07-24T06:00:00.000Z',
      },
    }, updatedAt);

    expect(Object.keys(usage.pools).sort()).toEqual([
      'claude-code:five_hour',
      'claude-code:seven_day',
      'claude-code:seven_day_opus',
    ]);
    expect(usage.pools['claude-code:five_hour']).toMatchObject({
      provider: 'claude-code',
      limitId: 'five_hour',
      name: '5-hour',
      utilization: 12,
      resetsAt: '2026-07-17T10:00:00.000Z',
      windowMinutes: 300,
      updatedAt,
      stale: false,
    });
    expect(usage.pools['claude-code:seven_day'].utilization).toBe(34);
    expect(usage.pools['claude-code:seven_day_opus'].utilization).toBe(56);
  });

  it('keeps a real zero but does not invent a zero pool for a missing utilization field', () => {
    const usage = mapClaudeUsageResponse({
      five_hour: {
        resets_at: '2026-07-17T10:00:00.000Z',
      },
      seven_day: {
        utilization: 0,
        resets_at: '2026-07-24T06:00:00.000Z',
      },
    }, Date.parse('2026-07-17T06:00:00.000Z'));

    expect(usage.pools['claude-code:five_hour']).toBeUndefined();
    expect(usage.pools['claude-code:seven_day'].utilization).toBe(0);
  });
});

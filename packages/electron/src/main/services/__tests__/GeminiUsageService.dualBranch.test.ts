import { describe, expect, it, vi, beforeEach } from 'vitest';
import { windowStates } from '../../window/windowState';
import { geminiUsageService } from '../GeminiUsageService';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => ({ id: 1 }),
  },
}));

const mockRequest = vi.fn();

vi.mock('../../extensions/PrivilegedExtensionHost', () => ({
  getPrivilegedExtensionHost: () => ({
    request: mockRequest,
  }),
}));

describe('GeminiUsageService dual-branch data mapping', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    windowStates.set(1, {
      workspacePath: '/test/workspace',
    } as unknown as import('../../types').WindowState);
  });

  it('GREEN ④: Branch A - maps real Antigravity snapshot into grouped models with utilization & resetTimes', async () => {
    mockRequest.mockResolvedValue({
      available: true,
      snapshot: {
        account: {
          name: 'Developer',
          tier: 'Pro',
          availablePromptCredits: 100,
          monthlyPromptCredits: 500,
        },
        models: {
          'gemini-2.5-flash': {
            model: 'gemini-2.5-flash',
            label: 'Gemini 2.5 Flash',
            remainingFraction: 0.75, // 25% utilization
            resetTime: '2026-08-31T20:00:00.000Z',
          },
          'gemini-2.5-pro': {
            model: 'gemini-2.5-pro',
            label: 'Gemini 2.5 Pro',
            remainingFraction: 0.40, // 60% utilization
            resetTime: '2026-08-31T22:00:00.000Z',
          },
          'claude-3-7-sonnet': {
            model: 'claude-3-7-sonnet',
            label: 'Claude 3.7 Sonnet',
            remainingFraction: 0.15, // 85% utilization
            resetTime: '2026-09-01T00:00:00.000Z',
          },
        },
      },
      tokenUsage: { totalTokens: 5000, lastTokens: 200 },
    });

    const result = await geminiUsageService.refresh();

    expect(result.available).toBe(true);
    expect(result.limitsAvailable).toBe(true);
    expect(result.groups).toHaveLength(2);

    const geminiGroup = result.groups?.find((g) => g.groupName === 'Gemini Models');
    expect(geminiGroup).toBeTruthy();
    expect(geminiGroup?.models).toHaveLength(2);
    expect(geminiGroup?.models[0]).toMatchObject({
      label: 'Gemini 2.5 Pro',
      utilization: 60,
      resetsAt: '2026-08-31T22:00:00.000Z',
    });
    expect(geminiGroup?.models[1]).toMatchObject({
      label: 'Gemini 2.5 Flash',
      utilization: 25,
      resetsAt: '2026-08-31T20:00:00.000Z',
    });

    const otherGroup = result.groups?.find((g) => g.groupName === 'Claude & GPT Models');
    expect(otherGroup).toBeTruthy();
    expect(otherGroup?.models).toHaveLength(1);
    expect(otherGroup?.models[0]).toMatchObject({
      label: 'Claude 3.7 Sonnet',
      utilization: 85,
      resetsAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('GREEN ④: Branch B - maps unavailable snapshot into token fallback with honest reason and no fake progress', async () => {
    mockRequest.mockResolvedValue({
      available: false,
      error: '未检测到 Antigravity 桌面版',
      tokenUsage: { totalTokens: 42000, lastTokens: 1500 },
    });

    const result = await geminiUsageService.refresh();

    expect(result.available).toBe(false);
    expect(result.limitsAvailable).toBe(false);
    expect(result.error).toBe('未检测到 Antigravity 桌面版');
    expect(result.tokenUsage).toEqual({ totalTokens: 42000, lastTokens: 1500 });
    expect(result.groups).toBeUndefined();
    expect(result.fiveHour.utilization).toBe(0);
    expect(result.sevenDay.utilization).toBe(0);
  });
});

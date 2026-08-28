// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkOrderAttempts } from '../WorkOrderAttempts';

describe('TrackerItemDetail work-order failure compatibility', () => {
  it('shows a legacy top-level failureReason when attempts is absent', () => {
    render(
      <WorkOrderAttempts
        fields={{
          failureReason: '旧卡失败原话',
          receipt: {
            engine: 'claude-code',
            model: 'claude-code:opus',
            startedAt: '2026-08-05T01:00:00.000Z',
            endedAt: '2026-08-05T01:01:00.000Z',
            outcome: 'failure',
          },
        }}
      />,
    );

    expect(screen.getByTestId('work-order-attempts')).toBeTruthy();
    expect(screen.getByTestId('work-order-attempt-failure').textContent).toBe('旧卡失败原话');
    expect(screen.getByText('第 1 次尝试')).toBeTruthy();
  });

  it('shows attempts and both failure fields for the new shape', () => {
    render(
      <WorkOrderAttempts
        fields={{
          failureReason: '最新失败原话',
          attempts: [{
            attempt: 2,
            engine: 'claude-code',
            model: 'claude-code:haiku',
            startedAt: '2026-08-05T02:00:00.000Z',
            endedAt: '2026-08-05T02:01:00.000Z',
            outcome: 'failure',
            failureReason: 'attempt 2 失败原话',
          }],
        }}
      />,
    );

    expect(screen.getByTestId('work-order-attempts')).toBeTruthy();
    expect(screen.getByText('第 2 次尝试')).toBeTruthy();
    expect(screen.getByTestId('work-order-attempt-failure').textContent).toBe('attempt 2 失败原话');
  });

  it('green FG: shows retry parameter changes in the attempts history', () => {
    render(
      <WorkOrderAttempts
        fields={{
          attempts: [{
            attempt: 2,
            engine: 'openai-codex',
            model: 'openai-codex:gpt-5.4-mini',
            startedAt: '2026-08-05T02:00:00.000Z',
            endedAt: '2026-08-05T02:01:00.000Z',
            outcome: 'success',
            retryReason: '老板手动重试',
            retryParameterChange: {
              changeSummary: '切到 Codex，并收窄任务书。',
              original: {
                provider: 'antigravity-gemini-agent',
                model: 'antigravity-gemini-agent:gemini-3.7-flash-high',
                prompt: '原任务书',
                permissionScope: 'read-only',
                disturbanceLevel: 'never',
                skillIds: [],
              },
              approved: {
                provider: 'openai-codex',
                model: 'openai-codex:gpt-5.4-mini',
                effortLevel: 'high',
                prompt: '老板最终任务书',
                permissionScope: 'workspace-write',
                disturbanceLevel: 'on-failure',
                skillBundleName: '施工包',
                skillIds: ['codex:user:implement'],
              },
            },
          }],
        }}
      />,
    );

    const params = screen.getByTestId('work-order-attempt-retry-params');
    expect(params.textContent).toContain('antigravity-gemini-agent:gemini-3.7-flash-high');
    expect(params.textContent).toContain('openai-codex:gpt-5.4-mini');
    expect(params.textContent).toContain('切到 Codex，并收窄任务书。');
  });
});

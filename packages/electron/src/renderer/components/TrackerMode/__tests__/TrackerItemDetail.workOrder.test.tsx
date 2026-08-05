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
});

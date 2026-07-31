import { describe, expect, it } from 'vitest';
import { shouldShowTextApprovalGuard } from '../metaAgentTextApprovalGuard';

describe('shouldShowTextApprovalGuard', () => {
  it('flags a completed Head turn that asks to proceed without a plan', () => {
    expect(shouldShowTextApprovalGuard({
      finalText: 'I have outlined the changes. Should I proceed?',
      submittedPlanThisTurn: false,
      hasApprovedPlan: false,
    })).toBe(true);
  });

  it.each([
    ['a submitted plan', { finalText: 'Should I proceed?', submittedPlanThisTurn: true, hasApprovedPlan: false }],
    ['an approved plan', { finalText: 'Should I proceed?', submittedPlanThisTurn: false, hasApprovedPlan: true }],
    ['a non-question ending', { finalText: 'I will wait for approval.', submittedPlanThisTurn: false, hasApprovedPlan: false }],
  ])('does not flag %s', (_label, input) => {
    expect(shouldShowTextApprovalGuard(input)).toBe(false);
  });
});

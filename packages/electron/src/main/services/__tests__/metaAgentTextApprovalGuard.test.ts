import { describe, expect, it } from 'vitest';
import {
  evaluateTextPlanGuard,
  hasOutstandingPlanRequest,
  type TextPlanGuardInput,
} from '../metaAgentTextApprovalGuard';

const implementationPlanText = `## 实施方案

1. 模块一：调整回合结算，产出文件 packages/electron/src/main/services/MetaAgentService.ts
2. 模块二：补充测试并完成引擎指派

此方案未经批准，不会派发，等待你的确认。`;

function evaluate(overrides: Partial<TextPlanGuardInput> = {}) {
  return evaluateTextPlanGuard({
    finalText: implementationPlanText,
    hasAnyToolCallThisTurn: false,
    submittedPlanThisTurn: false,
    hasPendingPlanCard: false,
    hasApprovedPlan: false,
    hasOutstandingPlanRequest: true,
    chaseCount: 0,
    ...overrides,
  });
}

describe('meta-agent text plan approval guard', () => {
  it('chases a plain-text implementation plan twice, then emits a warning', () => {
    const first = evaluate();
    expect(first).toEqual({ action: 'chase', nextChaseCount: 1 });

    const second = evaluate({ chaseCount: first.nextChaseCount });
    expect(second).toEqual({ action: 'chase', nextChaseCount: 2 });

    const third = evaluate({ chaseCount: second.nextChaseCount });
    expect(third).toEqual({ action: 'warn', nextChaseCount: 2 });
  });

  it('chases a text-only revision after a rejected plan', () => {
    expect(evaluate({ hasOutstandingPlanRequest: true, chaseCount: 0 }).action).toBe('chase');
  });

  it.each([
    ['ordinary question', '为什么这个函数返回 null？', true],
    ['investigation report', '调查报告：读取了 3 个文件，现状和失败点如下。', true],
    ['failure report', '失败汇报：子任务没有完成，原因是引擎不可用，未生成产出文件。', true],
  ])('does not chase a %s', (_label, finalText, hasOutstandingPlanRequest) => {
    expect(evaluate({
      finalText,
      hasOutstandingPlanRequest,
    }).action).toBe('none');
  });

  it('does not chase when a formal card is already submitted or a tool ran this turn', () => {
    expect(evaluate({ submittedPlanThisTurn: true }).action).toBe('none');
    expect(evaluate({ hasPendingPlanCard: true }).action).toBe('none');
    expect(evaluate({ hasAnyToolCallThisTurn: true }).action).toBe('none');
  });

  it.each([
    ['ordinary question', '为什么这个函数返回 null？', false],
    ['investigation report', '调查当前实现并汇报现状，不要改文件。', false],
    ['failure report', '失败汇报：引擎不可用，说明失败原因即可。', false],
    ['explicit plan request', '先出方案卡，未经批准不许派发。', true],
    ['implementation request', '请实现登录修复并补测试。', true],
  ])('classifies %s as outstanding-plan request: %s', (_label, prompt, expected) => {
    expect(hasOutstandingPlanRequest([prompt])).toBe(expected);
  });
});

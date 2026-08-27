import { describe, expect, it } from 'vitest';
import {
  evaluateTextPlanGuard,
  hasOutstandingPlanRequest,
  isImplementationPlanLikeText,
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
  it.each(['改进方案', '优化方案', '整理方案', '迁移方案'])(
    'green FB-127: recognizes an implementation-oriented %s by its structure, not a verb whitelist',
    (label) => {
      const implementationText = `## ${label}

1. 模块一：调整审批等待时序，产出文件 packages/electron/src/main/mcp/metaAgentServer.ts
2. 模块二：补充回归测试并完成子会话派发

风险：长时间等待可能让 Head 重交方案卡。
未经批准，不派发子任务。`;

      expect(isImplementationPlanLikeText(implementationText)).toBe(true);
    },
  );

  it('chases a plain-text implementation plan twice, then emits a warning', () => {
    const first = evaluate();
    expect(first).toEqual({ action: 'chase', nextChaseCount: 1 });

    const second = evaluate({ chaseCount: first.nextChaseCount });
    expect(second).toEqual({ action: 'chase', nextChaseCount: 2 });

    const third = evaluate({ chaseCount: second.nextChaseCount });
    expect(third).toEqual({ action: 'warn', nextChaseCount: 2 });
  });

  it('red FB-127: an approved plan globally suppresses a text plan with a new output file', () => {
    const newWorkPlanText = `## 重构方案

1. 模块一：重构配置读取，产出文件：packages/electron/src/main/services/configRefactor.ts
2. 模块二：补充迁移验证与风险说明

未经批准，不派发子任务。`;

    expect(isImplementationPlanLikeText(newWorkPlanText)).toBe(true);
    expect(evaluate({
      finalText: newWorkPlanText,
      hasApprovedPlan: true,
    })).toEqual({ action: 'none', nextChaseCount: 0 });
  });

  it('green FB-127: chases an approved plan when a text plan names a new output file', () => {
    const approvedScope = {
      approvedPlanOutputFiles: ['notes/approved-note.md'],
    };

    expect(evaluate({
      finalText: `## 重构方案

1. 模块一：重构配置读取，产出文件：packages/electron/src/main/services/configRefactor.ts
2. 模块二：补充迁移验证与风险说明

未经批准，不派发子任务。`,
      hasApprovedPlan: true,
      ...approvedScope,
    })).toEqual({ action: 'chase', nextChaseCount: 1 });
  });

  it('green FB-127: warns after two approved-plan chases for the same new output file', () => {
    const newWork = {
      finalText: `## 改进方案

1. 模块一：重构配置读取，产出文件 reports/config-refactor.md
2. 模块二：补充迁移验证与风险说明

未经批准，不派发子任务。`,
      hasApprovedPlan: true,
      approvedPlanOutputFiles: ['notes/approved-note.md'],
    };

    const first = evaluate(newWork);
    expect(first).toEqual({ action: 'chase', nextChaseCount: 1 });

    const second = evaluate({ ...newWork, chaseCount: first.nextChaseCount });
    expect(second).toEqual({ action: 'chase', nextChaseCount: 2 });

    expect(evaluate({ ...newWork, chaseCount: second.nextChaseCount }))
      .toEqual({ action: 'warn', nextChaseCount: 2 });
  });

  it.each([
    ['progress update', '进度汇报：已完成已批准范围内的整理，正在做回归验证。'],
    ['reasoning update', '思路说明：先复用当前模块，再补回归验证，不新增交付物。'],
  ])('green FB-127: does not chase an approved-plan %s without a new output file', (_label, finalText) => {
    expect(evaluate({
      finalText,
      hasApprovedPlan: true,
      approvedPlanOutputFiles: ['notes/approved-note.md'],
    })).toEqual({ action: 'none', nextChaseCount: 0 });
  });

  it('green FB-127: does not mistake a version identifier for an output file', () => {
    const progressPlanText = `## 改进方案

1. 模块一：将已批准的配置逻辑升级到 v1.20
2. 模块二：完成回归验证

风险：兼容旧版本。`;

    expect(isImplementationPlanLikeText(progressPlanText)).toBe(true);
    expect(evaluate({
      finalText: progressPlanText,
      hasApprovedPlan: true,
      approvedPlanOutputFiles: ['notes/approved-note.md'],
    })).toEqual({ action: 'none', nextChaseCount: 0 });
  });

  it('green FB-127: does not chase when every output file belongs to the approved plan', () => {
    expect(evaluate({
      finalText: `## 整理方案

1. 模块一：整理已批准笔记，产出文件 ./notes/approved-note.md
2. 模块二：合并候选结果，产出文件 docs/candidate-result.md

风险：沿用原有交付范围。`,
      hasApprovedPlan: true,
      approvedPlanOutputFiles: ['notes/approved-note.md', 'docs/candidate-result.md'],
    })).toEqual({ action: 'none', nextChaseCount: 0 });
  });

  it('chases a text-only revision after a rejected plan', () => {
    expect(evaluate({ hasOutstandingPlanRequest: true, chaseCount: 0 }).action).toBe('chase');
  });

  it.each([
    ['ordinary question', '为什么“改进方案”要覆盖模块和风险？', true],
    ['investigation report', '调查报告：改进方案当前仅列出模块和风险，尚未派发。', true],
    ['failure report', '失败汇报：改进方案未执行，模块派发因引擎不可用而中止，风险待复盘。', true],
  ])('does not chase a %s', (_label, finalText, hasOutstandingPlanRequest) => {
    expect(evaluate({
      finalText,
      hasOutstandingPlanRequest,
    }).action).toBe('none');
  });

  // The three exemptions must survive texts that do NOT open with a guard
  // word. Real failure reports and answers rarely start with "失败汇报：";
  // an earlier revision loosened the plan label to a bare 方案|计划 match and
  // these four everyday replies all started being chased.
  it.each([
    ['自然口吻的失败汇报', '这次没跑成。模块二在执行第 3 步的时候报错了，风险是数据可能不一致，我先回滚了。要不要我换个方案再试一次？'],
    ['自然口吻的答疑', '你问的这个地方，目前代码里有两种方案：一种是在模块入口做校验，一种是在派发前统一拦。各有风险，我倾向前者。'],
    ['自然口吻的调查汇报', '我看了一圈现状。notes 目录下有 145 个文件，分成几个模块，命名没有统一规则。风险主要是重名。要不要我出个整理方案？'],
    ['顺口提到计划', '好的，我按你说的做。第一步先读文件，第二步整理，第三步汇报。这个计划没有风险，模块也不用拆。'],
  ])('does not chase %s that never opens with a guard word', (_label, finalText) => {
    expect(isImplementationPlanLikeText(finalText)).toBe(false);
    expect(evaluate({ finalText, hasOutstandingPlanRequest: true }).action).toBe('none');
  });

  // The label may carry any everyday modifier, but it has to head its own
  // line. This is what separates a real plan from a passing mention.
  it.each([
    ['改进方案'], ['优化方案'], ['整理方案'], ['迁移方案'], ['重构方案'], ['方案'], ['执行计划'],
  ])('chases a plan headed by %s', (label) => {
    const finalText = [
      '好的。', '', `## ${label}`, '',
      '- 模块一：整理核心笔记，产出文件 notes/a.md',
      '- 模块二：合并汇总，产出文件 notes/b.md', '',
      '## 实施步骤', '', '1. 先备份', '2. 再迁移', '',
      '## 风险', '', '- 重名冲突', '',
      '需不需要我派发子会话执行？',
    ].join('\n');
    expect(isImplementationPlanLikeText(finalText)).toBe(true);
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

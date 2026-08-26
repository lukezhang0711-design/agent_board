export const MAX_TEXT_PLAN_CHASE_COUNT = 2;

export const TEXT_PLAN_CHASE_PROMPT = [
  '[Plan submission correction]',
  '你刚才在聊天文字中写出了实施方案，但没有调用 submit_plan。',
  '请立即把上述方案用 submit_plan 工具正式提交为方案卡；不要在聊天文字里等待批准，也不要先派发任何子任务。',
].join('\n');

export const TEXT_PLAN_BYPASS_WARNING = '⚠ Head 未按规提交方案卡，请在对话中要求它正式提交。';

// Kept for callers that imported the original one-shot predicate's patterns.
// The production guard below intentionally uses the stricter plan classifier.
export const TEXT_APPROVAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:should i|shall i|may i)\b[^?]*\?\s*$/i,
  /\b(?:proceed|continue)\?\s*$/i,
  /(?:继续|可以继续|要继续)吗？?\s*$/,
];

export const TEXT_APPROVAL_CORRECTION = [
  '请把上述实施方案用 submit_plan 工具正式提交为方案卡；不要在聊天文字里等待批准。',
].join(' ');

export function isTextPlanChasePrompt(text: string | null | undefined): boolean {
  return text?.trim().startsWith('[Plan submission correction]') === true;
}

const EXPLICIT_PLAN_REQUEST_PATTERNS: ReadonlyArray<RegExp> = [
  /方案卡|submit_plan|实施方案|implementation\s+plan/i,
  /先(?:出|写|给).{0,12}(?:方案|计划)/,
  /(?:提交|批准|审批).{0,12}(?:方案|计划)/,
];

const IMPLEMENTATION_REQUEST_PATTERN = /(?:修复|实现|开发|新增|修改|重构|施工单|implement|fix|build|create|add|modify|refactor)/i;
// Chinese words do not participate in JavaScript's `\b` word boundary, so
// keep the leading-word check explicit. This must run before the broad
// implementation verb check: "调查现状，请不要改文件" is still a report.
const QUESTION_OR_INVESTIGATION_PATTERN = /^(?:为什么|是什么|如何|怎么|调查|调研|研究|分析|汇报|报告|状态|失败汇报|why\b|what\b|how\b|investigate\b|research\b|report\b|status\b)/i;

/**
 * Identify a user turn that leaves an implementation plan outstanding. This
 * intentionally rejects question/investigation/report-shaped prompts unless
 * they contain an explicit plan-card request.
 */
export function hasOutstandingPlanRequest(promptTexts: ReadonlyArray<string>): boolean {
  return promptTexts.some((prompt) => {
    const text = prompt.trim();
    if (!text) return false;
    if (EXPLICIT_PLAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) return true;
    if (QUESTION_OR_INVESTIGATION_PATTERN.test(text)) return false;
    return IMPLEMENTATION_REQUEST_PATTERN.test(text);
  });
}

export interface TextPlanGuardInput {
  finalText: string | null | undefined;
  hasAnyToolCallThisTurn: boolean;
  submittedPlanThisTurn: boolean;
  hasPendingPlanCard: boolean;
  hasApprovedPlan: boolean;
  hasOutstandingPlanRequest: boolean;
  chaseCount: number;
}

export type TextPlanGuardAction = 'none' | 'chase' | 'warn';

export interface TextPlanGuardDecision {
  action: TextPlanGuardAction;
  nextChaseCount: number;
}

const PLAN_LABEL_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:implementation|execution|revised|revision)\s+plan\b/i,
  // The old whitelist of leading verbs (实施/执行/落地/修订/修改后的) missed
  // everyday labels such as 改进方案 and 优化方案. Keep the POSITIONAL
  // requirement instead: the label has to head its own line (a Markdown
  // heading or a `…方案：` lead-in), which is what a real plan looks like.
  // A mid-sentence mention ("我的处理方案是回滚") is not a plan and must not
  // reach the chase path.
  /(?:^|\n)\s*#{0,6}\s*[^\n：:]{0,8}?(?:方案|计划)\s*(?:[:：]|$)/im,
];

const PLAN_STRUCTURE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:模块|module|workstream|工作包|子任务)/i,
  /(?:产出文件|交付文件|产出物|交付物|output\s+files?|deliverables?|artifacts?)/i,
  /(?:引擎指派|派发|分派|dispatch|delegate|child\s+session|子会话)/i,
  /(?:步骤|step|阶段|phase)/i,
  /(?:风险|risk|trade[- ]?off)/i,
  /(?:批准|审批|确认|approval|approve)/i,
];

function hasNumberedOrBulletedStructure(text: string): boolean {
  const listLines = text
    .split(/\r?\n/)
    .filter((line) => /^(?:\s*(?:[-*+]\s+|\d+[.)、]\s+))/.test(line));
  return listLines.length >= 2;
}

/**
 * Conservative classifier for a text-only implementation plan. A plan label
 * plus at least two independent structure signals (or a real list plus one
 * signal) is required so ordinary answers, investigation notes, and failure
 * reports stay outside the chase path.
 */
export function isImplementationPlanLikeText(finalText: string | null | undefined): boolean {
  const text = finalText?.trim();
  if (
    !text
    || QUESTION_OR_INVESTIGATION_PATTERN.test(text)
    || !PLAN_LABEL_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return false;
  }

  const structureSignalCount = PLAN_STRUCTURE_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
  return structureSignalCount >= 2
    || (hasNumberedOrBulletedStructure(text) && structureSignalCount >= 1);
}

export function evaluateTextPlanGuard(input: TextPlanGuardInput): TextPlanGuardDecision {
  if (
    input.hasAnyToolCallThisTurn
    || input.submittedPlanThisTurn
    || input.hasPendingPlanCard
    || input.hasApprovedPlan
    || !input.hasOutstandingPlanRequest
    || !isImplementationPlanLikeText(input.finalText)
  ) {
    return { action: 'none', nextChaseCount: 0 };
  }

  const chaseCount = Number.isSafeInteger(input.chaseCount) && input.chaseCount > 0
    ? input.chaseCount
    : 0;
  if (chaseCount < MAX_TEXT_PLAN_CHASE_COUNT) {
    return { action: 'chase', nextChaseCount: chaseCount + 1 };
  }
  return { action: 'warn', nextChaseCount: MAX_TEXT_PLAN_CHASE_COUNT };
}

/** Backwards-compatible predicate for the earlier one-shot reminder path. */
export function shouldShowTextApprovalGuard(input: {
  finalText: string | null | undefined;
  submittedPlanThisTurn: boolean;
  hasApprovedPlan: boolean;
}): boolean {
  return evaluateTextPlanGuard({
    finalText: input.finalText,
    hasAnyToolCallThisTurn: false,
    submittedPlanThisTurn: input.submittedPlanThisTurn,
    hasPendingPlanCard: false,
    hasApprovedPlan: input.hasApprovedPlan,
    hasOutstandingPlanRequest: true,
    chaseCount: MAX_TEXT_PLAN_CHASE_COUNT,
  }).action === 'warn';
}

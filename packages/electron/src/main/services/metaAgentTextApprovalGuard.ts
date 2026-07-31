export const TEXT_APPROVAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:should i|shall i|may i)\b[^?]*\?\s*$/i,
  /\b(?:proceed|continue)\?\s*$/i,
  /(?:继续|可以继续|要继续)吗？?\s*$/,
];

export function shouldShowTextApprovalGuard(input: {
  finalText: string | null | undefined;
  submittedPlanThisTurn: boolean;
  hasApprovedPlan: boolean;
}): boolean {
  if (input.submittedPlanThisTurn || input.hasApprovedPlan) return false;
  const text = input.finalText?.trim();
  return !!text && TEXT_APPROVAL_PATTERNS.some((pattern) => pattern.test(text));
}

export const TEXT_APPROVAL_CORRECTION = 'Submit your plan formally using the submit_plan tool.';

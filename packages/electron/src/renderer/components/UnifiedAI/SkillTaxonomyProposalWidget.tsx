import React, { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  InteractivePromptStatusCard,
  type CustomToolWidgetProps,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';

interface TaxonomySkill {
  name: string;
  category: string;
  summaryZh?: string;
}

interface SkillTaxonomyProposalArgs {
  taxonomyProposalRequestId: string;
  categories: string[];
  skills: TaxonomySkill[];
  incremental: boolean;
}

function parseProposalArgs(value: unknown): SkillTaxonomyProposalArgs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const taxonomyProposalRequestId = typeof record.taxonomyProposalRequestId === 'string'
    ? record.taxonomyProposalRequestId.trim()
    : '';
  const categories = Array.isArray(record.categories)
    ? [...new Set(record.categories.flatMap((candidate) => {
        if (typeof candidate !== 'string' || !candidate.trim()) return [];
        return [candidate.trim()];
      }))]
    : [];
  const categorySet = new Set(categories);
  const rawSkills = Array.isArray(record.skills) ? record.skills : null;
  const skills = rawSkills
    ? rawSkills.flatMap((candidate): TaxonomySkill[] => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const entry = candidate as Record<string, unknown>;
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        const category = typeof entry.category === 'string' ? entry.category.trim() : '';
        if (!name || !category || !categorySet.has(category)) return [];
        const summaryZh = typeof entry.summaryZh === 'string' ? entry.summaryZh.trim() : '';
        return [{ name, category, ...(summaryZh ? { summaryZh } : {}) }];
      })
    : [];
  if (!taxonomyProposalRequestId || categories.length === 0 || !rawSkills || skills.length !== rawSkills.length) {
    return null;
  }
  return {
    taxonomyProposalRequestId,
    categories,
    skills,
    incremental: record.incremental === true,
  };
}

function parseResult(value: unknown): { approved: boolean } | null {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const approved = (parsed as Record<string, unknown>).approved;
    return approved === true || approved === false ? { approved } : null;
  } catch {
    return null;
  }
}

function nextCategoryName(categories: readonly string[]): string {
  let number = 1;
  let candidate = '新分类';
  while (categories.includes(candidate)) {
    number += 1;
    candidate = `新分类 ${number}`;
  }
  return candidate;
}

function testIdName(name: string): string {
  return encodeURIComponent(name);
}

export const SkillTaxonomyProposalWidget: React.FC<CustomToolWidgetProps> = (props) => {
  const { message, sessionId, workspacePath } = props;
  const toolCall = message.toolCall;
  const args = parseProposalArgs(toolCall?.arguments);
  const host = useAtomValue(interactiveWidgetHostAtom(sessionId));
  const effectiveWorkspacePath = workspacePath || host?.workspacePath;
  const [categories, setCategories] = useState<string[]>(args?.categories ?? []);
  const [skills, setSkills] = useState<TaxonomySkill[]>(args?.skills ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [localResult, setLocalResult] = useState<{ approved: boolean } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!args) return;
    setCategories(args.categories);
    setSkills(args.skills);
    setLocalResult(null);
    setSubmitError(null);
  }, [args?.taxonomyProposalRequestId]);

  const completedResult = localResult ?? parseResult(toolCall?.result);
  const isPending = !completedResult && toolCall?.status === 'running';
  const canApprove = categories.every((category) => category.trim())
    && skills.every((skill) => skill.category && categories.includes(skill.category));

  const groupedSkills = useMemo(
    () => new Map(categories.map((category) => [
      category,
      skills.filter((skill) => skill.category === category),
    ])),
    [categories, skills],
  );

  const renameCategory = (index: number, name: string) => {
    const previous = categories[index];
    setCategories((current) => current.map((category, categoryIndex) => (
      categoryIndex === index ? name : category
    )));
    setSkills((current) => current.map((skill) => (
      skill.category === previous ? { ...skill, category: name } : skill
    )));
  };

  const deleteCategory = (index: number) => {
    if (categories.length <= 1) return;
    const removed = categories[index];
    const nextCategories = categories.filter((_, categoryIndex) => categoryIndex !== index);
    const replacement = nextCategories[0];
    setCategories(nextCategories);
    setSkills((current) => current.map((skill) => (
      skill.category === removed ? { ...skill, category: replacement } : skill
    )));
  };

  const submitDecision = async (approved: boolean) => {
    if (!args || !toolCall || !effectiveWorkspacePath || !window.electronAPI?.invoke || submitting || completedResult) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await window.electronAPI.invoke(
        approved
          ? 'meta-agent:approve-skill-taxonomy-proposal'
          : 'meta-agent:reject-skill-taxonomy-proposal',
        approved
          ? {
              workspaceId: effectiveWorkspacePath,
              sessionId,
              requestId: args.taxonomyProposalRequestId,
              categories,
              skills,
            }
          : {
              workspaceId: effectiveWorkspacePath,
              sessionId,
              requestId: args.taxonomyProposalRequestId,
              reason: 'Owner rejected skill taxonomy proposal.',
            },
      );
      if (!response?.success) throw new Error(response?.error || 'Skill taxonomy response failed');
      setLocalResult({ approved });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!args || !toolCall) {
    return (
      <InteractivePromptStatusCard
        testId="skill-taxonomy-proposal-status"
        title="技能分类方案"
        status="unavailable"
        detail="技能分类方案参数无效。"
      />
    );
  }

  return (
    <div
      data-testid="skill-taxonomy-proposal-widget"
      data-state={completedResult ? (completedResult.approved ? 'approved' : 'rejected') : 'pending'}
      className="plan-approval-widget overflow-visible rounded-lg border border-nim-primary bg-nim-secondary"
    >
      <div className="flex items-center justify-between gap-3 border-b border-nim bg-nim-tertiary px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-nim">技能分类方案</div>
          <div className="mt-1 text-xs text-nim-muted">{args.incremental ? '新增技能' : '全部技能'}</div>
        </div>
        <span className="text-xs text-nim-muted">
          {completedResult ? (completedResult.approved ? '已批准' : '已拒绝') : '待确认'}
        </span>
      </div>

      <div className="space-y-3 p-4">
        {categories.map((category, index) => {
          const categorySkills = groupedSkills.get(category) ?? [];
          return (
            <section
              key={`${category}-${index}`}
              data-testid={`skill-taxonomy-group-${index}`}
              className="rounded-md border border-nim bg-nim-secondary p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  data-testid={`skill-taxonomy-category-name-${index}`}
                  value={category}
                  disabled={!isPending || submitting}
                  onChange={(event) => renameCategory(index, event.target.value)}
                  className="min-w-0 flex-1 rounded border border-nim bg-nim-secondary px-2 py-1 text-sm text-nim focus:border-nim-focus focus:outline-none disabled:opacity-60"
                />
                <span className="rounded bg-nim-tertiary px-2 py-1 text-xs text-nim-muted">
                  {categorySkills.length}
                </span>
                <button
                  type="button"
                  data-testid={`skill-taxonomy-delete-category-${index}`}
                  disabled={!isPending || submitting || categories.length <= 1}
                  onClick={() => deleteCategory(index)}
                  className="rounded border border-nim px-2 py-1 text-xs text-nim-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  删除
                </button>
              </div>
              <details className="mt-2" data-testid={`skill-taxonomy-details-${index}`}>
                <summary className="cursor-pointer text-xs text-nim-muted">查看归类</summary>
                <div className="mt-2 space-y-2">
                  {categorySkills.map((skill) => (
                    <div key={skill.name} className="flex flex-wrap items-center gap-2 rounded bg-nim-tertiary px-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-xs font-medium text-nim">{skill.name}</div>
                        <div className="mt-0.5 break-words text-xs text-nim-muted">
                          {skill.summaryZh || '[未翻译]'}
                        </div>
                      </div>
                      <select
                        data-testid={`skill-taxonomy-skill-select-${testIdName(skill.name)}`}
                        value={skill.category}
                        disabled={!isPending || submitting}
                        onChange={(event) => setSkills((current) => current.map((candidate) => (
                          candidate.name === skill.name
                            ? { ...candidate, category: event.target.value }
                            : candidate
                        )))}
                        className="rounded border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim disabled:opacity-60"
                      >
                        {categories.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          );
        })}

        {isPending && (
          <button
            type="button"
            data-testid="skill-taxonomy-add-category"
            disabled={submitting}
            onClick={() => setCategories((current) => [...current, nextCategoryName(current)])}
            className="rounded border border-dashed border-nim px-3 py-2 text-xs text-nim-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            + 添加分类
          </button>
        )}

        {submitError && (
          <div data-testid="skill-taxonomy-submit-error" className="rounded border border-red-500/40 px-3 py-2 text-xs text-red-600">
            {submitError}
          </div>
        )}

        {isPending && (
          <div className="flex justify-end gap-2 border-t border-nim pt-3">
            <button
              type="button"
              data-testid="skill-taxonomy-reject"
              disabled={submitting}
              onClick={() => void submitDecision(false)}
              className="rounded-md border border-nim px-3 py-2 text-xs font-medium text-nim disabled:cursor-not-allowed disabled:opacity-50"
            >
              拒绝
            </button>
            <button
              type="button"
              data-testid="skill-taxonomy-approve"
              disabled={submitting || !effectiveWorkspacePath || !canApprove}
              onClick={() => void submitDecision(true)}
              className="rounded-md bg-[var(--nim-primary)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              批准
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

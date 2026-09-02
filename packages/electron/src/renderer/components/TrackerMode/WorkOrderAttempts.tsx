import React, { useState } from 'react';
import { copyToClipboard, MaterialSymbol } from '@nimbalyst/runtime';

export interface WorkOrderAttemptView {
  attempt: number;
  engine: string;
  model: string | null;
  startedAt: string;
  endedAt: string;
  outcome: 'success' | 'failure';
  failureReason?: string;
  retryReason?: string;
  retryParameterChange?: WorkOrderRetryParameterChangeView;
}

export interface WorkOrderRetryParametersView {
  provider: string;
  model: string;
  effortLevel?: string;
  prompt?: string;
  permissionScope?: string;
  disturbanceLevel?: string;
  skillBundleName?: string;
  skillIds: string[];
}

export interface WorkOrderRetryParameterChangeView {
  changeSummary?: string;
  original: WorkOrderRetryParametersView;
  approved: WorkOrderRetryParametersView;
}

export function formatTimestamp(value: string | Date | number | undefined): string {
  if (!value) return '\u2014';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime()) || date.getTime() === 0) return '\u2014';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const normalized = readString(candidate);
    return normalized ? [normalized] : [];
  });
}

function readRetryParametersView(value: unknown): WorkOrderRetryParametersView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const provider = readString(record.provider);
  const model = readString(record.model);
  if (!provider || !model) return null;
  const effortLevel = readString(record.effortLevel);
  const prompt = readString(record.prompt);
  const permissionScope = readString(record.permissionScope);
  const disturbanceLevel = readString(record.disturbanceLevel);
  const skillBundleName = readString(record.skillBundleName);
  return {
    provider,
    model,
    ...(effortLevel ? { effortLevel } : {}),
    ...(prompt ? { prompt } : {}),
    ...(permissionScope ? { permissionScope } : {}),
    ...(disturbanceLevel ? { disturbanceLevel } : {}),
    ...(skillBundleName ? { skillBundleName } : {}),
    skillIds: readStringList(record.skillIds),
  };
}

function readRetryParameterChangeView(value: unknown): WorkOrderRetryParameterChangeView | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const original = readRetryParametersView(record.original);
  const approved = readRetryParametersView(record.approved);
  if (!original || !approved) return undefined;
  const changeSummary = readString(record.changeSummary);
  return {
    ...(changeSummary ? { changeSummary } : {}),
    original,
    approved,
  };
}

function formatRetryParameters(parameters: WorkOrderRetryParametersView): string {
  const parts = [
    parameters.provider,
    parameters.model,
    parameters.effortLevel ? `强度 ${parameters.effortLevel}` : null,
    parameters.permissionScope && parameters.disturbanceLevel
      ? `${parameters.permissionScope}/${parameters.disturbanceLevel}`
      : null,
    parameters.skillBundleName ? `技能包 ${parameters.skillBundleName}` : null,
    parameters.skillIds.length > 0 ? `技能 ${parameters.skillIds.join('、')}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ');
}

function readWorkOrderReceiptView(
  value: unknown,
): Pick<WorkOrderAttemptView, 'engine' | 'model' | 'startedAt' | 'endedAt' | 'outcome'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<WorkOrderAttemptView>;
  if (
    typeof raw.engine !== 'string'
    || typeof raw.startedAt !== 'string'
    || typeof raw.endedAt !== 'string'
    || (raw.outcome !== 'success' && raw.outcome !== 'failure')
  ) {
    return null;
  }
  return {
    engine: raw.engine,
    model: typeof raw.model === 'string' ? raw.model : null,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    outcome: raw.outcome,
  };
}

export function readWorkOrderAttemptViews(value: unknown): WorkOrderAttemptView[] {
  const fields = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const failureReason = typeof fields.failureReason === 'string' && fields.failureReason.trim()
    ? fields.failureReason
    : undefined;
  const attempts = Array.isArray(fields.attempts)
    ? fields.attempts.flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const raw = candidate as Partial<WorkOrderAttemptView>;
        if (
          typeof raw.engine !== 'string'
          || typeof raw.startedAt !== 'string'
          || typeof raw.endedAt !== 'string'
          || (raw.outcome !== 'success' && raw.outcome !== 'failure')
        ) {
          return [];
        }
        const rawAttemptNumber = raw.attempt;
        const retryParameterChange = readRetryParameterChangeView(
          (candidate as Record<string, unknown>).retryParameterChange,
        );
        return [{
          attempt: typeof rawAttemptNumber === 'number'
            && Number.isSafeInteger(rawAttemptNumber)
            && rawAttemptNumber > 0
            ? rawAttemptNumber
            : index + 1,
          engine: raw.engine,
          model: typeof raw.model === 'string' ? raw.model : null,
          startedAt: raw.startedAt,
          endedAt: raw.endedAt,
          outcome: raw.outcome,
          ...(typeof raw.failureReason === 'string' ? { failureReason: raw.failureReason } : {}),
          ...(typeof raw.retryReason === 'string' ? { retryReason: raw.retryReason } : {}),
          ...(retryParameterChange ? { retryParameterChange } : {}),
        }];
      })
    : [];

  if (attempts.length > 0) {
    if (failureReason && !attempts.some((attempt) => attempt.failureReason)) {
      let targetIndex = attempts.length - 1;
      for (let index = attempts.length - 1; index >= 0; index -= 1) {
        if (attempts[index].outcome === 'failure') {
          targetIndex = index;
          break;
        }
      }
      attempts[targetIndex] = { ...attempts[targetIndex], failureReason };
    }
    return attempts;
  }

  const receipt = readWorkOrderReceiptView(fields.receipt);
  if (!receipt && !failureReason) return [];
  return [{
    ...(receipt ?? {
      engine: 'unknown',
      model: null,
      startedAt: '',
      endedAt: '',
      outcome: 'failure' as const,
    }),
    attempt: 1,
    ...(failureReason ? { failureReason } : {}),
  }];
}

export function formatAttemptsForClipboard(attempts: WorkOrderAttemptView[]): string {
  return attempts
    .map((attempt) => {
      const lines = [
        `第 ${attempt.attempt} 次尝试 [${attempt.outcome === 'success' ? '成功' : '失败'}]`,
        `引擎/模型: ${attempt.engine} · ${attempt.model || '(无模型)'}`,
        `时间: ${formatTimestamp(attempt.startedAt)} → ${formatTimestamp(attempt.endedAt)}`,
      ];
      if (attempt.failureReason) {
        lines.push(`失败原因: ${attempt.failureReason}`);
      }
      if (attempt.retryReason) {
        lines.push(`重试原因: ${attempt.retryReason}`);
      }
      if (attempt.retryParameterChange) {
        lines.push(
          `参数变更: ${formatRetryParameters(attempt.retryParameterChange.original)} → ${formatRetryParameters(attempt.retryParameterChange.approved)}`
        );
        if (attempt.retryParameterChange.changeSummary) {
          lines.push(`变更说明: ${attempt.retryParameterChange.changeSummary}`);
        }
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

export const WorkOrderAttempts: React.FC<{ fields: unknown }> = ({ fields }) => {
  const attempts = readWorkOrderAttemptViews(fields);
  const [filter, setFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [copied, setCopied] = useState(false);

  if (attempts.length === 0) return null;

  const filteredAttempts = attempts.filter((attempt) => {
    if (filter === 'all') return true;
    return attempt.outcome === filter;
  });

  const handleCopyAll = async () => {
    const text = formatAttemptsForClipboard(filteredAttempts.length > 0 ? filteredAttempts : attempts);
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="space-y-2.5 pt-2 border-t border-nim" data-testid="work-order-attempts">
      {/* Header with Title, Filter, and Copy All */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-nim-muted uppercase tracking-[0.5px]">Attempts</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--nim-bg-subtle)] text-nim-faint font-medium">
            {attempts.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {/* Filter Buttons */}
          <div className="flex items-center rounded border border-nim bg-nim-secondary p-0.5 text-[10px]" data-testid="work-order-attempts-filter">
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${filter === 'all' ? 'bg-[var(--nim-primary)] text-white font-medium' : 'text-nim-muted hover:text-nim'}`}
              onClick={() => setFilter('all')}
              data-testid="filter-all"
            >
              全部
            </button>
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${filter === 'success' ? 'bg-[var(--nim-primary)] text-white font-medium' : 'text-nim-muted hover:text-nim'}`}
              onClick={() => setFilter('success')}
              data-testid="filter-success"
            >
              成功
            </button>
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${filter === 'failure' ? 'bg-[var(--nim-primary)] text-white font-medium' : 'text-nim-muted hover:text-nim'}`}
              onClick={() => setFilter('failure')}
              data-testid="filter-failure"
            >
              失败
            </button>
          </div>

          {/* Copy All Button */}
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-nim bg-nim-secondary hover:bg-nim-tertiary text-nim-muted hover:text-nim text-[10px] cursor-pointer transition-colors"
            onClick={handleCopyAll}
            data-testid="work-order-attempts-copy-all"
            title="复制全部执行记录"
          >
            <MaterialSymbol icon={copied ? 'check' : 'content_copy'} size={12} className={copied ? 'text-green-500' : ''} />
            <span>{copied ? '已复制' : '复制全部'}</span>
          </button>
        </div>
      </div>

      {/* Mini Density Overview Bar */}
      {attempts.length > 1 && (
        <div className="flex items-center gap-1 w-full h-1.5 rounded-full overflow-hidden bg-nim-tertiary/40" data-testid="work-order-attempts-density-bar">
          {attempts.map((attempt, index) => (
            <div
              key={index}
              className={`flex-1 h-full transition-opacity ${
                attempt.outcome === 'success' ? 'bg-green-500' : 'bg-red-500'
              } ${filter !== 'all' && attempt.outcome !== filter ? 'opacity-20' : 'opacity-100'}`}
              title={`第 ${attempt.attempt} 次尝试 · ${attempt.outcome}`}
            />
          ))}
        </div>
      )}

      {/* Attempts List */}
      {filteredAttempts.length === 0 ? (
        <div className="text-[11px] text-nim-faint italic py-2 text-center" data-testid="work-order-attempts-empty-filter">
          无匹配的尝试记录
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAttempts.map((attempt, index) => (
            <div
              key={`${attempt.attempt}-${attempt.startedAt}-${index}`}
              className="rounded border border-nim bg-nim-tertiary/30 px-2.5 py-2 space-y-1"
              data-testid="work-order-attempt"
              data-outcome={attempt.outcome}
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-nim">第 {attempt.attempt} 次尝试</span>
                <span className={attempt.outcome === 'success' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                  {attempt.outcome}
                </span>
              </div>
              <div className="text-[10px] text-nim-muted">
                {attempt.engine} · {attempt.model || '(no model)'}
              </div>
              <div className="text-[10px] text-nim-faint">
                {formatTimestamp(attempt.startedAt)} → {formatTimestamp(attempt.endedAt)}
              </div>
              {attempt.failureReason && (
                <div className="text-[10px] text-red-300 whitespace-pre-wrap break-words" data-testid="work-order-attempt-failure">
                  {attempt.failureReason}
                </div>
              )}
              {attempt.retryReason && (
                <div className="text-[10px] text-nim-accent" data-testid="work-order-attempt-retry-reason">
                  {attempt.retryReason}
                </div>
              )}
              {attempt.retryParameterChange && (
                <div className="space-y-1 text-[10px] text-nim-muted" data-testid="work-order-attempt-retry-params">
                  <div>
                    参数变更：{formatRetryParameters(attempt.retryParameterChange.original)}
                    {' → '}
                    {formatRetryParameters(attempt.retryParameterChange.approved)}
                  </div>
                  {attempt.retryParameterChange.changeSummary && (
                    <div className="whitespace-pre-wrap break-words">
                      {attempt.retryParameterChange.changeSummary}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

import React from 'react';

export interface WorkOrderAttemptView {
  attempt: number;
  engine: string;
  model: string | null;
  startedAt: string;
  endedAt: string;
  outcome: 'success' | 'failure';
  failureReason?: string;
  retryReason?: string;
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

export const WorkOrderAttempts: React.FC<{ fields: unknown }> = ({ fields }) => {
  const attempts = readWorkOrderAttemptViews(fields);
  if (attempts.length === 0) return null;

  return (
    <section className="space-y-2 pt-1 border-t border-nim" data-testid="work-order-attempts">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-nim-muted uppercase tracking-[0.5px]">Attempts</span>
        <span className="text-[10px] text-nim-faint">{attempts.length}</span>
      </div>
      <div className="space-y-2">
        {attempts.map((attempt, index) => (
          <div
            key={`${attempt.attempt}-${attempt.startedAt}-${index}`}
            className="rounded border border-nim bg-nim-tertiary/30 px-2.5 py-2 space-y-1"
            data-testid="work-order-attempt"
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-nim">第 {attempt.attempt} 次尝试</span>
              <span className={attempt.outcome === 'success' ? 'text-green-400' : 'text-red-400'}>
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
          </div>
        ))}
      </div>
    </section>
  );
};

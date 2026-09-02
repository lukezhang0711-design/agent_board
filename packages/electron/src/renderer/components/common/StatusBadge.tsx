import React from 'react';

export type StatusBadgeType =
  | 'running'
  | 'waiting'
  | 'pending'
  | 'completed'
  | 'done'
  | 'failed'
  | 'error'
  | 'idle'
  | 'todo';

export interface StatusBadgeProps {
  /** One of the five fixed statuses */
  status: StatusBadgeType;
  /** Custom label text (defaults to standard status name) */
  label?: React.ReactNode;
  /** Optional prefix icon or indicator dot */
  icon?: React.ReactNode;
  /** Additional container CSS class */
  className?: string;
  /** Test ID for assertions */
  testId?: string;
}

type CanonicalStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'idle';

const STATUS_CONFIG: Record<
  CanonicalStatus,
  {
    className: string;
    defaultLabel: string;
    statusKey: CanonicalStatus;
  }
> = {
  running: {
    className: 'bg-nim-primary-subtle text-[var(--nim-primary)] border border-nim-primary-subtle',
    defaultLabel: '在跑',
    statusKey: 'running',
  },
  waiting: {
    className: 'bg-nim-warning-subtle text-[var(--nim-warning)] border border-nim-warning-subtle',
    defaultLabel: '等确认',
    statusKey: 'waiting',
  },
  completed: {
    className: 'bg-nim-success-subtle text-[var(--nim-success)] border border-nim-success-subtle',
    defaultLabel: '已完成',
    statusKey: 'completed',
  },
  failed: {
    className: 'bg-nim-error-subtle text-[var(--nim-error)] border border-nim-error-subtle',
    defaultLabel: '失败',
    statusKey: 'failed',
  },
  idle: {
    className: 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] border border-[var(--nim-border)]',
    defaultLabel: '待办',
    statusKey: 'idle',
  },
};

function normalizeStatus(status: StatusBadgeType): CanonicalStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'waiting':
    case 'pending':
      return 'waiting';
    case 'completed':
    case 'done':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'idle':
    case 'todo':
    default:
      return 'idle';
  }
}

/**
 * StatusBadge - Standardized status badge component.
 *
 * Five fixed statuses:
 *   1. running: Primary subtle tone
 *   2. waiting: Warning subtle tone
 *   3. completed: Success subtle tone
 *   4. failed: Error subtle tone
 *   5. idle: Neutral tertiary tone
 *
 * All colors 100% bound to --nim-* visual tokens via bg-nim-*-subtle.
 * Pure display component: no state management, no registration machinery.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  icon,
  className = '',
  testId = 'status-badge',
}) => {
  const canonical = normalizeStatus(status);
  const config = STATUS_CONFIG[canonical];

  return (
    <span
      className={`status-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-ui-full text-ui-micro font-medium tracking-tight whitespace-nowrap ${config.className} ${className}`.trim()}
      data-testid={testId}
      data-status={canonical}
    >
      {icon && <span className="status-badge-icon shrink-0 flex items-center">{icon}</span>}
      <span className="status-badge-label">{label ?? config.defaultLabel}</span>
    </span>
  );
};

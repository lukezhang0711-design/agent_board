import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

export interface EmptyStateMessageProps {
  /** First line: Clear title stating what is empty */
  title: React.ReactNode;
  /** Second line: Actionable next step explaining what the user should do next */
  actionHint?: React.ReactNode;
  /** Optional icon (MaterialSymbol icon name or ReactNode) */
  icon?: string | React.ReactNode;
  /** Optional primary CTA button or inline action */
  action?: React.ReactNode;
  /** Custom container class */
  className?: string;
  /** Test ID for assertions */
  testId?: string;
}

/**
 * EmptyStateMessage - Standardized two-line empty state component.
 *
 * Pattern:
 *   Line 1: Bold/semibold clear title (e.g. "暂无可用技能")
 *   Line 2: Actionable next step (e.g. "在工作区添加技能文件后刷新即可在此启用。")
 *
 * Adheres to copy discipline: does not explain mechanics, guides user to the next action.
 */
export const EmptyStateMessage: React.FC<EmptyStateMessageProps> = ({
  title,
  actionHint,
  icon,
  action,
  className = '',
  testId = 'empty-state-message',
}) => {
  return (
    <div
      className={`empty-state-message flex flex-col items-center justify-center text-center p-6 rounded-lg border border-dashed border-[var(--nim-border)] bg-[var(--nim-bg-subtle)]/50 ${className}`.trim()}
      data-testid={testId}
    >
      {icon && (
        <div className="empty-state-icon mb-2 text-[var(--nim-text-faint)]">
          {typeof icon === 'string' ? (
            <MaterialSymbol icon={icon} size={28} />
          ) : (
            icon
          )}
        </div>
      )}

      <div className="empty-state-title text-sm font-semibold text-[var(--nim-text)]" data-testid="empty-state-title">
        {title}
      </div>

      {actionHint && (
        <div className="empty-state-hint mt-1 text-xs text-[var(--nim-text-muted)] max-w-[60ch] leading-relaxed" data-testid="empty-state-hint">
          {actionHint}
        </div>
      )}

      {action && (
        <div className="empty-state-action mt-3">
          {action}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

export interface PageHeaderProps {
  /** Icon name (MaterialSymbol) or a custom icon element */
  icon?: string | React.ReactNode;
  /** Main header title */
  title: React.ReactNode;
  /** Numerical or text count displayed as a clean badge next to the title */
  count?: number | string | React.ReactNode;
  /** Optional secondary subtitle or scope tag */
  subtitle?: React.ReactNode;
  /** Right-aligned primary action buttons or controls */
  actions?: React.ReactNode;
  /** Optional children rendered between title and actions or below */
  children?: React.ReactNode;
  /** Additional CSS class name */
  className?: string;
  /** Test ID for assertions */
  testId?: string;
}

/**
 * PageHeader - Standardized, lightweight page header template.
 *
 * Pattern:
 *   Left: [Icon] [Title] [Count Badge] [Optional Subtitle]
 *   Middle: [Optional search / filter children]
 *   Right: [Primary Action Buttons]
 *
 * Follows strict copy discipline: contains no permanent mechanism explanations.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  title,
  count,
  subtitle,
  actions,
  children,
  className = '',
  testId = 'page-header',
}) => {
  return (
    <div
      className={`page-header flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--nim-border)] ${className}`.trim()}
      data-testid={testId}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
        {icon && (
          <div className="page-header-icon shrink-0 flex items-center justify-center text-[var(--nim-primary)]">
            {typeof icon === 'string' ? (
              <MaterialSymbol icon={icon} size={20} />
            ) : (
              icon
            )}
          </div>
        )}

        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="page-header-title m-0 text-base sm:text-lg font-semibold text-[var(--nim-text)] leading-tight tracking-tight truncate">
            {title}
          </h2>

          {count !== undefined && count !== null && (
            <span
              className="page-header-count px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--nim-bg-subtle)] text-[var(--nim-text-muted)] border border-[var(--nim-border-subtle)] tabular-nums"
              data-testid="page-header-count"
            >
              {count}
            </span>
          )}
        </div>

        {subtitle && (
          <span className="page-header-subtitle text-xs text-[var(--nim-text-muted)] opacity-80 truncate">
            {subtitle}
          </span>
        )}
      </div>

      {children && (
        <div className="page-header-children flex-1 min-w-[200px] max-w-[400px]">
          {children}
        </div>
      )}

      {actions && (
        <div
          className="page-header-actions flex items-center gap-2 shrink-0 ml-auto"
          data-testid="page-header-actions"
        >
          {actions}
        </div>
      )}
    </div>
  );
};

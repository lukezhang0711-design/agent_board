import React from 'react';

export interface ToolbarProps {
  /** Left slot: Search input or component occupying primary width */
  search?: React.ReactNode;
  /** Right slot: Filter dropdowns or buttons */
  filters?: React.ReactNode;
  /** Right slot: Sort controls */
  sort?: React.ReactNode;
  /** Right slot: Additional action buttons */
  actions?: React.ReactNode;
  /** Optional custom content rendered between left and right slots */
  children?: React.ReactNode;
  /** Additional container CSS class */
  className?: string;
  /** Test ID for assertions */
  testId?: string;
}

/**
 * Toolbar - Standardized toolbar component for lists, kanban, and file areas.
 *
 * Fixed layout & spacing:
 *   Left: Search input (takes primary width: flex-1, min 200px, max 400px)
 *   Right: Button group (filters, sort, actions) with fixed 8px (gap-2) spacing
 *
 * Pure display component: no state management, no data fetching.
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  search,
  filters,
  sort,
  actions,
  children,
  className = '',
  testId = 'toolbar',
}) => {
  const hasRightControls = Boolean(filters || sort || actions);

  return (
    <div
      className={`toolbar flex items-center justify-between gap-3 p-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-ui-base ${className}`.trim()}
      data-testid={testId}
    >
      {/* Left slot: Search takes primary width */}
      {search && (
        <div className="toolbar-search flex-1 min-w-[200px] max-w-[400px]" data-testid="toolbar-search">
          {search}
        </div>
      )}

      {/* Optional middle slot */}
      {children && (
        <div className="toolbar-children flex items-center gap-2" data-testid="toolbar-children">
          {children}
        </div>
      )}

      {/* Right slot: Fixed group for filters, sort, and actions */}
      {hasRightControls && (
        <div className="toolbar-controls flex items-center gap-2 shrink-0 ml-auto" data-testid="toolbar-controls">
          {filters && (
            <div className="toolbar-filters flex items-center gap-2" data-testid="toolbar-filters">
              {filters}
            </div>
          )}
          {sort && (
            <div className="toolbar-sort flex items-center gap-2" data-testid="toolbar-sort">
              {sort}
            </div>
          )}
          {actions && (
            <div className="toolbar-actions flex items-center gap-2" data-testid="toolbar-actions">
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

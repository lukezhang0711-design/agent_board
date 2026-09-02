import React from 'react';

export interface ItemCardProps {
  /** Top row left: identifier (monospace, muted font) */
  idNumber?: React.ReactNode;
  /** Top row right: status badge component */
  statusBadge?: React.ReactNode;
  /** Title: max 2 lines, clamped with ellipsis */
  title: React.ReactNode;
  /** Description: 1 line only, truncated, muted */
  description?: React.ReactNode;
  /** Bottom row left: assignee avatar or name */
  assignee?: React.ReactNode;
  /** Bottom row right: timestamp or date */
  time?: React.ReactNode;
  /** Optional click handler */
  onClick?: () => void;
  /** Additional container CSS class */
  className?: string;
  /** Test ID for assertions */
  testId?: string;
}

/**
 * ItemCard - Standardized four-tier card component.
 *
 * Fixed four-tier information hierarchy:
 *   1. Top row: ID number (monospace, muted) / Status badge
 *   2. Title: Max 2 lines, clamped with ellipsis (line-clamp-2)
 *   3. Description: Single line, truncated (truncate)
 *   4. Bottom row: Assignee avatar / Timestamp, separated by top border divider
 *
 * Pure display component: no state management, no data fetching.
 */
export const ItemCard: React.FC<ItemCardProps> = ({
  idNumber,
  statusBadge,
  title,
  description,
  assignee,
  time,
  onClick,
  className = '',
  testId = 'item-card',
}) => {
  return (
    <div
      className={`item-card bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-ui-lg p-3 flex flex-col gap-2 transition-colors ${
        onClick ? 'cursor-pointer hover:border-[var(--nim-border-hover)] hover:bg-[var(--nim-bg-hover)]' : ''
      } ${className}`.trim()}
      data-testid={testId}
      onClick={onClick}
    >
      {/* Tier 1: Top row (ID number + Status badge) */}
      {(idNumber !== undefined || statusBadge !== undefined) && (
        <div className="item-card-top flex items-center justify-between gap-2 min-w-0" data-testid="item-card-top">
          <div className="item-card-id font-mono text-ui-caption text-[var(--nim-text-muted)] overflow-hidden text-ellipsis whitespace-nowrap" data-testid="item-card-id">
            {idNumber}
          </div>
          {statusBadge && (
            <div className="item-card-status shrink-0" data-testid="item-card-status">
              {statusBadge}
            </div>
          )}
        </div>
      )}

      {/* Tier 2: Title (Max 2 lines, clamped) */}
      <div
        className="item-card-title text-ui-body font-medium text-[var(--nim-text)] line-clamp-2 leading-snug break-words"
        data-testid="item-card-title"
      >
        {title}
      </div>

      {/* Tier 3: Description (Single line, truncated) */}
      {description !== undefined && description !== null && (
        <div
          className="item-card-description text-ui-caption text-[var(--nim-text-muted)] truncate"
          data-testid="item-card-description"
        >
          {description}
        </div>
      )}

      {/* Tier 4: Bottom row (Assignee + Time, separated by top border divider) */}
      {(assignee !== undefined || time !== undefined) && (
        <div
          className="item-card-bottom border-t border-[var(--nim-border)] pt-2 mt-1 flex items-center justify-between gap-2 min-w-0"
          data-testid="item-card-bottom"
        >
          <div className="item-card-assignee flex items-center gap-2 min-w-0 text-ui-caption text-[var(--nim-text-secondary)]" data-testid="item-card-assignee">
            {assignee}
          </div>
          {time !== undefined && time !== null && (
            <div className="item-card-time text-ui-micro text-[var(--nim-text-muted)] shrink-0 font-mono" data-testid="item-card-time">
              {time}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

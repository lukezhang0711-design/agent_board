import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { UsagePool, UsagePoolMap } from '../../../shared/usage';
import { formatResetTime } from '../../store/atoms/claudeUsageAtoms';

interface UsagePoolListProps {
  pools: UsagePoolMap;
  emptyMessage: string;
}

function getPoolColors(pool: UsagePool): { text: string; bar: string } {
  if (pool.stale) return { text: 'text-nim-muted', bar: 'bg-[var(--nim-text-muted)]' };
  if (pool.utilization >= 80) return { text: 'text-nim-error', bar: 'bg-[var(--nim-error)]' };
  if (pool.utilization >= 50) return { text: 'text-nim-warning', bar: 'bg-[var(--nim-warning)]' };
  return { text: 'text-nim-success', bar: 'bg-[var(--nim-success)]' };
}

function formatWindow(windowMinutes: number | null): string {
  if (windowMinutes === null) return 'Usage limit';
  if (windowMinutes % (24 * 60) === 0) {
    const days = windowMinutes / (24 * 60);
    return `${days}-day window`;
  }
  if (windowMinutes % 60 === 0) {
    const hours = windowMinutes / 60;
    return `${hours}-hour window`;
  }
  return `${windowMinutes}-minute window`;
}

export function formatUsageLastUpdated(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export const UsagePoolList: React.FC<UsagePoolListProps> = ({ pools, emptyMessage }) => {
  const rows = Object.values(pools).sort((left, right) => left.name.localeCompare(right.name));

  if (rows.length === 0) {
    return <div className="usage-pool-list-empty text-[12px] text-nim-muted">{emptyMessage}</div>;
  }

  return (
    <div className="usage-pool-list flex flex-col gap-4" data-component="UsagePoolList">
      {rows.map((pool) => {
        const colors = getPoolColors(pool);
        const barWidth = Math.max(0, Math.min(100, pool.utilization));
        return (
          <div
            key={pool.key}
            className="usage-pool-row"
            data-testid={`usage-pool-${pool.provider}-${pool.limitId}`}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-nim" title={pool.name}>
                  {pool.name}
                </div>
                <div className="text-[11px] text-nim-muted">{formatWindow(pool.windowMinutes)}</div>
              </div>
              <div className={`shrink-0 text-[16px] font-semibold ${colors.text}`}>
                {pool.utilization}%
              </div>
            </div>
            <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-nim-tertiary">
              <div
                className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <div className="flex flex-col gap-0.5 text-[11px] text-nim-muted">
              <div className="flex items-center gap-1">
                <MaterialSymbol icon="schedule" size={12} className="opacity-70" />
                <span>{pool.resetsAt ? `Resets in ${formatResetTime(pool.resetsAt)}` : 'Reset time unavailable'}</span>
              </div>
              <div className={pool.stale ? 'text-nim-warning' : 'text-nim-faint'}>
                {pool.stale ? 'Stale · ' : ''}Last updated {formatUsageLastUpdated(pool.updatedAt)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

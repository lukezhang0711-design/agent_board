import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { UsagePool, UsagePoolMap } from '../../../shared/usage';
import { formatResetTime } from '../../store/atoms/claudeUsageAtoms';
import { EmptyStateMessage } from '../common/EmptyStateMessage';

interface UsagePoolListProps {
  pools: UsagePoolMap;
  emptyMessage: string;
  emptyActionHint?: string;
}

function getPoolColors(pool: UsagePool): { text: string; bar: string } {
  if (pool.stale) return { text: 'text-nim-muted', bar: 'bg-[var(--nim-text-muted)]' };
  if (pool.utilization >= 80) return { text: 'text-nim-error', bar: 'bg-[var(--nim-error)]' };
  if (pool.utilization >= 50) return { text: 'text-nim-warning', bar: 'bg-[var(--nim-warning)]' };
  return { text: 'text-nim-success', bar: 'bg-[var(--nim-success)]' };
}

function formatWindow(windowMinutes: number | null): string {
  if (windowMinutes === null) return '用量上限';
  if (windowMinutes % (24 * 60) === 0) {
    const days = windowMinutes / (24 * 60);
    return `${days} 天周期`;
  }
  if (windowMinutes % 60 === 0) {
    const hours = windowMinutes / 60;
    return `${hours} 小时周期`;
  }
  return `${windowMinutes} 分钟周期`;
}

export function formatUsageLastUpdated(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return '刚刚';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} 天前`;
}

export const UsagePoolList: React.FC<UsagePoolListProps> = ({ pools, emptyMessage, emptyActionHint }) => {
  const rows = Object.values(pools).sort((left, right) => left.name.localeCompare(right.name));

  if (rows.length === 0) {
    return (
      <EmptyStateMessage
        title={emptyMessage || '暂无额度数据'}
        actionHint={emptyActionHint || '请确认已登录对应账号并点击右上角刷新，或发起会话后重试。'}
        className="my-2 py-4 px-3"
        testId="usage-pool-list-empty"
      />
    );
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
                <div className="truncate text-ui-body font-semibold text-nim" title={pool.name}>
                  {pool.name}
                </div>
                <div className="text-ui-caption text-nim-muted">{formatWindow(pool.windowMinutes)}</div>
              </div>
              <div className={`shrink-0 text-ui-subhead font-semibold ${colors.text}`}>
                {pool.utilization}%
              </div>
            </div>
            <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-nim-tertiary">
              <div
                className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <div className="flex flex-col gap-0.5 text-ui-caption text-nim-muted">
              <div className="flex items-center gap-1">
                <MaterialSymbol icon="schedule" size={12} className="opacity-70" />
                <span>{pool.resetsAt ? `${formatResetTime(pool.resetsAt)}后重置` : '重置时间不可用'}</span>
              </div>
              <div className={pool.stale ? 'text-nim-warning' : 'text-nim-faint'}>
                {pool.stale ? '已过期 · ' : ''}上次更新于 {formatUsageLastUpdated(pool.updatedAt)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

export interface ActiveWorkerSummary {
  id: string;
  title?: string;
  provider?: string;
  status?: string;
}

export interface AgentBusyIndicatorProps {
  /** Number of currently executing/running agents/workers */
  runningCount: number;
  /** Total count of sessions/workers if known */
  totalCount?: number;
  /** Number of queued tasks if any */
  queuedCount?: number;
  /** Active session/worker objects for stacked avatar display */
  activeSessions?: ActiveWorkerSummary[];
  /** Optional click handler or navigation */
  onClick?: () => void;
  /** Additional CSS class name */
  className?: string;
  /** Test ID for assertions */
  testId?: string;
}

/**
 * AgentBusyIndicator - Concise, one-sentence agent busy status indicator with stacked avatars.
 *
 * Pattern:
 *   Left: Stacked avatars/icons of running workers
 *   Center: Single clear sentence: "{N} agents working" / "0 agents working"
 *   Status: Subtle running pulse when > 0, clean idle state when 0
 *
 * Discards permanent mechanism explanation copy ("Child sessions created by this meta-agent.").
 */
export const AgentBusyIndicator: React.FC<AgentBusyIndicatorProps> = ({
  runningCount,
  totalCount,
  queuedCount = 0,
  activeSessions = [],
  onClick,
  className = '',
  testId = 'agent-busy-indicator',
}) => {
  const isWorking = runningCount > 0;
  const statusSentence = `${runningCount} agent${runningCount === 1 ? '' : 's'} working`;

  return (
    <div
      className={`agent-busy-indicator inline-flex items-center gap-2 px-2.5 py-1 rounded-full border transition-colors ${
        isWorking
          ? 'bg-[rgba(59,130,246,0.08)] border-[rgba(59,130,246,0.3)] text-[var(--nim-primary)]'
          : 'bg-[var(--nim-bg-subtle)] border-[var(--nim-border)] text-[var(--nim-text-muted)]'
      } ${className}`.trim()}
      data-testid={testId}
      data-running-count={runningCount}
      title={
        totalCount !== undefined
          ? `${statusSentence}${queuedCount > 0 ? ` · ${queuedCount} queued` : ''} (共 ${totalCount} 个工单)`
          : statusSentence
      }
      onClick={onClick}
    >
      {/* Avatar / Provider Icon Stack */}
      <div className="flex items-center -space-x-1.5 shrink-0" data-testid="agent-avatar-stack">
        {activeSessions.length > 0 ? (
          activeSessions.slice(0, 3).map((session, index) => (
            <div
              key={session.id || index}
              className="w-5 h-5 rounded-full ring-1 ring-[var(--nim-bg)] bg-[var(--nim-bg-secondary)] flex items-center justify-center overflow-hidden text-[10px]"
              title={session.title || session.provider || 'Agent'}
            >
              <MaterialSymbol icon="smart_toy" size={12} />
            </div>
          ))
        ) : (
          <div
            className={`w-5 h-5 rounded-full ring-1 ring-[var(--nim-bg)] flex items-center justify-center text-[11px] ${
              isWorking
                ? 'bg-blue-500/20 text-blue-500'
                : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]'
            }`}
          >
            {isWorking ? (
              <MaterialSymbol icon="sync" size={12} className="animate-spin" />
            ) : (
              <MaterialSymbol icon="smart_toy" size={12} />
            )}
          </div>
        )}
      </div>

      {/* Concise One Sentence */}
      <span className="text-xs font-medium tracking-tight whitespace-nowrap" data-testid="agent-busy-text">
        {statusSentence}
      </span>

      {queuedCount > 0 && (
        <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono">
          +{queuedCount} queued
        </span>
      )}
    </div>
  );
};

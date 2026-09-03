import React, { useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { useFloating, offset, flip, shift, FloatingPortal } from '@floating-ui/react';

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

const AVATAR_PALETTES = [
  'bg-nim-primary-subtle text-[var(--nim-primary)] border-nim-primary-subtle',
  'bg-nim-success-subtle text-[var(--nim-success)] border-nim-success-subtle',
  'bg-nim-warning-subtle text-[var(--nim-warning)] border-nim-warning-subtle',
  'bg-nim-error-subtle text-[var(--nim-error)] border-nim-error-subtle',
  'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] border-[var(--nim-border)]',
];

export function getAvatarColorIndex(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum += id.charCodeAt(i);
  }
  return sum % AVATAR_PALETTES.length;
}

export function getAvatarPalette(id: string): string {
  return AVATAR_PALETTES[getAvatarColorIndex(id)];
}

interface SessionAvatarProps {
  session: ActiveWorkerSummary;
  index: number;
}

function SessionAvatar({ session, index }: SessionAvatarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const title = session.title || session.id || 'Worker';
  const twoChars = (session.title?.trim() || session.provider || 'AG').slice(0, 2);
  const paletteClass = getAvatarPalette(session.id || String(index));

  return (
    <>
      <div
        ref={refs.setReference}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className={`w-5 h-5 rounded-ui-full border flex items-center justify-center overflow-hidden text-ui-micro font-semibold uppercase select-none cursor-pointer shrink-0 ring-1 ring-[var(--nim-bg)] ${paletteClass}`}
        data-testid="agent-avatar"
        data-session-id={session.id}
        data-session-status={session.status || 'running'}
      >
        {twoChars}
      </div>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[9999] px-2 py-1 rounded-ui-base bg-nim border border-nim text-ui-caption shadow-lg pointer-events-none flex flex-col gap-1"
            data-testid="agent-avatar-popover"
          >
            <span className="font-semibold text-nim truncate max-w-[220px]" data-testid="agent-avatar-popover-title">
              {title}
            </span>
            <span className="text-ui-micro text-nim-muted" data-testid="agent-avatar-popover-status">
              {session.status || 'running'}
            </span>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * AgentBusyIndicator - Concise, one-sentence agent busy status indicator with stacked avatars.
 *
 * Pattern:
 *   Left: Stacked avatars/icons of running workers (-6px overlap)
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
  const runningSessions = activeSessions.filter((s) => !s.status || s.status === 'running');

  return (
    <div
      className={`agent-busy-indicator inline-flex items-center gap-2 px-3 py-1 rounded-ui-full border transition-colors ${
        isWorking
          ? 'bg-nim-primary-subtle border-nim-primary-subtle text-[var(--nim-primary)]'
          : 'bg-[var(--nim-bg-secondary)] border-[var(--nim-border)] text-[var(--nim-text-muted)]'
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
        {runningSessions.length > 0 ? (
          runningSessions.map((session, index) => (
            <SessionAvatar
              key={session.id || index}
              session={session}
              index={index}
            />
          ))
        ) : (
          <div
            className={`w-5 h-5 rounded-ui-full ring-1 ring-[var(--nim-bg)] flex items-center justify-center text-ui-caption ${
              isWorking
                ? 'bg-nim-primary-subtle text-[var(--nim-primary)]'
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
      <span className="text-ui-compact font-medium tracking-tight whitespace-nowrap" data-testid="agent-busy-text">
        {statusSentence}
      </span>

      {queuedCount > 0 && (
        <span className="text-ui-micro px-2 py-0.5 rounded-ui-full bg-nim-warning-subtle text-[var(--nim-warning)] border border-nim-warning-subtle font-mono">
          +{queuedCount} queued
        </span>
      )}
    </div>
  );
};

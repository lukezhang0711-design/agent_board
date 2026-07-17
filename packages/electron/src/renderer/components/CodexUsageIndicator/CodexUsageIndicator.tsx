/**
 * CodexUsageIndicator - Circular progress indicator for Codex usage
 *
 * Displays the highest current pool utilization as a circular progress ring
 * in the navigation gutter. Clicking opens a popover with every pool.
 * Error states render as a blank ("--") indicator with hover details.
 */

import React, { useState, useRef, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import {
  codexUsageAtom,
  codexUsageAvailableAtom,
  codexUsageSessionColorAtom,
  codexUsageSummaryPoolAtom,
  formatResetTime,
} from '../../store/atoms/codexUsageAtoms';
import { useSetting } from '../../hooks/useSetting';
import { CodexUsagePopover } from './CodexUsagePopover';
import { refreshCodexUsage } from '../../store/listeners/codexUsageListeners';
import { formatUsageLastUpdated } from '../UsageIndicator/UsagePoolList';

const RING_RADIUS = 12;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface CodexUsageIndicatorProps {
  className?: string;
}

export const CodexUsageIndicator: React.FC<CodexUsageIndicatorProps> = ({ className }) => {
  const usage = useAtomValue(codexUsageAtom);
  const isAvailable = useAtomValue(codexUsageAvailableAtom);
  const isEnabled = useSetting('ai.showCodexUsageIndicator');
  const sessionColor = useAtomValue(codexUsageSessionColorAtom);
  const summaryPool = useAtomValue(codexUsageSummaryPoolAtom);

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    setIsPopoverOpen((prev) => !prev);
  }, []);

  const handleRefresh = useCallback(async () => {
    await refreshCodexUsage();
  }, []);

  if (!isEnabled || !isAvailable) {
    return null;
  }

  const utilization = summaryPool?.utilization ?? null;
  const clampedUtilization = utilization === null ? 0 : Math.max(0, Math.min(100, utilization));
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - clampedUtilization / 100);
  const limitsAvailable = summaryPool !== null;

  const colorClasses: Record<string, string> = {
    green: 'stroke-green-500',
    yellow: 'stroke-yellow-500',
    red: 'stroke-red-500',
    muted: 'stroke-nim-muted',
  };

  const effectiveSessionColor = summaryPool && !summaryPool.stale ? sessionColor : 'muted';
  const strokeColor = colorClasses[effectiveSessionColor] || colorClasses.muted;

  const tooltipContent = summaryPool
    ? summaryPool.stale
      ? `Codex ${summaryPool.name}: ${summaryPool.utilization}% · Last updated ${formatUsageLastUpdated(summaryPool.updatedAt)}`
      : `Codex ${summaryPool.name}: ${summaryPool.utilization}% (resets ${formatResetTime(summaryPool.resetsAt)})`
    : usage?.error
      ? `Codex usage unavailable: ${usage.error}`
      : 'Codex usage unavailable';

  return (
    <div className={`codex-usage-indicator relative ${className || ''}`}>
      <button
        ref={buttonRef}
        onClick={handleClick}
        title={tooltipContent}
        className="relative w-9 h-9 flex items-center justify-center bg-transparent border-none rounded-md cursor-pointer transition-all duration-150 p-0 hover:bg-nim-tertiary active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2"
        aria-label="Codex Usage"
        data-testid="codex-usage-indicator"
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          className="transform -rotate-90"
        >
          {/* Background ring */}
          <circle
            cx="16"
            cy="16"
            r={RING_RADIUS}
            fill="none"
            className="stroke-nim-tertiary"
            strokeWidth="3"
          />
          {/* Progress ring */}
          <circle
            cx="16"
            cy="16"
            r={RING_RADIUS}
            fill="none"
            className={strokeColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 0.3s ease' }}
          />
        </svg>
        {/* Percentage text */}
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-nim">
          {limitsAvailable ? `${utilization}%` : '--'}
        </span>
      </button>

      {isPopoverOpen && (
        <CodexUsagePopover
          anchorRef={buttonRef}
          onClose={() => setIsPopoverOpen(false)}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
};

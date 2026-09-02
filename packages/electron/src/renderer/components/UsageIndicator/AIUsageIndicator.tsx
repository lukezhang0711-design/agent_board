/**
 * AIUsageIndicator - Consolidated usage indicator in the navigation gutter
 *
 * Displays a clean 'speed' gauge icon. Clicking opens the unified popover
 * showing real usage/quota from Claude, Codex, and Gemini.
 * No warning badges/dots are shown on the icon itself.
 */

import React, { useState, useRef, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { HelpTooltip } from '../../help';
import { AIUsagePopover } from './AIUsagePopover';
import { refreshClaudeUsage } from '../../store/listeners/claudeUsageListeners';
import { refreshCodexUsage } from '../../store/listeners/codexUsageListeners';
import { refreshGeminiUsage } from '../../store/listeners/geminiUsageListeners';

interface AIUsageIndicatorProps {
  className?: string;
}

export const AIUsageIndicator: React.FC<AIUsageIndicatorProps> = ({ className }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    setIsPopoverOpen((prev) => !prev);
  }, []);

  const handleRefreshAll = useCallback(async () => {
    await Promise.allSettled([
      refreshClaudeUsage(),
      refreshCodexUsage(),
      refreshGeminiUsage(),
    ]);
  }, []);

  return (
    <div className={`ai-usage-indicator relative ${className || ''}`}>
      <HelpTooltip testId="gutter-ai-usage-button" placement="right">
        <button
          ref={buttonRef}
          onClick={handleClick}
          className={`nav-button relative w-9 h-9 flex items-center justify-center bg-transparent border-none rounded-md cursor-pointer transition-all duration-150 p-0 hover:bg-nim-tertiary active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${isPopoverOpen ? 'bg-nim-tertiary text-nim' : 'text-nim-muted hover:text-nim'}`}
          aria-label="AI 用量"
          aria-expanded={isPopoverOpen}
          data-testid="ai-usage-indicator"
        >
          <MaterialSymbol icon="speed" size={20} />
        </button>
      </HelpTooltip>

      {isPopoverOpen && (
        <AIUsagePopover
          anchorRef={buttonRef}
          onClose={() => setIsPopoverOpen(false)}
          onRefresh={handleRefreshAll}
        />
      )}
    </div>
  );
};

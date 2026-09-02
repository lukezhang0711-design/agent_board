import React from 'react';
import type { ClaudeAuthState } from '../../store/atoms/claudeAuthAtoms';
import { getClaudeIdentityBadge } from '../../utils/claudeIdentity';

export function ClaudeIdentityBadge({
  authState,
  apiKeys,
}: {
  authState: ClaudeAuthState | null | undefined;
  apiKeys: Record<string, string> | null | undefined;
}) {
  const badge = getClaudeIdentityBadge(authState, apiKeys);
  const ariaLabel = badge.guidance ? `${badge.label}：${badge.guidance}` : badge.label;

  return (
    <span
      className="claude-identity-badge rounded-ui-base px-2 py-0.5 text-ui-micro font-normal text-[var(--nim-text-faint)] border border-[var(--nim-border)]"
      data-testid="claude-identity-badge"
      aria-label={ariaLabel}
      title={badge.guidance}
    >
      {badge.label}
    </span>
  );
}

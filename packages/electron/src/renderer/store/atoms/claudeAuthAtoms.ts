import { atom } from 'jotai';

export type ClaudeAuthStateKind = 'logged-in' | 'logged-out' | 'check-failed' | 'unknown';

/**
 * The renderer projection of the main-process Claude CLI auth authority.
 * It deliberately contains no SDK/account-info fields: consumers must make
 * their login decision from the CLI status alone.
 */
export interface ClaudeAuthState {
  status: ClaudeAuthStateKind;
  source: 'claude-cli-auth-status';
  checkedAt: number | null;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  organization?: string;
  subscriptionType?: string;
  error?: string;
}

export function unknownClaudeAuthState(): ClaudeAuthState {
  return {
    status: 'unknown',
    source: 'claude-cli-auth-status',
    checkedAt: null,
  };
}

/** Updated only by the centralized Claude auth listener. */
export const claudeAuthStateAtom = atom<ClaudeAuthState>(unknownClaudeAuthState());

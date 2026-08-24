import { atom } from 'jotai';

export interface SessionCreationFailure {
  error: string;
  provider?: string;
  model?: string;
}

/**
 * The central IPC listener writes here; App owns the one user-visible
 * recovery dialog so every session-creation entry point behaves the same.
 */
export const sessionCreationFailureAtom = atom<SessionCreationFailure | null>(null);

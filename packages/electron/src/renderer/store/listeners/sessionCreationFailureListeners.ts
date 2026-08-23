import { store } from '../index';
import {
  sessionCreationFailureAtom,
  type SessionCreationFailure,
} from '../atoms/sessionCreationFailure';

function isSessionCreationFailure(value: unknown): value is SessionCreationFailure {
  if (!value || typeof value !== 'object') return false;
  const failure = value as Partial<SessionCreationFailure>;
  return typeof failure.error === 'string';
}

/**
 * Centralized IPC boundary for failures returned by SessionHandlers. Keeping
 * it here guarantees normal, Meta Agent, tracker, and child-session callers
 * share a single visible failure path instead of each silently ignoring an
 * invoke result.
 */
export function initSessionCreationFailureListeners(): () => void {
  return window.electronAPI.on('sessions:create-failed', (payload: unknown) => {
    if (!isSessionCreationFailure(payload)) {
      console.error('[SessionCreationFailureListeners] Ignored malformed session-create failure payload');
      return;
    }
    store.set(sessionCreationFailureAtom, payload);
  });
}

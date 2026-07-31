/**
 * Production wiring for the `claude-code-cli` queue flusher (NIM-806 — input
 * integration / queued prompts).
 *
 * Binds the real `getQueuedPromptsStore()` (the SAME store the renderer and
 * mobile write to via `ai:createQueuedPrompt`) and the shared submit composer,
 * and guards against concurrent flushes for a session. Invoked from the
 * launcher's PID `idle` transition (`claudeCliLauncherSingleton`). Kept separate
 * from the pure core so the core unit-tests without pulling in electron.
 */

import { BrowserWindow } from 'electron';
import { getQueuedPromptsStore } from '../RepositoryManager';
import { logger } from '../../utils/logger';
import { submitClaudeCliPromptProduction } from './claudeCliSubmitSingleton';
import { flushNextClaudeCliQueuedPrompt } from './claudeCliQueueFlush';

/** Per-session guard so two close `idle` events can't double-flush. */
const flushInFlight = new Set<string>();

export type ClaudeCliQueueFlushReason = 'idle-transition' | 'fallback-silence' | 'immediate-kick' | 'other';

/**
 * Flush the next queued prompt for a session on PID `idle`. Best-effort and
 * self-guarded — never throws into the turn-state callback.
 */
export async function flushNextClaudeCliQueuedPromptForSession(
  sessionId: string,
  workspacePath: string,
  reason: ClaudeCliQueueFlushReason = 'other',
): Promise<boolean> {
  if (flushInFlight.has(sessionId)) {
    logger.main.info(`[CliQueue] flush skipped sessionId=${sessionId} reason=${reason} result=in-flight`);
    return false;
  }
  flushInFlight.add(sessionId);
  try {
    logger.main.info(`[CliQueue] flush triggered sessionId=${sessionId} reason=${reason}`);
    const store = getQueuedPromptsStore();
    let claimedOrigin: 'user' | 'child_session_event' | undefined;
    let claimedPromptId: string | undefined;
    return await flushNextClaudeCliQueuedPrompt(
      { sessionId, workspacePath },
      {
        listPending: async (s) => {
          const pending = await store.listPending(s);
          logger.main.info(`[CliQueue] flush listPending sessionId=${s} count=${pending.length} promptIds=${pending.map((item) => item.id).join(',') || 'none'}`);
          return pending;
        },
        claim: async (id) => {
          const claimed = await store.claim(id);
          claimedOrigin = claimed?.origin;
          claimedPromptId = claimed?.id;
          logger.main.info(`[CliQueue] flush claim sessionId=${sessionId} promptId=${id} result=${claimed ? 'claimed' : 'not-claimed'}`);
          return claimed;
        },
        complete: (id) => store.complete(id),
        fail: (id, m) => store.fail(id, m),
        submit: async (input) => {
          try {
            const result = await submitClaudeCliPromptProduction({ ...input, origin: claimedOrigin });
            logger.main.info(`[CliQueue] flush submit sessionId=${sessionId} promptId=${claimedPromptId ?? 'unknown'} result=${result.submitted ? 'submitted' : 'not-submitted'}`);
            return result;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.main.error(`[CliQueue] flush submit failed sessionId=${sessionId} promptId=${claimedPromptId ?? 'unknown'} error=${errorMessage}`);
            throw error;
          }
        },
        // The flush runs from the PID-idle transition with no originating IPC
        // event, so there is no single target window; broadcasting is safe
        // because the renderer filters by sessionId (NIM-830).
        notifyClaimed: (promptId) => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send('ai:promptClaimed', { sessionId, promptId });
            }
          }
        },
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.main.warn(`[CliQueue] flush failed sessionId=${sessionId} reason=${reason} error=${errorMessage}`);
    return false;
  } finally {
    flushInFlight.delete(sessionId);
  }
}

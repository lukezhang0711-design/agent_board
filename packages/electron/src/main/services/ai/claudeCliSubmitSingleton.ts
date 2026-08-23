/**
 * Production wiring for `submitClaudeCliPrompt` (NIM-806 — input integration).
 *
 * Keeps the pure submit core (`claudeCliSubmit.ts`) free of electron/runtime
 * singletons so it unit-tests with injected deps. This module binds the real
 * terminal manager, the transcript user-prompt log, and PostHog analytics.
 */

import type { ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { AISessionsRepository } from '@nimbalyst/runtime';
import { getTerminalSessionManager } from '../TerminalSessionManager';
import { AnalyticsService } from '../analytics/AnalyticsService';
import { bucketMessageLength } from './aiServiceUtils';
import { logClaudeCliUserPrompt } from './claudeCliUserPromptLog';
import { submitClaudeCliPrompt, type SubmitClaudeCliPromptInput } from './claudeCliSubmit';
import { detectInteractiveCliCommand } from './claudeCliInteractiveCommands';
import { broadcastClaudeCliRevealTerminal } from './claudeCliRevealTerminal';
import { assertDynamicModelCatalogSelection } from './modelCatalogValidation';

/**
 * The CLI has several input routes (direct composer submit, queued idle flush,
 * and channel health). Put the live directory gate at their shared final PTY
 * boundary so an already-active terminal cannot keep using a stale model.
 */
export async function assertClaudeCliSessionModelCanSubmit(sessionId: string): Promise<void> {
  const session = await AISessionsRepository.get(sessionId);
  if (!session) {
    throw new Error(`Claude CLI 会话“${sessionId}”不存在，无法验证当前模型目录。`);
  }
  if (session.provider !== 'claude-code-cli') {
    throw new Error(`会话“${sessionId}”不是 Claude CLI 通道，拒绝向 PTY 写入提示。`);
  }
  await assertDynamicModelCatalogSelection('claude-code-cli', session.model ?? undefined);
}

/** Submit a CLI prompt using the real terminal/log/analytics deps. */
export async function submitClaudeCliPromptProduction(
  input: SubmitClaudeCliPromptInput,
): Promise<{ submitted: boolean }> {
  await assertClaudeCliSessionModelCanSubmit(input.sessionId);
  const manager = getTerminalSessionManager();
  const result = await submitClaudeCliPrompt(input, {
    writeToTerminal: (sessionId: string, data: string) => manager.writeToTerminal(sessionId, data),
    logUserPrompt: (p: {
      sessionId: string;
      workspacePath: string;
      prompt: string;
      attachments?: ChatAttachment[];
    }) => logClaudeCliUserPrompt(p),
    sendAnalytics: ({ messageLength, hasAttachments, attachmentCount, hasDocumentContext }) => {
      // Analytics parity with the SDK path (MessageStreamingHandler fires
      // ai_message_sent per send). Document-context and attachment flags are real
      // (NIM-818).
      try {
        AnalyticsService.getInstance().sendEvent('ai_message_sent', {
          provider: 'claude-code-cli',
          hasDocumentContext,
          hasAttachments,
          attachmentCount,
          messageLength: bucketMessageLength(messageLength),
          contentMode: 'unknown',
        });
      } catch {
        // analytics is best-effort; never block the send
      }
    },
    delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  // NIM-810: tell the renderer whether this submit was an interactive slash
  // command so it can reveal the raw-terminal drawer (and focus it) for the
  // native picker — or collapse an auto-revealed drawer on a normal prompt.
  // Only signal for real sends; a no-op (empty prompt) leaves the drawer alone.
  if (result.submitted) {
    const command = detectInteractiveCliCommand(input.prompt);
    broadcastClaudeCliRevealTerminal({
      sessionId: input.sessionId,
      interactive: command !== null,
      source: 'input',
      ...(command ? { command } : {}),
    });
  }

  return result;
}

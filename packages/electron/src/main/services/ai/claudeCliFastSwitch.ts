/**
 * Session-level Fast mode control for the genuine `claude-code-cli` terminal.
 *
 * Fast mode is a CLI session setting, not a model variant. As with `/model`,
 * Ink consumes a separately-written Enter more reliably than `command + \r`
 * in one PTY write.
 */

/** Gap between the slash command and Enter; kept in step with model switching. */
export const FAST_SWITCH_WRITE_GAP_MS = 25;

export interface SwitchClaudeCliFastModeInput {
  sessionId: string;
  enabled: boolean;
}

export interface SwitchClaudeCliFastModeDeps {
  writeToTerminal: (sessionId: string, data: string) => void;
  delay: (ms: number) => Promise<void>;
}

export type SwitchClaudeCliFastModeResult = { switched: true; enabled: boolean };

export function buildClaudeCliFastSwitchCommand(enabled: boolean): '/fast on' | '/fast off' {
  return enabled ? '/fast on' : '/fast off';
}

/** Send the request only. The renderer updates state after a CLI echo arrives. */
export async function switchClaudeCliFastMode(
  input: SwitchClaudeCliFastModeInput,
  deps: SwitchClaudeCliFastModeDeps,
): Promise<SwitchClaudeCliFastModeResult> {
  deps.writeToTerminal(input.sessionId, buildClaudeCliFastSwitchCommand(input.enabled));
  await deps.delay(FAST_SWITCH_WRITE_GAP_MS);
  deps.writeToTerminal(input.sessionId, '\r');
  return { switched: true, enabled: input.enabled };
}

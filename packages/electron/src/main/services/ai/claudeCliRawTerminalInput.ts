/**
 * Guard raw terminal input for a live Claude CLI session.
 *
 * xterm delivers keystrokes one chunk at a time, so text may already be shown
 * in the native CLI before Enter arrives. Model selection and prompt execution
 * happen on Enter; hold that byte until the current dynamic catalog validates.
 * This preserves read-only terminal observation and non-executing editing keys
 * without permitting `/model <anything>` to bypass the controlled picker.
 */

export interface ClaudeCliRawTerminalInputState {
  line: string;
}

export interface ClaudeCliRawTerminalInputDeps {
  writeToTerminal: (data: string) => void;
  assertCurrentModel: () => Promise<void>;
}

export type ClaudeCliRawTerminalInputResult =
  | { accepted: true }
  | { accepted: false; error: string };

export function createClaudeCliRawTerminalInputState(): ClaudeCliRawTerminalInputState {
  return { line: '' };
}

function isModelCommand(line: string): boolean {
  return /^\s*\/model(?:\s|$)/i.test(line);
}

function updateLine(state: ClaudeCliRawTerminalInputState, character: string): void {
  if (character === '\x7f' || character === '\b') {
    state.line = state.line.slice(0, -1);
    return;
  }
  if (character === '\x15') { // Ctrl-U: clear the editable terminal line.
    state.line = '';
    return;
  }
  if (character === '\x03') { // Ctrl-C cancels the line rather than executing it.
    state.line = '';
    return;
  }
  // Keep only printable text for command recognition. Escape sequences used
  // by arrows/pickers are forwarded but do not become a fake command line.
  if (character >= ' ' && character !== '\x7f') {
    state.line += character;
  }
}

/**
 * Forward a raw xterm chunk. It deliberately withholds only Enter for a
 * dynamic session: a failed catalog therefore leaves typed text unexecuted.
 */
export async function writeGuardedClaudeCliRawTerminalInput(
  data: string,
  state: ClaudeCliRawTerminalInputState,
  deps: ClaudeCliRawTerminalInputDeps,
): Promise<ClaudeCliRawTerminalInputResult> {
  for (const character of data) {
    if (character === '\r' || character === '\n') {
      if (isModelCommand(state.line)) {
        state.line = '';
        return {
          accepted: false,
          error: 'Claude CLI 的 /model 原始终端命令已禁用。请使用模型选择器；它会验证当前引擎目录。',
        };
      }
      try {
        await deps.assertCurrentModel();
      } catch (error) {
        state.line = '';
        return {
          accepted: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      deps.writeToTerminal(character);
      state.line = '';
      continue;
    }
    deps.writeToTerminal(character);
    updateLine(state, character);
  }
  return { accepted: true };
}

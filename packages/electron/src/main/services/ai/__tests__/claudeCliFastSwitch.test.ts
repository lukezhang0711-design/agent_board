import { describe, expect, it, vi } from 'vitest';
import {
  FAST_SWITCH_WRITE_GAP_MS,
  buildClaudeCliFastSwitchCommand,
  switchClaudeCliFastMode,
} from '../claudeCliFastSwitch';

describe('claude-code-cli Fast mode switch', () => {
  it('has a PTY entry point and writes /fast on followed by a separate Enter', async () => {
    const writes: string[] = [];
    const deps = {
      writeToTerminal: vi.fn((_sessionId: string, data: string) => writes.push(data)),
      delay: vi.fn(async (_ms: number) => {}),
    };

    expect(buildClaudeCliFastSwitchCommand(true)).toBe('/fast on');
    expect(await switchClaudeCliFastMode({ sessionId: 'cli-session', enabled: true }, deps))
      .toEqual({ switched: true, enabled: true });
    expect(writes).toEqual(['/fast on', '\r']);
    expect(deps.delay).toHaveBeenCalledWith(FAST_SWITCH_WRITE_GAP_MS);
  });

  it('writes /fast off without treating a PTY write as an optimistic state update', async () => {
    const writes: string[] = [];
    const deps = {
      writeToTerminal: vi.fn((_sessionId: string, data: string) => writes.push(data)),
      delay: vi.fn(async (_ms: number) => {}),
    };

    expect(buildClaudeCliFastSwitchCommand(false)).toBe('/fast off');
    expect(await switchClaudeCliFastMode({ sessionId: 'cli-session', enabled: false }, deps))
      .toEqual({ switched: true, enabled: false });
    expect(writes).toEqual(['/fast off', '\r']);
  });
});

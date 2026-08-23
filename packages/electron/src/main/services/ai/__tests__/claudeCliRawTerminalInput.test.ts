import { describe, expect, it, vi } from 'vitest';
import {
  createClaudeCliRawTerminalInputState,
  writeGuardedClaudeCliRawTerminalInput,
} from '../claudeCliRawTerminalInput';

describe('guarded Claude CLI raw terminal input', () => {
  it('validates the current live model before forwarding Enter', async () => {
    const writes: string[] = [];
    const assertCurrentModel = vi.fn(async () => {});

    await expect(writeGuardedClaudeCliRawTerminalInput(
      'implement this\r',
      createClaudeCliRawTerminalInputState(),
      { writeToTerminal: (data) => writes.push(data), assertCurrentModel },
    )).resolves.toEqual({ accepted: true });

    expect(writes.join('')).toBe('implement this\r');
    expect(assertCurrentModel).toHaveBeenCalledOnce();
  });

  it('does not forward Enter when the model directory has failed', async () => {
    const writes: string[] = [];

    await expect(writeGuardedClaudeCliRawTerminalInput(
      'must not execute\r',
      createClaudeCliRawTerminalInputState(),
      {
        writeToTerminal: (data) => writes.push(data),
        assertCurrentModel: async () => { throw new Error('supportedModels(): request timed out'); },
      },
    )).resolves.toEqual({ accepted: false, error: 'supportedModels(): request timed out' });

    expect(writes.join('')).toBe('must not execute');
  });

  it('blocks a raw /model command before it can change the active CLI model', async () => {
    const writes: string[] = [];
    const assertCurrentModel = vi.fn(async () => {});

    const result = await writeGuardedClaudeCliRawTerminalInput(
      '/model removed-model\r',
      createClaudeCliRawTerminalInputState(),
      { writeToTerminal: (data) => writes.push(data), assertCurrentModel },
    );

    expect(result).toMatchObject({ accepted: false, error: expect.stringContaining('/model') });
    expect(writes.join('')).toBe('/model removed-model');
    expect(assertCurrentModel).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

// These assertions exercise the exported Fast-mode policy only. Avoid loading
// the large rich-transcript renderer (and its syntax-highlight language pack)
// which is unrelated to this toolbar policy.
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/AgentTranscriptPanel', () => ({
  AgentTranscriptPanel: () => null,
}));
vi.mock('@nimbalyst/runtime/store', () => ({
  store: { get: () => null },
  registerInteractiveWidgetHost: () => {},
  unregisterInteractiveWidgetHost: () => {},
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/utils/messageTypeHelpers', () => ({
  isToolLikeMessage: () => false,
}));
import {
  CLAUDE_CLI_FAST_MODE_CONFIRMATION_KEY,
  hasConfirmedClaudeCliFastMode,
  isClaudeCliFastModeSupportedModel,
  parseClaudeCliFastModeOutput,
  rememberClaudeCliFastModeConfirmation,
} from '../SessionTranscript';

describe('Claude Code CLI Fast mode toolbar policy', () => {
  it('only recognises Opus-family models as eligible', () => {
    expect(isClaudeCliFastModeSupportedModel('claude-code-cli:opus')).toBe(true);
    expect(isClaudeCliFastModeSupportedModel('claude-code-cli:opus-4-8')).toBe(true);
    expect(isClaudeCliFastModeSupportedModel('claude-code-cli:sonnet')).toBe(false);
    expect(isClaudeCliFastModeSupportedModel('claude-code:opus')).toBe(true);
    expect(isClaudeCliFastModeSupportedModel(undefined)).toBe(false);
  });
});

describe('Claude Code CLI Fast mode output', () => {
  it('uses the CLI ON/OFF echo as the state transition', () => {
    expect(parseClaudeCliFastModeOutput('\u001B[32mFast mode ON\u001B[0m')).toEqual({ kind: 'enabled', enabled: true });
    expect(parseClaudeCliFastModeOutput('Fast mode disabled')).toEqual({ kind: 'enabled', enabled: false });
  });

  it('preserves a CLI refusal as displayable rejection text', () => {
    expect(parseClaudeCliFastModeOutput('Fast mode is not available for this organization')).toEqual({
      kind: 'rejected',
      message: 'Fast mode is not available for this organization',
    });
  });
});

describe('Claude Code CLI Fast mode confirmation', () => {
  it('records approval once so later enables do not need another confirmation', () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };

    expect(hasConfirmedClaudeCliFastMode(fakeStorage)).toBe(false);
    rememberClaudeCliFastModeConfirmation(fakeStorage);
    expect(storage.get(CLAUDE_CLI_FAST_MODE_CONFIRMATION_KEY)).toBe('true');
    expect(hasConfirmedClaudeCliFastMode(fakeStorage)).toBe(true);
  });
});

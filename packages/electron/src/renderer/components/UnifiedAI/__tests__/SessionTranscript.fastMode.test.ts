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
vi.mock('../../CustomEditors/registry', () => ({
  customEditorRegistry: { get: () => null },
}));
import {
  CLAUDE_CLI_FAST_MODE_CONFIRMATION_SETTING,
  isClaudeCliFastModeConfirmationAccepted,
  isClaudeCliFastModeSupportedModel,
  loadClaudeCliFastModeConfirmation,
  parseClaudeCliFastModeOutput,
  persistClaudeCliFastModeConfirmation,
  shouldShowClaudeCliFastModeToggle,
} from '../SessionTranscript';

describe('Claude Code CLI Fast mode toolbar policy', () => {
  it('only recognises Opus-family models as eligible', () => {
    expect(isClaudeCliFastModeSupportedModel('claude-code-cli:opus')).toBe(true);
    expect(isClaudeCliFastModeSupportedModel('claude-code-cli:opus-4-8')).toBe(true);
    expect(isClaudeCliFastModeSupportedModel('claude-code-cli:sonnet')).toBe(false);
    expect(isClaudeCliFastModeSupportedModel('claude-code:opus')).toBe(true);
    expect(isClaudeCliFastModeSupportedModel(undefined)).toBe(false);
  });

  it('renders only for an idle, committed claude-code-cli Opus session', () => {
    expect(shouldShowClaudeCliFastModeToggle('claude-code-cli', 'claude-code-cli:opus', true, true)).toBe(true);
    expect(shouldShowClaudeCliFastModeToggle('claude-code', 'claude-code:opus', true, true)).toBe(false);
    expect(shouldShowClaudeCliFastModeToggle('claude-code-cli', 'claude-code-cli:sonnet', true, true)).toBe(false);
    expect(shouldShowClaudeCliFastModeToggle('claude-code-cli', 'claude-code-cli:opus', false, true)).toBe(false);
    expect(shouldShowClaudeCliFastModeToggle('claude-code-cli', 'claude-code-cli:opus', true, false)).toBe(false);
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
  it('loads and persists a single app-settings acknowledgement', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'app-settings:get' ? true : undefined);
    expect(CLAUDE_CLI_FAST_MODE_CONFIRMATION_SETTING).toBe('claudeCliFastModeConfirmationAccepted');
    expect(await loadClaudeCliFastModeConfirmation(invoke)).toBe(true);
    await persistClaudeCliFastModeConfirmation(invoke);
    expect(invoke).toHaveBeenNthCalledWith(1, 'app-settings:get', CLAUDE_CLI_FAST_MODE_CONFIRMATION_SETTING);
    expect(invoke).toHaveBeenNthCalledWith(2, 'app-settings:set', CLAUDE_CLI_FAST_MODE_CONFIRMATION_SETTING, true);
    expect(isClaudeCliFastModeConfirmationAccepted(undefined)).toBe(false);
    expect(isClaudeCliFastModeConfirmationAccepted('true')).toBe(false);
  });
});

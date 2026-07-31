import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_VARIANTS } from '@nimbalyst/runtime/ai/server/types';
import { supportsEffortLevel } from '../modelUtils';

describe('supportsEffortLevel', () => {
  it('supports all shared Claude Code variants, including 1M rows, for both transports', () => {
    for (const provider of ['claude-code', 'claude-code-cli']) {
      for (const variant of CLAUDE_CODE_VARIANTS) {
        expect(supportsEffortLevel(`${provider}:${variant}`)).toBe(true);
        expect(supportsEffortLevel(`${provider}:${variant}-1m`)).toBe(true);
      }
    }
  });

  it('supports new 5-series variants for both Claude Code transports', () => {
    expect(supportsEffortLevel('claude-code:opus-5')).toBe(true);
    expect(supportsEffortLevel('claude-code:sonnet-5')).toBe(true);
    expect(supportsEffortLevel('claude-code-cli:opus-5')).toBe(true);
  });

  it('keeps the legacy Claude and Codex support paths', () => {
    expect(supportsEffortLevel('claude-code:opus')).toBe(true);
    expect(supportsEffortLevel('claude-code:opus-4-6')).toBe(true);
    expect(supportsEffortLevel('claude-code:sonnet')).toBe(true);
    expect(supportsEffortLevel('openai-codex:gpt-5.4')).toBe(true);
    expect(supportsEffortLevel('openai-codex-acp:gpt-5.4')).toBe(true);
  });
});

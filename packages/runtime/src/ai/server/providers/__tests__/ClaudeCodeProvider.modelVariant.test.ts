import { describe, it, expect } from 'vitest';
import { resolveClaudeCodeModelVariant } from '../../types';
import { ModelIdentifier } from '../../ModelIdentifier';

const DEFAULT_MODEL = 'claude-code:opus-1m';

describe('resolveClaudeCodeModelVariant', () => {
  it('passes a dynamically discovered SDK alias through unchanged', () => {
    expect(resolveClaudeCodeModelVariant('claude-code:sonnet', DEFAULT_MODEL)).toBe('sonnet');
    expect(resolveClaudeCodeModelVariant('claude-code:claude-fable-5', DEFAULT_MODEL)).toBe('claude-fable-5');
    expect(resolveClaudeCodeModelVariant('claude-code:opus-5', DEFAULT_MODEL)).toBe('opus-5');
  });

  it('converts only the persisted -1m transport suffix back to the SDK [1m] form', () => {
    expect(resolveClaudeCodeModelVariant('claude-code:opus-1m', DEFAULT_MODEL)).toBe('opus[1m]');
    expect(resolveClaudeCodeModelVariant('claude-code:claude-opus-5-1m', DEFAULT_MODEL)).toBe('claude-opus-5[1m]');
    expect(resolveClaudeCodeModelVariant('opus-4-8-1m', DEFAULT_MODEL)).toBe('opus-4-8[1m]');
  });

  it('does not contain a static Claude Agent allowlist or alias rewrite table', () => {
    expect(ModelIdentifier.parse('claude-code:not-yet-known-to-this-build').combined)
      .toBe('claude-code:not-yet-known-to-this-build');
    expect(resolveClaudeCodeModelVariant('claude-code:not-yet-known-to-this-build', DEFAULT_MODEL))
      .toBe('not-yet-known-to-this-build');
  });

  it('retains the legacy default only when an old session has no model', () => {
    expect(resolveClaudeCodeModelVariant(undefined, DEFAULT_MODEL)).toBe('opus[1m]');
    expect(resolveClaudeCodeModelVariant('', DEFAULT_MODEL)).toBe('opus[1m]');
  });

  it('rejects a model for another provider', () => {
    expect(() => resolveClaudeCodeModelVariant('openai:gpt-5', DEFAULT_MODEL)).toThrow(
      'Claude Agent requires a claude-code:* model identifier',
    );
  });
});

/**
 * Unit tests for importedClaudeCodeModel - the helper that preserves the raw
 * per-turn engine id on imported Claude Code entries. It must not infer a
 * static variant; the live supportedModels() catalog resolves it at send time.
 */

import { describe, it, expect } from 'vitest';
import { importedClaudeCodeModel } from '../ClaudeCodeSessionSync';
import type { ClaudeCodeEntry } from '../ClaudeCodeSessionScanner';

function assistant(model: string | undefined): ClaudeCodeEntry {
  return { type: 'assistant', message: model === undefined ? {} : { model } };
}

describe('importedClaudeCodeModel', () => {
  it('preserves an opus engine id without guessing a local alias', () => {
    expect(importedClaudeCodeModel([assistant('claude-opus-4-7')])).toBe(
      'claude-code:claude-opus-4-7',
    );
  });

  it('preserves a sonnet engine id without guessing a local alias', () => {
    expect(importedClaudeCodeModel([assistant('claude-sonnet-4-6')])).toBe(
      'claude-code:claude-sonnet-4-6',
    );
  });

  it('preserves a haiku engine id without guessing a local alias', () => {
    expect(importedClaudeCodeModel([assistant('claude-haiku-4-5-20251001')])).toBe(
      'claude-code:claude-haiku-4-5-20251001',
    );
  });

  it('uses the most recent non-empty engine id when models differ', () => {
    // A session that started on Sonnet and switched to Opus should report Opus.
    const entries = [assistant('claude-sonnet-4-6'), assistant('claude-opus-4-7')];
    expect(importedClaudeCodeModel(entries)).toBe('claude-code:claude-opus-4-7');
  });

  it('skips entries that carry no model (user / tool turns)', () => {
    const entries: ClaudeCodeEntry[] = [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      assistant('claude-opus-4-7'),
      { type: 'user', message: { role: 'user', content: 'thanks' } },
    ];
    expect(importedClaudeCodeModel(entries)).toBe('claude-code:claude-opus-4-7');
  });

  it('returns undefined for an empty session', () => {
    expect(importedClaudeCodeModel([])).toBeUndefined();
  });

  it('returns undefined when no turn has a model', () => {
    const entries: ClaudeCodeEntry[] = [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      assistant(undefined),
    ];
    expect(importedClaudeCodeModel(entries)).toBeUndefined();
  });

  it('preserves future model ids so the live catalog can explicitly reject or resolve them', () => {
    expect(importedClaudeCodeModel([assistant('some-future-model')])).toBe('claude-code:some-future-model');
  });

  it('ignores an empty-string model', () => {
    expect(importedClaudeCodeModel([assistant('')])).toBeUndefined();
  });
});

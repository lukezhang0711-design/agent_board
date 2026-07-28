import { describe, expect, it } from 'vitest';
import {
  extractResolvedClaudeModelFromInit,
  mergeResolvedModelMetadata,
} from '../ClaudeCodeProvider';

describe('Claude Agent SDK resolved-model receipt', () => {
  it('extracts the actual model from a system/init fixture and preserves metadata when storing it', () => {
    const init = {
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-5',
    };

    const resolvedModel = extractResolvedClaudeModelFromInit(init);
    expect(resolvedModel).toBe('claude-opus-5');
    if (!resolvedModel) throw new Error('fixture must include a resolved model');
    expect(mergeResolvedModelMetadata({ phase: 'implementing' }, resolvedModel)).toEqual({
      phase: 'implementing',
      resolvedModel: 'claude-opus-5',
    });
  });

  it('does not manufacture a receipt when the init payload has no model', () => {
    expect(extractResolvedClaudeModelFromInit({ type: 'system', subtype: 'init' })).toBeNull();
  });
});

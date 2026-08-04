import { describe, expect, it } from 'vitest';
import { resolveMetaAgentModel } from '../metaAgentUtils';

describe('resolveMetaAgentModel', () => {
  it('uses the embedded Claude provider for new Meta Agent sessions by default', () => {
    expect(resolveMetaAgentModel('claude-code-cli:sonnet')).toBe('claude-code:sonnet');
  });

  it('restores the stored CLI model when advanced visibility is enabled', () => {
    expect(resolveMetaAgentModel('claude-code-cli:sonnet', true)).toBe('claude-code-cli:sonnet');
  });
});

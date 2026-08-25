import { describe, it, expect } from 'vitest';
import { ProviderFactory } from '../../ProviderFactory';

/**
 * GitHub #631 / NIM-848 — billing safety: the Claude Agent SDK provider must
 * never silently send the paid 1M-context beta when a session's model is
 * lost/empty.
 *
 * An empty model must defer to the SDK's native default; the host must not
 * invent a static model alias or rewrite a raw user selection.
 */
describe('ClaudeCodeProvider silent fallback model (#631)', () => {
  it('uses the SDK native default when the session model is empty', async () => {
    const sessionId = 'fallback-model-test-session';
    const provider = ProviderFactory.createProvider('claude-code', sessionId) as unknown as {
      initialize(config: { model?: string }): Promise<void>;
      resolveModelVariant(): string;
    };
    try {
      // Provider initialized with no model — the lost/empty-model case.
      await provider.initialize({});
      const resolved = provider.resolveModelVariant();
      expect(resolved).toBe('default');
    } finally {
      ProviderFactory.destroyProvider(sessionId, 'claude-code');
    }
  });

  it('keeps a user-selected -1m model raw', async () => {
    const sessionId = 'fallback-model-test-session-1m';
    const provider = ProviderFactory.createProvider('claude-code', sessionId) as unknown as {
      initialize(config: { model?: string }): Promise<void>;
      resolveModelVariant(): string;
    };
    try {
      await provider.initialize({ model: 'claude-code:opus-1m' });
      const resolved = provider.resolveModelVariant();
      expect(resolved).toBe('opus-1m');
    } finally {
      ProviderFactory.destroyProvider(sessionId, 'claude-code');
    }
  });
});

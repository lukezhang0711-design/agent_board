import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from '../ClaudeCodeProvider';
import { ClaudeCodeCliProvider } from '../ClaudeCodeCliProvider';

describe('Claude model catalogs', () => {
  it.each([
    ['Claude Agent', 'claude-code', ClaudeCodeProvider],
    ['Claude Code CLI', 'claude-code-cli', ClaudeCodeCliProvider],
  ] as const)('%s exposes explicit 5-series rows and honest latest aliases', async (prefix, provider, Provider) => {
    const models = await Provider.getModels();
    const modelById = new Map(models.map((model) => [model.id, model]));

    expect(modelById.get(`${provider}:opus-5`)).toMatchObject({
      name: `${prefix} · Opus 5`,
      contextWindow: 200000,
    });
    expect(modelById.get(`${provider}:opus-5-1m`)).toMatchObject({
      name: `${prefix} · Opus 5 (1M)`,
      contextWindow: 1000000,
    });
    expect(modelById.get(`${provider}:sonnet-5`)).toMatchObject({
      name: `${prefix} · Sonnet 5`,
      contextWindow: 200000,
    });
    expect(modelById.get(`${provider}:sonnet-5-1m`)).toMatchObject({
      name: `${prefix} · Sonnet 5 (1M)`,
      contextWindow: 1000000,
    });
    expect(modelById.get(`${provider}:opus`)).toMatchObject({
      name: `${prefix} · Opus (latest)`,
    });
  });
});

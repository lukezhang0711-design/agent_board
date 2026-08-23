import { afterEach, describe, expect, it } from 'vitest';
import type { AIModel } from '../../types';
import { ClaudeCodeProvider } from '../ClaudeCodeProvider';
import { ClaudeCodeCliProvider } from '../ClaudeCodeCliProvider';

const sdkCatalog: AIModel[] = [{
  id: 'claude-code:opus-1m',
  name: 'Claude Agent · Opus (1M context)',
  provider: 'claude-code',
  resolvedModel: 'claude-opus-5[1m]',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'high'],
}];

afterEach(() => {
  ClaudeCodeProvider.setModelCatalogSnapshotResolver(null);
  ClaudeCodeCliProvider.setModelCatalogSnapshotResolver(null);
});

describe('Claude model catalogs', () => {
  it('has no package-local Claude Agent catalog before the host provides a verified SDK snapshot', async () => {
    await expect(ClaudeCodeProvider.getModels()).resolves.toEqual([]);
    await expect(ClaudeCodeCliProvider.getModels()).resolves.toEqual([]);
  });

  it('projects only the host-owned SDK snapshot, including alias resolution and exact effort levels', async () => {
    ClaudeCodeProvider.setModelCatalogSnapshotResolver(() => sdkCatalog);
    ClaudeCodeCliProvider.setModelCatalogSnapshotResolver(() => sdkCatalog.map((model) => ({
      ...model,
      id: model.id.replace('claude-code:', 'claude-code-cli:'),
      provider: 'claude-code-cli',
      name: model.name.replace('Claude Agent', 'Claude Code CLI'),
    })));

    await expect(ClaudeCodeProvider.getModels()).resolves.toEqual(sdkCatalog);
    await expect(ClaudeCodeCliProvider.getModels()).resolves.toEqual([
      expect.objectContaining({
        id: 'claude-code-cli:opus-1m',
        resolvedModel: 'claude-opus-5[1m]',
        supportedEffortLevels: ['low', 'high'],
      }),
    ]);
  });
});

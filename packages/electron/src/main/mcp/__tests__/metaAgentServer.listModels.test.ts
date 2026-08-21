import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/workspaceDetection', () => ({
  resolveProjectPath: (workspaceId: string) => workspaceId,
}));

import {
  dispatchMetaAgentTool,
  getMetaAgentOpenAITools,
  setMetaAgentToolFns,
} from '../metaAgentServer';

describe('list_models meta-agent tool', () => {
  const listModels = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listModels.mockResolvedValue(JSON.stringify({
      models: [{
        id: 'openai-codex:gpt-5.6-sol',
        provider: 'openai-codex',
        supportedEffortLevels: ['low', 'ultra'],
      }],
      catalogs: { 'openai-codex': { verified: true } },
    }));
    setMetaAgentToolFns({
      listModels,
      listWorktrees: vi.fn(),
      submitPlan: vi.fn(),
      createSession: vi.fn(),
      spawnSession: vi.fn(),
      getSessionStatus: vi.fn(),
      getSessionResult: vi.fn(),
      sendPrompt: vi.fn(),
      respondToPrompt: vi.fn(),
      listSpawnedSessions: vi.fn(),
      interruptSession: vi.fn(),
    });
  });

  it('exposes a read-only real-name catalog before create_session on both tool surfaces', async () => {
    const tool = getMetaAgentOpenAITools().find((candidate) => candidate.function.name === 'list_models');
    expect(tool?.function.description).toContain('exact model IDs');
    expect(tool?.function.parameters).toMatchObject({ type: 'object', properties: {} });

    await expect(dispatchMetaAgentTool(
      'mcp__nimbalyst-meta-agent__list_models',
      'head-session',
      '/workspace',
      {},
    )).resolves.toContain('openai-codex:gpt-5.6-sol');
    expect(listModels).toHaveBeenCalledWith('head-session', '/workspace');
  });
});

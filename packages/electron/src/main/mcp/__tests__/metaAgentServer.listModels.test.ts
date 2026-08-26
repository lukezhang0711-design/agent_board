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
      resolvedModelNote: 'resolvedModel is display-only; never put it in a model field. Use id for create_session and submit_plan.',
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

  it('teaches both create_session and submit_plan to use catalog IDs, not resolvedModel', async () => {
    const tool = getMetaAgentOpenAITools().find((candidate) => candidate.function.name === 'list_models');
    expect(tool?.function.description).toContain('exact model IDs');
    expect(tool?.function.description).toContain('create_session');
    expect(tool?.function.description).toContain('submit_plan');
    expect(tool?.function.description).toContain('resolvedModel is display-only; never put it in a model field');
    expect(tool?.function.parameters).toMatchObject({ type: 'object', properties: {} });

    await expect(dispatchMetaAgentTool(
      'mcp__nimbalyst-meta-agent__list_models',
      'head-session',
      '/workspace',
      {},
    )).resolves.toContain('openai-codex:gpt-5.6-sol');
    await expect(dispatchMetaAgentTool(
      'mcp__nimbalyst-meta-agent__list_models',
      'head-session',
      '/workspace',
      {},
    )).resolves.toContain('resolvedModel is display-only; never put it in a model field');
    expect(listModels).toHaveBeenCalledWith('head-session', '/workspace');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/workspaceDetection', () => ({
  resolveProjectPath: (workspaceId: string) => workspaceId,
}));

import { BaseAgentProvider } from '@nimbalyst/runtime/ai/server/providers/BaseAgentProvider';
import { buildMetaAgentSystemPrompt } from '@nimbalyst/runtime/ai/prompt';
import {
  dispatchMetaAgentTool,
  getMetaAgentOpenAITools,
  setMetaAgentToolFns,
} from '../../mcp/metaAgentServer';

describe('interrupt_session meta-agent tool registration', () => {
  const interruptSession = vi.fn();
  const submitPlan = vi.fn();
  const spawnSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    interruptSession.mockResolvedValue('{"success":true}');
    submitPlan.mockResolvedValue('{"approved":true}');
    spawnSession.mockResolvedValue('{"sessionId":"spawned-session"}');
    setMetaAgentToolFns({
      listWorktrees: vi.fn(),
      submitPlan,
      createSession: vi.fn(),
      spawnSession,
      getSessionStatus: vi.fn(),
      getSessionResult: vi.fn(),
      sendPrompt: vi.fn(),
      respondToPrompt: vi.fn(),
      listSpawnedSessions: vi.fn(),
      interruptSession,
    });
  });

  it('registers submit_plan and the two-tier dispatch contract', async () => {
    const tools = getMetaAgentOpenAITools();
    const submitPlanTool = tools.find((candidate) => candidate.function.name === 'submit_plan');
    const createSessionTool = tools.find((candidate) => candidate.function.name === 'create_session');

    expect(submitPlanTool?.function.description).toContain('user approval');
    expect(submitPlanTool?.function.parameters).toMatchObject({
      properties: {
        title: { type: 'string' },
        planItems: { type: 'array', items: { type: 'string' } },
        workOrderCount: { type: 'integer' },
        risks: { type: 'string' },
      },
      required: ['title', 'planItems', 'workOrderCount', 'risks'],
    });
    expect(createSessionTool?.function.description).toContain('investigation');
    expect(createSessionTool?.function.description).toContain('approved plan');
    expect(createSessionTool?.function.parameters).toMatchObject({
      properties: {
        intent: {
          type: 'string',
          enum: ['investigation', 'implementation'],
        },
        planId: { type: 'string' },
      },
      required: ['intent'],
    });
    expect((BaseAgentProvider as any).META_AGENT_ALLOWED_TOOLS).toContain(
      'mcp__nimbalyst-meta-agent__submit_plan',
    );

    const planArgs = {
      title: 'Approved dispatch gate',
      planItems: ['Persist plan approval'],
      workOrderCount: 1,
      risks: 'Durable response timeout',
    };
    await expect(dispatchMetaAgentTool(
      'mcp__nimbalyst-meta-agent__submit_plan',
      'head-session',
      '/workspace',
      planArgs,
    )).resolves.toBe('{"approved":true}');
    expect(submitPlan).toHaveBeenCalledWith('head-session', '/workspace', planArgs);

    const spawnArgs = {
      prompt: 'Implement the approved plan',
      intent: 'implementation',
      planId: 'plan-1',
    };
    await expect(dispatchMetaAgentTool(
      'mcp__nimbalyst-meta-agent__spawn_session',
      'head-session',
      '/workspace',
      spawnArgs,
    )).resolves.toBe('{"sessionId":"spawned-session"}');
    expect(spawnSession).toHaveBeenCalledWith('head-session', '/workspace', spawnArgs);

    const prompt = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'opus',
    });
    expect(prompt).toContain('mcp__nimbalyst-meta-agent__submit_plan');
    expect(prompt).toContain(
      'Investigation sessions may be dispatched freely; implementation sessions require an approved plan',
    );
  });

  it('exposes the schema in both provider paths and dispatches the tool', async () => {
    const tool = getMetaAgentOpenAITools()
      .find((candidate) => candidate.function.name === 'interrupt_session');

    expect(tool).toBeDefined();
    expect(tool?.function.description).toContain('does not revert file changes');
    expect(tool?.function.parameters).toMatchObject({
      properties: {
        sessionId: { type: 'string' },
        cascade: { type: 'boolean', default: false },
        queueAction: { type: 'string', enum: ['pause', 'clear'], default: 'pause' },
      },
      required: ['sessionId'],
    });
    expect((BaseAgentProvider as any).META_AGENT_ALLOWED_TOOLS).toContain(
      'mcp__nimbalyst-meta-agent__interrupt_session'
    );

    await expect(dispatchMetaAgentTool(
      'mcp__nimbalyst-meta-agent__interrupt_session',
      'head-session',
      '/workspace',
      { sessionId: 'child-session', cascade: true, queueAction: 'clear' },
    )).resolves.toBe('{"success":true}');
    expect(interruptSession).toHaveBeenCalledWith(
      'head-session',
      '/workspace',
      { sessionId: 'child-session', cascade: true, queueAction: 'clear' },
    );
  });
});

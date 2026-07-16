import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/workspaceDetection', () => ({
  resolveProjectPath: (workspaceId: string) => workspaceId,
}));

import { BaseAgentProvider } from '@nimbalyst/runtime/ai/server/providers/BaseAgentProvider';
import {
  dispatchMetaAgentTool,
  getMetaAgentOpenAITools,
  setMetaAgentToolFns,
} from '../../mcp/metaAgentServer';

describe('interrupt_session meta-agent tool registration', () => {
  const interruptSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    interruptSession.mockResolvedValue('{"success":true}');
    setMetaAgentToolFns({
      listWorktrees: vi.fn(),
      createSession: vi.fn(),
      spawnSession: vi.fn(),
      getSessionStatus: vi.fn(),
      getSessionResult: vi.fn(),
      sendPrompt: vi.fn(),
      respondToPrompt: vi.fn(),
      listSpawnedSessions: vi.fn(),
      interruptSession,
    });
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

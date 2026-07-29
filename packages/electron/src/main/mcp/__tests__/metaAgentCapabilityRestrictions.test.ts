import { describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('../../utils/workspaceDetection', () => ({
  resolveProjectPath: (workspaceId: string) => workspaceId,
}));

vi.mock('@nimbalyst/runtime', () => ({
  AgentMessagesRepository: {},
  AISessionsRepository: { get: runtimeMocks.getSession },
}));

import { getDevAgentOpenAITools } from '../devAgentTools';
import { getMetaAgentOpenAITools } from '../metaAgentServer';
import {
  getInteractiveToolSchemas,
  getInteractiveToolSchemasForSession,
  shouldExcludePromptToolsForCodexHead,
} from '../tools/interactiveToolHandlers';

describe('extension Meta Agent current capability restrictions', () => {
  it('exposes only orchestration tools and withholds file/command tools', () => {
    // Wave 2 解禁后本测试应翻转：扩展型 Head Agent 应获得工作区内读写与命令能力。
    const metaToolNames = getMetaAgentOpenAITools().map((tool) => tool.function.name);
    const fullDevToolNames = getDevAgentOpenAITools('full').map((tool) => tool.function.name);

    expect(metaToolNames).toEqual([
      'list_worktrees',
      'submit_plan',
      'create_session',
      'get_session_status',
      'get_session_result',
      'send_prompt',
      'interrupt_session',
      'respond_to_prompt',
      'list_spawned_sessions',
    ]);
    expect(fullDevToolNames).toEqual(
      expect.arrayContaining(['read_file', 'list_files', 'search_files', 'write_file', 'run_command']),
    );
    expect(metaToolNames).not.toEqual(
      expect.arrayContaining(['read_file', 'list_files', 'search_files', 'write_file', 'run_command']),
    );
  });

  it('withholds generic input cards from a Codex Head while keeping submit_plan available', () => {
    // This is the tool surface used by the Codex Head's shared MCP server. A
    // generic approval card must not be offered as an alternative to the
    // meta-agent approval state machine.
    const sharedToolNames = getInteractiveToolSchemas('codex-head-session', {
      excludePromptTools: true,
    }).map((tool) => tool.name);
    const metaToolNames = getMetaAgentOpenAITools().map((tool) => tool.function.name);

    expect(sharedToolNames).not.toContain('PromptForUserInput');
    expect(sharedToolNames).not.toContain('AskUserQuestion');
    expect(metaToolNames).toContain('submit_plan');
    expect(shouldExcludePromptToolsForCodexHead({
      provider: 'openai-codex',
      agentRole: 'meta-agent',
    })).toBe(true);
    expect(shouldExcludePromptToolsForCodexHead({
      provider: 'claude-code',
      agentRole: 'meta-agent',
    })).toBe(false);
  });

  it('applies the Codex Head session profile to the live shared-MCP tool list', async () => {
    runtimeMocks.getSession.mockResolvedValueOnce({
      provider: 'openai-codex',
      agentRole: 'meta-agent',
    });
    const codexHeadToolNames = (await getInteractiveToolSchemasForSession('codex-head-session'))
      .map((tool) => tool.name);

    expect(codexHeadToolNames).not.toContain('PromptForUserInput');
    expect(codexHeadToolNames).not.toContain('AskUserQuestion');

    runtimeMocks.getSession.mockResolvedValueOnce({
      provider: 'claude-code',
      agentRole: 'meta-agent',
    });
    const claudeHeadToolNames = (await getInteractiveToolSchemasForSession('claude-head-session'))
      .map((tool) => tool.name);

    expect(claudeHeadToolNames).toEqual(expect.arrayContaining([
      'PromptForUserInput',
      'AskUserQuestion',
    ]));
  });
});

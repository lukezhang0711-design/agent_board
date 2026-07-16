import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/workspaceDetection', () => ({
  resolveProjectPath: (workspaceId: string) => workspaceId,
}));

import { getDevAgentOpenAITools } from '../devAgentTools';
import { getMetaAgentOpenAITools } from '../metaAgentServer';

describe('extension Meta Agent current capability restrictions', () => {
  it('exposes only orchestration tools and withholds file/command tools', () => {
    // Wave 2 解禁后本测试应翻转：扩展型 Head Agent 应获得工作区内读写与命令能力。
    const metaToolNames = getMetaAgentOpenAITools().map((tool) => tool.function.name);
    const fullDevToolNames = getDevAgentOpenAITools('full').map((tool) => tool.function.name);

    expect(metaToolNames).toEqual([
      'list_worktrees',
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
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claudeQueryMock = vi.hoisted(() => vi.fn());
const electronAppMock = vi.hoisted(() => ({
  isPackaged: false,
  getPath: vi.fn(() => '/mock/path'),
  getName: vi.fn(() => 'test-app'),
  getVersion: vi.fn(() => '1.0.0'),
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
  whenReady: vi.fn(async () => {}),
  quit: vi.fn(),
  isReady: vi.fn(() => true),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: claudeQueryMock,
}));

vi.mock('electron', () => ({
  app: electronAppMock,
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return [];
    }
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn() },
}));

vi.mock('../../../../../../electron/src/main/HistoryManager', () => ({
  historyManager: {
    createSnapshot: vi.fn(async () => {}),
    getPendingTags: vi.fn(async () => []),
    createTag: vi.fn(async () => {}),
    updateTagStatus: vi.fn(async () => {}),
  },
}));

import { Codex } from '@openai/codex-sdk';
import { buildMetaAgentSystemPrompt } from '../../../prompt';
import { CodexAppServerProtocol } from '../../protocols/CodexAppServerProtocol';
import { McpConfigService } from '../../services/McpConfigService';
import { BaseAgentProvider } from '../BaseAgentProvider';
import { ClaudeCodeProvider } from '../ClaudeCodeProvider';

const META_AGENT_ALLOWED_TOOLS = [
  'mcp__nimbalyst-meta-agent__list_spawned_sessions',
  'mcp__nimbalyst-meta-agent__list_worktrees',
  'mcp__nimbalyst-meta-agent__create_session',
  'mcp__nimbalyst-meta-agent__get_session_status',
  'mcp__nimbalyst-meta-agent__get_session_result',
  'mcp__nimbalyst-meta-agent__send_prompt',
  'mcp__nimbalyst-meta-agent__interrupt_session',
  'mcp__nimbalyst-meta-agent__respond_to_prompt',
  'mcp__nimbalyst-session-naming__update_session_meta',
  'mcp__nimbalyst-mcp__capture_editor_screenshot',
  'mcp__nimbalyst-mcp__display_to_user',
  'mcp__nimbalyst-mcp__voice_agent_speak',
  'mcp__nimbalyst-session-context__get_session_summary',
  'mcp__nimbalyst-session-context__get_workstream_overview',
  'mcp__nimbalyst-session-context__list_recent_sessions',
  'mcp__nimbalyst-session-context__get_workstream_edited_files',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  'TodoRead',
  'TodoWrite',
];

function createEmptyClaudeQuery() {
  const iterator = (async function* () {
    // No provider events are needed: the fixture only captures the SDK options.
  })();

  return Object.assign(iterator, {
    interrupt: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    streamInput: vi.fn(async () => {}),
    mcpServerStatus: vi.fn(async () => []),
    reconnectMcpServer: vi.fn(async () => {}),
  });
}

describe('Meta Agent current capability restrictions', () => {
  beforeEach(() => {
    claudeQueryMock.mockReset();
    claudeQueryMock.mockImplementation(() => createEmptyClaudeQuery());

    ClaudeCodeProvider.setTrustChecker(null);
    ClaudeCodeProvider.setMcpServerPort(null);
    ClaudeCodeProvider.setSessionNamingServerPort(null);
    ClaudeCodeProvider.setExtensionDevServerPort(null);
    ClaudeCodeProvider.setSessionContextServerPort(null);
    ClaudeCodeProvider.setMetaAgentServerPort(null);
    ClaudeCodeProvider.setSettingsServerPort(null);
    ClaudeCodeProvider.setMCPConfigLoader(async () => ({}));
    ClaudeCodeProvider.setCustomClaudeCodePathLoader(() => '/fake/claude');
    ClaudeCodeProvider.setClaudeCodeSettingsLoader(null);
    ClaudeCodeProvider.setClaudeSettingsEnvLoader(null);
    ClaudeCodeProvider.setShellEnvironmentLoader(null);
    ClaudeCodeProvider.setAdditionalDirectoriesLoader(null);
  });

  afterEach(() => {
    ClaudeCodeProvider.setMCPConfigLoader(null);
    ClaudeCodeProvider.setCustomClaudeCodePathLoader(null);
    ClaudeCodeProvider.setTrustChecker(null);
    vi.restoreAllMocks();
  });

  it('keeps the Head Agent no-files/no-commands ban in the assembled prompt', () => {
    // Wave 2 解禁后本测试应翻转：默认角色说明不应再包含这组能力禁令。
    const prompt = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'opus',
    });

    expect(prompt).toContain('You never touch code directly.');
    expect(prompt).toContain(
      'You still cannot read files, run commands, edit code, or browse the filesystem.',
    );
    expect(prompt).toContain(
      'All real implementation, testing, reviewing, and debugging work must be delegated',
    );
  });

  it('locks the runtime Meta Agent orchestration allow-list', () => {
    // Wave 2 解禁后本测试应翻转：原生工作区工具将进入 Head Agent 的能力集合。
    const actual = (BaseAgentProvider as unknown as {
      META_AGENT_ALLOWED_TOOLS: string[];
    }).META_AGENT_ALLOWED_TOOLS;

    expect(actual).toEqual(META_AGENT_ALLOWED_TOOLS);
    expect(actual).not.toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']));
  });

  it('keeps custom MCP servers visible while excluding extension-dev and settings in the meta profile', async () => {
    // Wave 2 解禁后本测试应翻转的限制项：extension-dev/settings 当前被 profile 排除。
    // custom-shell 的断言同时防止把 META_AGENT_ALLOWED_TOOLS 误读成严格可见工具白名单。
    const service = new McpConfigService({
      mcpServerPort: 41001,
      sessionNamingServerPort: 41002,
      extensionDevServerPort: 41003,
      superLoopProgressServerPort: null,
      sessionContextServerPort: 41004,
      metaAgentServerPort: 41005,
      settingsServerPort: 41006,
      mcpConfigLoader: async () => ({
        'custom-shell': {
          type: 'stdio',
          command: 'custom-shell-server',
          args: [],
        },
      }),
      claudeSettingsEnvLoader: null,
      shellEnvironmentLoader: null,
    });

    const config = await service.getMcpServersConfig({
      sessionId: 'head-session',
      workspacePath: '/workspace',
      profile: 'meta-agent',
    });

    expect(config).toHaveProperty('nimbalyst-meta-agent');
    expect(config).toHaveProperty('nimbalyst-session-context');
    expect(config).toHaveProperty('custom-shell');
    expect(config).not.toHaveProperty('nimbalyst-extension-dev');
    expect(config).not.toHaveProperty('nimbalyst-settings');
  });

  it('hard-blocks Claude native file and command tools in the SDK options', async () => {
    // Wave 2 解禁后本测试应翻转：disallowedTools/blockedTools 不应再封锁原生工作区工具。
    const provider = new ClaudeCodeProvider();
    await provider.initialize({ model: 'claude-code:opus' });

    const hooks = {
      clearEditedFiles: vi.fn(),
      createPreToolUseHook: vi.fn(() => vi.fn()),
      createPostToolUseHook: vi.fn(() => vi.fn()),
      createPermissionDeniedHook: vi.fn(() => vi.fn()),
      getEditedFiles: vi.fn(() => new Set<string>()),
      createTurnEndSnapshots: vi.fn(async () => {}),
    };
    const providerInternals = provider as any;
    providerInternals.getAgentRole = vi.fn(async () => 'meta-agent');
    providerInternals.getWorkflowPreset = vi.fn(async () => 'default');
    providerInternals.createToolHooksService = vi.fn(() => hooks);
    providerInternals.createCanUseToolHandler = vi.fn(() => vi.fn());
    providerInternals.logAgentMessage = vi.fn(async () => {});
    providerInternals.flushPendingWrites = vi.fn(async () => {});
    providerInternals.processTranscriptMessages = vi.fn(async () => {});

    for await (const _chunk of provider.sendMessage(
      'probe current Head Agent tools',
      undefined,
      'head-session',
      [],
      '/workspace',
    )) {
      // Drain the provider so its finally block closes the prompt controller.
    }

    expect(claudeQueryMock).toHaveBeenCalledTimes(1);
    const options = claudeQueryMock.mock.calls[0][0].options as Record<string, unknown>;
    expect(options.allowedTools).toEqual(META_AGENT_ALLOWED_TOOLS);
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining(['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash']),
    );
    expect(options.blockedTools).toEqual(options.disallowedTools);
    expect(options.disallowedTools).not.toEqual(
      expect.arrayContaining(['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TodoRead', 'TodoWrite']),
    );
  });

  it('shows that Codex app-server drops the provider tool allow/deny fields', () => {
    // Wave 2 解禁施工应删除上游伪限制；本探针锁定当前 app-server 并未执行它。
    const protocol = new CodexAppServerProtocol();
    const params = (protocol as any).buildThreadStartParams({
      workspacePath: '/workspace',
      permissionMode: 'allow-all',
      allowedTools: META_AGENT_ALLOWED_TOOLS,
      disallowedTools: ['Read', 'Write', 'Edit', 'Bash'],
      raw: { systemPrompt: 'meta prompt' },
    });

    expect(params.sandbox).toBe('workspace-write');
    expect(params.approvalPolicy).toBe('never');
    expect(params).not.toHaveProperty('allowedTools');
    expect(params).not.toHaveProperty('disallowedTools');
  });

  it('shows that the installed Codex SDK drops unknown tool allow/deny fields before execution', async () => {
    // Wave 2 解禁施工应删除上游伪限制；本探针锁定当前 SDK 也未执行它。
    let forwardedRunOptions: Record<string, unknown> | undefined;
    const codex = new Codex({ codexPathOverride: '/fake/codex' });
    const thread = codex.startThread({
      model: 'gpt-5.5',
      workingDirectory: '/workspace',
      sandboxMode: 'workspace-write',
      allowedTools: META_AGENT_ALLOWED_TOOLS,
      disallowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    } as any);

    (thread as any)._exec = {
      run: (options: Record<string, unknown>) => {
        forwardedRunOptions = options;
        return (async function* () {
          yield JSON.stringify({ type: 'thread.started', thread_id: 'probe-thread' });
        })();
      },
    };

    const { events } = await thread.runStreamed('probe');
    for await (const _event of events) {
      // Drain the installed SDK's real Thread forwarding path.
    }

    expect(forwardedRunOptions).toMatchObject({
      model: 'gpt-5.5',
      workingDirectory: '/workspace',
      sandboxMode: 'workspace-write',
    });
    expect(forwardedRunOptions).not.toHaveProperty('allowedTools');
    expect(forwardedRunOptions).not.toHaveProperty('disallowedTools');
  });
});

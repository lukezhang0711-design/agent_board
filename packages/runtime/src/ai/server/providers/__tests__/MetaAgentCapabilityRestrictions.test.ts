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

// The orchestration MCP + task/todo allow-list the Head Agent keeps after Wave 2.
// This is the auto-approve set, NOT an exhaustive capability filter: native workspace
// tools are absent here because they now flow through the normal permission path, not
// because they are blocked.
const META_AGENT_ALLOWED_TOOLS = [
  'mcp__nimbalyst-meta-agent__list_spawned_sessions',
  'mcp__nimbalyst-meta-agent__list_worktrees',
  'mcp__nimbalyst-meta-agent__submit_plan',
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

/**
 * Spin up a ClaudeCodeProvider wired as a Head Agent (meta-agent role) with all
 * side-effecting internals stubbed, so a drained sendMessage() only captures the
 * SDK options passed to `query`. `customRole` is what getMetaAgentCustomRole returns
 * (undefined => built-in default role).
 */
async function createClaudeProviderProbe(
  agentRole: 'standard' | 'meta-agent' = 'meta-agent',
  customRole?: string,
): Promise<ClaudeCodeProvider> {
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
  const internals = provider as any;
  internals.getAgentRole = vi.fn(async () => agentRole);
  internals.getWorkflowPreset = vi.fn(async () => 'default');
  internals.getMetaAgentCustomRole = vi.fn(async () => customRole);
  internals.createToolHooksService = vi.fn(() => hooks);
  internals.createCanUseToolHandler = vi.fn(() => vi.fn());
  internals.logAgentMessage = vi.fn(async () => {});
  internals.flushPendingWrites = vi.fn(async () => {});
  internals.processTranscriptMessages = vi.fn(async () => {});
  return provider;
}

async function createMetaAgentProviderProbe(customRole?: string): Promise<ClaudeCodeProvider> {
  return createClaudeProviderProbe('meta-agent', customRole);
}

async function captureClaudeSdkOptions(
  provider: ClaudeCodeProvider,
): Promise<Record<string, unknown>> {
  for await (const _chunk of provider.sendMessage(
    'probe Head Agent tools',
    undefined,
    'head-session',
    [],
    '/workspace',
  )) {
    // Drain the provider so its finally block closes the prompt controller.
  }

  expect(claudeQueryMock).toHaveBeenCalledTimes(1);
  return claudeQueryMock.mock.calls[0][0].options as Record<string, unknown>;
}

describe('Meta Agent capability (Wave 2: role-constrained, full native tools)', () => {
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

  it('builds a responsibility-constrained Head Agent role with failure reporting discipline', () => {
    const prompt = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'opus',
    });

    // The old capability prohibitions are gone.
    expect(prompt).not.toContain('You never touch code directly');
    expect(prompt).not.toContain(
      'You still cannot read files, run commands, edit code, or browse the filesystem',
    );

    // Iron law: implementation is always delegated, even a one-line edit.
    expect(prompt).toContain('Iron law — implementation is always delegated');
    expect(prompt).toContain('even a one-line edit');

    // Head Agent may investigate on its own (read files, run read-only diagnostics).
    expect(prompt).toContain('read any file');
    expect(prompt).toContain('read-only diagnostics');

    // Acceptance upgrade: the Head Agent must personally verify a child's work.
    expect(prompt).toContain("Verify, don't trust the prose");
    expect(prompt).toContain('personally verify');
    expect(prompt).toContain('You do not have built-in `Agent` or `Task` tools');
    expect(prompt).toContain('mcp__nimbalyst-meta-agent__create_session');
    expect(prompt).toContain('Child Failure Discipline');
    expect(prompt).toContain('exact error text');
    expect(prompt).toContain('wait for the user\'s instruction before retrying or re-dispatching');
  });

  it('retains the orchestration MCP allow-list without amputating native tools', () => {
    const actual = (BaseAgentProvider as unknown as {
      META_AGENT_ALLOWED_TOOLS: string[];
    }).META_AGENT_ALLOWED_TOOLS;

    // The orchestration whitelist is retained unchanged.
    expect(actual).toEqual(META_AGENT_ALLOWED_TOOLS);
    // Native workspace tools are NOT auto-approved via this list — they now go through
    // the normal permission flow (canUseTool), exactly like a standard session.
    expect(actual).not.toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']));
  });

  it('keeps custom MCP servers visible while excluding extension-dev and settings in the meta profile', async () => {
    // Unchanged by Wave 2: the meta profile still surfaces orchestration + custom MCP
    // servers while excluding extension-dev/settings. custom-shell also guards against
    // reading META_AGENT_ALLOWED_TOOLS as a strict visible-tool whitelist.
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

  it('blocks native delegation and file-writing tools only in Head SDK options', async () => {
    const provider = await createMetaAgentProviderProbe();
    const options = await captureClaudeSdkOptions(provider);

    // Orchestration allow-list is still applied (auto-approve for orchestration tools).
    expect(options.allowedTools).toEqual(META_AGENT_ALLOWED_TOOLS);

    // Head delegation must go through mcp__nimbalyst-meta-agent__create_session so
    // Nimbalyst retains approval, queue, concurrency, and Tracker control.
    expect(options.disallowedTools).toEqual([
      'Agent',
      'Task',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
    ]);
    // Keep native read/diagnostic tools and the MCP dispatch path available.
    expect(options.disallowedTools).not.toEqual(
      expect.arrayContaining(['Read', 'Glob', 'Grep', 'LS', 'Bash']),
    );
    expect(options.allowedTools).toContain('mcp__nimbalyst-meta-agent__create_session');
    expect(options.blockedTools).toBeUndefined();
  });

  it('leaves built-in subagent tools available to a standard SDK session', async () => {
    const provider = await createClaudeProviderProbe('standard');
    const options = await captureClaudeSdkOptions(provider);

    expect(options.disallowedTools).toBeUndefined();
  });

  it('replaces the default Head Agent role with custom metadata role text, keeping orchestration sections', () => {
    const customRole =
      'You are Atlas, a bespoke orchestrator for this workspace. Follow the operator exactly.';
    const prompt = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'opus',
      customRole,
    });

    // Custom role text replaces the built-in default role segment.
    expect(prompt).toContain(customRole);
    expect(prompt).not.toContain('You are the Head Agent — a Meta Agent that orchestrates');
    expect(prompt).not.toContain("Verify, don't trust the prose");

    // Fixed orchestration sections remain and are unaffected by the override.
    expect(prompt).toContain('## Your Tools');
    expect(prompt).toContain('## Core Behavior');
    expect(prompt).toContain('Delegate all implementation');
    expect(prompt).toContain('optional effortLevel');
    expect(prompt).toContain('Keep thinking effort high by default');
    expect(prompt).toContain('## First Turn');

    // Blank/whitespace custom role falls back to the built-in default role.
    const fallback = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'opus',
      customRole: '   ',
    });
    expect(fallback).toContain('You are the Head Agent — a Meta Agent that orchestrates');
  });

  it('threads a custom Head Agent role from session metadata into the Claude system prompt', async () => {
    const customRole = 'You are Atlas, a bespoke orchestrator wired via session metadata.';
    const provider = await createMetaAgentProviderProbe(customRole);
    const options = await captureClaudeSdkOptions(provider);

    // The meta-agent system prompt is passed as a plain string; it carries the custom role.
    expect(options.systemPrompt).toContain(customRole);
    expect(options.systemPrompt).not.toContain(
      'You are the Head Agent — a Meta Agent that orchestrates',
    );
    // Fixed orchestration mechanics still present regardless of the custom role.
    expect(options.systemPrompt).toContain('## Your Tools');
    expect(options.systemPrompt).toContain('## Core Behavior');
  });

  it('shows that Codex app-server drops the provider tool allow/deny fields', () => {
    // Unchanged by Wave 2: Codex has native capability sandboxed to the workspace, and
    // the app-server transport never enforced allow/deny — so nothing to unlock here.
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
    // Unchanged by Wave 2: the installed Codex SDK also drops allow/deny before exec.
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

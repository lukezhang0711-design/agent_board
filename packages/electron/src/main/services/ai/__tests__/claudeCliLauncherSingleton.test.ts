import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('claudeCliLauncherSingleton', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadHarness(opts?: {
    claudeInstalled?: boolean;
    session?: {
      agentRole?: 'standard' | 'meta-agent';
      metadata?: Record<string, unknown>;
    } | null;
  }) {
    const claudeInstalled = opts?.claudeInstalled ?? true;
    const getSession = vi.fn(async () => opts?.session ?? { agentRole: 'standard' });
    const buildMetaAgentSystemPrompt = vi.fn(() => 'META_AGENT_SYSTEM_PROMPT');
    const manager = {
      isTerminalActive: vi.fn(() => false),
    };
    const stateManager = {
      startSession: vi.fn(async () => undefined),
      endSession: vi.fn(async () => undefined),
      updateActivity: vi.fn(async () => undefined),
    };
    const launch = vi.fn(async (_input?: any): Promise<void> => undefined);
    const flushQueuedPrompt = vi.fn(async () => false);

    vi.doMock('../../TerminalSessionManager', () => ({
      getTerminalSessionManager: () => manager,
    }));
    vi.doMock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
      getSessionStateManager: () => stateManager,
    }));
    vi.doMock('@nimbalyst/runtime/ai/server', () => ({
      McpConfigService: class {
        getMcpServersConfig = vi.fn(async () => ({}));
      },
      buildMetaAgentSystemPrompt,
    }));
    vi.doMock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
      AISessionsRepository: {
        get: getSession,
      },
    }));
    vi.doMock('../../CLIManager', () => ({
      getEnhancedPath: () => '/bin',
      getShellEnvironment: () => ({}),
    }));
    vi.doMock('../claudeExecutableResolver', () => ({
      resolveClaudeExecutablePath: () => '/usr/local/bin/claude',
      isClaudeExecutableInstalled: () => claudeInstalled,
    }));
    vi.doMock('../claudeCliPermissionHookPath', () => ({
      resolveClaudePermissionHookScriptPath: () => undefined,
    }));
    vi.doMock('../claudeCliObservationSingleton', () => ({
      startClaudeCliProxyObservation: vi.fn(),
      fireClaudeCliTurnCompletion: vi.fn(),
    }));
    vi.doMock('../HooklessAgentFileWatcher', () => ({
      HooklessAgentFileWatcher: class {
        ensureForSession = vi.fn(async () => undefined);
        scheduleStop = vi.fn();
        stopForSession = vi.fn(async () => undefined);
      },
    }));
    vi.doMock('../../AgentWorkflowService', () => ({
      getAgentWorkflowService: () => ({
        getClaudeProviderPluginPaths: vi.fn(async () => []),
      }),
    }));
    vi.doMock('../../AttachmentService', () => ({
      workspacePathToDir: (workspacePath: string) => workspacePath.replace(/[^a-z0-9]/gi, '-'),
    }));
    vi.doMock('../../PermissionService', () => ({
      getPermissionService: () => ({ getPermissionMode: () => 'default' }),
    }));
    vi.doMock('../claudeCliQueueFlushSingleton', () => ({
      flushNextClaudeCliQueuedPromptForSession: flushQueuedPrompt,
    }));
    vi.doMock('../ClaudeCliSessionLauncher', () => ({
      ClaudeCliSessionLauncher: class {
        constructor() {
          (this as any).launch = launch;
        }
      },
    }));

    const mod = await import('../claudeCliLauncherSingleton');
    return {
      ...mod,
      manager,
      stateManager,
      launch,
      flushQueuedPrompt,
      getSession,
      buildMetaAgentSystemPrompt,
    };
  }

  // loadHarness() dynamically imports the real launcher module after
  // vi.resetModules(), which cold-loads electron/analytics/store + the runtime
  // MCP config chain (~4s). That's fine solo but crosses the 5s default under
  // full-suite parallel CPU contention, so give these a generous timeout.
  it('coalesces concurrent ensure calls for the same session', async () => {
    const h = await loadHarness();
    let releaseLaunch: (() => void) | undefined;
    h.launch.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releaseLaunch = resolve;
      }),
    );

    const input = { sessionId: 'session-1', workspacePath: '/work' };
    const first = h.ensureClaudeCliSession(input);
    const second = h.ensureClaudeCliSession(input);
    await vi.waitFor(() => {
      expect(h.launch).toHaveBeenCalledTimes(1);
    });

    expect(h.stateManager.startSession).toHaveBeenCalledTimes(1);
    expect(h.launch).toHaveBeenCalledTimes(1);

    releaseLaunch?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true },
      { success: true },
    ]);
  }, 20000);

  it('ends session state when the launched CLI terminal exits', async () => {
    const h = await loadHarness();
    let onExit: ((exitCode: number) => void) | undefined;
    h.launch.mockImplementationOnce(async (input: { onExit?: (exitCode: number) => void }) => {
      onExit = input.onExit;
    });

    await h.ensureClaudeCliSession({ sessionId: 'session-1', workspacePath: '/work' });
    onExit?.(7);

    expect(h.stateManager.endSession).toHaveBeenCalledWith('session-1');
  }, 20000);

  it('short-circuits without launching when claude is not installed (NIM-852)', async () => {
    const h = await loadHarness({ claudeInstalled: false });

    const result = await h.ensureClaudeCliSession({ sessionId: 'session-1', workspacePath: '/work' });

    expect(result).toEqual({
      success: false,
      claudeNotInstalled: true,
      error: 'Claude Code CLI is not installed',
    });
    expect(h.stateManager.startSession).not.toHaveBeenCalled();
    expect(h.launch).not.toHaveBeenCalled();
  }, 20000);

  it('reads the persisted Head role and forwards the shared Meta prompt to the CLI launch', async () => {
    const h = await loadHarness({
      session: {
        agentRole: 'meta-agent',
        metadata: { workflowPreset: 'research' },
      },
    });

    await h.ensureClaudeCliSession({
      sessionId: 'head-session',
      workspacePath: '/work',
      model: 'claude-code-cli:opus',
    });

    expect(h.getSession).toHaveBeenCalledWith('head-session');
    expect(h.buildMetaAgentSystemPrompt).toHaveBeenCalledWith('claude', 'research', {
      provider: 'claude-code-cli',
      model: 'claude-code-cli:opus',
    });
    expect(h.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpProfile: 'meta-agent',
        systemPromptAppend: 'META_AGENT_SYSTEM_PROMPT',
      }),
    );
  }, 20000);

  it('keeps a standard CLI session on the existing launch path', async () => {
    const h = await loadHarness({
      session: {
        agentRole: 'standard',
      },
    });

    await h.ensureClaudeCliSession({
      sessionId: 'standard-session',
      workspacePath: '/work',
      model: 'claude-code-cli:sonnet',
    });

    expect(h.getSession).toHaveBeenCalledWith('standard-session');
    expect(h.buildMetaAgentSystemPrompt).not.toHaveBeenCalled();
    const launchInput = h.launch.mock.calls[0][0];
    expect(launchInput).not.toHaveProperty('mcpProfile');
    expect(launchInput).not.toHaveProperty('systemPromptAppend');
  }, 20000);

  it('flushes once with fallback-silence when the terminal synthesizes an idle boundary', async () => {
    const h = await loadHarness();

    await h.ensureClaudeCliSession({ sessionId: 'session-1', workspacePath: '/work' });
    const launchInput = h.launch.mock.calls[0][0];
    launchInput.onTurnState('idle', null, 'fallback-silence');

    await vi.waitFor(() => {
      expect(h.flushQueuedPrompt).toHaveBeenCalledWith(
        'session-1',
        '/work',
        'fallback-silence',
      );
    });
  }, 20000);
});

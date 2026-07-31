import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
  getQueuedPromptsStore: vi.fn(),
  getSession: vi.fn(),
  interruptSession: vi.fn(),
  isTerminalActive: vi.fn(),
  interruptClaudeCliTurn: vi.fn(),
  writeToTerminal: vi.fn(),
  clearModelCache: vi.fn(),
  databaseQuery: vi.fn(),
  onPromptResolved: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  ipcHandlers: new Map<string, (...args: any[]) => any>(),
}));

vi.mock('../../../utils/ipcRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/ipcRegistry')>();
  return {
    ...actual,
    safeHandle: (channel: string, handler: (...args: any[]) => any) => {
      mocks.ipcHandlers.set(channel, handler);
    },
  };
});

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  SessionManager: class {},
  ProviderFactory: { getProvider: mocks.getProvider },
  ModelRegistry: { clearCache: mocks.clearModelCache },
  isAskUserQuestionProvider: () => false,
  isAgentProvider: () => false,
  isSlashCommandCatalogProvider: () => false,
  ClaudeCodeProvider: { setCustomClaudeCodePathLoader: vi.fn() },
  OpenAICodexProvider: class {},
}));

vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { get: mocks.getSession },
  DocumentContextService: class {},
  SessionFilesRepository: {},
}));

vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: { get: mocks.getSession },
}));

vi.mock('../../../database/PGLiteDatabaseWorker', () => ({
  database: { query: mocks.databaseQuery },
}));

vi.mock('../../../tray/TrayManager', () => ({
  TrayManager: { getInstance: () => ({ onPromptResolved: mocks.onPromptResolved }) },
}));

vi.mock('../../SyncManager', () => ({ getSyncProvider: () => null }));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    on: vi.fn(), once: vi.fn(), off: vi.fn(), removeListener: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()), quit: vi.fn(), isReady: vi.fn(() => true),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => null) },
  ipcMain: { handle: vi.fn(), on: vi.fn(), listenerCount: vi.fn(() => 0) },
  ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn() },
}));

vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({
    interruptSession: mocks.interruptSession,
  }),
}));

vi.mock('../tools', () => ({
  ToolExecutor: class {},
  toolRegistry: { register: vi.fn() },
  BUILT_IN_TOOLS: [],
}));

vi.mock('../MessageStreamingHandler', () => ({ MessageStreamingHandler: class {} }));
vi.mock('../HooklessAgentFileWatcher', () => ({ HooklessAgentFileWatcher: class {} }));
vi.mock('../../TerminalSessionManager', () => ({
  getTerminalSessionManager: () => ({
    isTerminalActive: mocks.isTerminalActive,
    interruptClaudeCliTurn: mocks.interruptClaudeCliTurn,
    writeToTerminal: mocks.writeToTerminal,
  }),
}));
vi.mock('../../RepositoryManager', () => ({
  getQueuedPromptsStore: mocks.getQueuedPromptsStore,
}));
vi.mock('../../analytics/AnalyticsService.ts', () => ({
  AnalyticsService: { getInstance: () => ({ sendEvent: vi.fn() }) },
}));
vi.mock('../../../utils/logger', () => {
  return {
    logger: {
      main: {
        info: mocks.logInfo,
        error: mocks.logError,
        warn: vi.fn(),
        debug: vi.fn(),
      },
    },
  };
});

import { createPGLiteQueuedPromptsStore } from '../../PGLiteQueuedPromptsStore';
import { AIService, deriveDurablePlanApprovalState } from '../AIService';

describe('AIService.stopSession', () => {
  let db: PGlite;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.ipcHandlers.clear();
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
      CREATE TABLE queued_prompts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        attachments JSONB,
        document_context JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        claimed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        error_message TEXT
      );
      CREATE TABLE ai_agent_messages (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  it('logs the durable create boundary and returns its persisted prompt ID', async () => {
    const create = vi.fn(async (input) => ({
      ...input,
      origin: 'user' as const,
      status: 'pending' as const,
      createdAt: 123,
    }));
    mocks.getQueuedPromptsStore.mockReturnValue({ create });
    mocks.getSession.mockResolvedValue(null);
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, { streamingHandler: { handle: vi.fn() } });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:createQueuedPrompt');
    const sender = { isDestroyed: () => false, send: vi.fn() };

    await expect(handler?.({ sender } as any, 'session-1', 'hello')).resolves.toMatchObject({
      id: expect.stringMatching(/^local-/),
      prompt: 'hello',
      timestamp: 123,
    });
    const promptId = create.mock.calls[0][0].id;
    expect(mocks.logInfo.mock.calls.map(([line]) => line)).toEqual(expect.arrayContaining([
      expect.stringContaining(`[CliQueue] create received promptId=${promptId} sessionId=session-1 promptLength=5`),
      expect.stringContaining(`[CliQueue] create persisted promptId=${promptId} sessionId=session-1 status=pending`),
      expect.stringContaining(`[CliQueue] create response promptId=${promptId} sessionId=session-1 status=pending`),
    ]));
  });

  it('logs and rethrows a durable create failure for the renderer to surface', async () => {
    mocks.getQueuedPromptsStore.mockReturnValue({
      create: vi.fn(async () => { throw new Error('store write failed'); }),
    });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, { streamingHandler: { handle: vi.fn() } });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:createQueuedPrompt');

    await expect(handler?.({} as any, 'session-1', 'hello')).rejects.toThrow('store write failed');
    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining(
      '[CliQueue] create failed',
    ));
  });

  it('derives submitted → responded → delivered → closed from durable rows', () => {
    const requestId = 'approval-state-1';
    const submitted = {
      type: 'nimbalyst_tool_use',
      name: 'ExitPlanMode',
      id: requestId,
      input: { planId: 'plan-state-1' },
    };
    const responded = {
      type: 'exit_plan_mode_response',
      requestId,
      approved: false,
      feedback: 'Add recovery.',
      respondedAt: 100,
      respondedBy: 'desktop',
    };
    const delivered = {
      type: 'plan_approval_delivery',
      requestId,
      method: 'revive',
    };
    const closed = {
      type: 'nimbalyst_tool_result',
      tool_use_id: requestId,
      result: '{"approved":false}',
    };
    const conflictingRetry = {
      type: 'exit_plan_mode_response',
      requestId,
      approved: true,
    };
    const ordinaryExitPlanMode = {
      type: 'nimbalyst_tool_use',
      name: 'ExitPlanMode',
      id: 'ordinary-exit-plan-mode',
      input: { planFilePath: 'docs/plan.md' },
    };

    expect(deriveDurablePlanApprovalState(
      [ordinaryExitPlanMode],
      'ordinary-exit-plan-mode',
    )).toBeNull();
    expect(deriveDurablePlanApprovalState([submitted], requestId)?.status).toBe('submitted');
    expect(deriveDurablePlanApprovalState([submitted, responded], requestId)).toMatchObject({
      status: 'responded',
      decision: 'rejected',
    });
    expect(deriveDurablePlanApprovalState([submitted, responded, delivered], requestId)).toMatchObject({
      status: 'delivered',
      deliveryMethod: 'revive',
    });
    expect(deriveDurablePlanApprovalState(
      [submitted, responded, delivered, closed, conflictingRetry],
      requestId,
    )).toMatchObject({
      status: 'closed',
      decision: 'rejected',
    });
  });

  it('validates workspace scope before exposing durable approval state', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'head-session',
      workspacePath: '/workspace',
    });
    const service = Object.create(AIService.prototype) as AIService;
    const getPlanApprovalState = vi.fn().mockResolvedValue({
      requestId: 'approval-state-1',
      status: 'responded',
      decision: 'approved',
    });
    Object.assign(service, {
      getPlanApprovalState,
      streamingHandler: { handle: vi.fn() },
    });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:getPlanApprovalState');

    await expect(handler?.(
      {} as any,
      '/workspace',
      'head-session',
      'approval-state-1',
    )).resolves.toMatchObject({
      success: true,
      state: { status: 'responded', decision: 'approved' },
    });
    await expect(handler?.(
      {} as any,
      '/other-workspace',
      'head-session',
      'approval-state-1',
    )).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('not found in workspace'),
    });
    expect(getPlanApprovalState).toHaveBeenCalledTimes(1);
  });

  it('clears the generic model cache without forcing a Codex model retry', async () => {
    const manualRetry = vi.fn(async () => ({ phase: 'normal' }));
    const modelRefreshStatus = {
      phase: 'normal',
      attempt: 0,
      maxAttempts: 4,
      inFlight: false,
      nextRetryAt: null,
      lastError: null,
      lastSuccessAt: null,
    };
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      codexModelRefreshService: {
        manualRetry,
        getStatus: () => modelRefreshStatus,
      },
      getNormalizedProviderSettings: () => ({
        'openai-codex': { enabled: true },
      }),
      streamingHandler: { handle: vi.fn() },
    });
    (service as any).setupIpcHandlers();

    const result = await mocks.ipcHandlers.get('ai:clearModelCache')?.({} as any);

    expect(mocks.clearModelCache).toHaveBeenCalledTimes(1);
    expect(manualRetry).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, modelRefreshStatus });
  });

  afterEach(async () => {
    await db.close();
  });

  it('interrupts the active turn, pauses queued work, and returns the persisted result', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    await store.create({ id: 'queued-1', sessionId: 'child-1', prompt: 'next task' });
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    mocks.getSession.mockResolvedValue({ id: 'child-1', provider: 'claude-code' });

    const state = { running: true, visibleStatus: 'running' };
    mocks.getProvider.mockReturnValue({
      providerType: 'claude-code',
      abort: () => {
        state.running = false;
      },
    });
    mocks.interruptSession.mockImplementation(async () => {
      state.visibleStatus = 'interrupted';
    });

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      analytics: { sendEvent: vi.fn() },
      sessionsProcessingQueue: new Set(['child-1']),
    });

    const result = await service.stopSession('child-1', 'pause');

    expect(result).toEqual({ success: true, queue: 'paused', paused: 1 });
    expect(state).toEqual({ running: false, visibleStatus: 'interrupted' });
    expect((await store.get('queued-1'))?.status).toBe('paused');
  }, 30_000);

  it('queues a revived approval message exactly once for the same durable key', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    const service = Object.create(AIService.prototype) as AIService;

    const [first, second] = await Promise.all([
      service.queuePromptForSession(
        'head-session',
        'Continue after approval.',
        undefined,
        undefined,
        'child_session_event',
        'plan-approval-revive-49',
      ),
      service.queuePromptForSession(
        'head-session',
        'Continue after approval.',
        undefined,
        undefined,
        'child_session_event',
        'plan-approval-revive-49',
      ),
    ]);

    expect(first.id).toBe('meta-plan-approval-revive-49');
    expect(second.id).toBe(first.id);
    await expect(store.listForSession('head-session')).resolves.toHaveLength(1);
  });

  it('treats a stale session with no provider as already stopped and remains idempotent', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    await store.create({ id: 'stale-queued-1', sessionId: 'stale-1', prompt: 'resume after stop' });
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    mocks.getSession.mockResolvedValue({ id: 'stale-1', provider: 'claude-code' });
    mocks.getProvider.mockReturnValue(null);

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      analytics: { sendEvent: vi.fn() },
      sessionsProcessingQueue: new Set(['stale-1']),
    });

    await expect(service.stopSession('stale-1', 'pause')).resolves.toEqual({
      success: true,
      queue: 'paused',
      paused: 1,
    });
    await expect(service.stopSession('stale-1', 'pause')).resolves.toEqual({
      success: true,
      queue: 'paused',
      paused: 1,
    });

    expect((service as any).sessionsProcessingQueue.has('stale-1')).toBe(false);
    expect((await store.get('stale-queued-1'))?.status).toBe('paused');
    expect(mocks.interruptSession).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('converges a stale claude-code-cli session with no terminal during an emergency clear', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    await store.create({ id: 'stale-cli-queued-1', sessionId: 'stale-cli-1', prompt: 'do not resume' });
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    mocks.getSession.mockResolvedValue({ id: 'stale-cli-1', provider: 'claude-code-cli' });
    mocks.isTerminalActive.mockReturnValue(false);

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      analytics: { sendEvent: vi.fn() },
      sessionsProcessingQueue: new Set(['stale-cli-1']),
    });

    await expect(service.stopSession('stale-cli-1', 'clear')).resolves.toEqual({
      success: true,
      queue: 'cleared',
    });

    expect((service as any).sessionsProcessingQueue.has('stale-cli-1')).toBe(false);
    expect(await store.get('stale-cli-queued-1')).toBeNull();
    expect(mocks.interruptClaudeCliTurn).not.toHaveBeenCalled();
    expect(mocks.interruptSession).toHaveBeenCalledWith('stale-cli-1');
  }, 30_000);

  it('uses Copilot provider.abort() so the signal-tier stop path can send cancellation', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    await store.create({ id: 'copilot-queued', sessionId: 'copilot-1', prompt: 'next task' });
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    mocks.getSession.mockResolvedValue({ id: 'copilot-1', provider: 'copilot-cli' });
    const abort = vi.fn();
    const interruptCurrentTurn = vi.fn();
    mocks.getProvider.mockReturnValue({
      providerType: 'copilot-cli',
      abort,
      interruptCurrentTurn,
    });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      analytics: { sendEvent: vi.fn() },
      sessionsProcessingQueue: new Set(['copilot-1']),
    });

    const result = await service.stopSession('copilot-1', 'pause');

    expect(result).toEqual({ success: true, queue: 'paused', paused: 1 });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(interruptCurrentTurn).not.toHaveBeenCalled();
  }, 30_000);

  it('waits for OpenCode server confirmation before reporting stop success', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    await store.create({ id: 'opencode-queued', sessionId: 'opencode-1', prompt: 'next task' });
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    mocks.getSession.mockResolvedValue({ id: 'opencode-1', provider: 'opencode' });
    let releaseConfirmation!: () => void;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    const abort = vi.fn();
    const interruptCurrentTurn = vi.fn(async () => {
      await confirmationGate;
      return { method: 'interrupt', result: { data: true } };
    });
    mocks.getProvider.mockReturnValue({
      providerType: 'opencode',
      abort,
      interruptCurrentTurn,
    });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      analytics: { sendEvent: vi.fn() },
      sessionsProcessingQueue: new Set(['opencode-1']),
    });
    let settled = false;
    const resultPromise = service.stopSession('opencode-1', 'pause').then((result) => {
      settled = true;
      return result;
    });

    try {
      await vi.waitFor(() => expect(interruptCurrentTurn).toHaveBeenCalledTimes(1));
      expect(abort).not.toHaveBeenCalled();
      expect(settled).toBe(false);
    } finally {
      releaseConfirmation();
    }

    await expect(resultPromise).resolves.toEqual({ success: true, queue: 'paused', paused: 1 });
  }, 30_000);

  it('reports an OpenCode abort rejection as a stop failure', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    mocks.getSession.mockResolvedValue({ id: 'opencode-failure', provider: 'opencode' });
    const failure = new Error('OpenCode server rejected abort');
    const abort = vi.fn();
    const interruptCurrentTurn = vi.fn().mockRejectedValue(failure);
    mocks.getProvider.mockReturnValue({
      providerType: 'opencode',
      abort,
      interruptCurrentTurn,
    });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      analytics: { sendEvent: vi.fn() },
      sessionsProcessingQueue: new Set(['opencode-failure']),
    });

    const result = await service.stopSession('opencode-failure', 'pause');

    expect(result).toEqual({
      success: false,
      queue: 'unchanged',
      error: 'OpenCode server rejected abort',
    });
    expect(abort).not.toHaveBeenCalled();
    expect(mocks.interruptSession).not.toHaveBeenCalled();
  }, 30_000);

  it('does not claim OpenCode stop success when the server returns data false', async () => {
    const store = createPGLiteQueuedPromptsStore(db);
    mocks.getQueuedPromptsStore.mockReturnValue(store);
    mocks.getSession.mockResolvedValue({ id: 'opencode-unconfirmed', provider: 'opencode' });
    const abort = vi.fn();
    const interruptCurrentTurn = vi.fn().mockResolvedValue({
      method: 'interrupt',
      result: { data: false },
    });
    mocks.getProvider.mockReturnValue({
      providerType: 'opencode',
      abort,
      interruptCurrentTurn,
    });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      analytics: { sendEvent: vi.fn() },
      sessionsProcessingQueue: new Set(['opencode-unconfirmed']),
    });

    const result = await service.stopSession('opencode-unconfirmed', 'pause');

    expect(result).toEqual({
      success: false,
      queue: 'unchanged',
      error: 'OpenCode server did not confirm session abort',
    });
    expect(abort).not.toHaveBeenCalled();
    expect(mocks.interruptSession).not.toHaveBeenCalled();
  }, 30_000);

  it('routes the ai:interruptCurrentTurn CLI bypass through the confirmed strong interrupt', async () => {
    mocks.getSession.mockResolvedValue({ id: 'claude-cli-1', provider: 'claude-code-cli' });
    mocks.isTerminalActive.mockReturnValue(true);
    mocks.interruptClaudeCliTurn.mockResolvedValue({
      success: true,
      resolvedAfter: 'second-interrupt',
    });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      sessionsProcessingQueue: new Set(['claude-cli-1']),
      streamingHandler: { handle: vi.fn() },
    });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:interruptCurrentTurn');

    await expect(handler?.({} as any, 'claude-cli-1')).resolves.toEqual({
      success: true,
      method: 'terminal-ctrl-c',
    });
    expect(mocks.interruptClaudeCliTurn).toHaveBeenCalledWith('claude-cli-1');
    expect(mocks.writeToTerminal).not.toHaveBeenCalled();
  });

  it('does not claim CLI interrupt success when the strong interrupt is unconfirmed', async () => {
    mocks.getSession.mockResolvedValue({ id: 'claude-cli-failure', provider: 'claude-code-cli' });
    mocks.isTerminalActive.mockReturnValue(true);
    mocks.interruptClaudeCliTurn.mockResolvedValue({ success: false });
    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, {
      sessionsProcessingQueue: new Set(['claude-cli-failure']),
      streamingHandler: { handle: vi.fn() },
    });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:interruptCurrentTurn');

    await expect(handler?.({} as any, 'claude-cli-failure')).resolves.toEqual({
      success: false,
      error: 'Terminal interrupt was not confirmed',
    });
  });

  it('durably routes a rejected plan response when the provider memory waiter was lost', async () => {
    mocks.getSession.mockResolvedValue({ id: 'head-session', provider: 'claude-code' });
    const resolveExitPlanModeConfirmation = vi.fn(() => false);
    mocks.getProvider.mockReturnValue({ resolveExitPlanModeConfirmation });
    mocks.databaseQuery.mockImplementation(async (sql: string) => ({
      // The MetaAgent submitPlan tool-use is the durable waiter surviving the
      // provider restart / lost in-memory Map from FB-043.
      rows: sql.includes('nimbalyst_tool_use') ? [{ id: 'durable-plan-card' }] : [],
    }));

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, { streamingHandler: { handle: vi.fn() } });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:exitPlanModeConfirmResponse');

    await expect(handler?.({} as any, 'approval-43', 'head-session', {
      approved: false,
      feedback: 'Please split the plan.',
    })).resolves.toEqual({ success: true });

    expect(resolveExitPlanModeConfirmation).not.toHaveBeenCalled();
    expect(mocks.databaseQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_agent_messages'),
      [
        'head-session',
        'nimbalyst',
        'output',
        expect.stringContaining('"requestId":"approval-43"'),
        expect.any(Date),
        false,
      ],
    );
  });

  it('normalizes a Codex composite approval ID before persistence and durable matching', async () => {
    const bareRequestId = 'approval-49';
    const compositeRequestId = `nimtc|${bareRequestId}|1784297999209|21431`;
    mocks.getSession.mockResolvedValue({ id: 'head-session', provider: 'openai-codex' });
    const resolveExitPlanModeConfirmation = vi.fn(() => false);
    mocks.getProvider.mockReturnValue({ resolveExitPlanModeConfirmation });
    mocks.databaseQuery.mockImplementation(async (sql: string, params?: unknown[]) => ({
      rows: sql.includes('nimbalyst_tool_use')
        && params?.some((param) => String(param).includes(`"id":"${bareRequestId}"`))
        ? [{ id: 'durable-plan-card' }]
        : [],
    }));

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, { streamingHandler: { handle: vi.fn() } });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:exitPlanModeConfirmResponse');

    await expect(handler?.({} as any, compositeRequestId, 'head-session', {
      approved: false,
      feedback: 'Revise the Codex plan.',
    })).resolves.toEqual({ success: true });

    expect(resolveExitPlanModeConfirmation).not.toHaveBeenCalled();
    expect(mocks.databaseQuery).toHaveBeenCalledWith(
      expect.stringContaining('nimbalyst_tool_use'),
      ['head-session', `%"id":"${bareRequestId}"%`],
    );
    expect(mocks.databaseQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_agent_messages'),
      [
        'head-session',
        'nimbalyst',
        'output',
        expect.stringContaining(`"requestId":"${bareRequestId}"`),
        expect.any(Date),
        false,
      ],
    );
  });

  it('keeps the first durable response when a retry arrives after delivery', async () => {
    mocks.getSession.mockResolvedValue({ id: 'head-session', provider: 'claude-code' });
    mocks.databaseQuery.mockImplementation(async (sql: string) => ({
      rows: sql.includes('nimbalyst_tool_use') ? [{ id: 'durable-plan-card' }] : [],
    }));
    const service = Object.create(AIService.prototype) as AIService;
    const getPlanApprovalState = vi.fn().mockResolvedValue({
      requestId: 'approval-49',
      status: 'delivered',
      decision: 'rejected',
      feedback: 'Keep the first response.',
      deliveryMethod: 'revive',
    });
    Object.assign(service, {
      getPlanApprovalState,
      streamingHandler: { handle: vi.fn() },
    });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:exitPlanModeConfirmResponse');

    await expect(handler?.({} as any, 'approval-49', 'head-session', {
      approved: true,
    })).resolves.toEqual({ success: true });

    expect(mocks.databaseQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_agent_messages'),
      expect.anything(),
    );
    expect(getPlanApprovalState).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when a lost memory waiter has no durable successor', async () => {
    mocks.getSession.mockResolvedValue({ id: 'orphaned-session', provider: 'claude-code' });
    mocks.getProvider.mockReturnValue({ resolveExitPlanModeConfirmation: vi.fn(() => false) });
    mocks.databaseQuery.mockResolvedValue({ rows: [] });

    const service = Object.create(AIService.prototype) as AIService;
    Object.assign(service, { streamingHandler: { handle: vi.fn() } });
    (service as any).setupIpcHandlers();
    const handler = mocks.ipcHandlers.get('ai:exitPlanModeConfirmResponse');

    await expect(handler?.({} as any, 'orphaned-approval', 'orphaned-session', {
      approved: false,
      feedback: 'Retry this response.',
    })).rejects.toThrow('ExitPlanMode approval is no longer active; retry the response');
  });
});

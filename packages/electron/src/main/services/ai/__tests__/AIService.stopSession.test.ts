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
  const scope = new Proxy({}, { get: () => vi.fn() });
  return { logger: new Proxy({}, { get: () => scope }) };
});

import { createPGLiteQueuedPromptsStore } from '../../PGLiteQueuedPromptsStore';
import { AIService } from '../AIService';

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
});

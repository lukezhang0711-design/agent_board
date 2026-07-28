import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelRequestWithQueueSemantics,
  type CreateQueuedPromptInput,
  type QueueCancelAction,
  type QueuedPrompt,
  type QueuedPromptsStore,
} from '../PGLiteQueuedPromptsStore';

const databaseQuery = vi.hoisted(() => vi.fn());
const browserWindowsMock = vi.hoisted(() => ({ windows: [] as any[] }));

vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { create: vi.fn(), updateMetadata: vi.fn(), get: vi.fn() },
  AgentMessagesRepository: { list: vi.fn() },
  SessionFilesRepository: { getFilesBySession: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ClaudeCodeProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexACPProvider: { setMetaAgentServerPort: vi.fn() },
  SessionManager: class { async initialize() {} },
}));
vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  ModelIdentifier: {
    parse: (id: string) => ({ provider: id.split(':')[0], model: id.split(':')[1], combined: id }),
    tryParse: () => null,
    getDefaultModelId: (provider: string) => `${provider}:default`,
  },
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({ subscribe: vi.fn() }),
}));
vi.mock('../ai/providerResolution', () => ({
  resolveExtensionAgentRef: () => null,
  isExtensionAgentProvider: () => false,
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => browserWindowsMock.windows },
}));
vi.mock('../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn() }));
vi.mock('../../utils/store', () => ({ getDefaultAIModel: () => null }));
vi.mock('../../utils/timestampUtils', () => ({ toMillis: (value: unknown) => value }));
vi.mock('../WorktreeStore', () => ({ createWorktreeStore: vi.fn() }));
vi.mock('../GitWorktreeService', () => ({ GitWorktreeService: class {} }));
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: { query: databaseQuery },
}));
vi.mock('../../database/initialize', () => ({ getDatabase: () => null }));
vi.mock('../../file/GitRefWatcher', () => ({ gitRefWatcher: {} }));
vi.mock('../ai/AIService', () => ({ AIService: class {} }));
vi.mock('../../mcp/tools/trackerToolHandlers', () => ({ createBidirectionalLink: vi.fn() }));
vi.mock('../../mcp/metaAgentServer', () => ({
  startMetaAgentServer: vi.fn(),
  setMetaAgentToolFns: vi.fn(),
  shutdownMetaAgentServer: vi.fn(),
}));
vi.mock('../metaAgentNotificationSignature', () => ({
  computeNotificationSignature: (eventType: string) => eventType,
}));
vi.mock('../metaAgentMessageText', () => ({
  extractMessageText: vi.fn(),
  extractUserPrompts: vi.fn(),
}));
vi.mock('../ai/claudeCliLauncherSingleton', () => ({
  ClaudeCliLauncherConfig: { setMetaAgentServerPort: vi.fn() },
}));

import { AISessionsRepository } from '@nimbalyst/runtime';
import { MetaAgentService } from '../MetaAgentService';

function createMemoryQueueStore(): QueuedPromptsStore {
  const prompts = new Map<string, QueuedPrompt>();
  const pausedSessions = new Set<string>();

  return {
    async create(input: CreateQueuedPromptInput) {
      const prompt: QueuedPrompt = {
        ...input,
        origin: input.origin ?? 'user',
        status: 'pending',
        createdAt: Date.now(),
      };
      prompts.set(prompt.id, prompt);
      return prompt;
    },
    async get(id) {
      return prompts.get(id) ?? null;
    },
    async listForSession(sessionId) {
      return [...prompts.values()].filter((prompt) => prompt.sessionId === sessionId);
    },
    async listPending(sessionId) {
      if (pausedSessions.has(sessionId)) return [];
      return [...prompts.values()].filter(
        (prompt) => prompt.sessionId === sessionId && prompt.status === 'pending'
      );
    },
    async pauseSessionQueue(sessionId) {
      pausedSessions.add(sessionId);
      let count = 0;
      for (const prompt of prompts.values()) {
        if (prompt.sessionId === sessionId && prompt.status === 'pending') {
          prompt.status = 'paused';
          count += 1;
        }
      }
      return count;
    },
    async resumeSessionQueue(sessionId) {
      pausedSessions.delete(sessionId);
      let count = 0;
      for (const prompt of prompts.values()) {
        if (prompt.sessionId === sessionId && prompt.status === 'paused') {
          prompt.status = 'pending';
          count += 1;
        }
      }
      return count;
    },
    async isSessionQueuePaused(sessionId) {
      return pausedSessions.has(sessionId);
    },
    async clearSessionQueue(sessionId) {
      let count = 0;
      for (const [id, prompt] of prompts.entries()) {
        if (prompt.sessionId === sessionId && ['pending', 'paused', 'executing'].includes(prompt.status)) {
          prompts.delete(id);
          count += 1;
        }
      }
      pausedSessions.delete(sessionId);
      return count;
    },
    async claim(id) {
      const prompt = prompts.get(id);
      if (!prompt || prompt.status !== 'pending' || pausedSessions.has(prompt.sessionId)) return null;
      prompt.status = 'executing';
      return prompt;
    },
    async complete(id) {
      const prompt = prompts.get(id);
      if (prompt) prompt.status = 'completed';
    },
    async fail(id, errorMessage) {
      const prompt = prompts.get(id);
      if (prompt) {
        prompt.status = 'failed';
        prompt.errorMessage = errorMessage;
      }
    },
    async delete(id) {
      prompts.delete(id);
    },
    async rollbackExecuting() { return 0; },
    async rollbackAllExecuting() { return 0; },
    async sweepExecutingOnBoot() { return { completed: 0, rolledBack: 0 }; },
    async sweepExecutingForSession() { return { completed: 0, rolledBack: 0 }; },
    async cleanup() { return 0; },
  };
}

describe('MetaAgentService.interruptSession', () => {
  const service = MetaAgentService.getInstance();
  let queueStore: QueuedPromptsStore;
  let running: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AISessionsRepository.get).mockReset();
    vi.mocked(AISessionsRepository.updateMetadata).mockReset();
    browserWindowsMock.windows = [];
    queueStore = createMemoryQueueStore();
    running = new Set(['child', 'grandchild']);
    databaseQuery.mockResolvedValue({
      rows: [
        { id: 'head', created_by_session_id: null, status: 'running' },
        { id: 'child', created_by_session_id: 'head', status: 'running' },
        { id: 'grandchild', created_by_session_id: 'child', status: 'running' },
      ],
    });
    (service as any).aiService = {
      stopSession: async (sessionId: string, queueAction: QueueCancelAction) =>
        cancelRequestWithQueueSemantics({
          sessionId,
          queueAction,
          queueStore,
          cancelCurrent: async () => {
            if (!running.delete(sessionId)) throw new Error('No active provider for session');
          },
          clearProcessing: () => {},
        }),
    };
  });

  it('stops only the target when cascade is false', async () => {
    await queueStore.create({ id: 'child-queued', sessionId: 'child', prompt: 'child next' });
    await queueStore.create({ id: 'grandchild-queued', sessionId: 'grandchild', prompt: 'grandchild next' });

    const result = JSON.parse(await service.interruptSession('head', '/workspace', {
      sessionId: 'child',
      cascade: false,
    }));

    expect(result).toEqual({
      success: true,
      cascade: false,
      queueAction: 'pause',
      results: [{
        sessionId: 'child',
        outcome: 'interrupted',
        queue: 'paused',
        paused: 1,
      }],
    });
    expect(running).toEqual(new Set(['grandchild']));
    expect((await queueStore.get('child-queued'))?.status).toBe('paused');
    expect((await queueStore.get('grandchild-queued'))?.status).toBe('pending');
  });

  it('emergency-stops children, cancels queued dispatches, then clears the Head queue', async () => {
    databaseQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE dispatch_queue')) {
        return { rows: [{ reserved_session_id: 'queued-child' }] };
      }
      return {
        rows: [
          { id: 'head', created_by_session_id: null, status: 'running' },
          { id: 'child', created_by_session_id: 'head', status: 'running' },
        ],
      };
    });
    const stopSession = vi.fn().mockResolvedValue({ success: true, queue: 'cleared' });
    (service as any).aiService = { stopSession };

    await expect(service.stopAndClearHeadSession('head', '/workspace')).resolves.toEqual({
      success: true,
      stoppedChildren: 1,
      clearedDispatches: 1,
    });

    expect(stopSession).toHaveBeenNthCalledWith(1, 'child', 'clear');
    expect(stopSession).toHaveBeenNthCalledWith(2, 'head', 'clear');
    expect(AISessionsRepository.updateMetadata).toHaveBeenCalledWith('queued-child', {
      metadata: { dispatchQueued: false },
    });
  });

  it('cascades through multiple levels without following cycles back to the Head Agent', async () => {
    databaseQuery.mockResolvedValue({
      rows: [
        { id: 'head', created_by_session_id: 'grandchild', status: 'running' },
        { id: 'child', created_by_session_id: 'head', status: 'running' },
        { id: 'grandchild', created_by_session_id: 'child', status: 'running' },
        { id: 'self-cycle', created_by_session_id: 'self-cycle', status: 'running' },
        { id: 'outsider', created_by_session_id: 'other-head', status: 'running' },
      ],
    });
    running = new Set(['head', 'child', 'grandchild', 'outsider']);
    await queueStore.create({ id: 'child-cascade', sessionId: 'child', prompt: 'child next' });
    await queueStore.create({ id: 'grandchild-cascade', sessionId: 'grandchild', prompt: 'grandchild next' });

    const result = JSON.parse(await service.interruptSession('head', '/workspace', {
      sessionId: 'child',
      cascade: true,
    }));

    expect(result.results).toEqual([
      {
        sessionId: 'child',
        outcome: 'interrupted',
        queue: 'paused',
        paused: 1,
      },
      {
        sessionId: 'grandchild',
        outcome: 'interrupted',
        queue: 'paused',
        paused: 1,
      },
    ]);
    expect(running).toEqual(new Set(['head', 'outsider']));
    expect((await queueStore.get('child-cascade'))?.status).toBe('paused');
    expect((await queueStore.get('grandchild-cascade'))?.status).toBe('paused');
  });

  it('reports an idle target with no active provider as already-ended', async () => {
    databaseQuery.mockResolvedValue({
      rows: [
        { id: 'head', created_by_session_id: null, status: 'running' },
        { id: 'idle-child', created_by_session_id: 'head', status: 'idle' },
      ],
    });
    (service as any).aiService = {
      stopSession: async () => ({
        success: false,
        queue: 'unchanged',
        error: 'No active provider for session',
      }),
    };

    const result = JSON.parse(await service.interruptSession('head', '/workspace', {
      sessionId: 'idle-child',
    }));

    expect(result).toEqual({
      success: true,
      cascade: false,
      queueAction: 'pause',
      results: [{
        sessionId: 'idle-child',
        outcome: 'already-ended',
        queue: 'unchanged',
        reason: 'No active provider for session',
      }],
    });
  });

  it('rejects a target outside the calling Head Agent task tree without changing it', async () => {
    databaseQuery.mockResolvedValue({
      rows: [
        { id: 'head', created_by_session_id: null, status: 'running' },
        { id: 'child', created_by_session_id: 'head', status: 'running' },
        { id: 'outsider', created_by_session_id: 'other-head', status: 'running' },
      ],
    });
    running = new Set(['child', 'outsider']);
    await queueStore.create({ id: 'outsider-queued', sessionId: 'outsider', prompt: 'must remain' });

    await expect(service.interruptSession('head', '/workspace', {
      sessionId: 'outsider',
      cascade: true,
    })).rejects.toThrow(
      'Session outsider is not in the task tree created by Head Agent head'
    );
    expect(running).toEqual(new Set(['child', 'outsider']));
    expect((await queueStore.get('outsider-queued'))?.status).toBe('pending');
  });

  it('returns a failed node with the real reason', async () => {
    databaseQuery.mockResolvedValue({
      rows: [
        { id: 'head', created_by_session_id: null, status: 'running' },
        { id: 'child', created_by_session_id: 'head', status: 'running' },
      ],
    });
    (service as any).aiService = {
      stopSession: async () => ({
        success: false,
        queue: 'unchanged',
        error: 'database unavailable',
      }),
    };

    const result = JSON.parse(await service.interruptSession('head', '/workspace', {
      sessionId: 'child',
    }));

    expect(result.results).toEqual([{
      sessionId: 'child',
      outcome: 'failed',
      queue: 'unchanged',
      reason: 'database unavailable',
    }]);
    expect(result.success).toBe(false);
  });

  it('clears queued work when queueAction is clear', async () => {
    await queueStore.create({ id: 'child-clear', sessionId: 'child', prompt: 'discard me' });

    const result = JSON.parse(await service.interruptSession('head', '/workspace', {
      sessionId: 'child',
      queueAction: 'clear',
    }));

    expect(result.results).toEqual([{
      sessionId: 'child',
      outcome: 'interrupted',
      queue: 'cleared',
    }]);
    expect(await queueStore.get('child-clear')).toBeNull();
  });

  it('broadcasts a session-list refresh after persisting an interrupted marker', async () => {
    const send = vi.fn();
    browserWindowsMock.windows = [{
      isDestroyed: () => false,
      webContents: { send },
    }];

    await service.interruptSession('head', '/workspace', { sessionId: 'child' });

    expect(AISessionsRepository.updateMetadata).toHaveBeenCalledWith('child', {
      metadata: { interruptedByHead: true },
    });
    expect(send.mock.calls.filter(([channel]) => channel === 'sessions:refresh-list')).toEqual([
      ['sessions:refresh-list', { workspacePath: '/workspace', sessionId: 'child' }],
    ]);
  });

  it('broadcasts a session-list refresh after clearing an interrupted marker', async () => {
    const send = vi.fn();
    browserWindowsMock.windows = [{
      isDestroyed: () => false,
      webContents: { send },
    }];
    vi.mocked(AISessionsRepository.get).mockResolvedValue({
      workspacePath: '/workspace',
      metadata: { interruptedByHead: true },
    } as any);

    await (service as any).clearInterruptedByHeadMarker('child');

    expect(AISessionsRepository.updateMetadata).toHaveBeenCalledWith('child', {
      metadata: { interruptedByHead: false },
    });
    expect(send.mock.calls.filter(([channel]) => channel === 'sessions:refresh-list')).toEqual([
      ['sessions:refresh-list', { workspacePath: '/workspace', sessionId: 'child' }],
    ]);
  });
});

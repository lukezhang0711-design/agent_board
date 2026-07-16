import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
  getQueuedPromptsStore: vi.fn(),
  getSession: vi.fn(),
  interruptSession: vi.fn(),
  isTerminalActive: vi.fn(),
  interruptClaudeCliTurn: vi.fn(),
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  SessionManager: class {},
  ProviderFactory: { getProvider: mocks.getProvider },
  ModelRegistry: class {},
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
});

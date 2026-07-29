import { afterEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  batchListener: null as null | ((batch: {
    sessionId: string;
    count: number;
    direction: 'input' | 'output' | 'mixed';
  }) => void),
  canonicalListener: null as null | ((event: Record<string, unknown>) => void),
  unsubscribeBatch: vi.fn(),
  processNewMessages: vi.fn(),
  getSession: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: {
    setStore: vi.fn(),
    clearStore: vi.fn(),
    get: testState.getSession,
  },
  SessionFilesRepository: {
    setStore: vi.fn(),
    clearStore: vi.fn(),
  },
  AgentMessagesRepository: {
    setStore: vi.fn(),
    clearStore: vi.fn(),
  },
  TranscriptMigrationRepository: {
    setService: vi.fn(),
    clearService: vi.fn(),
  },
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  isAgentProvider: (provider: string | null | undefined) =>
    provider === 'claude-code'
    || provider === 'claude-code-cli'
    || provider === 'openai-codex'
    || provider === 'openai-codex-acp'
    || provider === 'opencode'
    || provider === 'copilot-cli',
  onAgentMessageBatch: vi.fn((listener) => {
    testState.batchListener = listener;
    return testState.unsubscribeBatch;
  }),
}));

vi.mock('@nimbalyst/runtime/ai/server/transcript/TranscriptMigrationService', () => ({
  TranscriptMigrationService: class {
    setOnEventWritten(listener: (event: Record<string, unknown>) => void): void {
      testState.canonicalListener = listener;
    }

    processNewMessages(sessionId: string, provider: string): Promise<unknown> {
      return testState.processNewMessages(sessionId, provider);
    }
  },
}));

vi.mock('../TranscriptMigrationAdapters', () => ({
  createRawMessageStoreAdapter: vi.fn(() => ({})),
}));
vi.mock('../PGLiteSessionStore', () => ({
  createPGLiteSessionStore: vi.fn(() => ({})),
}));
vi.mock('../PGLiteSessionFileStore', () => ({
  createPGLiteSessionFileStore: vi.fn(() => ({})),
}));
vi.mock('../PGLiteAgentMessagesStore', () => ({
  createPGLiteAgentMessagesStore: vi.fn(() => ({})),
}));
vi.mock('../SyncedAgentMessagesStore', () => ({
  createSyncedAgentMessagesStore: vi.fn((store) => store),
}));
vi.mock('../PGLiteWorkspaceRepository', () => ({
  createPGLiteWorkspaceRepository: vi.fn(() => ({})),
}));
vi.mock('../PGLiteDocumentsRepository', () => ({
  createPGLiteDocumentsRepository: vi.fn(() => ({})),
}));
vi.mock('../PGLiteQueuedPromptsStore', () => ({
  createPGLiteQueuedPromptsStore: vi.fn(() => ({})),
}));
vi.mock('../PGLiteSessionWakeupsStore', () => ({
  createPGLiteSessionWakeupsStore: vi.fn(() => ({})),
}));
vi.mock('../AgentMessagesBackfill', () => ({
  runAgentMessagesBackfill: vi.fn(async () => undefined),
}));
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: {
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(async () => undefined),
    getActiveSQLiteDatabase: vi.fn(() => null),
    query: vi.fn(),
  },
}));
vi.mock('../../database/sqlite/SQLiteStoreAdapter', () => ({
  createSQLiteStoreAdapter: vi.fn(() => ({})),
}));
vi.mock('../../utils/logger', () => ({
  logger: {
    main: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));
vi.mock('../SyncManager', () => ({
  initializeSync: vi.fn(async (store) => store),
  shutdownSync: vi.fn(),
  isSyncEnabled: vi.fn(() => false),
  reinitializeSync: vi.fn(async (store) => store),
}));
vi.mock('../TrackerSyncManager', () => ({
  shutdownTrackerSync: vi.fn(),
  initializeTrackerSync: vi.fn(async () => undefined),
}));
vi.mock('../StytchAuthService', () => ({
  onAuthStateChange: vi.fn(() => vi.fn()),
}));
vi.mock('../../window/WindowManager', () => ({
  windows: new Map([
    [1, { webContents: { send: testState.send } }],
  ]),
  windowStates: new Map(),
}));

import { repositoryManager } from '../RepositoryManager';

afterEach(async () => {
  await repositoryManager.cleanup();
  testState.batchListener = null;
  testState.canonicalListener = null;
  vi.clearAllMocks();
});

describe('FB-051 persisted-batch transcript catch-up', () => {
  it('transforms and broadcasts an interactive prompt after the queued raw row is persisted', async () => {
    const sessionId = 'claude-haiku-waiting';
    const promptEvent = {
      id: 41,
      sessionId,
      sequence: 41,
      eventType: 'interactive_prompt',
      payload: {
        promptType: 'ask_user_question',
        requestId: 'toolu_waiting',
        status: 'pending',
      },
    };
    testState.getSession.mockResolvedValue({
      id: sessionId,
      provider: 'claude-code',
    });
    testState.processNewMessages.mockImplementation(async () => {
      testState.canonicalListener?.(promptEvent);
      return [promptEvent];
    });

    await repositoryManager.initialize();

    // This event fires only after AgentMessageWriteQueue has committed the raw
    // Claude SDK chunk. At that point the transformer must catch up even if
    // Claude is blocked waiting for the user's answer and emits no next chunk.
    expect(testState.batchListener).toBeTypeOf('function');
    testState.batchListener!({
      sessionId,
      count: 1,
      direction: 'output',
    });

    await vi.waitFor(() => {
      expect(testState.processNewMessages).toHaveBeenCalledWith(sessionId, 'claude-code');
      expect(testState.send).toHaveBeenCalledWith('transcript:event', promptEvent);
    });
  });
});

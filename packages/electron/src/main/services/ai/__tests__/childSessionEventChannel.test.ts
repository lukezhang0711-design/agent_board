import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const handlerTestState = vi.hoisted(() => ({
  provider: null as any,
  stateManager: {
    startSession: vi.fn().mockResolvedValue(undefined),
    updateActivity: vi.fn().mockResolvedValue(undefined),
    getSessionState: vi.fn().mockReturnValue(null),
    isSessionActive: vi.fn().mockReturnValue(false),
    endSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/tmp',
    getPath: () => '/tmp',
    isPackaged: false,
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getAllWindows: () => [],
  },
}));
vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { get: vi.fn() },
  DocumentContextService: class {},
}));
vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ProviderFactory: {
    getProvider: () => handlerTestState.provider,
  },
  ModelRegistry: {
    getModelsForProvider: vi.fn().mockResolvedValue([]),
  },
  isAgentProvider: () => false,
  onAgentMessageBatch: () => () => {},
  buildMetaAgentSystemPrompt: () => '',
  buildDevAgentSystemPrompt: () => '',
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => handlerTestState.stateManager,
}));
vi.mock('../tools', () => ({ toolRegistry: { getAll: () => [] } }));
vi.mock('../tools/extractFilePath', () => ({ extractFilePath: () => null }));
vi.mock('../providerResolution', () => ({ resolveExtensionAgentRef: () => null }));
vi.mock('../../../extensions/AgentProviderRegistry', () => ({
  getAgentProviderRegistry: () => ({ findByContributionId: () => null }),
}));
vi.mock('../childSessionTakeover', () => ({
  disableParentNotificationsAfterDirectTakeover: vi.fn(),
}));
vi.mock('../../SessionFileTracker', () => ({
  sessionFileTracker: { trackUserMessage: vi.fn() },
}));
vi.mock('../../FeatureUsageService.ts', () => ({
  FEATURES: {},
  FeatureUsageService: { getInstance: () => ({ recordUsage: vi.fn() }) },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));
vi.mock('../../../window/WindowManager', () => ({
  findWindowByWorkspace: () => null,
  windowStates: new Map(),
}));
vi.mock('../../CodexEditWindowRegistry', () => ({
  codexEditWindowRegistry: { clearSession: vi.fn() },
  shouldOpenCodexEditWindow: () => false,
}));
vi.mock('../../ToolCallMatcher', () => ({
  toolCallMatcher: { matchSession: vi.fn().mockResolvedValue(0) },
  unwrapShellCommand: (value: string) => value,
}));
vi.mock('../../../file/WorkspaceEventBus', () => ({ addGitignoreBypass: vi.fn() }));
vi.mock('../pendingPromptPersistence', () => ({ setSessionPendingPrompt: vi.fn() }));
vi.mock('../../AgentWorkflowService', () => ({ getAgentWorkflowService: () => ({}) }));
vi.mock('../../../mcp/metaAgentServer', () => ({ getMetaAgentOpenAITools: () => [] }));
vi.mock('../../../mcp/devAgentTools', () => ({
  getDevAgentOpenAITools: () => [],
  resolveDevToolScope: () => 'read',
}));
vi.mock('../../../utils/store', () => ({
  getDefaultEffortLevel: () => undefined,
  incrementCompletedSessionsWithTools: () => 0,
  markCommunityPopupShown: vi.fn(),
  shouldShowCommunityPopup: () => false,
  wasCommunityPopupShownThisLaunch: () => false,
}));
vi.mock('../aiServiceUtils', () => ({
  safeSend: vi.fn(),
  previewForLog: (value: string) => value,
  extractModelForProvider: () => null,
  bucketMessageLength: () => 'short',
  bucketResponseTime: () => 'fast',
  bucketChunkCount: () => 'few',
  bucketContentLength: () => 'short',
  categorizeAIError: () => 'unknown',
  attachMentionedFiles: async (message: string) => ({ enhancedMessage: message, attachedFiles: [] }),
  tagFileBeforeEdit: vi.fn(),
  detectConfiguredAIProvider: () => null,
  detectNimbalystSlashCommand: () => null,
  readFileContentOrNull: async () => null,
  getFileExtensionForAnalytics: () => null,
}));
vi.mock('../providerListenerRegistry', () => ({ installScopedProviderListener: vi.fn() }));
vi.mock('../../NotificationService', () => ({ notificationService: { showNotification: vi.fn() } }));
vi.mock('../../SoundNotificationService', () => ({
  SoundNotificationService: { getInstance: () => ({ playCompletionSound: vi.fn() }) },
}));
vi.mock('../../../tray/TrayManager', () => ({ TrayManager: { getInstance: () => ({}) } }));
vi.mock('../../../HistoryManager', () => ({ historyManager: {} }));
vi.mock('../../SyncManager', () => ({
  getSyncProvider: () => null,
  isDesktopTrulyAway: () => false,
}));
vi.mock('../../MetaAgentService', () => ({ MetaAgentService: { getInstance: () => ({ getPort: () => null }) } }));

import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { AgentMessagesRepository } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';
import { TranscriptRuntime } from '@nimbalyst/runtime/ai/server/transcript';
import type { RawMessage } from '@nimbalyst/runtime/ai/server/transcript';
import { SQLiteDatabase } from '../../../database/sqlite/SQLiteDatabase';
import { createSQLiteStoreAdapter } from '../../../database/sqlite/SQLiteStoreAdapter';
import { createPGLiteAgentMessagesStore } from '../../PGLiteAgentMessagesStore';
import {
  createPGLiteQueuedPromptsStore,
  prepareQueuedPromptForDispatch,
} from '../../PGLiteQueuedPromptsStore';
import { createPGLiteSessionStore } from '../../PGLiteSessionStore';
import { exportSessionToHtml } from '../../SessionHtmlExporter';
import {
  MessageStreamingHandler,
  suppressChildSessionEventInputPersistence,
} from '../MessageStreamingHandler';

const eventTypes = [
  'session:completed',
  'session:error',
  'session:waiting',
  'session:interrupted',
] as const;

type PersistedLog = (
  sessionId: string,
  source: string,
  direction: 'input' | 'output',
  content: string,
) => Promise<void>;

function createPersistingProvider(modelInputs: string[], reply: string) {
  return {
    async logAgentMessage(
      sessionId: string,
      source: string,
      direction: 'input' | 'output',
      content: string,
    ): Promise<void> {
      await AgentMessagesRepository.create({
        sessionId,
        source,
        direction,
        content,
        createdAt: new Date(),
        hidden: false,
        searchable: true,
        searchableText: direction === 'input'
          ? (JSON.parse(content) as { prompt: string }).prompt
          : reply,
        messageKind: direction === 'input' ? 'user' : 'assistant',
      });
    },
    async *sendMessage(message: string, sessionId: string) {
      modelInputs.push(message);
      await (this.logAgentMessage as PersistedLog)(
        sessionId,
        'claude-code',
        'input',
        JSON.stringify({ prompt: message, options: {} }),
      );
      await (this.logAgentMessage as PersistedLog)(
        sessionId,
        'claude-code',
        'output',
        JSON.stringify({ type: 'text', content: reply }),
      );
      yield { type: 'text', content: reply };
      yield { type: 'complete', content: reply };
    },
  };
}

function rawMessageStore(db: SQLiteDatabase) {
  return {
    async getMessages(sessionId: string, afterId?: number): Promise<RawMessage[]> {
      const params: unknown[] = [sessionId];
      let sql = `SELECT id, session_id, source, direction, content, created_at, metadata, hidden
        FROM ai_agent_messages WHERE session_id = $1`;
      if (afterId !== undefined) {
        params.push(afterId);
        sql += ' AND id > $2';
      }
      sql += ' ORDER BY id ASC';
      const { rows } = await db.query<any>(sql, params);
      return rows.map((row) => ({
        id: Number(row.id),
        sessionId: row.session_id,
        source: row.source,
        direction: row.direction,
        content: row.content,
        createdAt: new Date(row.created_at),
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        hidden: Boolean(row.hidden),
      }));
    },
  };
}

describe('child session event hidden delivery channel', () => {
  let dbDir: string;
  let db: SQLiteDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlerTestState.provider = null;
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-child-event-channel-'));
    db = new SQLiteDatabase({
      dbDir,
      schemaDir: path.resolve(__dirname, '../../../database/sqlite/schemas'),
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await db.initialize();
    AISessionsRepository.setStore(createPGLiteSessionStore(db));
    AgentMessagesRepository.setStore(createPGLiteAgentMessagesStore(db));
  });

  afterEach(async () => {
    AgentMessagesRepository.clearStore();
    AISessionsRepository.clearStore();
    await db.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it.each(eventTypes)('delivers %s to the model without a user record', async (eventType) => {
    const sessionId = `parent-${eventType}`;
    const promptId = `prompt-${eventType}`;
    const secret = `FB001_${eventType.replace(':', '_')}_RAW_EVENT`;
    const notification = `[Child Session Update]\nEvent: ${eventType}\n${secret}`;
    const reply = `Head processed ${eventType}`;
    await AISessionsRepository.create({
      id: sessionId,
      provider: 'claude-code',
      workspaceId: '/workspace',
      title: `Parent ${eventType}`,
    });

    const queueStore = createPGLiteQueuedPromptsStore(db);
    await queueStore.create({
      id: promptId,
      sessionId,
      prompt: notification,
      origin: 'child_session_event',
    });
    const claimed = await queueStore.claim(promptId);
    expect(claimed).not.toBeNull();
    const dispatched = prepareQueuedPromptForDispatch(claimed!);
    expect(dispatched.documentContext?.promptOrigin).toBe('child_session_event');

    const modelInputs: string[] = [];
    const provider = createPersistingProvider(modelInputs, reply);
    const restoreInputPersistence = suppressChildSessionEventInputPersistence(
      provider as any,
      sessionId,
    );
    try {
      for await (const _chunk of provider.sendMessage(dispatched.prompt, sessionId)) {
        // Drain the real provider-shaped async stream.
      }
    } finally {
      restoreInputPersistence();
    }

    expect(modelInputs).toEqual([notification]);
    const { rows } = await db.query<any>(
      `SELECT direction, content, message_kind, searchable_text
       FROM ai_agent_messages WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: 'output',
      message_kind: 'assistant',
      searchable_text: reply,
    });

    const transcript = await new TranscriptRuntime(rawMessageStore(db)).getViewMessages(
      sessionId,
      'claude-code',
    );
    expect(transcript.some((message) => message.type === 'user_message')).toBe(false);
    expect(transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant_message', text: reply }),
    ]));

    const sessionStore = createPGLiteSessionStore(createSQLiteStoreAdapter(db));
    await expect(sessionStore.search('/workspace', secret, {
      direction: 'input',
      timeRange: 'all',
    })).resolves.toEqual([]);
    const html = await exportSessionToHtml({
      id: sessionId,
      provider: 'claude-code',
      workspacePath: '/workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: transcript,
    } as any);
    expect(html).not.toContain(secret);
    expect(html).toContain(reply);
  });

  it('routes the persisted child origin through MessageStreamingHandler without a user row', async () => {
    const sessionId = 'parent-handler-integration';
    const notification = '[Child Session Update]\nEvent: session:completed\nHANDLER_INTEGRATION_RAW';
    const reply = 'Handler integration reply';
    await AISessionsRepository.create({
      id: sessionId,
      provider: 'openai',
      workspaceId: '/workspace',
      title: 'Handler integration',
    });
    const queueStore = createPGLiteQueuedPromptsStore(db);
    const queued = await queueStore.create({
      id: 'prompt-handler-integration',
      sessionId,
      prompt: notification,
      origin: 'child_session_event',
    });
    const claimed = prepareQueuedPromptForDispatch((await queueStore.claim(queued.id))!);

    const modelInputs: string[] = [];
    const provider = {
      initialize: vi.fn().mockResolvedValue(undefined),
      registerToolHandler: vi.fn(),
      async logAgentMessage(
        loggedSessionId: string,
        source: string,
        direction: 'input' | 'output',
        content: string,
      ): Promise<void> {
        await AgentMessagesRepository.create({
          sessionId: loggedSessionId,
          source,
          direction,
          content,
          createdAt: new Date(),
          hidden: false,
          searchable: true,
          searchableText: direction === 'input'
            ? (JSON.parse(content) as { prompt: string }).prompt
            : reply,
          messageKind: direction === 'input' ? 'user' : 'assistant',
        });
      },
      async *sendMessage(message: string, _context: unknown, loggedSessionId: string) {
        modelInputs.push(message);
        await this.logAgentMessage(
          loggedSessionId,
          'openai',
          'input',
          JSON.stringify({ prompt: message, options: {} }),
        );
        await this.logAgentMessage(
          loggedSessionId,
          'openai',
          'output',
          JSON.stringify({ type: 'text', content: reply }),
        );
      },
    };
    handlerTestState.provider = provider;

    const sessionManager = {
      loadSession: vi.fn().mockResolvedValue({
        id: sessionId,
        provider: 'openai',
        workspacePath: '/workspace',
        title: 'Handler integration',
        messages: [],
        metadata: {},
        providerConfig: {},
      }),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateSessionTitle: vi.fn().mockResolvedValue(undefined),
      updateProviderSessionData: vi.fn().mockResolvedValue(undefined),
    };
    const handler = new MessageStreamingHandler({
      sessionManager,
      analytics: { sendEvent: vi.fn() },
      sendMessageHandler: null,
      processingQueuedPromptIds: new Set<string>(),
      matchDebounceTimers: new Map(),
      sessionsProcessingQueue: new Set<string>(),
      documentContextService: {
        prepareContext: () => ({
          documentContext: {},
          userMessageAdditions: {},
        }),
      },
      hooklessWatcher: {
        ensureForSession: vi.fn().mockResolvedValue(undefined),
        stopForSession: vi.fn().mockResolvedValue(undefined),
        scheduleStop: vi.fn(),
      },
      getSettingsStore: () => ({ get: vi.fn() }),
      getApiKeyForProvider: () => undefined,
      buildClaudeCodeRuntimeConfig: vi.fn(),
      continueQueuedPromptChain: vi.fn(),
      tryDispatchNextQueuedPrompt: vi.fn(),
      isSessionQueuePaused: vi.fn().mockResolvedValue(false),
      runAutoContextCommand: vi.fn(),
      createToolHandler: () => ({}),
      inferWorktreePathFromFilePath: () => null,
      inferWorktreePathFromCommand: () => null,
      adoptWorktreeForSession: vi.fn(),
    } as any);

    try {
      await handler.handle(
        { sender: { id: 1 } } as any,
        claimed.prompt,
        {
          ...claimed.documentContext,
          queuedPromptId: claimed.id,
        } as any,
        sessionId,
        '/workspace',
      );
    } finally {
      handler.destroy();
    }

    expect(modelInputs).toEqual([notification]);
    expect(sessionManager.addMessage).not.toHaveBeenCalled();
    const { rows } = await db.query<any>(
      `SELECT direction, message_kind, searchable_text
       FROM ai_agent_messages WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    expect(rows).toEqual([
      { direction: 'output', message_kind: 'assistant', searchable_text: reply },
    ]);
  });

  it('keeps ordinary queued prompts as visible user messages by default', async () => {
    const sessionId = 'parent-user-default';
    const userPrompt = 'VISIBLE_ORDINARY_USER_PROMPT';
    await AISessionsRepository.create({
      id: sessionId,
      provider: 'claude-code',
      workspaceId: '/workspace',
      title: 'Ordinary queue',
    });
    const queueStore = createPGLiteQueuedPromptsStore(db);
    const queued = await queueStore.create({
      id: 'prompt-user-default',
      sessionId,
      prompt: userPrompt,
    });
    expect(queued.origin).toBe('user');
    const claimed = await queueStore.claim(queued.id);
    const dispatched = prepareQueuedPromptForDispatch(claimed!);
    expect(dispatched.documentContext?.promptOrigin).toBeUndefined();

    const provider = createPersistingProvider([], 'Normal reply');
    for await (const _chunk of provider.sendMessage(dispatched.prompt, sessionId)) {
      // Drain the real provider-shaped async stream.
    }

    const { rows } = await db.query<any>(
      `SELECT direction, message_kind, searchable_text
       FROM ai_agent_messages WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    expect(rows).toEqual([
      { direction: 'input', message_kind: 'user', searchable_text: userPrompt },
      { direction: 'output', message_kind: 'assistant', searchable_text: 'Normal reply' },
    ]);

    const transcript = await new TranscriptRuntime(rawMessageStore(db)).getViewMessages(
      sessionId,
      'claude-code',
    );
    expect(transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'user_message', text: userPrompt }),
    ]));
  });
});

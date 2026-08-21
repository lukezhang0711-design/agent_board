import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const productionState = vi.hoisted(() => ({
  queueStore: null as null | {
    listPending: (sessionId: string) => Promise<any[]>;
    claim: (id: string) => Promise<any>;
    complete: (id: string) => Promise<void>;
    fail: (id: string, message: string) => Promise<void>;
  },
  terminalWrites: [] as Array<[string, string]>,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('../../RepositoryManager', () => ({
  getQueuedPromptsStore: () => {
    if (!productionState.queueStore) {
      throw new Error('queued prompt store not installed');
    }
    return productionState.queueStore;
  },
}));

vi.mock('../../TerminalSessionManager', () => ({
  getTerminalSessionManager: () => ({
    writeToTerminal: (sessionId: string, data: string) => {
      productionState.terminalWrites.push([sessionId, data]);
    },
  }),
}));

vi.mock('../../analytics/AnalyticsService', () => ({
  AnalyticsService: {
    getInstance: () => ({ sendEvent: vi.fn() }),
  },
}));

vi.mock('../aiServiceUtils', () => ({
  bucketMessageLength: () => 'short',
}));

vi.mock('../claudeCliRevealTerminal', () => ({
  broadcastClaudeCliRevealTerminal: vi.fn(),
}));

vi.mock('@nimbalyst/runtime', async () => {
  const [
    { AgentMessagesRepository },
    { AISessionsRepository },
  ] = await Promise.all([
    import('@nimbalyst/runtime/storage/repositories/AgentMessagesRepository'),
    import('@nimbalyst/runtime/storage/repositories/AISessionsRepository'),
  ]);
  return { AgentMessagesRepository, AISessionsRepository };
});

import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { AgentMessagesRepository } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';
import { SQLiteDatabase } from '../../../database/sqlite/SQLiteDatabase';
import { createPGLiteAgentMessagesStore } from '../../PGLiteAgentMessagesStore';
import {
  createPGLiteQueuedPromptsStore,
  type QueuedPromptsStore,
} from '../../PGLiteQueuedPromptsStore';
import { createPGLiteSessionStore } from '../../PGLiteSessionStore';
import { flushNextClaudeCliQueuedPromptForSession } from '../claudeCliQueueFlushSingleton';
import { setDynamicModelCatalogValidator } from '../modelCatalogValidation';

const eventTypes = [
  'session:completed',
  'session:error',
  'session:waiting',
  'session:interrupted',
] as const;

const pasted = (text: string) => `\x1b[200~${text}\x1b[201~`;

describe('claude-code-cli child session event channel', () => {
  let dbDir: string;
  let db: SQLiteDatabase;
  let queueStore: QueuedPromptsStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDynamicModelCatalogValidator(async () => {});
    productionState.terminalWrites.length = 0;
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-cli-child-event-'));
    db = new SQLiteDatabase({
      dbDir,
      schemaDir: path.resolve(__dirname, '../../../database/sqlite/schemas'),
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await db.initialize();
    AISessionsRepository.setStore(createPGLiteSessionStore(db));
    AgentMessagesRepository.setStore(createPGLiteAgentMessagesStore(db));
    queueStore = createPGLiteQueuedPromptsStore(db);
    productionState.queueStore = queueStore;
  });

  afterEach(async () => {
    setDynamicModelCatalogValidator(null);
    productionState.queueStore = null;
    AgentMessagesRepository.clearStore();
    AISessionsRepository.clearStore();
    await db.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it.each(eventTypes)('delivers %s to the CLI without persisting a user message', async (eventType) => {
    const eventName = eventType.slice('session:'.length);
    const sessionId = `cli-parent-${eventName}`;
    const notification = `[Child Session Update]\nEvent: ${eventType}\nCLI_${eventName.toUpperCase()}_RAW`;
    await AISessionsRepository.create({
      id: sessionId,
      provider: 'claude-code-cli',
      model: 'claude-code-cli:sonnet',
      workspaceId: '/workspace',
      title: `CLI parent ${eventName}`,
    });
    const queued = await queueStore.create({
      id: `cli-event-${eventName}`,
      sessionId,
      prompt: notification,
      origin: 'child_session_event',
    });

    expect(queued.origin).toBe('child_session_event');
    await expect(
      flushNextClaudeCliQueuedPromptForSession(sessionId, '/workspace'),
    ).resolves.toBe(true);

    expect(productionState.terminalWrites).toEqual([
      [sessionId, pasted(notification.replace(/\r?\n/g, '\\n'))],
      [sessionId, '\r'],
    ]);
    await expect(queueStore.get(queued.id)).resolves.toMatchObject({
      origin: 'child_session_event',
      status: 'completed',
    });

    const { rows } = await db.query(
      `SELECT direction, content
       FROM ai_agent_messages WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    expect(rows).toEqual([]);
  });

  it('persists an ordinary queued CLI prompt as a user message with the default origin', async () => {
    const sessionId = 'cli-parent-user';
    const prompt = 'ordinary queued CLI prompt';
    await AISessionsRepository.create({
      id: sessionId,
      provider: 'claude-code-cli',
      model: 'claude-code-cli:sonnet',
      workspaceId: '/workspace',
      title: 'CLI parent user',
    });
    const queued = await queueStore.create({
      id: 'cli-user-prompt',
      sessionId,
      prompt,
    });

    expect(queued.origin).toBe('user');
    await expect(
      flushNextClaudeCliQueuedPromptForSession(sessionId, '/workspace'),
    ).resolves.toBe(true);

    expect(productionState.terminalWrites).toEqual([
      [sessionId, pasted(prompt)],
      [sessionId, '\r'],
    ]);
    await expect(queueStore.get(queued.id)).resolves.toMatchObject({
      origin: 'user',
      status: 'completed',
    });

    const { rows } = await db.query<any>(
      `SELECT source, direction, content, hidden
       FROM ai_agent_messages WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'claude-code',
      direction: 'input',
      content: JSON.stringify({ prompt }),
      hidden: 0,
    });
  });

  it('marks an idle-flush prompt failed without writing the PTY when the catalog turns red', async () => {
    const sessionId = 'cli-parent-catalog-failed';
    await AISessionsRepository.create({
      id: sessionId,
      provider: 'claude-code-cli',
      model: 'claude-code-cli:sonnet',
      workspaceId: '/workspace',
      title: 'CLI parent catalog failed',
    });
    const queued = await queueStore.create({
      id: 'cli-catalog-failed',
      sessionId,
      prompt: 'must remain unsent',
    });
    setDynamicModelCatalogValidator(async () => {
      throw new Error('supportedModels(): network unavailable');
    });

    await expect(
      flushNextClaudeCliQueuedPromptForSession(sessionId, '/workspace', 'idle-transition'),
    ).resolves.toBe(false);

    expect(productionState.terminalWrites).toEqual([]);
    await expect(queueStore.get(queued.id)).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'supportedModels(): network unavailable',
    });
  });
});

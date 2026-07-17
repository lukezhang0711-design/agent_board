import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testState = vi.hoisted(() => ({
  db: null as any,
  stateListener: null as ((event: any) => void) | null,
  stateManager: null as any,
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ClaudeCodeProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexACPProvider: { setMetaAgentServerPort: vi.fn() },
  SessionManager: class { async initialize() {} },
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nimbalyst/runtime/ai/server/SessionStateManager')>();
  return {
    ...actual,
    getSessionStateManager: () => testState.stateManager ?? ({
      subscribe: (listener: (event: any) => void) => {
        testState.stateListener = listener;
        return () => { testState.stateListener = null; };
      },
    }),
  };
});
vi.mock('../ai/providerResolution', () => ({
  resolveExtensionAgentRef: () => null,
  isExtensionAgentProvider: () => false,
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn() }));
vi.mock('../../utils/store', () => ({
  getDefaultAIModel: () => null,
  getWorkspaceState: () => ({ issueKeyPrefix: 'NIM' }),
}));
vi.mock('../../utils/timestampUtils', () => ({ toMillis: (value: unknown) => value }));
vi.mock('../WorktreeStore', () => ({ createWorktreeStore: vi.fn() }));
vi.mock('../GitWorktreeService', () => ({ GitWorktreeService: class {} }));
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: {
    query: (sql: string, params?: unknown[]) => testState.db.query(sql, params),
  },
}));
vi.mock('../../database/initialize', () => ({ getDatabase: () => testState.db }));
vi.mock('../../file/GitRefWatcher', () => ({ gitRefWatcher: {} }));
vi.mock('../ai/AIService', () => ({ AIService: class {} }));
vi.mock('../../mcp/metaAgentServer', () => ({
  startMetaAgentServer: vi.fn().mockResolvedValue({ port: 49152 }),
  setMetaAgentToolFns: vi.fn(),
  shutdownMetaAgentServer: vi.fn(),
}));
vi.mock('../metaAgentNotificationSignature', () => ({
  computeNotificationSignature: (eventType: string) => eventType,
}));
vi.mock('../metaAgentMessageText', () => ({
  extractMessageText: () => null,
  extractUserPrompts: () => [],
}));
vi.mock('../ai/claudeCliLauncherSingleton', () => ({
  ClaudeCliLauncherConfig: { setMetaAgentServerPort: vi.fn() },
}));

// The work-order path reuses createBidirectionalLink from trackerToolHandlers.
// Keep that real helper while replacing unrelated tracker subsystems at their
// external seams so this test can exercise a real SQLite store in isolation.
vi.mock('../TrackerIdentityService', () => ({ getCurrentIdentity: () => ({ displayName: 'Test User' }) }));
vi.mock('../TrackerPolicyService', () => ({
  getEffectiveTrackerSyncPolicy: () => ({ mode: 'local', scope: 'project' }),
  getInitialTrackerSyncStatus: () => 'local',
  shouldSyncTrackerPolicy: () => false,
}));
vi.mock('../TrackerSyncManager', () => ({
  isTrackerSyncActive: () => false,
  syncTrackerItem: vi.fn(),
}));
vi.mock('../MainBodyDocService', () => ({ applyHeadlessBodyMarkdown: vi.fn() }));
vi.mock('../TrackerSchemaService', () => ({
  deleteWorkspaceTrackerSchema: vi.fn(),
  ensureWorkspaceTrackerSchemasLoaded: vi.fn(),
  getAllTrackerSchemas: () => [],
  getTrackerRoleField: () => null,
  isBuiltinTrackerSchema: () => false,
  TrackerTypeExistsError: class extends Error {},
  upsertWorkspaceTrackerSchema: vi.fn(),
}));

import { AgentMessagesRepository, AISessionsRepository } from '@nimbalyst/runtime';
import { SessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { createPGLiteAgentMessagesStore } from '../PGLiteAgentMessagesStore';
import { createPGLiteSessionStore } from '../PGLiteSessionStore';
import { MetaAgentService } from '../MetaAgentService';

describe('MetaAgentService work-order persistence', () => {
  const workspacePath = '/workspace/work-order-test';
  const service = MetaAgentService.getInstance();
  let dbDir: string;
  let db: SQLiteDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-work-order-'));
    db = new SQLiteDatabase({
      dbDir,
      schemaDir: path.resolve(__dirname, '../../database/sqlite/schemas'),
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await db.initialize();
    testState.db = db;
    AISessionsRepository.setStore(createPGLiteSessionStore(db));
    AgentMessagesRepository.setStore(createPGLiteAgentMessagesStore(db));
    (service as any).notificationSignatures.clear();
    (service as any).interruptedChildSessionIds.clear();
    await AISessionsRepository.create({
      id: 'head-session',
      provider: 'claude-code',
      model: 'claude-code:opus',
      workspaceId: workspacePath,
      title: 'Head session',
      agentRole: 'meta-agent',
    } as any);
    (service as any).aiService = {
      queuePromptForSession: vi.fn(),
      triggerQueuedPromptProcessingForSession: vi.fn(),
    };
  });

  afterEach(async () => {
    if ((service as any).started) {
      await service.shutdown();
    }
    AgentMessagesRepository.clearStore();
    AISessionsRepository.clearStore();
    testState.db = null;
    testState.stateListener = null;
    testState.stateManager = null;
    await db.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it('persists one card and both session links when a child is dispatched', async () => {
    const prompt = `${'Implement dispatch tracking with real persistence '.repeat(3)}\nDo not skip links.`;

    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt },
    );

    const { rows } = await db.query<any>(
      `SELECT id, data, source_ref, sync_status
       FROM tracker_items
       WHERE workspace = $1 AND type = 'work-order'`,
      [workspacePath],
    );
    expect(rows).toHaveLength(1);
    const card = rows[0];
    const data = typeof card.data === 'string' ? JSON.parse(card.data) : card.data;
    expect(card.source_ref).toBe(`meta-agent-work-order:${child.sessionId}`);
    expect(card.sync_status).toBe('local');
    expect(data).toMatchObject({
      status: 'dispatched',
      childSessionId: child.sessionId,
      taskSummary: expect.any(String),
      dispatchedAt: expect.any(String),
      linkedSessions: [child.sessionId],
    });
    expect(data.title.length).toBeLessThanOrEqual(80);
    expect(data.taskSummary.length).toBeLessThanOrEqual(80);
    expect(data.title).toBe(data.taskSummary);
    expect(data.title.endsWith('...')).toBe(true);
    expect(Number.isNaN(Date.parse(data.dispatchedAt))).toBe(false);

    const { rows: sessionRows } = await db.query<any>(
      'SELECT metadata FROM ai_sessions WHERE id = $1',
      [child.sessionId],
    );
    const metadata = typeof sessionRows[0].metadata === 'string'
      ? JSON.parse(sessionRows[0].metadata)
      : sessionRows[0].metadata;
    expect(metadata.linkedTrackerItemIds).toEqual([card.id]);
  });

  it('keeps the dispatched child when work-order persistence fails', async () => {
    const persistedDb = db;
    testState.db = {
      query: (sql: string, params?: unknown[]) => {
        if (/INSERT INTO tracker_items/.test(sql)) {
          throw new Error('tracker storage unavailable');
        }
        return persistedDb.query(sql, params);
      },
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Dispatch even if the work-order store is unavailable' },
    );

    await expect(AISessionsRepository.get(child.sessionId)).resolves.toMatchObject({
      id: child.sessionId,
      createdBySessionId: 'head-session',
    });
    await expect(db.query(
      `SELECT id FROM tracker_items WHERE type = 'work-order'`,
    )).resolves.toEqual({ rows: [] });
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to create work-order for child ${child.sessionId}`),
      expect.objectContaining({ message: 'tracker storage unavailable' }),
    );
  });

  it.each([
    ['session:completed', 'completed'],
    ['session:error', 'failed'],
    ['session:waiting', 'waiting'],
    ['session:interrupted', 'interrupted'],
  ] as const)('maps %s to the persisted %s card state', async (eventType, expectedStatus) => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: `Exercise ${eventType}` },
    );

    await (service as any).handleChildSessionEvent(child.sessionId, eventType);

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    expect(data.status).toBe(expectedStatus);
    if (eventType === 'session:interrupted') {
      expect(data.interruptionReason).toBe('Session interrupted');
    }
  });

  it('records the Head Agent interrupt reason on the persisted card', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Stop this delegated task' },
    );
    await db.query(
      `UPDATE ai_sessions SET status = 'running' WHERE id = $1`,
      [child.sessionId],
    );
    (service as any).aiService.stopSession = vi.fn().mockResolvedValue({
      success: true,
      queue: 'paused',
    });

    await service.interruptSession('head-session', workspacePath, {
      sessionId: child.sessionId,
    });

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    expect(data).toMatchObject({
      status: 'interrupted',
      interruptionReason: 'Interrupted by Head Agent',
    });
  });

  it('silently ignores a child event when its card is missing', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Card may be repaired later' },
    );
    await db.query(
      `DELETE FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      (service as any).handleChildSessionEvent(child.sessionId, 'session:completed'),
    ).resolves.toBeUndefined();

    expect(errorLog).not.toHaveBeenCalled();
  });

  it('keeps both the card and Head notification interrupted after a late completed event', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Interrupt without a false completion' },
    );
    const queuePromptForSession = (service as any).aiService.queuePromptForSession as ReturnType<typeof vi.fn>;

    await (service as any).handleChildSessionEvent(child.sessionId, 'session:interrupted');
    await (service as any).handleChildSessionEvent(child.sessionId, 'session:completed');

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    expect(data.status).toBe('interrupted');
    expect(queuePromptForSession).toHaveBeenCalledTimes(1);
    expect(queuePromptForSession).toHaveBeenCalledWith(
      'head-session',
      expect.stringContaining('Event: session:interrupted'),
      undefined,
      undefined,
      'child_session_event',
    );
  });

  it('preserves the existing plan-exit card path', async () => {
    await (service as any).ensurePlanTrackerItem(workspacePath, 'plan-child', {
      sessionId: 'plan-child',
      title: 'Existing plan flow',
      provider: 'claude-code',
      model: 'claude-code:opus',
      status: 'waiting_for_input',
      lastActivity: 1,
      originalPrompt: 'Draft a plan',
      userPrompts: ['Draft a plan'],
      lastResponse: null,
      fullResponse: null,
      recentMessages: [],
      editedFiles: [],
      pendingPrompt: {
        id: 'message-1',
        promptId: 'plan-prompt-1',
        promptType: 'exit_plan_mode_request',
        createdAt: 1,
        content: { planFilePath: '/workspace/plan.md', allowedPrompts: [] },
      },
      createdAt: 1,
      updatedAt: 2,
      worktreeId: null,
      toolScope: null,
    });

    const { rows } = await db.query<any>(
      `SELECT type, data, source_ref FROM tracker_items WHERE source_ref = $1`,
      ['meta-agent-plan:plan-child:plan-prompt-1'],
    );
    expect(rows).toHaveLength(1);
    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    expect(rows[0]).toMatchObject({
      type: 'plan',
      source_ref: 'meta-agent-plan:plan-child:plan-prompt-1',
    });
    expect(data).toMatchObject({ title: 'Plan review: Existing plan flow', status: 'in-review' });
  });

  it('does not create a work-order for an ordinary standalone session event', async () => {
    await AISessionsRepository.create({
      id: 'standalone-session',
      provider: 'claude-code',
      model: 'claude-code:opus',
      workspaceId: workspacePath,
      title: 'Standalone session',
      agentRole: 'standard',
    } as any);

    await (service as any).handleChildSessionEvent('standalone-session', 'session:completed');

    const { rows } = await db.query<any>(
      `SELECT id FROM tracker_items WHERE type = 'work-order'`,
    );
    expect(rows).toEqual([]);
    expect((service as any).aiService.queuePromptForSession).not.toHaveBeenCalled();
  });

  it('moves a dispatched card to running when the child starts', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Start delegated work' },
    );
    await service.start((service as any).aiService);

    testState.stateListener?.({
      type: 'session:started',
      sessionId: child.sessionId,
      workspacePath,
      timestamp: new Date(),
    });

    await vi.waitFor(async () => {
      const { rows } = await db.query<any>(
        `SELECT data FROM tracker_items WHERE source_ref = $1`,
        [`meta-agent-work-order:${child.sessionId}`],
      );
      const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      expect(data.status).toBe('running');
    });
  });

  it('filters the real interrupt-then-end event sequence before it reaches Head', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Exercise the real state event sequence' },
    );
    const stateManager = new SessionStateManager();
    stateManager.setDatabase(db);
    testState.stateManager = stateManager;
    const queuePromptForSession = (service as any).aiService.queuePromptForSession as ReturnType<typeof vi.fn>;
    await service.start((service as any).aiService);

    await stateManager.startSession({ sessionId: child.sessionId, workspacePath });
    await stateManager.interruptSession(child.sessionId);
    // This is the FB-014 failure mechanism: interruptSession removes the active
    // state, so the stream's later endSession used to emit session:completed.
    await stateManager.endSession(child.sessionId);

    await vi.waitFor(async () => {
      expect(queuePromptForSession).toHaveBeenCalledTimes(1);
      expect(queuePromptForSession).toHaveBeenCalledWith(
        'head-session',
        expect.stringContaining('Event: session:interrupted'),
        undefined,
        undefined,
        'child_session_event',
      );
      const { rows } = await db.query<any>(
        `SELECT data FROM tracker_items WHERE source_ref = $1`,
        [`meta-agent-work-order:${child.sessionId}`],
      );
      const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      expect(data.status).toBe('interrupted');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testState = vi.hoisted(() => ({
  db: null as any,
  stateListener: null as ((event: any) => void) | null,
  stateManager: null as any,
  maxParallel: 4,
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
  store: { get: (key: string) => key === 'metaAgentMaxParallel' ? testState.maxParallel : undefined },
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
import { resolveEffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';
import { SessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { createPGLiteAgentMessagesStore } from '../PGLiteAgentMessagesStore';
import { createPGLiteSessionStore } from '../PGLiteSessionStore';
import { MetaAgentService } from '../MetaAgentService';

describe('MetaAgentService work-order persistence', () => {
  const workspacePath = '/workspace/work-order-test';
  const implementationPlanError =
    'implementation sessions require an approved plan. Submit a plan for user approval first, or set intent to "investigation" for read-only work.';
  const service = MetaAgentService.getInstance();
  let dbDir: string;
  let db: SQLiteDatabase;

  const parseStoredJson = <T = Record<string, unknown>>(value: unknown): T =>
    (typeof value === 'string' ? JSON.parse(value) : value) as T;

  async function waitForPlanApprovalPrompt(excludedRequestIds: string[] = []): Promise<{
    requestId: string;
    input: Record<string, unknown>;
  }> {
    let prompt: { requestId: string; input: Record<string, unknown> } | undefined;
    await vi.waitFor(async () => {
      const { rows } = await db.query<{ content: unknown }>(
        `SELECT content
         FROM ai_agent_messages
         WHERE session_id = $1
         ORDER BY created_at DESC, id DESC`,
        ['head-session'],
      );
      for (const row of rows) {
        const content = parseStoredJson<any>(row.content);
        if (
          content.type === 'nimbalyst_tool_use'
          && content.name === 'ExitPlanMode'
          && typeof content.id === 'string'
          && !excludedRequestIds.includes(content.id)
        ) {
          prompt = { requestId: content.id, input: content.input };
          break;
        }
      }
      expect(prompt).toBeDefined();
    }, { timeout: 3000, interval: 10 });
    return prompt!;
  }

  async function persistPlanApprovalResponse(
    requestId: string,
    approved: boolean,
    feedback?: string,
  ): Promise<void> {
    await AgentMessagesRepository.create({
      sessionId: 'head-session',
      source: 'nimbalyst',
      direction: 'output',
      content: JSON.stringify({
        type: 'exit_plan_mode_response',
        requestId,
        approved,
        feedback,
        respondedAt: Date.now(),
        respondedBy: 'desktop',
      }),
      createdAt: new Date(),
      hidden: false,
    });
  }

  async function createRunningChildren(count: number): Promise<string[]> {
    const sessionIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const child = await (service as any).createChildSessionInternal(
        'head-session',
        workspacePath,
        { title: `Active child ${index + 1}`, prompt: `Hold slot ${index + 1}` },
      );
      sessionIds.push(child.sessionId);
      await db.query(
        `UPDATE ai_sessions SET status = 'running' WHERE id = $1`,
        [child.sessionId],
      );
    }
    return sessionIds;
  }

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
    testState.maxParallel = 4;
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

  it('persists an explicit effort level on the real child session and the existing resolver consumes it', async () => {
    const child = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Deep investigation',
        prompt: 'Inspect the difficult routing path',
        intent: 'investigation',
        effortLevel: 'xhigh',
      },
    ));

    const persisted = await AISessionsRepository.get(child.sessionId);
    expect(persisted?.metadata).toMatchObject({ effortLevel: 'xhigh' });
    expect(resolveEffortLevel(persisted?.metadata?.effortLevel, 'low')).toBe('xhigh');
  });

  it('persists the over-limit dispatch and work-order, then returns its queue position instead of rejecting', async () => {
    testState.maxParallel = 1;
    await createRunningChildren(1);

    const receipt = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Queued investigation',
        prompt: 'Run after the active child releases its slot',
        provider: 'claude-code',
        model: 'claude-code:opus',
        effortLevel: 'max',
        intent: 'investigation',
        toolScope: 'read',
      },
    ));

    expect(receipt).toMatchObject({
      status: 'queued',
      queued: true,
      queuePosition: 1,
      queueId: expect.any(String),
      sessionId: expect.any(String),
    });
    expect(receipt.message).toContain('position 1');
    await expect(AISessionsRepository.get(receipt.sessionId)).resolves.toBeNull();

    const { rows: queueRows } = await db.query<any>(
      `SELECT id, head_session_id, workspace_id, reserved_session_id,
              request_snapshot, status, error_message, source_ref
       FROM dispatch_queue WHERE id = $1`,
      [receipt.queueId],
    );
    expect(queueRows).toHaveLength(1);
    const snapshot = parseStoredJson<any>(queueRows[0].request_snapshot);
    expect(queueRows[0]).toMatchObject({
      head_session_id: 'head-session',
      workspace_id: workspacePath,
      reserved_session_id: receipt.sessionId,
      status: 'queued',
      error_message: null,
      source_ref: `meta-agent-work-order:${receipt.sessionId}`,
    });
    expect(snapshot).toMatchObject({
      requestKind: 'create_session',
      metaSessionId: 'head-session',
      workspaceId: workspacePath,
      args: {
        title: 'Queued investigation',
        prompt: 'Run after the active child releases its slot',
        provider: 'claude-code',
        model: 'claude-code:opus',
        effortLevel: 'max',
        intent: 'investigation',
        toolScope: 'read',
      },
    });

    const { rows: cardRows } = await db.query<any>(
      `SELECT data, source_ref FROM tracker_items WHERE source_ref = $1`,
      [queueRows[0].source_ref],
    );
    expect(cardRows).toHaveLength(1);
    expect(parseStoredJson<any>(cardRows[0].data)).toMatchObject({
      status: 'queued',
      childSessionId: receipt.sessionId,
      taskSummary: 'Run after the active child releases its slot',
    });
  });

  it('dispatches queued work FIFO into real sessions and links each existing card through running', async () => {
    testState.maxParallel = 2;
    const running = await createRunningChildren(2);
    const first = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'FIFO first',
        prompt: 'Dispatch me first',
        intent: 'investigation',
        effortLevel: 'high',
      },
    ));
    const second = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'FIFO second',
        prompt: 'Dispatch me second',
        intent: 'investigation',
        effortLevel: 'low',
      },
    ));
    await service.start((service as any).aiService);

    await db.query(`UPDATE ai_sessions SET status = 'waiting_for_input' WHERE id = $1`, [running[0]]);
    await (service as any).handleChildSessionEvent(running[0], 'session:waiting');

    const firstSession = await AISessionsRepository.get(first.sessionId);
    expect(firstSession).toMatchObject({
      id: first.sessionId,
      title: 'FIFO first',
      createdBySessionId: 'head-session',
      metadata: expect.objectContaining({ effortLevel: 'high' }),
    });
    await expect(AISessionsRepository.get(second.sessionId)).resolves.toBeNull();
    const { rows: afterFirst } = await db.query<any>(
      `SELECT id, status, dispatched_session_id
       FROM dispatch_queue
       WHERE id IN ($1, $2)
       ORDER BY queue_sequence`,
      [first.queueId, second.queueId],
    );
    expect(afterFirst).toEqual([
      expect.objectContaining({ id: first.queueId, status: 'dispatched', dispatched_session_id: first.sessionId }),
      expect.objectContaining({ id: second.queueId, status: 'queued', dispatched_session_id: null }),
    ]);

    const { rows: dispatchedCardRows } = await db.query<any>(
      `SELECT id, data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${first.sessionId}`],
    );
    expect(parseStoredJson<any>(dispatchedCardRows[0].data)).toMatchObject({
      status: 'dispatched',
      childSessionId: first.sessionId,
      linkedSessions: [first.sessionId],
    });
    const persistedFirst = await AISessionsRepository.get(first.sessionId);
    expect(persistedFirst?.metadata?.linkedTrackerItemIds).toEqual([dispatchedCardRows[0].id]);

    testState.stateListener?.({
      type: 'session:started',
      sessionId: first.sessionId,
      workspacePath,
      timestamp: new Date(),
    });
    await vi.waitFor(async () => {
      const { rows } = await db.query<any>(
        `SELECT data FROM tracker_items WHERE source_ref = $1`,
        [`meta-agent-work-order:${first.sessionId}`],
      );
      expect(parseStoredJson<any>(rows[0].data).status).toBe('running');
    });

    await db.query(`UPDATE ai_sessions SET status = 'waiting_for_input' WHERE id = $1`, [running[1]]);
    await (service as any).handleChildSessionEvent(running[1], 'session:waiting');
    await expect(AISessionsRepository.get(second.sessionId)).resolves.toMatchObject({
      id: second.sessionId,
      title: 'FIFO second',
      metadata: expect.objectContaining({ effortLevel: 'low' }),
    });
    const { rows: finalQueueRows } = await db.query<any>(
      `SELECT id, status FROM dispatch_queue WHERE id IN ($1, $2) ORDER BY queue_sequence`,
      [first.queueId, second.queueId],
    );
    expect(finalQueueRows).toEqual([
      { id: first.queueId, status: 'dispatched' },
      { id: second.queueId, status: 'dispatched' },
    ]);
  });

  it('refills the queue when a child reaches a terminal completed state', async () => {
    testState.maxParallel = 1;
    const [running] = await createRunningChildren(1);
    const queued = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'After terminal child',
        prompt: 'Start after completion',
        intent: 'investigation',
      },
    ));

    await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [running]);
    await (service as any).handleChildSessionEvent(running, 'session:completed');

    await expect(AISessionsRepository.get(queued.sessionId)).resolves.toMatchObject({
      id: queued.sessionId,
      title: 'After terminal child',
    });
    await expect((service as any).dispatchQueueStore.get(queued.queueId)).resolves.toMatchObject({
      status: 'dispatched',
      dispatchedSessionId: queued.sessionId,
    });
  });

  it('marks a failed dequeue, notifies Head, and continues to the next FIFO item', async () => {
    testState.maxParallel = 1;
    const [running] = await createRunningChildren(1);
    const broken = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Broken queued worktree',
        prompt: 'Fail reconstruction without blocking the queue',
        intent: 'investigation',
        worktreeId: 'missing-worktree',
      },
    ));
    const healthy = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Healthy queued task',
        prompt: 'Continue after the failed item',
        intent: 'investigation',
      },
    ));

    await db.query(`UPDATE ai_sessions SET status = 'waiting_for_input' WHERE id = $1`, [running]);
    await (service as any).handleChildSessionEvent(running, 'session:waiting');

    const { rows } = await db.query<any>(
      `SELECT id, status, error_message
       FROM dispatch_queue
       WHERE id IN ($1, $2)
       ORDER BY queue_sequence`,
      [broken.queueId, healthy.queueId],
    );
    expect(rows[0]).toMatchObject({
      id: broken.queueId,
      status: 'failed',
      error_message: expect.stringContaining('Worktree'),
    });
    expect(rows[1]).toMatchObject({ id: healthy.queueId, status: 'dispatched', error_message: null });
    await expect(AISessionsRepository.get(broken.sessionId)).resolves.toBeNull();
    await expect(AISessionsRepository.get(healthy.sessionId)).resolves.toMatchObject({
      id: healthy.sessionId,
      title: 'Healthy queued task',
    });
    const { rows: failedCardRows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${broken.sessionId}`],
    );
    expect(parseStoredJson<any>(failedCardRows[0].data).status).toBe('failed');
    expect((service as any).aiService.queuePromptForSession).toHaveBeenCalledWith(
      'head-session',
      expect.stringContaining(`Dispatch queue item ${broken.queueId} failed`),
      undefined,
      undefined,
      'child_session_event',
    );
  });

  it('recovers dispatching rows to queued on boot and resumes them when the service starts', async () => {
    testState.maxParallel = 1;
    const [running] = await createRunningChildren(1);
    const queued = JSON.parse(await (service as any).spawnSession(
      'head-session',
      workspacePath,
      {
        title: 'Restart-safe spawn',
        prompt: 'Resume this dispatch after restart',
        intent: 'investigation',
        isolated: true,
        effortLevel: 'max',
      },
    ));
    await db.query(
      `UPDATE dispatch_queue SET status = 'dispatching' WHERE id = $1`,
      [queued.queueId],
    );

    await expect(service.recoverDispatchQueueOnBoot()).resolves.toBe(1);
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../index.ts'), 'utf8');
    expect(mainSource).toContain('MetaAgentService.getInstance().recoverDispatchQueueOnBoot()');
    const { rows: recoveredRows } = await db.query<any>(
      `SELECT status FROM dispatch_queue WHERE id = $1`,
      [queued.queueId],
    );
    expect(recoveredRows).toEqual([{ status: 'queued' }]);

    await db.query(`UPDATE ai_sessions SET status = 'waiting_for_input' WHERE id = $1`, [running]);
    await service.start((service as any).aiService);
    await vi.waitFor(async () => {
      await expect(AISessionsRepository.get(queued.sessionId)).resolves.toMatchObject({
        id: queued.sessionId,
        title: 'Restart-safe spawn',
        metadata: expect.objectContaining({ effortLevel: 'max', notifyParent: false }),
      });
      const { rows } = await db.query<any>(
        `SELECT status FROM dispatch_queue WHERE id = $1`,
        [queued.queueId],
      );
      expect(rows).toEqual([{ status: 'dispatched' }]);
    });
  });

  it('persists the approval prompt and allows implementation only after approval', async () => {
    const submitPromise = (service as any).submitPlan('head-session', workspacePath, {
      title: 'Persist the approval gate',
      planItems: ['Create the durable prompt', 'Gate implementation dispatch'],
      workOrderCount: 2,
      risks: 'A stale response could approve the wrong submission',
    });

    const prompt = await waitForPlanApprovalPrompt();
    expect(prompt.input).toMatchObject({
      planId: expect.any(String),
      title: 'Persist the approval gate',
      planItems: ['Create the durable prompt', 'Gate implementation dispatch'],
      workOrderCount: 2,
      risks: 'A stale response could approve the wrong submission',
    });

    const { rows: pendingRows } = await db.query<any>(
      `SELECT id, data FROM tracker_items WHERE id = $1 AND type = 'plan'`,
      [prompt.input.planId],
    );
    expect(pendingRows).toHaveLength(1);
    expect(parseStoredJson<any>(pendingRows[0].data).status).toBe('in-review');

    await persistPlanApprovalResponse(prompt.requestId, true);
    const approval = JSON.parse(await submitPromise);
    expect(approval).toMatchObject({
      approved: true,
      planId: prompt.input.planId,
      status: 'ready-for-development',
    });

    const { rows: approvedRows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE id = $1 AND type = 'plan'`,
      [approval.planId],
    );
    expect(parseStoredJson<any>(approvedRows[0].data)).toMatchObject({
      title: 'Persist the approval gate',
      status: 'ready-for-development',
      planItems: ['Create the durable prompt', 'Gate implementation dispatch'],
      workOrderCount: 2,
      risks: 'A stale response could approve the wrong submission',
    });

    const { rows: resultRows } = await db.query<{ content: unknown }>(
      `SELECT content
       FROM ai_agent_messages
       WHERE session_id = $1
         AND content LIKE '%"type":"nimbalyst_tool_result"%'`,
      ['head-session'],
    );
    const toolResult = resultRows
      .map((row) => parseStoredJson<any>(row.content))
      .find((content) => content.tool_use_id === prompt.requestId);
    expect(toolResult).toBeDefined();
    expect(JSON.parse(toolResult.result)).toMatchObject({
      approved: true,
      planId: approval.planId,
      status: 'approved',
    });

    const implementation = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Gate implementation',
        prompt: 'Implement the approved dispatch gate',
        intent: 'implementation',
        planId: approval.planId,
      },
    ));
    const spawnedImplementation = JSON.parse(await (service as any).spawnSession(
      'head-session',
      workspacePath,
      {
        title: 'Persist implementation',
        prompt: 'Implement the approved durable approval flow',
        intent: 'implementation',
        planId: approval.planId,
        isolated: true,
      },
    ));
    const { rows: groupedWorkOrders } = await db.query<any>(
      `SELECT data
       FROM tracker_items
       WHERE type = 'work-order'
         AND json_extract(data, '$.planId') = $1`,
      [approval.planId],
    );
    expect(groupedWorkOrders).toHaveLength(2);
    const groupedData = groupedWorkOrders.map((row) => parseStoredJson<any>(row.data));
    expect(groupedData).toEqual(expect.arrayContaining([
      expect.objectContaining({
        childSessionId: implementation.sessionId,
        intent: 'implementation',
        planId: approval.planId,
      }),
      expect.objectContaining({
        childSessionId: spawnedImplementation.sessionId,
        intent: 'implementation',
        planId: approval.planId,
      }),
    ]));
  });

  it('returns change feedback, keeps review status, and updates the same plan card', async () => {
    const firstSubmission = (service as any).submitPlan('head-session', workspacePath, {
      title: 'Initial dispatch plan',
      planItems: ['One broad work order'],
      workOrderCount: 1,
      risks: 'The work order is too broad',
    });
    const firstPrompt = await waitForPlanApprovalPrompt();
    await persistPlanApprovalResponse(
      firstPrompt.requestId,
      false,
      'Split persistence from dispatch authorization.',
    );
    const firstResult = JSON.parse(await firstSubmission);
    expect(firstResult).toMatchObject({
      approved: false,
      planId: firstPrompt.input.planId,
      status: 'in-review',
      feedback: 'Split persistence from dispatch authorization.',
    });

    const { rows: rejectedRows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE id = $1 AND type = 'plan'`,
      [firstResult.planId],
    );
    expect(parseStoredJson<any>(rejectedRows[0].data).status).toBe('in-review');

    await expect((service as any).createChildSession('head-session', workspacePath, {
      prompt: 'Implement without a plan id',
      intent: 'implementation',
    })).rejects.toThrow(implementationPlanError);
    await expect((service as any).createChildSession('head-session', workspacePath, {
      prompt: 'Implement an unapproved plan',
      intent: 'implementation',
      planId: firstResult.planId,
    })).rejects.toThrow(implementationPlanError);
    await expect((service as any).spawnSession('head-session', workspacePath, {
      prompt: 'Spawn implementation for an unapproved plan',
      intent: 'implementation',
      planId: firstResult.planId,
      isolated: true,
    })).rejects.toThrow(implementationPlanError);
    const { rows: rejectedSessionRows } = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ai_sessions WHERE created_by_session_id = $1`,
      ['head-session'],
    );
    const { rows: rejectedWorkOrderRows } = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM tracker_items WHERE type = 'work-order'`,
    );
    expect(Number(rejectedSessionRows[0].count)).toBe(0);
    expect(Number(rejectedWorkOrderRows[0].count)).toBe(0);

    const secondSubmission = (service as any).submitPlan('head-session', workspacePath, {
      title: 'Revised dispatch plan',
      planItems: ['Persist approval', 'Authorize dispatch'],
      workOrderCount: 2,
      risks: 'Concurrent responses could cross submissions',
    });
    const secondPrompt = await waitForPlanApprovalPrompt([firstPrompt.requestId]);
    expect(secondPrompt.input.planId).toBe(firstResult.planId);
    await persistPlanApprovalResponse(secondPrompt.requestId, false, 'Add the timeout behavior.');
    const secondResult = JSON.parse(await secondSubmission);
    expect(secondResult).toMatchObject({
      approved: false,
      planId: firstResult.planId,
      status: 'in-review',
      feedback: 'Add the timeout behavior.',
    });

    const { rows: planRows } = await db.query<any>(
      `SELECT id, data
       FROM tracker_items
       WHERE workspace = $1 AND type = 'plan' AND source_ref = $2`,
      [workspacePath, 'meta-agent-submitted-plan:head-session'],
    );
    expect(planRows).toHaveLength(1);
    expect(planRows[0].id).toBe(firstResult.planId);
    expect(parseStoredJson<any>(planRows[0].data)).toMatchObject({
      title: 'Revised dispatch plan',
      status: 'in-review',
      planItems: ['Persist approval', 'Authorize dispatch'],
      workOrderCount: 2,
      risks: 'Concurrent responses could cross submissions',
    });
  });

  it('allows investigation dispatch without a plan and requires an explicit intent', async () => {
    await expect((service as any).createChildSession('head-session', workspacePath, {
      prompt: 'Missing intent',
    })).rejects.toThrow('intent is required and must be "investigation" or "implementation"');
    await expect((service as any).spawnSession('head-session', workspacePath, {
      prompt: 'Missing intent for spawn',
      isolated: true,
    })).rejects.toThrow('intent is required and must be "investigation" or "implementation"');
    await expect((service as any).createChildSession('head-session', workspacePath, {
      prompt: 'Implementation without an approved plan',
      intent: 'implementation',
      planId: 'not-approved',
    })).rejects.toThrow(implementationPlanError);
    await expect((service as any).spawnSession('head-session', workspacePath, {
      prompt: 'Spawn implementation without an approved plan',
      intent: 'implementation',
      planId: 'not-approved',
      isolated: true,
    })).rejects.toThrow(implementationPlanError);
    const { rows: missingIntentRows } = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ai_sessions WHERE created_by_session_id = $1`,
      ['head-session'],
    );
    const { rows: unauthorizedQueueRows } = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM dispatch_queue`,
    );
    expect(Number(missingIntentRows[0].count)).toBe(0);
    expect(Number(unauthorizedQueueRows[0].count)).toBe(0);

    const child = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Read-only investigation',
        prompt: 'Inspect the dispatch path without editing',
        intent: 'investigation',
        toolScope: 'read',
      },
    ));
    const spawned = JSON.parse(await (service as any).spawnSession(
      'head-session',
      workspacePath,
      {
        title: 'Independent investigation',
        prompt: 'Inspect plan status values without editing',
        intent: 'investigation',
        isolated: true,
      },
    ));

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE type = 'work-order' ORDER BY created`,
    );
    expect(rows).toHaveLength(2);
    const workOrders = rows.map((row) => parseStoredJson<any>(row.data));
    expect(workOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        childSessionId: child.sessionId,
        intent: 'investigation',
      }),
      expect.objectContaining({
        childSessionId: spawned.sessionId,
        intent: 'investigation',
      }),
    ]));
    expect(workOrders.every((workOrder) => workOrder.planId === undefined)).toBe(true);
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

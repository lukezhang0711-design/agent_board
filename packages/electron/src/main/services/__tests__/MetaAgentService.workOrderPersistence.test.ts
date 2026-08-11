import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testState = vi.hoisted(() => ({
  db: null as any,
  stateListener: null as ((event: any) => void) | null,
  stateManager: null as any,
  metaAgentToolFns: null as any,
  nativeHeadPlanApprovalHandler: null as any,
  maxParallel: 4,
  planAutoApprove: false,
  ipcHandlers: new Map<string, (...args: any[]) => any>(),
  /** Every `webContents.send` the service makes, so tests can assert IPC signals. */
  sentIpc: [] as { channel: string; args: unknown[] }[],
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ClaudeCodeProvider: {
    setMetaAgentServerPort: vi.fn(),
    setNativeHeadPlanApprovalHandler: vi.fn((handler: unknown) => {
      testState.nativeHeadPlanApprovalHandler = handler;
    }),
  },
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
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, ...args: unknown[]) => { testState.sentIpc.push({ channel, args }); },
      },
    }],
  },
  app: { on: vi.fn(), getAppPath: () => '/', isPackaged: false },
}));
vi.mock('../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    testState.ipcHandlers.set(channel, handler);
  }),
  safeOn: vi.fn(),
}));
vi.mock('../../utils/store', () => ({
  getDefaultAIModel: () => null,
  getWorkspaceState: () => ({ issueKeyPrefix: 'NIM' }),
  store: { get: (key: string) => key === 'metaAgentMaxParallel'
    ? testState.maxParallel
    : key === 'metaAgentPlanAutoApprove' ? testState.planAutoApprove : undefined },
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
vi.mock('../ai/AIService', () => ({
  AIService: class {},
  normalizePlanApprovalRequestId: (requestId: string) => requestId,
}));
vi.mock('../../mcp/metaAgentServer', () => ({
  startMetaAgentServer: vi.fn().mockResolvedValue({ port: 49152 }),
  setMetaAgentToolFns: vi.fn((toolFns: unknown) => {
    testState.metaAgentToolFns = toolFns;
  }),
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
import { getCodexToolLookupAliases } from '@nimbalyst/runtime/ai/server/toolLookupIds';
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
  let replacementServices: MetaAgentService[] = [];

  const parseStoredJson = <T = Record<string, unknown>>(value: unknown): T =>
    (typeof value === 'string' ? JSON.parse(value) : value) as T;

  async function expectWorkOrderStatus(sessionId: string, status: string): Promise<void> {
    await vi.waitFor(async () => {
      const { rows } = await db.query<any>(
        `SELECT data FROM tracker_items WHERE source_ref = $1`,
        [`meta-agent-work-order:${sessionId}`],
      );
      expect(parseStoredJson<Record<string, unknown>>(rows[0]?.data).status).toBe(status);
    });
  }

  function expectTrackerInvalidation(): void {
    const invalidations = testState.sentIpc.filter(
      (sent) => sent.channel === 'document-service:tracker-items-changed',
    );
    expect(invalidations).toEqual([
      expect.objectContaining({
        args: [expect.objectContaining({ added: [], updated: [], removed: [] })],
      }),
    ]);
  }

  async function readTestPlanApprovalState(sessionId: string, promptId: string): Promise<any | null> {
    const aliases = getCodexToolLookupAliases(promptId);
    const requestId = aliases[aliases.length - 1] ?? promptId;
    const matches = (candidate: unknown) => {
      if (typeof candidate !== 'string') return false;
      const candidateAliases = getCodexToolLookupAliases(candidate);
      return (candidateAliases[candidateAliases.length - 1] ?? candidate) === requestId;
    };
    const { rows } = await db.query<{ content: unknown }>(
      `SELECT content FROM ai_agent_messages WHERE session_id = $1 ORDER BY created_at, id`,
      [sessionId],
    );
    let submitted = false;
    let response: any = null;
    let delivery: any = null;
    let closed = false;
    let planId: string | undefined;
    for (const row of rows) {
      const content = parseStoredJson<any>(row.content);
      if (content.type === 'nimbalyst_tool_use' && content.name === 'ExitPlanMode' && matches(content.id)) {
        submitted = true;
        planId = typeof content.input?.planId === 'string' ? content.input.planId : undefined;
      } else if (content.type === 'exit_plan_mode_response' && matches(content.requestId)) {
        response = content;
      } else if (content.type === 'plan_approval_delivery' && matches(content.requestId)) {
        delivery = content;
      } else if (content.type === 'nimbalyst_tool_result' && matches(content.tool_use_id)) {
        closed = true;
      }
    }
    if (!submitted && !response && !delivery && !closed) return null;
    const decision = response?.approved
      ? 'approved'
      : response
        ? response.feedback === 'User dismissed the plan.' ? 'dismissed' : 'rejected'
        : undefined;
    return {
      requestId,
      status: closed ? 'closed' : delivery ? 'delivered' : response ? 'responded' : 'submitted',
      decision,
      feedback: response?.feedback,
      respondedAt: response?.respondedAt,
      respondedBy: response?.respondedBy,
      deliveryMethod: delivery?.method,
      planId,
    };
  }

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

  async function seedRespondedPlanApproval(args: {
    requestId: string;
    planId: string;
    approved: boolean;
    feedback?: string;
  }): Promise<void> {
    const planData = {
      title: 'Approval stranded across restart',
      status: 'in-review',
      planItems: ['Recover the approval after restart'],
      workOrderCount: 1,
      risks: 'The original submit_plan call is gone.',
      submittedBySessionId: 'head-session',
      approvalPromptId: args.requestId,
      submittedAt: new Date().toISOString(),
      tags: ['meta-agent', 'user-approval'],
    };
    await db.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, 'plan', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'pending', $5, FALSE, 'meta-agent', $6)`,
      [
        args.planId,
        ['plan'],
        JSON.stringify(planData),
        workspacePath,
        JSON.stringify({
          planItems: planData.planItems,
          workOrderCount: planData.workOrderCount,
          risks: planData.risks,
        }),
        `meta-agent-submitted-plan:head-session`,
      ],
    );
    await AgentMessagesRepository.create({
      sessionId: 'head-session',
      source: 'claude-code',
      direction: 'output',
      content: JSON.stringify({
        type: 'nimbalyst_tool_use',
        id: args.requestId,
        name: 'ExitPlanMode',
        input: {
          planId: args.planId,
          title: planData.title,
          planItems: planData.planItems,
          workOrderCount: planData.workOrderCount,
          risks: planData.risks,
        },
      }),
      createdAt: new Date(),
      hidden: false,
    });
    await persistPlanApprovalResponse(args.requestId, args.approved, args.feedback);
  }

  async function getSubmitPlanTool(): Promise<(
    metaSessionId: string,
    workspaceId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    mcpCall?: {
      requestId: string;
      resolveOriginalMcpCall: (result: string) => boolean;
    },
  ) => Promise<string>> {
    await service.start((service as any).aiService);
    expect(testState.metaAgentToolFns?.submitPlan).toBeTypeOf('function');
    return testState.metaAgentToolFns.submitPlan;
  }

  async function getNativeHeadPlanApprovalHandler(): Promise<(
    request: {
      sessionId: string;
      requestId: string;
      planSummary: string;
      planFilePath: string;
      signal: AbortSignal;
    },
  ) => Promise<{
    approved: boolean;
    planId: string;
    feedback?: string;
    deliveryMethod: 'direct' | 'revive';
  } | null>> {
    await service.start((service as any).aiService);
    expect(testState.nativeHeadPlanApprovalHandler).toBeTypeOf('function');
    return testState.nativeHeadPlanApprovalHandler;
  }

  function toCodexTranscriptRequestId(requestId: string): string {
    return `nimtc|${requestId}|1784297999209|21431`;
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
    testState.planAutoApprove = false;
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-work-order-'));
    db = new SQLiteDatabase({
      dbDir,
      schemaDir: path.resolve(__dirname, '../../database/sqlite/schemas'),
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await db.initialize();
    testState.db = db;
    testState.metaAgentToolFns = null;
    testState.nativeHeadPlanApprovalHandler = null;
    testState.maxParallel = 4;
    testState.sentIpc = [];
    replacementServices = [];
    AISessionsRepository.setStore(createPGLiteSessionStore(db));
    AgentMessagesRepository.setStore(createPGLiteAgentMessagesStore(db));
    (service as any).notificationSignatures.clear();
    (service as any).interruptedChildSessionIds.clear();
    (service as any).releasedDispatchPromptIdsByHead.clear();
    await AISessionsRepository.create({
      id: 'head-session',
      provider: 'claude-code',
      model: 'claude-code:opus',
      workspaceId: workspacePath,
      title: 'Head session',
      agentRole: 'meta-agent',
    } as any);
    const getPlanApprovalState = vi.fn(readTestPlanApprovalState);
    (service as any).aiService = {
      queuePromptForSession: vi.fn(async (_sessionId: string, prompt: string) => ({
        id: 'revived-plan-approval',
        prompt,
        createdAt: Date.now(),
      })),
      triggerQueuedPromptProcessingForSession: vi.fn().mockResolvedValue(true),
      getPlanApprovalState,
      markPlanApprovalDelivered: vi.fn(async (
        sessionId: string,
        requestId: string,
        method: 'direct' | 'revive',
      ) => {
        const current = await readTestPlanApprovalState(sessionId, requestId);
        if (current?.status === 'responded') {
          await AgentMessagesRepository.create({
            sessionId,
            source: 'nimbalyst',
            direction: 'output',
            content: JSON.stringify({
              type: 'plan_approval_delivery',
              requestId,
              method,
              deliveredAt: Date.now(),
            }),
            createdAt: new Date(),
            hidden: true,
          });
        }
        return readTestPlanApprovalState(sessionId, requestId);
      }),
    };
  });

  afterEach(async () => {
    for (const replacementService of replacementServices) {
      if ((replacementService as any).started) {
        await replacementService.shutdown();
      }
    }
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

  // FB-020: SessionNamingService.applySessionTitle renames with `force: true`,
  // which bypasses `hasBeenNamed`. It keys off this marker instead so an
  // operator-chosen dispatch title survives the auto-namer.
  it('marks a caller-supplied child title as dispatch-sourced so auto-naming skips it', async () => {
    const child = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'X-queue-1',
        prompt: 'Run the queued verification pass',
        intent: 'investigation',
      },
    ));

    const persisted = await AISessionsRepository.get(child.sessionId);
    expect(persisted?.title).toBe('X-queue-1');
    expect(persisted?.metadata).toMatchObject({ titleSource: 'dispatch' });
  });

  it('leaves a title-less dispatch auto-nameable', async () => {
    const child = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        prompt: 'Investigate the routing regression without a caller title',
        intent: 'investigation',
      },
    ));

    const persisted = await AISessionsRepository.get(child.sessionId);
    expect(persisted?.metadata?.titleSource).toBeUndefined();
  });

  it('persists a concrete parent model when child model input is default, empty, or omitted', async () => {
    const parentModel = 'openai-codex:gpt-5.6-luna';
    await db.query(
      'UPDATE ai_sessions SET provider = $1, model = $2 WHERE id = $3',
      ['openai-codex', parentModel, 'head-session'],
    );
    const cases = [
      { label: 'bare default', childModel: 'default', expectedModel: parentModel },
      { label: 'empty string', childModel: '', expectedModel: parentModel },
      { label: 'omitted model', childModel: undefined, expectedModel: parentModel },
      {
        label: 'explicit other model',
        childModel: 'openai-codex:gpt-5.6-terra',
        expectedModel: 'openai-codex:gpt-5.6-terra',
      },
    ];
    const children: Array<{ sessionId: string; expectedModel: string }> = [];

    for (const testCase of cases) {
      const child = await (service as any).createChildSessionInternal(
        'head-session',
        workspacePath,
        {
          title: `Model inheritance: ${testCase.label}`,
          prompt: 'Persist the resolved child model for this inheritance case',
          model: testCase.childModel,
        },
      );
      children.push({ sessionId: child.sessionId, expectedModel: testCase.expectedModel });

      const { rows } = await db.query<{ model: string }>(
        'SELECT model FROM ai_sessions WHERE id = $1',
        [child.sessionId],
      );
      expect(rows, testCase.label).toEqual([{ model: testCase.expectedModel }]);
    }

    const spawned = await (service as any).getSpawnedSessions('head-session', workspacePath);
    for (const child of children) {
      expect(
        spawned.find((session: { sessionId: string }) => session.sessionId === child.sessionId),
      ).toMatchObject({ model: child.expectedModel });
    }
  });

  it('records a direct routing failure before rethrowing the engine/model error', async () => {
    const rawRoutingError = 'Model identifier must be in "provider:model" format: gemini-2.5-pro';

    await expect((service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Gemini routing failure',
        prompt: 'Do not hide the unmapped child model error',
        provider: 'claude-code',
        model: 'gemini-2.5-pro',
        intent: 'investigation',
      },
    )).rejects.toThrow(rawRoutingError);

    const { rows } = await db.query<any>(
      `SELECT data, source_ref
       FROM tracker_items
       WHERE type = 'work-order'
       ORDER BY created DESC
       LIMIT 1`,
    );
    const data = parseStoredJson<any>(rows[0].data);
    expect(data).toMatchObject({
      status: 'failed',
      failureReason: rawRoutingError,
      failureClass: 'agent',
      receipt: {
        engine: 'claude-code',
        model: 'gemini-2.5-pro',
        startedAt: expect.any(String),
        endedAt: expect.any(String),
        outcome: 'failure',
      },
    });
    expect(data.attempts).toHaveLength(1);
    expect(data.attempts[0]).toMatchObject({
      attempt: 1,
      failureReason: rawRoutingError,
      failureClass: 'agent',
      outcome: 'failure',
    });
    expect(rows[0].source_ref).toMatch(/^meta-agent-work-order:/);
    expect((service as any).aiService.queuePromptForSession).toHaveBeenCalledWith(
      'head-session',
      expect.stringContaining(`Failure reason: ${rawRoutingError}`),
      undefined,
      undefined,
      'child_session_event',
    );
  });

  it('RED FB-085: denies an agent retry until a new Head user message arrives', async () => {
    const planId = 'plan-fb-085';
    const moduleTitle = 'Module 1';
    const firstAttemptError = await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: moduleTitle,
        prompt: 'Run Module 1 with the initial engine configuration',
        provider: 'claude-code',
        model: 'haiku',
        intent: 'investigation',
        planId,
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(firstAttemptError).toBeInstanceOf(Error);
    const rawFailureReason = firstAttemptError instanceof Error
      ? firstAttemptError.message
      : String(firstAttemptError);
    expect(rawFailureReason).toContain('provider:model');

    const deniedLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect((service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: moduleTitle,
        prompt: 'Run Module 1 with the corrected engine configuration',
        provider: 'claude-code',
        model: 'claude-code:haiku',
        intent: 'investigation',
        planId,
      },
    )).rejects.toThrow('此类失败需老板指示后才能重试');
    expect(deniedLog).toHaveBeenCalledWith(expect.stringContaining('[RetryGate] denied'));
    deniedLog.mockRestore();

    const { rows: failedRows } = await db.query<any>(
      `SELECT data, source_ref
       FROM tracker_items
       WHERE type = 'work-order'
       ORDER BY created`,
    );
    expect(failedRows).toHaveLength(1);
    const failedData = parseStoredJson<any>(failedRows[0].data);
    expect(failedData).toMatchObject({
      status: 'failed',
      failureClass: 'agent',
      attempts: [expect.objectContaining({ attempt: 1, failureClass: 'agent' })],
    });

    await AgentMessagesRepository.create({
      sessionId: 'head-session',
      source: 'claude-code',
      direction: 'input',
      content: JSON.stringify({ prompt: '老板允许重试 Module 1' }),
      createdAt: new Date(Date.parse(failedData.receipt.endedAt) + 1_000),
      hidden: false,
      searchable: true,
      messageKind: 'user',
    });

    const retry = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: moduleTitle,
        prompt: 'Run Module 1 with the corrected engine configuration',
        provider: 'claude-code',
        model: 'claude-code:haiku',
        intent: 'investigation',
        planId,
      },
    ));
    await (service as any).handleChildSessionEvent(retry.sessionId, 'session:completed');

    const { rows } = await db.query<any>(
      `SELECT data, source_ref
       FROM tracker_items
       WHERE type = 'work-order'
       ORDER BY created`,
    );
    expect(rows).toHaveLength(1);
    const data = parseStoredJson<any>(rows[0].data);
    expect(data.status).toBe('completed');
    expect(data.attempts).toHaveLength(2);
    expect(data.attempts[0]).toMatchObject({
      attempt: 1,
      engine: 'claude-code',
      model: 'haiku',
      outcome: 'failure',
      failureReason: rawFailureReason,
      failureClass: 'agent',
    });
    expect(data.attempts[1]).toMatchObject({
      attempt: 2,
      engine: 'claude-code',
      model: 'claude-code:haiku',
      outcome: 'success',
    });
    expect(rows[0].source_ref).toBe(`meta-agent-work-order:${retry.sessionId}`);
  });

  it('allows one infra retry, then sends the next retry to the owner', async () => {
    const planId = 'plan-fb-085-failed';
    const args = {
      title: 'Module 1',
      prompt: 'Retry Module 1 but keep the engine error',
      provider: 'claude-code',
      model: 'claude-code:haiku',
      intent: 'investigation',
      planId,
    } as const;
    const dispatchFailure = async (prompt: string) => {
      const child = JSON.parse(await (service as any).createChildSession(
        'head-session',
        workspacePath,
        { ...args, prompt },
      ));
      await AgentMessagesRepository.create({
        sessionId: child.sessionId,
        source: 'claude-code',
        direction: 'output',
        content: JSON.stringify({ type: 'error', error: 'request timed out after 30s', is_error: true }),
        createdAt: new Date(),
        hidden: false,
      });
      await (service as any).handleChildSessionEvent(child.sessionId, 'session:error');
      return child;
    };

    await dispatchFailure('First infra failure');
    await dispatchFailure('Second infra failure');

    const deniedLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect((service as any).createChildSession('head-session', workspacePath, {
      ...args,
      prompt: 'Third retry must wait for owner',
    })).rejects.toThrow('此类失败需老板指示后才能重试');
    expect(deniedLog).toHaveBeenCalledWith(expect.stringContaining('[RetryGate] denied'));
    deniedLog.mockRestore();

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE type = 'work-order' AND workspace = $1`,
      [workspacePath],
    );
    expect(rows).toHaveLength(1);
    const data = parseStoredJson<any>(rows[0].data);
    expect(data.status).toBe('failed');
    expect(data.attempts).toHaveLength(2);
    expect(data.attempts.every((attempt: any) => attempt.outcome === 'failure')).toBe(true);
    expect(data.failureClass).toBe('infra');
    expect(data.attempts[0]).toMatchObject({ failureClass: 'infra', failureReason: 'request timed out after 30s' });
    expect(data.attempts[1]).toMatchObject({ failureClass: 'infra', failureReason: 'request timed out after 30s' });
  });

  it('lets the failed-card owner retry once and records the manual authorization', async () => {
    const child = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Manual retry module',
        prompt: 'Create a failed card for manual retry',
        provider: 'claude-code',
        model: 'claude-code:haiku',
        intent: 'investigation',
        planId: 'plan-manual-retry',
      },
    ));
    await AgentMessagesRepository.create({
      sessionId: child.sessionId,
      source: 'claude-code',
      direction: 'output',
      content: JSON.stringify({
        type: 'error',
        error: 'Model "missing-model" is not supported',
        is_error: true,
      }),
      createdAt: new Date(),
      hidden: false,
    });
    await (service as any).handleChildSessionEvent(child.sessionId, 'session:error');

    const { rows: failedRows } = await db.query<any>(
      `SELECT id, data FROM tracker_items WHERE type = 'work-order' AND workspace = $1`,
      [workspacePath],
    );
    expect(failedRows).toHaveLength(1);
    const trackerItemId = failedRows[0].id as string;

    const retry = await (service as any).retryWorkOrder(workspacePath, trackerItemId);
    expect(retry).toMatchObject({ sessionId: expect.any(String) });
    expect(retry.sessionId).not.toBe(child.sessionId);

    const { rows: retriedRows } = await db.query<any>(
      `SELECT id, data, source_ref FROM tracker_items WHERE type = 'work-order' AND workspace = $1`,
      [workspacePath],
    );
    expect(retriedRows).toHaveLength(1);
    const retriedData = parseStoredJson<any>(retriedRows[0].data);
    expect(retriedData).toMatchObject({
      status: 'dispatched',
      retryReason: '老板手动重试',
      attempts: [expect.objectContaining({ attempt: 1, failureClass: 'agent' })],
    });

    await (service as any).handleChildSessionEvent(retry.sessionId, 'session:completed');
    const { rows: completedRows } = await db.query<any>(
      `SELECT data, source_ref FROM tracker_items WHERE type = 'work-order' AND workspace = $1`,
      [workspacePath],
    );
    const completedData = parseStoredJson<any>(completedRows[0].data);
    expect(completedData).toMatchObject({
      status: 'completed',
      retryReason: '老板手动重试',
    });
    expect(completedData.attempts).toHaveLength(2);
    expect(completedData.attempts[1]).toMatchObject({
      attempt: 2,
      outcome: 'success',
      retryReason: '老板手动重试',
    });
    expect(completedRows[0].source_ref).toBe(`meta-agent-work-order:${retry.sessionId}`);
  });

  it('FB-090 RED→GREEN: retries a legacy card by resolving its plan owner and backfills it', async () => {
    const planId = 'legacy-plan-fb-090';
    const trackerItemId = 'legacy-work-order-fb-090';
    await db.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, 'plan', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'local', $5, FALSE, 'meta-agent', $6)`,
      [
        planId,
        ['plan'],
        JSON.stringify({
          title: 'Legacy approved plan',
          status: 'ready-for-development',
          submittedBySessionId: 'head-session',
          approvalPromptId: 'legacy-approval-fb-090',
        }),
        workspacePath,
        JSON.stringify({ planItems: ['Retry the legacy work order'] }),
        'meta-agent-submitted-plan:head-session',
      ],
    );
    await db.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, 'work-order', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'local', NULL, FALSE, 'meta-agent', $5)`,
      [
        trackerItemId,
        ['work-order'],
        JSON.stringify({
          title: 'Legacy work order',
          taskSummary: 'Retry the legacy work order',
          status: 'failed',
          childSessionId: 'deleted-child-fb-090',
          intent: 'investigation',
          planId,
          failureReason: 'legacy failure text',
        }),
        workspacePath,
        `meta-agent-work-order:${'deleted-child-fb-090'}`,
      ],
    );

    const retry = await service.retryWorkOrder(workspacePath, trackerItemId);
    expect(retry).toMatchObject({ sessionId: expect.any(String) });

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE id = $1`,
      [trackerItemId],
    );
    expect(parseStoredJson<any>(rows[0].data)).toMatchObject({
      status: 'dispatched',
      planId,
      headSessionId: 'head-session',
      childSessionId: retry.sessionId,
      retryReason: '老板手动重试',
    });
  });

  it('FB-090 RED→GREEN: reports an unresolvable legacy owner as not retryable', async () => {
    const trackerItemId = 'unresolvable-work-order-fb-090';
    await db.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, 'work-order', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'local', NULL, FALSE, 'meta-agent', $5)`,
      [
        trackerItemId,
        ['work-order'],
        JSON.stringify({
          title: 'Unresolvable legacy work order',
          taskSummary: 'Do not retry without a Head owner',
          status: 'failed',
          planId: 'missing-plan-fb-090',
          failureReason: 'legacy failure text',
        }),
        workspacePath,
        `meta-agent-work-order:${trackerItemId}`,
      ],
    );

    await expect(
      (service as any).canRetryWorkOrder(workspacePath, trackerItemId),
    ).resolves.toEqual({
      canRetry: false,
      reason: '原指挥官会话已不存在，无法重派',
    });
  });

  it.each([
    { label: 'deleted', submittedBySessionId: 'deleted-head-fb-090', createSession: false },
    { label: 'standard-role', submittedBySessionId: 'standard-head-fb-090', createSession: true },
  ])('rejects a $label plan owner that is not a live meta-agent', async ({ submittedBySessionId, createSession }) => {
    if (createSession) {
      await AISessionsRepository.create({
        id: submittedBySessionId,
        provider: 'claude-code',
        model: 'claude-code:opus',
        workspaceId: workspacePath,
        title: 'Standard session must not own retries',
        agentRole: 'standard',
      } as any);
    }
    const planId = `plan-owner-role-fb-090-${submittedBySessionId}`;
    const trackerItemId = `work-order-owner-role-fb-090-${submittedBySessionId}`;
    await db.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, 'plan', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'local', NULL, FALSE, 'meta-agent', $5)`,
      [
        planId,
        ['plan'],
        JSON.stringify({ submittedBySessionId }),
        workspacePath,
        `meta-agent-submitted-plan:${submittedBySessionId}`,
      ],
    );
    await db.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, 'work-order', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'local', NULL, FALSE, 'meta-agent', $5)`,
      [
        trackerItemId,
        ['work-order'],
        JSON.stringify({
          title: 'Owner validation work order',
          taskSummary: 'Owner validation',
          status: 'failed',
          planId,
        }),
        workspacePath,
        `meta-agent-work-order:${trackerItemId}`,
      ],
    );

    await expect(service.canRetryWorkOrder(workspacePath, trackerItemId)).resolves.toEqual({
      canRetry: false,
      reason: '原指挥官会话已不存在，无法重派',
    });
  });

  it('serves the same retryability decision through the owner-retry IPC query', async () => {
    const trackerItemId = 'ipc-unresolvable-work-order-fb-090';
    await db.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, 'work-order', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'local', NULL, FALSE, 'meta-agent', $5)`,
      [
        trackerItemId,
        ['work-order'],
        JSON.stringify({ status: 'failed', planId: 'missing-plan-ipc-fb-090' }),
        workspacePath,
        `meta-agent-work-order:${trackerItemId}`,
      ],
    );
    await service.start((service as any).aiService);

    const handler = testState.ipcHandlers.get('meta-agent:can-retry-work-order');
    expect(handler).toBeTypeOf('function');
    await expect(handler?.({}, { workspaceId: workspacePath, trackerItemId })).resolves.toEqual({
      success: true,
      canRetry: false,
      reason: '原指挥官会话已不存在，无法重派',
    });
  });

  it('does not reuse a work-order across modules or plans', async () => {
    const dispatches = [
      { title: 'Module 1', planId: 'plan-a' },
      { title: 'Module 2', planId: 'plan-a' },
      { title: 'Module 1', planId: 'plan-b' },
    ];
    const children = [] as Array<{ sessionId: string }>;
    for (const dispatch of dispatches) {
      children.push(JSON.parse(await (service as any).createChildSession(
        'head-session',
        workspacePath,
        {
          ...dispatch,
          prompt: `Run ${dispatch.title}`,
          provider: 'claude-code',
          model: 'claude-code:haiku',
          intent: 'investigation',
        },
      )));
    }
    for (const child of children) {
      await (service as any).handleChildSessionEvent(child.sessionId, 'session:completed');
    }

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE type = 'work-order' AND workspace = $1`,
      [workspacePath],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => parseStoredJson<any>(row.data).attempts)).toEqual([
      [expect.objectContaining({ attempt: 1, outcome: 'success' })],
      [expect.objectContaining({ attempt: 1, outcome: 'success' })],
      [expect.objectContaining({ attempt: 1, outcome: 'success' })],
    ]);
  });

  it('keeps no-override dispatch behavior: persists the over-limit request and returns its queue position', async () => {
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
    // FB-019: a queued dispatch now owns a placeholder session row from the moment
    // it is enqueued, so it is visible while it waits instead of appearing only
    // once a slot frees up.
    await expect(AISessionsRepository.get(receipt.sessionId)).resolves.toMatchObject({
      id: receipt.sessionId,
      title: 'Queued investigation',
      createdBySessionId: 'head-session',
      metadata: expect.objectContaining({ dispatchQueued: true }),
    });
    // The placeholder must not consume capacity: it is neither in flight nor
    // counted toward the lifetime total until it is really dispatched.
    const queuedCounts = await (service as any).getDispatchCounts('head-session', workspacePath);
    expect(queuedCounts).toEqual({ inFlightCount: 1, totalCount: 1 });

    // Delegated Sessions reads this list; the placeholder must report as queued
    // rather than as an idle child that silently never started.
    const spawned = await (service as any).getSpawnedSessions('head-session', workspacePath);
    const queuedEntry = spawned.find((s: any) => s.sessionId === receipt.sessionId);
    expect(queuedEntry).toMatchObject({ title: 'Queued investigation', status: 'queued' });

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

  it('caps an override above the global setting and queues the third dispatch', async () => {
    testState.maxParallel = 2;
    await createRunningChildren(2);

    const receipt = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Capped third dispatch',
        prompt: 'Wait for one of the two configured slots to open',
        intent: 'investigation',
        maxParallelOverride: 3,
      },
    ));

    expect(receipt).toMatchObject({
      status: 'queued',
      queued: true,
      queuePosition: 1,
    });
    await expect((service as any).getDispatchCounts('head-session', workspacePath)).resolves.toEqual({
      inFlightCount: 2,
      totalCount: 2,
    });
  });

  it('honors a lower override and queues the second dispatch', async () => {
    testState.maxParallel = 4;
    await createRunningChildren(1);

    const receipt = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Lowered second dispatch',
        prompt: 'Wait because this dispatch lowers the cap to one',
        intent: 'investigation',
        maxParallelOverride: 1,
      },
    ));

    expect(receipt).toMatchObject({
      status: 'queued',
      queued: true,
      queuePosition: 1,
    });
    await expect((service as any).getDispatchCounts('head-session', workspacePath)).resolves.toEqual({
      inFlightCount: 1,
      totalCount: 1,
    });
  });

  it('serializes simultaneous public create and spawn dispatches and queues one at a limit of two', async () => {
    testState.maxParallel = 2;
    const bypassSpy = vi.spyOn(service as any, 'shouldBypassChildAgentExecutionForTests')
      .mockReturnValue(false);
    const aiService = (service as any).aiService;
    aiService.queuePromptForSession.mockImplementation(async (sessionId: string, prompt: string) => {
      const promptId = `initial-${sessionId}`;
      await db.query(
        `INSERT INTO queued_prompts (id, session_id, prompt, status)
         VALUES ($1, $2, $3, 'pending')`,
        [promptId, sessionId, prompt],
      );
      return { id: promptId, prompt, createdAt: Date.now() };
    });
    aiService.triggerQueuedPromptProcessingForSession.mockResolvedValue(false);

    try {
      await service.start(aiService);
      expect(testState.metaAgentToolFns?.createSession).toBeTypeOf('function');
      expect(testState.metaAgentToolFns?.spawnSession).toBeTypeOf('function');

      const receipts = await Promise.all([1, 2, 3].map(async (index) => JSON.parse(
        await (index === 2
          ? testState.metaAgentToolFns.spawnSession('head-session', workspacePath, {
              title: `Concurrent dispatch ${index}`,
              prompt: `Hold the initial dispatch slot ${index}`,
              intent: 'investigation',
              isolated: true,
            })
          : testState.metaAgentToolFns.createSession('head-session', workspacePath, {
              title: `Concurrent dispatch ${index}`,
              prompt: `Hold the initial dispatch slot ${index}`,
              intent: 'investigation',
            })),
      )));
      const direct = receipts.filter((receipt) => receipt.queued !== true);
      const queued = receipts.filter((receipt) => receipt.queued === true);

      expect(direct).toHaveLength(2);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        status: 'queued',
        queued: true,
        queuePosition: 1,
        queueId: expect.any(String),
        sessionId: expect.any(String),
        message: expect.stringContaining('position 1'),
      });
      await expect(AISessionsRepository.get(queued[0].sessionId)).resolves.toMatchObject({
        id: queued[0].sessionId,
        createdBySessionId: 'head-session',
        metadata: expect.objectContaining({ dispatchQueued: true }),
      });

      const { rows: queueRows } = await db.query<any>(
        `SELECT id, reserved_session_id, status
         FROM dispatch_queue
         WHERE id = $1`,
        [queued[0].queueId],
      );
      expect(queueRows).toEqual([{
        id: queued[0].queueId,
        reserved_session_id: queued[0].sessionId,
        status: 'queued',
      }]);
      await expect(
        (service as any).getDispatchCounts('head-session', workspacePath),
      ).resolves.toEqual({ inFlightCount: 2, totalCount: 2 });
    } finally {
      bypassSpy.mockRestore();
    }
  });

  it('counts only idle children with an active prompt during the pre-running dispatch window', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { title: 'Lifecycle probe', prompt: 'Probe the initial dispatch lifecycle' },
    );
    const promptId = `lifecycle-${child.sessionId}`;
    await db.query(
      `INSERT INTO queued_prompts (id, session_id, prompt, status)
       VALUES ($1, $2, $3, 'pending')`,
      [promptId, child.sessionId, 'Probe the initial dispatch lifecycle'],
    );

    await expect(
      (service as any).getDispatchCounts('head-session', workspacePath),
    ).resolves.toEqual({ inFlightCount: 1, totalCount: 1 });

    await db.query(`UPDATE queued_prompts SET status = 'executing' WHERE id = $1`, [promptId]);
    await expect(
      (service as any).getDispatchCounts('head-session', workspacePath),
    ).resolves.toEqual({ inFlightCount: 1, totalCount: 1 });

    await db.query(`UPDATE ai_sessions SET status = 'waiting_for_input' WHERE id = $1`, [child.sessionId]);
    await expect(
      (service as any).getDispatchCounts('head-session', workspacePath),
    ).resolves.toEqual({ inFlightCount: 0, totalCount: 1 });

    await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [child.sessionId]);
    await db.query(`UPDATE queued_prompts SET status = 'completed' WHERE id = $1`, [promptId]);
    await expect(
      (service as any).getDispatchCounts('head-session', workspacePath),
    ).resolves.toEqual({ inFlightCount: 0, totalCount: 1 });

    await db.query(`UPDATE ai_sessions SET status = 'error' WHERE id = $1`, [child.sessionId]);
    await db.query(`UPDATE queued_prompts SET status = 'pending' WHERE id = $1`, [promptId]);
    await expect(
      (service as any).getDispatchCounts('head-session', workspacePath),
    ).resolves.toEqual({ inFlightCount: 0, totalCount: 1 });

    await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [child.sessionId]);
    await db.query(`UPDATE queued_prompts SET status = 'paused' WHERE id = $1`, [promptId]);
    await expect(
      (service as any).getDispatchCounts('head-session', workspacePath),
    ).resolves.toEqual({ inFlightCount: 0, totalCount: 1 });
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
    // FB-019: the still-queued second item keeps its placeholder (and its queued
    // marker), while the dispatched first item has had the marker cleared.
    await expect(AISessionsRepository.get(second.sessionId)).resolves.toMatchObject({
      id: second.sessionId,
      metadata: expect.objectContaining({ dispatchQueued: true }),
    });
    expect(firstSession?.metadata?.dispatchQueued).toBeFalsy();
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

  it('refills the queue when completion fires before the executing prompt is marked completed', async () => {
    testState.maxParallel = 1;
    const [running] = await createRunningChildren(1);
    await db.query(
      `INSERT INTO queued_prompts (id, session_id, prompt, status)
       VALUES ($1, $2, $3, 'executing')`,
      [`settling-${running}`, running, 'Prompt still settling after the completion event'],
    );
    const queued = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'After executing completion edge',
        prompt: 'Start even while the completed prompt row is still settling',
        intent: 'investigation',
      },
    ));

    await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [running]);
    await (service as any).handleChildSessionEvent(running, 'session:completed');

    await expect((service as any).dispatchQueueStore.get(queued.queueId)).resolves.toMatchObject({
      status: 'dispatched',
      dispatchedSessionId: queued.sessionId,
    });
  });

  it('counts a newly executing prompt even before its next started event', async () => {
    const [childSessionId] = await createRunningChildren(1);
    const settlingPromptId = `settling-${childSessionId}`;
    const nextPromptId = `next-${childSessionId}`;
    await db.query(
      `INSERT INTO queued_prompts (id, session_id, prompt, status)
       VALUES ($1, $2, $3, 'executing')`,
      [settlingPromptId, childSessionId, 'The turn that is finishing'],
    );

    await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [childSessionId]);
    await (service as any).handleChildSessionEvent(childSessionId, 'session:completed');
    await db.query(`UPDATE queued_prompts SET status = 'completed' WHERE id = $1`, [settlingPromptId]);
    await db.query(
      `INSERT INTO queued_prompts (id, session_id, prompt, status)
       VALUES ($1, $2, $3, 'pending')`,
      [nextPromptId, childSessionId, 'The next turn'],
    );

    await expect((service as any).getDispatchCounts('head-session', workspacePath)).resolves.toMatchObject({
      inFlightCount: 1,
    });
    expect((service as any).releasedDispatchPromptIdsByHead.get('head-session')).toBeUndefined();

    // claim() changes the row before startSession emits session:started. The
    // new executing prompt must still occupy the slot in that window.
    await db.query(`UPDATE queued_prompts SET status = 'executing' WHERE id = $1`, [nextPromptId]);
    await expect((service as any).getDispatchCounts('head-session', workspacePath)).resolves.toMatchObject({
      inFlightCount: 1,
    });
  });

  it('binds completion release to the prompt active when the event arrived', async () => {
    const [childSessionId] = await createRunningChildren(1);
    const settlingPromptId = `event-settling-${childSessionId}`;
    const nextPromptId = `event-next-${childSessionId}`;
    await db.query(
      `INSERT INTO queued_prompts (id, session_id, prompt, status)
       VALUES ($1, $2, $3, 'executing')`,
      [settlingPromptId, childSessionId, 'The prompt active at completion'],
    );
    await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [childSessionId]);

    const originalGet = AISessionsRepository.get.bind(AISessionsRepository);
    let releaseSessionRead!: () => void;
    let sessionReadStarted!: () => void;
    const sessionReadGate = new Promise<void>((resolve) => {
      releaseSessionRead = resolve;
    });
    const sessionReadStartedPromise = new Promise<void>((resolve) => {
      sessionReadStarted = resolve;
    });
    const getSpy = vi.spyOn(AISessionsRepository, 'get').mockImplementationOnce(async (sessionId) => {
      sessionReadStarted();
      await sessionReadGate;
      return originalGet(sessionId);
    });

    try {
      const completion = (service as any).handleChildSessionEvent(childSessionId, 'session:completed');
      await sessionReadStartedPromise;
      await db.query(`UPDATE queued_prompts SET status = 'completed' WHERE id = $1`, [settlingPromptId]);
      await db.query(
        `INSERT INTO queued_prompts (id, session_id, prompt, status)
         VALUES ($1, $2, $3, 'executing')`,
        [nextPromptId, childSessionId, 'Claimed after the completion event'],
      );
      releaseSessionRead();
      await completion;

      await expect((service as any).getDispatchCounts('head-session', workspacePath)).resolves.toMatchObject({
        inFlightCount: 1,
      });
    } finally {
      releaseSessionRead();
      getSpy.mockRestore();
    }
  });

  it('releases the slot when a snapshotted pending prompt fails before the completion decision', async () => {
    testState.maxParallel = 1;
    const [childSessionId] = await createRunningChildren(1);
    const settlingPromptId = `pending-edge-settling-${childSessionId}`;
    const pendingPromptId = `pending-edge-next-${childSessionId}`;
    await db.query(
      `INSERT INTO queued_prompts (id, session_id, prompt, status)
       VALUES ($1, $2, $3, 'executing'), ($4, $2, $5, 'pending')`,
      [
        settlingPromptId,
        childSessionId,
        'The prompt finishing at the idle boundary',
        pendingPromptId,
        'The follow-up that fails before submission',
      ],
    );
    const queued = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Dispatch after failed follow-up',
        prompt: 'Must refill after the pending follow-up fails',
        intent: 'investigation',
      },
    ));
    await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [childSessionId]);

    const originalGet = AISessionsRepository.get.bind(AISessionsRepository);
    let releaseSessionRead!: () => void;
    let sessionReadStarted!: () => void;
    const sessionReadGate = new Promise<void>((resolve) => {
      releaseSessionRead = resolve;
    });
    const sessionReadStartedPromise = new Promise<void>((resolve) => {
      sessionReadStarted = resolve;
    });
    const getSpy = vi.spyOn(AISessionsRepository, 'get').mockImplementationOnce(async (sessionId) => {
      sessionReadStarted();
      await sessionReadGate;
      return originalGet(sessionId);
    });

    try {
      const completion = (service as any).handleChildSessionEvent(childSessionId, 'session:completed');
      await sessionReadStartedPromise;
      await db.query(`UPDATE queued_prompts SET status = 'completed' WHERE id = $1`, [settlingPromptId]);
      await db.query(`UPDATE queued_prompts SET status = 'failed' WHERE id = $1`, [pendingPromptId]);
      releaseSessionRead();
      await completion;

      await expect((service as any).dispatchQueueStore.get(queued.queueId)).resolves.toMatchObject({
        status: 'dispatched',
        dispatchedSessionId: queued.sessionId,
      });
    } finally {
      releaseSessionRead();
      getSpy.mockRestore();
    }
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
    // FB-019: the failed item's placeholder stays visible and carries the failure,
    // rather than silently disappearing from the board.
    const brokenSession = await db.query<any>(
      `SELECT status, metadata FROM ai_sessions WHERE id = $1`,
      [broken.sessionId],
    );
    expect(brokenSession.rows[0].status).toBe('error');
    expect(parseStoredJson<any>(brokenSession.rows[0].metadata).dispatchQueued).toBe(false);
    await expect(AISessionsRepository.get(healthy.sessionId)).resolves.toMatchObject({
      id: healthy.sessionId,
      title: 'Healthy queued task',
    });
    const { rows: failedCardRows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${broken.sessionId}`],
    );
    expect(parseStoredJson<any>(failedCardRows[0].data)).toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('Worktree'),
      receipt: {
        engine: expect.any(String),
        model: expect.anything(),
        startedAt: expect.any(String),
        endedAt: expect.any(String),
        outcome: 'failure',
      },
    });
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

  it('matches the Codex transcript composite request ID for approval', async () => {
    const requestId = '94471805-5eca-4d66-a448-56e438de6ab3';
    await persistPlanApprovalResponse(toCodexTranscriptRequestId(requestId), true);

    const startedAt = 1_000;
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(startedAt)
      .mockReturnValueOnce(startedAt)
      .mockReturnValue(startedAt + (8 * 24 * 60 * 60 * 1000));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await expect(
        (service as any).waitForPlanApprovalResponse('head-session', requestId),
      ).resolves.toMatchObject({ approved: true, respondedBy: 'desktop' });
    } finally {
      infoSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('matches the Codex transcript composite request ID for rejection feedback', async () => {
    const requestId = '94471805-5eca-4d66-a448-56e438de6ab3';
    await persistPlanApprovalResponse(
      toCodexTranscriptRequestId(requestId),
      false,
      'Split persistence from dispatch authorization.',
    );

    const startedAt = 1_000;
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(startedAt)
      .mockReturnValueOnce(startedAt)
      .mockReturnValue(startedAt + (8 * 24 * 60 * 60 * 1000));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await expect(
        (service as any).waitForPlanApprovalResponse('head-session', requestId),
      ).resolves.toMatchObject({
        approved: false,
        feedback: 'Split persistence from dispatch authorization.',
        respondedBy: 'desktop',
      });
    } finally {
      infoSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('rejects a malformed composite request ID even when its second segment matches', async () => {
    const requestId = '94471805-5eca-4d66-a448-56e438de6ab3';
    await persistPlanApprovalResponse(`nimtc|${requestId}|not-a-timestamp|21431`, true);

    const startedAt = 1_000;
    const expiredAt = startedAt + (8 * 24 * 60 * 60 * 1000);
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(startedAt)
      .mockReturnValueOnce(startedAt)
      .mockReturnValue(expiredAt);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((
      ((callback: () => void) => {
        queueMicrotask(callback);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout
    ));
    try {
      await expect(
        (service as any).waitForPlanApprovalResponse('head-session', requestId),
      ).rejects.toThrow('Timed out waiting for plan approval response');
    } finally {
      timeoutSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('waits for seven days and backs off polling after the first minute', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    let now = 0;
    const delays: number[] = [];
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((
      ((callback: () => void, delay?: number) => {
        delays.push(Number(delay));
        if (delays.length === 1) now = (10 * 60 * 1000) + 1;
        else if (delays.length === 2) now = 7 * dayMs;
        else now = (7 * dayMs) + 1;
        queueMicrotask(callback);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout
    ));

    try {
      await expect(
        (service as any).waitForPlanApprovalResponse('head-session', 'no-response'),
      ).rejects.toThrow('Timed out waiting for plan approval response');
      expect(delays).toEqual([100, 2_000, 2_000]);
    } finally {
      timeoutSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('does not swallow a superseded check after finding a matching approval response', async () => {
    const requestId = '94471805-5eca-4d66-a448-56e438de6ab3';
    await persistPlanApprovalResponse(requestId, true);
    const freshnessSpy = vi.spyOn(service as any, 'assertCurrentPlanApprovalRequest')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('approval request superseded during response processing'))
      .mockResolvedValue(undefined);

    try {
      await expect(
        (service as any).waitForPlanApprovalResponse('head-session', requestId, 'plan-id'),
      ).rejects.toThrow('approval request superseded during response processing');
      expect(freshnessSpy).toHaveBeenCalledTimes(2);
    } finally {
      freshnessSpy.mockRestore();
    }
  });

  it('routes a Claude Head native ExitPlanMode request through the durable approval lifecycle', async () => {
    const nativeApproval = await getNativeHeadPlanApprovalHandler();
    const firstRequestId = 'toolu_01V5qt_native_head_initial';
    const firstSubmission = nativeApproval({
      sessionId: 'head-session',
      requestId: firstRequestId,
      planSummary: [
        '# Claude Head 原生方案',
        '1. 接入现有 durable 审批状态机。',
        '2. 复用 PlanApprovalWidget 展示审批卡。',
        '风险：旧的短超时取消可能导致重复提交。',
      ].join('\n'),
      planFilePath: '/workspace/.claude/plans/claude-head-plan.md',
      signal: new AbortController().signal,
    });
    const firstPrompt = await waitForPlanApprovalPrompt();

    expect(firstPrompt).toMatchObject({ requestId: firstRequestId });
    expect(firstPrompt.input).toMatchObject({
      planId: expect.any(String),
      planFilePath: '/workspace/.claude/plans/claude-head-plan.md',
      planSummary: expect.stringContaining('Claude Head 原生方案'),
    });

    await persistPlanApprovalResponse(
      firstRequestId,
      false,
      '请把状态迁移和回归验证拆成明确步骤。',
    );
    const rejected = await firstSubmission;
    expect(rejected).toMatchObject({
      approved: false,
      planId: firstPrompt.input.planId,
      feedback: '请把状态迁移和回归验证拆成明确步骤。',
      deliveryMethod: 'direct',
    });
    await expect(readTestPlanApprovalState('head-session', firstRequestId)).resolves.toMatchObject({
      status: 'closed',
      decision: 'rejected',
      deliveryMethod: 'direct',
    });

    const secondRequestId = 'toolu_01V5qt_native_head_revision';
    const revisedSubmission = nativeApproval({
      sessionId: 'head-session',
      requestId: secondRequestId,
      planSummary: [
        '# Claude Head 修订方案',
        '1. 写入 submitted 审批卡。',
        '2. 记录 responded、delivered、closed。',
        '3. 用批准后的 planId 派发实现任务。',
        '风险：需要保持普通会话的原生确认流程。',
      ].join('\n'),
      planFilePath: '/workspace/.claude/plans/claude-head-plan.md',
      signal: new AbortController().signal,
    });
    const revisedPrompt = await waitForPlanApprovalPrompt([firstRequestId]);
    expect(revisedPrompt).toMatchObject({ requestId: secondRequestId });
    expect(revisedPrompt.input.planId).toBe(firstPrompt.input.planId);
    await persistPlanApprovalResponse(secondRequestId, true);

    const approved = await revisedSubmission;
    if (!approved) {
      throw new Error('Native Head durable approval did not return a result');
    }
    expect(approved).toMatchObject({
      approved: true,
      planId: firstPrompt.input.planId,
      deliveryMethod: 'direct',
    });
    await expect(readTestPlanApprovalState('head-session', secondRequestId)).resolves.toMatchObject({
      status: 'closed',
      decision: 'approved',
      deliveryMethod: 'direct',
    });

    const { rows: lifecycleRows } = await db.query<{ content: unknown }>(
      `SELECT content
       FROM ai_agent_messages
       WHERE session_id = $1 AND content LIKE $2
       ORDER BY created_at ASC, id ASC`,
      ['head-session', `%${secondRequestId}%`],
    );
    expect(lifecycleRows.map((row) => parseStoredJson<any>(row.content).type)).toEqual([
      'nimbalyst_tool_use',
      'exit_plan_mode_response',
      'plan_approval_delivery',
      'nimbalyst_tool_result',
    ]);

    const implementation = JSON.parse(await (service as any).createChildSession(
      'head-session',
      workspacePath,
      {
        title: 'Implement the approved Claude Head plan',
        prompt: 'Use the approved native plan ID for dispatch authorization.',
        intent: 'implementation',
        planId: approved.planId,
      },
    ));
    expect(implementation).toMatchObject({
      createdBySessionId: 'head-session',
    });

    const { rows: cancellationRows } = await db.query<{ content: unknown }>(
      `SELECT content
       FROM ai_agent_messages
       WHERE session_id = $1 AND content LIKE '%"cancelled":true%'`,
      ['head-session'],
    );
    expect(cancellationRows).toHaveLength(0);
  });

  it('does not route a non-Head native ExitPlanMode request into durable approval', async () => {
    const nativeApproval = await getNativeHeadPlanApprovalHandler();
    await db.query(
      `UPDATE ai_sessions SET agent_role = 'standard' WHERE id = $1`,
      ['head-session'],
    );

    await expect(nativeApproval({
      sessionId: 'head-session',
      requestId: 'toolu_01V5qt_standard_session',
      planSummary: '普通会话原生规划确认。',
      planFilePath: '/workspace/.claude/plans/standard-plan.md',
      signal: new AbortController().signal,
    })).resolves.toBeNull();

    const { rows } = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM ai_agent_messages
       WHERE session_id = $1
         AND content LIKE '%"type":"nimbalyst_tool_use"%'
         AND content LIKE $2`,
      ['head-session', '%"id":"toolu_01V5qt_standard_session"%'],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it('persists the approval prompt and allows implementation only after approval', async () => {
    const submitPlan = await getSubmitPlanTool();
    const submitPromise = submitPlan('head-session', workspacePath, {
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

    await persistPlanApprovalResponse(toCodexTranscriptRequestId(prompt.requestId), true);
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

    // FB-018: persisting the result row notifies nobody by itself, so an already-open
    // session would keep showing "Awaiting review". Assert the existing transcript
    // reload signal fires for this session after the decision lands.
    const reloadSignals = testState.sentIpc.filter((sent) => sent.channel === 'ai:message-logged');
    expect(reloadSignals).toContainEqual({
      channel: 'ai:message-logged',
      args: [{ sessionId: 'head-session', workspacePath }],
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

  it('marks a Claude approval direct only after it resolves the original MCP call', async () => {
    const submitPlan = await getSubmitPlanTool();
    const resolveOriginalMcpCall = vi.fn((result: string) => {
      expect(JSON.parse(result)).toMatchObject({
        approved: true,
        deliveryMethod: 'direct',
      });
      return true;
    });
    const markPlanApprovalDelivered = (service as any).aiService.markPlanApprovalDelivered;
    (service as any).aiService.markPlanApprovalDelivered = vi.fn(async (...args: any[]) => {
      expect(resolveOriginalMcpCall).toHaveBeenCalledTimes(1);
      return markPlanApprovalDelivered(...args);
    });

    const submission = submitPlan('head-session', workspacePath, {
      title: 'Resolve Claude MCP approval',
      planItems: ['Resolve the original request', 'Then record delivery'],
      workOrderCount: 0,
      risks: 'Transcript-only delivery leaves the Claude tool call hanging.',
    }, undefined, {
      requestId: 'claude-original-mcp-request',
      resolveOriginalMcpCall,
    });
    const prompt = await waitForPlanApprovalPrompt();
    expect(prompt.requestId).toBe('claude-original-mcp-request');

    await persistPlanApprovalResponse(prompt.requestId, true);
    const approval = JSON.parse(await submission);

    expect(resolveOriginalMcpCall).toHaveBeenCalledTimes(1);
    expect(approval).toMatchObject({
      approved: true,
      planId: prompt.input.planId,
      deliveryMethod: 'direct',
    });
    await expect(readTestPlanApprovalState(
      'head-session',
      prompt.requestId,
    )).resolves.toMatchObject({
      status: 'closed',
      decision: 'approved',
      deliveryMethod: 'direct',
    });
  });

  it('infers the work-order count and preserves an empty risk list on the approval card', async () => {
    const submitPlan = await getSubmitPlanTool();
    const submission = submitPlan('head-session', workspacePath, {
      title: 'Plan with no declared risks',
      planItems: ['Persist the approval card', 'Dispatch only after approval'],
      risks: [],
    });
    const prompt = await waitForPlanApprovalPrompt();

    expect(prompt.input).toMatchObject({
      title: 'Plan with no declared risks',
      planItems: ['Persist the approval card', 'Dispatch only after approval'],
      workOrderCount: 2,
      risks: [],
    });

    const { rows } = await db.query<{ data: unknown }>(
      'SELECT data FROM tracker_items WHERE id = $1 AND type = \'plan\'',
      [prompt.input.planId],
    );
    expect(parseStoredJson<any>(rows[0].data)).toMatchObject({
      workOrderCount: 2,
      risks: [],
    });

    await persistPlanApprovalResponse(prompt.requestId, true);
    await expect(submission).resolves.toEqual(expect.stringContaining('"approved": true'));
  });

  it('returns a Claude rejection through the original MCP call before closing it direct', async () => {
    const submitPlan = await getSubmitPlanTool();
    const resolveOriginalMcpCall = vi.fn((result: string) => {
      expect(JSON.parse(result)).toMatchObject({
        approved: false,
        deliveryMethod: 'direct',
        feedback: 'Split the integration work before approval.',
      });
      return true;
    });
    const markPlanApprovalDelivered = (service as any).aiService.markPlanApprovalDelivered;
    (service as any).aiService.markPlanApprovalDelivered = vi.fn(async (...args: any[]) => {
      expect(resolveOriginalMcpCall).toHaveBeenCalledTimes(1);
      return markPlanApprovalDelivered(...args);
    });

    const submission = submitPlan('head-session', workspacePath, {
      title: 'Resolve Claude MCP rejection',
      planItems: ['Return revision feedback through the original request'],
      workOrderCount: 0,
      risks: 'A rejected plan must not leave the original MCP call hanging.',
    }, undefined, {
      requestId: 'claude-original-mcp-rejection',
      resolveOriginalMcpCall,
    });
    const prompt = await waitForPlanApprovalPrompt();

    await persistPlanApprovalResponse(
      prompt.requestId,
      false,
      'Split the integration work before approval.',
    );
    const rejection = JSON.parse(await submission);

    expect(resolveOriginalMcpCall).toHaveBeenCalledTimes(1);
    expect(rejection).toMatchObject({
      approved: false,
      planId: prompt.input.planId,
      deliveryMethod: 'direct',
      feedback: 'Split the integration work before approval.',
    });
    await expect(readTestPlanApprovalState(
      'head-session',
      prompt.requestId,
    )).resolves.toMatchObject({
      status: 'closed',
      decision: 'rejected',
      deliveryMethod: 'direct',
    });
  });

  it('keeps Codex direct delivery on its existing transcript path', async () => {
    await db.query(
      'UPDATE ai_sessions SET provider = $1 WHERE id = $2',
      ['openai-codex', 'head-session'],
    );
    const submitPlan = await getSubmitPlanTool();
    const resolveOriginalMcpCall = vi.fn(() => true);
    const submission = submitPlan('head-session', workspacePath, {
      title: 'Keep Codex direct delivery',
      planItems: ['Use the existing transcript delivery'],
      workOrderCount: 0,
      risks: 'Codex does not use the Claude MCP promise resolver.',
    }, undefined, {
      requestId: 'codex-direct-transcript-request',
      resolveOriginalMcpCall,
    });
    const prompt = await waitForPlanApprovalPrompt();

    await persistPlanApprovalResponse(prompt.requestId, true);
    const approval = JSON.parse(await submission);

    expect(resolveOriginalMcpCall).not.toHaveBeenCalled();
    expect(approval).toMatchObject({
      approved: true,
      deliveryMethod: 'direct',
    });
    await expect(readTestPlanApprovalState(
      'head-session',
      prompt.requestId,
    )).resolves.toMatchObject({
      status: 'closed',
      decision: 'approved',
      deliveryMethod: 'direct',
    });
  });

  it('revives instead of marking direct when the original Claude MCP call is gone', async () => {
    const submitPlan = await getSubmitPlanTool();
    const resolveOriginalMcpCall = vi.fn(() => false);
    const submission = submitPlan('head-session', workspacePath, {
      title: 'Recover absent Claude MCP call',
      planItems: ['Detect unavailable original call', 'Revive the Head session'],
      workOrderCount: 0,
      risks: 'A stale call must not be recorded as direct delivery.',
    }, undefined, {
      requestId: 'claude-unavailable-mcp-request',
      resolveOriginalMcpCall,
    });
    const prompt = await waitForPlanApprovalPrompt();
    expect(prompt.requestId).toBe('claude-unavailable-mcp-request');

    await persistPlanApprovalResponse(prompt.requestId, true);
    const approval = JSON.parse(await submission);

    expect(resolveOriginalMcpCall).toHaveBeenCalledTimes(1);
    expect(approval).toMatchObject({
      approved: true,
      deliveryMethod: 'revive',
    });
    expect((service as any).aiService.queuePromptForSession).toHaveBeenCalledWith(
      'head-session',
      expect.stringContaining('The user approved plan'),
      undefined,
      undefined,
      'child_session_event',
      expect.stringContaining(prompt.requestId),
    );
    await expect(readTestPlanApprovalState(
      'head-session',
      prompt.requestId,
    )).resolves.toMatchObject({
      status: 'closed',
      decision: 'approved',
      deliveryMethod: 'revive',
    });
  });

  it('auto-approves a submitted plan through the durable approval path only when test mode is enabled', async () => {
    testState.planAutoApprove = true;
    const respondToInteractivePrompt = vi.fn(async ({ sessionId, promptId }: any) => {
      await persistPlanApprovalResponse(promptId, true);
      return { success: true };
    });
    (service as any).aiService.respondToInteractivePrompt = respondToInteractivePrompt;
    const submitPlan = await getSubmitPlanTool();
    const approval = JSON.parse(await submitPlan('head-session', workspacePath, {
      title: 'Auto-approved test plan', planItems: ['Use durable approval'], workOrderCount: 1, risks: 'Test only',
    }));
    expect(respondToInteractivePrompt).toHaveBeenCalledWith(expect.objectContaining({
      promptType: 'exit_plan_mode_request', response: { approved: true },
    }));
    expect(approval).toMatchObject({ approved: true, status: 'ready-for-development', autoApproved: true });
  });

  it('revives a dead Head turn after a durable rejection is recorded', async () => {
    const submitPlan = await getSubmitPlanTool();
    const deadTurn = new AbortController();
    const submission = submitPlan('head-session', workspacePath, {
      title: 'Revive the rejected plan',
      planItems: ['Record the response', 'Resume Head with revision feedback'],
      workOrderCount: 2,
      risks: 'The original MCP tool turn may be gone before the response arrives',
    }, deadTurn.signal);
    const prompt = await waitForPlanApprovalPrompt();

    deadTurn.abort();
    await persistPlanApprovalResponse(
      prompt.requestId,
      false,
      'Split persistence from delivery.',
    );
    await submission;

    expect((service as any).aiService.queuePromptForSession).toHaveBeenCalledWith(
      'head-session',
      expect.stringContaining('Split persistence from delivery.'),
      undefined,
      undefined,
      'child_session_event',
      expect.stringContaining(prompt.requestId),
    );
    expect((service as any).aiService.triggerQueuedPromptProcessingForSession)
      .toHaveBeenCalledWith('head-session', workspacePath, true);
    const { rows } = await db.query<{ content: unknown }>(
      `SELECT content
       FROM ai_agent_messages
       WHERE session_id = $1
         AND content LIKE '%"type":"plan_approval_delivery"%'`,
      ['head-session'],
    );
    expect(rows.map((row) => parseStoredJson<any>(row.content))).toContainEqual(
      expect.objectContaining({
        requestId: prompt.requestId,
        method: 'revive',
      }),
    );
  });

  it('revives a responded approval left behind when the app restarts', async () => {
    const infoSpy = vi.spyOn(console, 'info');
    try {
      await seedRespondedPlanApproval({
        requestId: 'restart-stranded-approval',
        planId: 'restart-stranded-plan',
        approved: true,
      });
      // The durable rows are the only surviving state: the original
      // submit_plan MCP call and its in-memory waiter are intentionally absent.
      await service.start((service as any).aiService);
      await service.reviveRespondedPlanApprovalsOnBoot();

      await expect(readTestPlanApprovalState(
        'head-session',
        'restart-stranded-approval',
      )).resolves.toMatchObject({
        status: 'closed',
        decision: 'approved',
        deliveryMethod: 'revive',
      });
      const { rows: planRows } = await db.query<{ data: unknown }>(
        `SELECT data FROM tracker_items WHERE id = $1`,
        ['restart-stranded-plan'],
      );
      expect(parseStoredJson<any>(planRows[0].data)).toMatchObject({
        status: 'ready-for-development',
        approvedAt: expect.any(String),
      });
      expect((service as any).aiService.queuePromptForSession).toHaveBeenCalledWith(
        'head-session',
        expect.stringContaining('The user approved plan restart-stranded-plan'),
        undefined,
        undefined,
        'child_session_event',
        expect.stringContaining('restart-stranded-approval'),
      );
      expect((service as any).aiService.triggerQueuedPromptProcessingForSession)
        .toHaveBeenCalledWith('head-session', workspacePath, true);
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[PlanRevive]'));
    } finally {
      infoSpy.mockRestore();
    }
  });

  it.each([
    { approved: true, decision: 'approved', feedback: undefined },
    { approved: false, decision: 'rejected', feedback: 'Split the dispatch work before approval.' },
  ])('revives at the live settlement seam after the original waiter is replaced ($decision)', async ({
    approved,
    decision,
    feedback,
  }) => {
    const submitPlan = await getSubmitPlanTool();
    const requestId = '33292f31-5381-41a3-b5ce-d60e6e5ba87e';
    const abandonedSubmission = submitPlan('head-session', workspacePath, {
      title: 'Reproduce live restart settlement',
      planItems: ['Persist the submitted plan', 'Approve after the process is replaced'],
      workOrderCount: 1,
      risks: 'The old process no longer owns the approval waiter.',
    }, undefined, { requestId, resolveOriginalMcpCall: () => false });
    const prompt = await waitForPlanApprovalPrompt();

    // Reproduce DP3: the old process dies with only durable submitted state
    // surviving. The old promise must not be allowed to settle this test's
    // response after the replacement process takes over.
    await service.shutdown();
    (service as any).aiService = null;
    await expect(abandonedSubmission).rejects.toThrow();
    await expect(readTestPlanApprovalState('head-session', prompt.requestId)).resolves.toMatchObject({
      status: 'submitted',
    });

    const replacementAiService = {
      queuePromptForSession: vi.fn(async (_sessionId: string, promptText: string) => ({
        id: 'restarted-live-revive',
        prompt: promptText,
        createdAt: Date.now(),
      })),
      triggerQueuedPromptProcessingForSession: vi.fn().mockResolvedValue(true),
      getPlanApprovalState: vi.fn(readTestPlanApprovalState),
      markPlanApprovalDelivered: vi.fn(async (
        sessionId: string,
        requestId: string,
        method: 'direct' | 'revive',
      ) => {
        const current = await readTestPlanApprovalState(sessionId, requestId);
        if (current?.status === 'responded') {
          await AgentMessagesRepository.create({
            sessionId,
            source: 'nimbalyst',
            direction: 'output',
            content: JSON.stringify({
              type: 'plan_approval_delivery',
              requestId,
              method,
              deliveredAt: Date.now(),
            }),
            createdAt: new Date(),
            hidden: true,
          });
        }
        return readTestPlanApprovalState(sessionId, requestId);
      }),
      respondToInteractivePrompt: vi.fn(async ({ promptId, response }: any) => {
        await persistPlanApprovalResponse(promptId, response.approved, response.feedback);
        // The replacement process has no valid in-memory provider waiter. The
        // durable response is written, but the base settlement reports the
        // same miss that the real restarted process can report.
        return {
          success: false,
          error: 'ExitPlanMode approval is no longer active; retry the response',
        };
      }),
    };
    const replacementService = new (MetaAgentService as any)() as MetaAgentService;
    replacementServices.push(replacementService);
    await replacementService.start(replacementAiService as any);

    const settlement = await replacementAiService.respondToInteractivePrompt({
      sessionId: 'head-session',
      promptId: prompt.requestId,
      promptType: 'exit_plan_mode_request',
      response: { approved, feedback },
      respondedBy: 'desktop',
    });

    expect(settlement).toMatchObject({
      success: true,
      planApprovalState: { status: 'closed', deliveryMethod: 'revive' },
    });
    await expect(readTestPlanApprovalState('head-session', prompt.requestId)).resolves.toMatchObject({
      status: 'closed',
      decision,
      deliveryMethod: 'revive',
      ...(feedback ? { feedback } : {}),
    });
    expect(replacementAiService.queuePromptForSession).toHaveBeenCalledWith(
      'head-session',
      expect.stringContaining(approved ? 'The user approved plan' : 'The user requested changes to plan'),
      undefined,
      undefined,
      'child_session_event',
      expect.stringContaining(prompt.requestId),
    );
    expect(replacementAiService.triggerQueuedPromptProcessingForSession)
      .toHaveBeenCalledWith('head-session', workspacePath, true);
    const { rows: planRows } = await db.query<{ data: unknown }>(
      `SELECT data FROM tracker_items WHERE id = $1`,
      [prompt.input.planId],
    );
    expect(parseStoredJson<any>(planRows[0].data)).toMatchObject({
      status: approved ? 'ready-for-development' : 'in-review',
      ...(feedback ? { lastReviewFeedback: feedback } : {}),
    });
  });

  it('revives a rejected approval with feedback left behind when the app restarts', async () => {
    await seedRespondedPlanApproval({
      requestId: 'restart-stranded-rejection',
      planId: 'restart-stranded-rejection-plan',
      approved: false,
      feedback: 'Split the dispatch work before approval.',
    });

    await service.start((service as any).aiService);
    await service.reviveRespondedPlanApprovalsOnBoot();

    await expect(readTestPlanApprovalState(
      'head-session',
      'restart-stranded-rejection',
    )).resolves.toMatchObject({
      status: 'closed',
      decision: 'rejected',
      feedback: 'Split the dispatch work before approval.',
      deliveryMethod: 'revive',
    });
    const { rows: planRows } = await db.query<{ data: unknown }>(
      `SELECT data FROM tracker_items WHERE id = $1`,
      ['restart-stranded-rejection-plan'],
    );
    expect(parseStoredJson<any>(planRows[0].data)).toMatchObject({
      status: 'in-review',
      lastReviewFeedback: 'Split the dispatch work before approval.',
    });
    expect((service as any).aiService.queuePromptForSession).toHaveBeenCalledWith(
      'head-session',
      expect.stringContaining('Split the dispatch work before approval.'),
      undefined,
      undefined,
      'child_session_event',
      expect.stringContaining('restart-stranded-rejection'),
    );
    expect((service as any).aiService.triggerQueuedPromptProcessingForSession)
      .toHaveBeenCalledWith('head-session', workspacePath, true);
  });

  it.each([
    ['Claude', 'claude-code', (requestId: string) => requestId],
    ['Codex', 'openai-codex', toCodexTranscriptRequestId],
  ])(
    '%s closes rejection → revive → revision → approval exactly once',
    async (_channel, provider, responseIdFor) => {
      await db.query(`UPDATE ai_sessions SET provider = $1 WHERE id = $2`, [
        provider,
        'head-session',
      ]);
      const submitPlan = await getSubmitPlanTool();
      const deadTurn = new AbortController();
      const rejectedSubmission = submitPlan('head-session', workspacePath, {
        title: `${provider} initial plan`,
        planItems: ['Submit a plan that needs revision'],
        workOrderCount: 1,
        risks: 'The approval turn will end before the rejection arrives',
      }, deadTurn.signal);
      const rejectedPrompt = await waitForPlanApprovalPrompt();
      deadTurn.abort();
      await persistPlanApprovalResponse(
        responseIdFor(rejectedPrompt.requestId),
        false,
        'Add an explicit recovery step.',
      );
      const rejected = JSON.parse(await rejectedSubmission);
      expect(rejected).toMatchObject({
        approved: false,
        deliveryMethod: 'revive',
      });
      await expect(readTestPlanApprovalState(
        'head-session',
        rejectedPrompt.requestId,
      )).resolves.toMatchObject({
        status: 'closed',
        decision: 'rejected',
        deliveryMethod: 'revive',
      });

      const approvedSubmission = submitPlan('head-session', workspacePath, {
        title: `${provider} revised plan`,
        planItems: ['Persist response', 'Recover delivery', 'Close the card'],
        workOrderCount: 2,
        risks: 'A duplicate path must not deliver twice',
      });
      const approvedPrompt = await waitForPlanApprovalPrompt([rejectedPrompt.requestId]);
      await persistPlanApprovalResponse(responseIdFor(approvedPrompt.requestId), true);
      const approved = JSON.parse(await approvedSubmission);
      expect(approved).toMatchObject({
        planId: rejected.planId,
        approved: true,
        status: 'ready-for-development',
        deliveryMethod: 'direct',
      });
      await expect(readTestPlanApprovalState(
        'head-session',
        approvedPrompt.requestId,
      )).resolves.toMatchObject({
        status: 'closed',
        decision: 'approved',
        deliveryMethod: 'direct',
      });
      expect((service as any).aiService.queuePromptForSession).toHaveBeenCalledTimes(1);
      expect((service as any).aiService.triggerQueuedPromptProcessingForSession)
        .toHaveBeenCalledTimes(1);
    },
  );

  it('returns change feedback, accepts a revision, and closes the original approval card', async () => {
    const submitPlan = await getSubmitPlanTool();
    const firstSubmission = submitPlan('head-session', workspacePath, {
      title: 'Initial dispatch plan',
      planItems: ['One broad work order'],
      workOrderCount: 1,
      risks: 'The work order is too broad',
    });
    const firstPrompt = await waitForPlanApprovalPrompt();
    await persistPlanApprovalResponse(
      toCodexTranscriptRequestId(firstPrompt.requestId),
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

    const secondSubmission = submitPlan('head-session', workspacePath, {
      title: 'Revised dispatch plan',
      planItems: ['Persist approval', 'Authorize dispatch'],
      workOrderCount: 2,
      risks: 'Concurrent responses could cross submissions',
    });
    const secondPrompt = await waitForPlanApprovalPrompt([firstPrompt.requestId]);
    expect(secondPrompt.input.planId).toBe(firstResult.planId);
    await persistPlanApprovalResponse(secondPrompt.requestId, true);
    const secondResult = JSON.parse(await secondSubmission);
    expect(secondResult).toMatchObject({
      approved: true,
      planId: firstResult.planId,
      status: 'ready-for-development',
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
      status: 'ready-for-development',
      planItems: ['Persist approval', 'Authorize dispatch'],
      workOrderCount: 2,
      risks: 'Concurrent responses could cross submissions',
    });
  });

  it('cancels the old approval waiter when its response arrives before the new response', async () => {
    const submitPlan = await getSubmitPlanTool();
    const firstSubmission = submitPlan('head-session', workspacePath, {
      title: 'Old approval plan',
      planItems: ['Await the old card response'],
      workOrderCount: 1,
      risks: 'The first response may arrive after a replacement plan exists',
    });
    const firstOutcome = firstSubmission.then(
      (result) => ({ result }),
      (error) => ({ error: error instanceof Error ? error.message : String(error) }),
    );
    const firstPrompt = await waitForPlanApprovalPrompt();

    const secondSubmission = submitPlan('head-session', workspacePath, {
      title: 'Current approval plan',
      planItems: ['Await the current card response'],
      workOrderCount: 1,
      risks: 'A stale approval must not authorize the current plan',
    });
    const secondPrompt = await waitForPlanApprovalPrompt([firstPrompt.requestId]);
    expect(secondPrompt.input.planId).toBe(firstPrompt.input.planId);

    try {
      await persistPlanApprovalResponse(firstPrompt.requestId, true);
      await expect(firstOutcome).resolves.toEqual({
        error: expect.stringContaining('superseded'),
      });

      const { rows: pendingRows } = await db.query<any>(
        'SELECT data FROM tracker_items WHERE id = $1',
        [secondPrompt.input.planId],
      );
      expect(parseStoredJson<any>(pendingRows[0].data)).toMatchObject({
        title: 'Current approval plan',
        status: 'in-review',
        approvalPromptId: secondPrompt.requestId,
      });
    } finally {
      await persistPlanApprovalResponse(secondPrompt.requestId, true);
      await secondSubmission.catch(() => undefined);
    }
    await expect(secondSubmission).resolves.toEqual(expect.stringContaining('ready-for-development'));
  });

  it('keeps the current plan approved when its response arrives before an old response', async () => {
    const submitPlan = await getSubmitPlanTool();
    const firstSubmission = submitPlan('head-session', workspacePath, {
      title: 'First approval plan',
      planItems: ['Wait for a response that must become stale'],
      workOrderCount: 1,
      risks: 'The old response may arrive after the current plan is approved',
    });
    const firstOutcome = firstSubmission.then(
      (result) => ({ result }),
      (error) => ({ error: error instanceof Error ? error.message : String(error) }),
    );
    const firstPrompt = await waitForPlanApprovalPrompt();

    const secondSubmission = submitPlan('head-session', workspacePath, {
      title: 'Second approval plan',
      planItems: ['Approve this current submission'],
      workOrderCount: 1,
      risks: 'The current approval must survive a delayed old response',
    });
    const secondPrompt = await waitForPlanApprovalPrompt([firstPrompt.requestId]);

    await persistPlanApprovalResponse(secondPrompt.requestId, true);
    const secondResult = JSON.parse(await secondSubmission);
    expect(secondResult).toMatchObject({
      approved: true,
      planId: secondPrompt.input.planId,
      status: 'ready-for-development',
    });

    await persistPlanApprovalResponse(firstPrompt.requestId, false, 'This response belongs to the old card.');
    await expect(firstOutcome).resolves.toEqual({
      error: expect.stringContaining('superseded'),
    });

    const { rows } = await db.query<any>(
      'SELECT data FROM tracker_items WHERE id = $1',
      [secondPrompt.input.planId],
    );
    expect(parseStoredJson<any>(rows[0].data)).toMatchObject({
      title: 'Second approval plan',
      status: 'ready-for-development',
      approvalPromptId: secondPrompt.requestId,
    });
  });

  it('uses approvalPromptId CAS when a stale waiter reaches finalization after replacement', async () => {
    const submitPlan = await getSubmitPlanTool();
    let releaseStaleWaiter: ((response: Record<string, unknown>) => void) | undefined;
    const staleWaiter = new Promise<Record<string, unknown>>((resolve) => {
      releaseStaleWaiter = resolve;
    });
    const waitSpy = vi.spyOn(service as any, 'waitForPlanApprovalResponse')
      .mockImplementationOnce(() => staleWaiter)
      .mockImplementationOnce(async (...callArgs: unknown[]) => {
        const requestId = String(callArgs[1]);
        await persistPlanApprovalResponse(requestId, true);
        return {
          approved: true,
          decision: 'approved',
          respondedAt: Date.now(),
          respondedBy: 'desktop',
        };
      });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const staleSubmission = submitPlan('head-session', workspacePath, {
        title: 'CAS stale plan',
        planItems: ['Reach finalization only after replacement'],
        workOrderCount: 1,
        risks: 'The stale waiter must update zero rows',
      });
      const staleOutcome = staleSubmission.then(
        (result) => ({ result }),
        (error) => ({ error: error instanceof Error ? error.message : String(error) }),
      );
      const stalePrompt = await waitForPlanApprovalPrompt();
      await vi.waitFor(() => expect(waitSpy).toHaveBeenCalledTimes(1));

      const currentSubmission = submitPlan('head-session', workspacePath, {
        title: 'CAS current plan',
        planItems: ['Keep this replacement untouched'],
        workOrderCount: 1,
        risks: 'A stale finalization must be rejected atomically',
      });
      const currentPrompt = await waitForPlanApprovalPrompt([stalePrompt.requestId]);
      const currentResult = JSON.parse(await currentSubmission);
      expect(currentResult).toMatchObject({
        approved: true,
        planId: currentPrompt.input.planId,
        status: 'ready-for-development',
      });

      if (!releaseStaleWaiter) {
        throw new Error('Stale approval waiter was not initialized');
      }
      releaseStaleWaiter({
        approved: false,
        feedback: 'Old response',
        respondedAt: Date.now(),
        respondedBy: 'desktop',
      });
      await expect(staleOutcome).resolves.toEqual({
        error: expect.stringContaining('superseded'),
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stale plan approval response'));

      const { rows } = await db.query<any>(
        'SELECT data FROM tracker_items WHERE id = $1',
        [currentPrompt.input.planId],
      );
      expect(parseStoredJson<any>(rows[0].data)).toMatchObject({
        title: 'CAS current plan',
        status: 'ready-for-development',
        approvalPromptId: currentPrompt.requestId,
      });
    } finally {
      waitSpy.mockRestore();
      warnSpy.mockRestore();
    }
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
    if (eventType === 'session:completed') {
      expect(data.receipt).toMatchObject({
        engine: 'claude-code',
        model: 'claude-code:opus',
        startedAt: expect.any(String),
        endedAt: expect.any(String),
        outcome: 'success',
      });
      expect(data.attempts).toEqual([
        expect.objectContaining({ attempt: 1, outcome: 'success' }),
      ]);
    }
    if (eventType === 'session:interrupted') {
      expect(data.interruptionReason).toBe('Session interrupted');
    }
  });

  it('records the raw child failure receipt and rejects a forged completed settlement', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Preserve the engine failure as a failed work order' },
    );
    const rawEngineError = 'Model "gemini-2.5-pro" is not supported. Supported models: gemini-2.5-flash';
    await AgentMessagesRepository.create({
      sessionId: child.sessionId,
      source: 'claude-code',
      direction: 'output',
      content: JSON.stringify({ type: 'error', error: rawEngineError, is_error: true }),
      createdAt: new Date(),
      hidden: false,
    });

    await (service as any).handleChildSessionEvent(child.sessionId, 'session:error');

    const { rows: failedRows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    expect(parseStoredJson<any>(failedRows[0].data)).toMatchObject({
      status: 'failed',
      failureReason: rawEngineError,
      receipt: {
        engine: 'claude-code',
        model: 'claude-code:opus',
        startedAt: expect.any(String),
        endedAt: expect.any(String),
        outcome: 'failure',
      },
    });
    expect(parseStoredJson<any>(failedRows[0].data).attempts).toEqual([
      expect.objectContaining({ attempt: 1, failureReason: rawEngineError, outcome: 'failure' }),
    ]);

    const guardLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await (service as any).handleChildSessionEvent(child.sessionId, 'session:completed');

    const { rows: guardedRows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    expect(parseStoredJson<any>(guardedRows[0].data).status).toBe('failed');
    expect(guardLog).toHaveBeenCalledWith(expect.stringContaining('[WorkOrderGuard]'));
    guardLog.mockRestore();
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
    expect((service as any).aiService.stopSession).toHaveBeenCalledWith(
      child.sessionId,
      'pause',
      0,
      'Interrupted by Head Agent',
    );
    expect((service as any).aiService.stopSession).not.toHaveBeenCalledWith('head-session', expect.anything());

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

  it('records a manual owner stop without a failure receipt and reports it to Head', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { title: 'Manual stop history', prompt: 'Keep the partial files', planId: 'du-manual-stop-plan' },
    );
    const stoppedAt = '2026-08-07T12:34:56.000Z';
    await AISessionsRepository.updateMetadata(child.sessionId, {
      metadata: {
        manualStopAt: stoppedAt,
        interruptionReason: '老板手动停止',
      },
    });
    const queuePromptForSession = (service as any).aiService.queuePromptForSession as ReturnType<typeof vi.fn>;

    await (service as any).handleChildSessionEvent(child.sessionId, 'session:interrupted');
    // The state event can be delivered twice; the ledger and Head notification
    // must remain one interruption rather than becoming two attempts.
    await (service as any).handleChildSessionEvent(child.sessionId, 'session:interrupted');

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    const data = parseStoredJson<any>(rows[0].data);
    expect(data).toMatchObject({
      status: 'interrupted',
      interruptionReason: '老板手动停止',
      interruptedAt: stoppedAt,
      attempts: [],
    });
    expect(data.receipt).toBeUndefined();
    expect(data.failureClass).toBeUndefined();
    expect(data.interruptions).toEqual([
      expect.objectContaining({
        reason: '老板手动停止',
        interruptedAt: stoppedAt,
        sessionId: child.sessionId,
      }),
    ]);
    expect(queuePromptForSession).toHaveBeenCalledTimes(1);
    expect(queuePromptForSession.mock.calls[0][1]).toEqual(expect.stringContaining('老板手动停止'));
    expect(queuePromptForSession.mock.calls[0][1]).toEqual(expect.stringContaining(stoppedAt));
    expect(queuePromptForSession.mock.calls[0][1]).toEqual(expect.stringContaining('Do not retry automatically'));
  });

  it('does not open RetryGate for a manually interrupted work-order', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { title: 'Manual stop retry gate', prompt: 'Stop before retry', planId: 'du-retry-gate-plan' },
    );
    await AISessionsRepository.updateMetadata(child.sessionId, {
      metadata: {
        manualStopAt: '2026-08-07T12:34:56.000Z',
        interruptionReason: '老板手动停止',
      },
    });
    await (service as any).handleChildSessionEvent(child.sessionId, 'session:interrupted');

    await expect((service as any).assertRetryGate(
      'head-session',
      workspacePath,
      {
        title: 'Manual stop retry gate',
        prompt: 'Stop before retry',
        planId: 'du-retry-gate-plan',
      },
      { manualRetry: false },
    )).resolves.toBeUndefined();
  });

  it('keeps a completed work-order when a late interruption loses the settlement race', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { title: 'Completion race', prompt: 'Finish before stop', planId: 'du-completion-race-plan' },
    );
    const queuePromptForSession = (service as any).aiService.queuePromptForSession as ReturnType<typeof vi.fn>;

    await (service as any).handleChildSessionEvent(child.sessionId, 'session:completed');
    await AISessionsRepository.updateMetadata(child.sessionId, {
      metadata: {
        manualStopAt: '2026-08-07T12:34:56.000Z',
        interruptionReason: '老板手动停止',
      },
    });
    await (service as any).handleChildSessionEvent(child.sessionId, 'session:interrupted');

    const { rows } = await db.query<any>(
      `SELECT data FROM tracker_items WHERE source_ref = $1`,
      [`meta-agent-work-order:${child.sessionId}`],
    );
    const data = parseStoredJson<any>(rows[0].data);
    expect(data.status).toBe('completed');
    expect(data.receipt).toMatchObject({ outcome: 'success' });
    expect(data.interruptedAt).toBeUndefined();
    expect(data.interruptions).toBeUndefined();
    expect(queuePromptForSession).toHaveBeenCalledTimes(1);
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

  it('publishes the established tracker invalidation for interrupt, resume, and completion', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Interrupt, resume, and complete this delegated task' },
    );
    await db.query(
      `UPDATE ai_sessions SET status = 'running' WHERE id = $1`,
      [child.sessionId],
    );
    (service as any).aiService = {
      ...(service as any).aiService,
      stopSession: vi.fn().mockResolvedValue({ success: true, queue: 'paused' }),
    };
    await service.start((service as any).aiService);

    testState.sentIpc = [];
    await service.interruptSession('head-session', workspacePath, { sessionId: child.sessionId });
    await expectWorkOrderStatus(child.sessionId, 'interrupted');
    expectTrackerInvalidation();

    testState.sentIpc = [];
    testState.stateListener?.({
      type: 'session:started',
      sessionId: child.sessionId,
      workspacePath,
      timestamp: new Date(),
    });
    await expectWorkOrderStatus(child.sessionId, 'running');
    expectTrackerInvalidation();

    testState.sentIpc = [];
    testState.stateListener?.({
      type: 'session:completed',
      sessionId: child.sessionId,
      workspacePath,
      timestamp: new Date(),
    });
    await expectWorkOrderStatus(child.sessionId, 'completed');
    expectTrackerInvalidation();
  });

  it('persists Head interruption state and clears it when the child becomes active again', async () => {
    const child = await (service as any).createChildSessionInternal(
      'head-session',
      workspacePath,
      { prompt: 'Interrupt and resume this delegated task' },
    );
    await db.query(
      `UPDATE ai_sessions SET status = 'running' WHERE id = $1`,
      [child.sessionId],
    );
    (service as any).aiService = {
      ...(service as any).aiService,
      stopSession: vi.fn(async (sessionId: string) => {
        // Match the post-stop state that used to make the delegated list show
        // an ordinary idle session even though Head had interrupted it.
        await db.query(`UPDATE ai_sessions SET status = 'idle' WHERE id = $1`, [sessionId]);
        return { success: true, queue: 'paused', paused: 0 };
      }),
    };

    const result = JSON.parse(await service.interruptSession('head-session', workspacePath, {
      sessionId: child.sessionId,
    }));
    expect(result.results).toEqual([
      expect.objectContaining({ sessionId: child.sessionId, outcome: 'interrupted' }),
    ]);

    const interruptedSession = (await (service as any).getSpawnedSessions('head-session', workspacePath))
      .find((session: { sessionId: string }) => session.sessionId === child.sessionId);
    expect(interruptedSession).toMatchObject({ status: 'interrupted' });

    const metadataAfterInterrupt = parseStoredJson<Record<string, unknown>>((await db.query<any>(
      `SELECT metadata FROM ai_sessions WHERE id = $1`,
      [child.sessionId],
    )).rows[0]?.metadata);
    expect(metadataAfterInterrupt.interruptedByHead).toBe(true);

    await service.start((service as any).aiService);
    testState.stateListener?.({
      type: 'session:started',
      sessionId: child.sessionId,
      workspacePath,
      timestamp: new Date(),
    });

    await vi.waitFor(async () => {
      const metadata = parseStoredJson<Record<string, unknown>>((await db.query<any>(
        `SELECT metadata FROM ai_sessions WHERE id = $1`,
        [child.sessionId],
      )).rows[0]?.metadata);
      expect(metadata.interruptedByHead).toBe(false);
    });

    await AISessionsRepository.updateMetadata(child.sessionId, {
      metadata: { interruptedByHead: true },
    });
    testState.stateListener?.({
      type: 'session:streaming',
      sessionId: child.sessionId,
      workspacePath,
      timestamp: new Date(),
    });

    await vi.waitFor(async () => {
      const metadata = parseStoredJson<Record<string, unknown>>((await db.query<any>(
        `SELECT metadata FROM ai_sessions WHERE id = $1`,
        [child.sessionId],
      )).rows[0]?.metadata);
      expect(metadata.interruptedByHead).toBe(false);
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

import path from 'path';
import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { safeHandle } from '../utils/ipcRegistry';
import { ClaudeCodeProvider, OpenAICodexProvider, OpenAICodexACPProvider, SessionManager } from '@nimbalyst/runtime/ai/server';
import type { AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import { ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';
import type { EffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';
import { AISessionsRepository, AgentMessagesRepository, SessionFilesRepository } from '@nimbalyst/runtime';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { getDefaultAIModel, store } from '../utils/store';
import { toMillis } from '../utils/timestampUtils';
import { createWorktreeStore } from './WorktreeStore';
import { GitWorktreeService } from './GitWorktreeService';
import { database as databaseWorker } from '../database/PGLiteDatabaseWorker';
import { getDatabase } from '../database/initialize';
import { gitRefWatcher } from '../file/GitRefWatcher';
import {
  AIService,
  type DurablePlanApprovalState,
  type PlanApprovalDeliveryMethod,
} from './ai/AIService';
import { createBidirectionalLink } from '../mcp/tools/trackerToolHandlers';
import {
  startMetaAgentServer,
  setMetaAgentToolFns,
  shutdownMetaAgentServer,
} from '../mcp/metaAgentServer';
import {
  persistInteractivePromptToolResult,
  persistInteractivePromptToolUse,
} from '../mcp/tools/interactivePromptTranscript';
import { broadcastMessageLogged } from './ai/claudeCliUserPromptLog';
import { computeNotificationSignature } from './metaAgentNotificationSignature';
import { extractMessageText, extractUserPrompts } from './metaAgentMessageText';
import { shouldShowTextApprovalGuard, TEXT_APPROVAL_CORRECTION } from './metaAgentTextApprovalGuard';
import { ClaudeCliLauncherConfig } from './ai/claudeCliLauncherSingleton';
import type {
  QueueCancelAction,
  QueueCancelResult,
  QueuedPromptOrigin,
} from './PGLiteQueuedPromptsStore';
import {
  createPGLiteDispatchQueueStore,
  type DispatchQueueItem,
  type DispatchRequestKind,
  type DispatchQueueRequestSnapshot,
} from './PGLiteDispatchQueueStore';

type SessionStatusValue = 'idle' | 'running' | 'waiting_for_input' | 'error' | 'interrupted';
type PromptType = 'permission_request' | 'ask_user_question_request' | 'exit_plan_mode_request';
type WorkOrderStatus = 'queued' | 'dispatched' | 'running' | 'waiting' | 'interrupted' | 'completed' | 'failed';
type SessionIntent = 'investigation' | 'implementation';

const IMPLEMENTATION_PLAN_APPROVAL_ERROR =
  'implementation sessions require an approved plan. Submit a plan for user approval first, or set intent to "investigation" for read-only work.';
const SESSION_INTENT_ERROR =
  'intent is required and must be "investigation" or "implementation"';
const DEFAULT_META_AGENT_MAX_PARALLEL = 4;
const PLAN_APPROVAL_MAX_POLL_TIME_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_APPROVAL_FAST_POLL_WINDOW_MS = 60 * 1000;
const PLAN_APPROVAL_FAST_POLL_INTERVAL_MS = 100;
const PLAN_APPROVAL_SLOW_POLL_INTERVAL_MS = 2_000;
const LIFETIME_BACKSTOP = 50;
const VALID_EFFORT_LEVELS = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max']);
const TEXT_APPROVAL_REMINDER = 'Head 正在用文字征求批准——请让它提交正式方案，或点此发送标准指令';

class DispatchCapacityError extends Error {
  constructor(
    readonly inFlightCount: number,
    readonly maxParallel: number,
  ) {
    super(
      `Head Agent concurrency limit reached (${inFlightCount} running, limit ${maxParallel}); adjust the limit in Settings.`,
    );
    this.name = 'DispatchCapacityError';
  }
}

class PlanApprovalSupersededError extends Error {
  constructor(planId: string, requestId: string) {
    super(`Plan approval request ${requestId} was superseded by a newer submission for plan ${planId}`);
    this.name = 'PlanApprovalSupersededError';
  }
}

function isValidMaxParallel(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function getEffectiveMaxParallel(override: number | undefined): number {
  const storedValue = store.get('metaAgentMaxParallel') as unknown;
  const configuredMax = isValidMaxParallel(storedValue)
    ? storedValue
    : DEFAULT_META_AGENT_MAX_PARALLEL;

  if (override === undefined) {
    return configuredMax;
  }
  if (!isValidMaxParallel(override)) {
    throw new Error('maxParallelOverride must be a positive safe integer');
  }
  return Math.min(configuredMax, override);
}

interface PendingInteractivePrompt {
  id: string;
  promptId: string;
  promptType: PromptType;
  createdAt: number;
  content: Record<string, any>;
}

interface SessionResultData {
  sessionId: string;
  title: string;
  provider: string;
  model: string | null;
  status: SessionStatusValue;
  lastActivity: number | null;
  originalPrompt: string | null;
  userPrompts: string[];
  lastResponse: string | null;
  /** Full final assistant response (large cap), for get_session_result so the
   *  meta-agent can synthesize from the child's real work, not a 500-char stub.
   *  The notification preview deliberately uses lastResponse, not this. */
  fullResponse: string | null;
  recentMessages: Array<{ direction: 'input' | 'output'; text: string }>;
  editedFiles: string[];
  pendingPrompt: PendingInteractivePrompt | null;
  errorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
  worktreeId?: string | null;
  /** Capability scope the child was granted (read|write|full). The objective
   *  record of what the child COULD do; null/full means all tools. */
  toolScope?: string | null;
}

interface CreateChildSessionArgs {
  title?: string;
  provider?: string;
  model?: string;
  effortLevel?: EffortLevel;
  prompt?: string;
  useWorktree?: boolean;
  worktreeId?: string;
  toolScope?: string;
  intent?: SessionIntent;
  planId?: string;
  maxParallelOverride?: number;
}

interface SubmitPlanArgs {
  title: string;
  planItems: string[];
  workOrderCount: number;
  risks: string;
}

interface NativeHeadPlanApprovalRequest {
  sessionId: string;
  requestId: string;
  planSummary: string;
  planFilePath: string;
  signal: AbortSignal;
}

interface NativeHeadPlanApprovalResult {
  approved: boolean;
  planId: string;
  feedback?: string;
  deliveryMethod: 'direct' | 'revive';
}

interface PlanSubmissionOptions {
  requestId?: string;
  planFilePath?: string;
  planSummary?: string;
  /**
   * Claude's MCP submit_plan request remains open while a user reviews the
   * card. Settlement must resolve that exact request before lifecycle state can
   * claim delivery.
   */
  resolveOriginalMcpCall?: (result: string) => boolean | Promise<boolean>;
}

interface PlanApprovalResponse {
  approved: boolean;
  decision?: 'approved' | 'rejected' | 'dismissed';
  feedback?: string;
  respondedAt?: number;
  respondedBy?: string;
}

function buildNativeHeadPlanArgs(planSummary: string, planFilePath: string): SubmitPlanArgs {
  const normalizedSummary = planSummary.trim() || `Plan file: ${planFilePath}`;
  const lines = normalizedSummary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  const firstNarrativeLine = lines.find((line) =>
    !/^#{1,6}\s+/.test(line)
    && !/^(?:[-*+]\s+|\d+[.)、]\s+)/.test(line)
    && !/^(?:风险|risks?)\s*[:：]?/i.test(line),
  );
  const title = (heading?.replace(/^#{1,6}\s+/, '') || firstNarrativeLine || path.basename(planFilePath) || 'Claude Head native plan').trim();
  const planItems = lines
    .filter((line) => /^(?:[-*+]\s+|\d+[.)、]\s+)/.test(line))
    .map((line) => line.replace(/^(?:[-*+]\s+|\d+[.)、]\s+)/, '').trim())
    .filter(Boolean);
  const inlineRisk = lines.find((line) => /^(?:风险|risks?)\s*[:：]/i.test(line));
  const riskHeadingIndex = lines.findIndex((line) => /^(?:#{1,6}\s*)?(?:风险|risks?)\s*$/i.test(line));
  const risks = inlineRisk
    ? inlineRisk.replace(/^(?:风险|risks?)\s*[:：]\s*/i, '').trim()
    : riskHeadingIndex >= 0
      ? (lines.slice(riskHeadingIndex + 1).find(Boolean) ?? 'No risks provided.')
      : 'No risks provided.';

  return {
    title,
    planItems: planItems.length > 0 ? planItems : [normalizedSummary],
    workOrderCount: planItems.length || 1,
    risks,
  };
}

interface InterruptSessionArgs {
  sessionId: string;
  cascade?: boolean;
  queueAction?: QueueCancelAction;
}

interface TaskTreeSessionRow {
  id: string;
  created_by_session_id: string | null;
  status: SessionStatusValue | null;
}

interface InterruptSessionNodeResult {
  sessionId: string;
  outcome: 'interrupted' | 'already-ended' | 'failed';
  queue: QueueCancelResult['queue'];
  paused?: number;
  reason?: string;
}

function collectDescendantSessionIds(rows: TaskTreeSessionRow[], rootSessionId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.created_by_session_id) continue;
    const children = childrenByParent.get(row.created_by_session_id) ?? [];
    children.push(row.id);
    childrenByParent.set(row.created_by_session_id, children);
  }

  const descendants: string[] = [];
  const visited = new Set<string>([rootSessionId]);
  const pending = [rootSessionId];
  while (pending.length > 0) {
    const parentId = pending.shift()!;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      descendants.push(childId);
      pending.push(childId);
    }
  }
  return descendants;
}

function normalizeStoredChildModelIdentifier(
  provider: string | null | undefined,
  model: string | null | undefined
): string | null {
  const normalizedModel = model?.trim();
  if (!normalizedModel || normalizedModel === 'default') {
    return null;
  }

  if (provider === 'claude-code' || normalizedModel.startsWith('claude-code:')) {
    const parsed = ModelIdentifier.parse(normalizedModel);
    if (provider === 'claude-code' && parsed.provider !== 'claude-code') {
      throw new Error(`Claude Agent child sessions require a claude-code:* model identifier. Received: ${normalizedModel}`);
    }
    return parsed.combined;
  }

  return normalizedModel;
}

interface SpawnSessionArgs {
  title?: string;
  prompt: string;
  useWorktree?: boolean;
  model?: string;
  effortLevel?: EffortLevel;
  /**
   * When true and `model` is not explicitly set, the new session uses the
   * caller's model instead of the global app default. Ignored if `model` is
   * provided explicitly.
   */
  inheritModel?: boolean;
  /**
   * If false (the default for /launch-new-session), the parent will not receive
   * `[Child Session Update]` notifications when the spawned session completes,
   * errors, or waits for input. Use this for fire-and-forget hand-offs where the
   * parent is just kicking off work to escape a long context.
   */
  notifyOnComplete?: boolean;
  /**
   * When true, the new session is created at the top level — no parent, no
   * workstream container, no shared files-edited or tabs with the caller.
   * Use for fix-and-commit-separately work that should not pollute the
   * caller's workstream.
   */
  isolated?: boolean;
  intent?: SessionIntent;
  planId?: string;
  maxParallelOverride?: number;
}

type InternalCreateChildSessionArgs = CreateChildSessionArgs & {
  parentSessionIdOverride?: string | null;
  sessionIdOverride?: string;
  workOrderSourceRef?: string;
  notifyParent?: boolean;
};

interface CreatedChildSessionResult {
  sessionId: string;
  title: string;
  provider: string;
  model: string;
  worktreeId: string | null;
  worktreePath: string | null;
  worktreeMode: 'existing' | 'new' | 'none';
  createdBySessionId: string;
  queuedInitialPrompt: boolean;
  parentSessionId: string | null;
}

interface QueuedChildSessionResult {
  sessionId: string;
  status: 'queued';
  queued: true;
  queueId: string;
  queuePosition: number;
  title: string;
  provider: string;
  model: string;
  createdBySessionId: string;
  parentSessionId: string | null;
  message: string;
}

type ChildDispatchResult = CreatedChildSessionResult | QueuedChildSessionResult;

export class MetaAgentService {
  private static instance: MetaAgentService | null = null;
  private starting: Promise<void> | null = null;
  private started = false;
  private serverPort: number | null = null;
  private aiService: AIService | null = null;
  private sessionManager: SessionManager | null = null;
  private unsubscribeStateListener: (() => void) | null = null;
  private notificationSignatures = new Map<string, string>();
  private interruptedChildSessionIds = new Set<string>();
  // A completion event arrives before its queued prompt leaves `executing`.
  // Remember that exact prompt so its stale row cannot reclaim a released slot.
  private releasedDispatchPromptIdsByHead = new Map<string, Map<string, Set<string>>>();
  private ipcHandlersRegistered = false;
  private readonly dispatchQueueStore = createPGLiteDispatchQueueStore();
  private readonly dispatchLocks = new Map<string, Promise<void>>();

  private constructor() {}

  public static getInstance(): MetaAgentService {
    if (!MetaAgentService.instance) {
      MetaAgentService.instance = new MetaAgentService();
    }
    return MetaAgentService.instance;
  }

  public getPort(): number | null {
    return this.serverPort;
  }

  public async recoverDispatchQueueOnBoot(): Promise<number> {
    return this.dispatchQueueStore.recoverDispatching();
  }

  public async interruptSession(
    metaSessionId: string,
    workspaceId: string,
    args: InterruptSessionArgs,
  ): Promise<string> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }
    if (!args?.sessionId?.trim()) {
      throw new Error('sessionId is required');
    }

    const queueAction = args.queueAction ?? 'pause';
    if (queueAction !== 'pause' && queueAction !== 'clear') {
      throw new Error('queueAction must be "pause" or "clear"');
    }

    const { rows } = await databaseWorker.query<TaskTreeSessionRow>(
      `SELECT id, created_by_session_id, status
       FROM ai_sessions
       WHERE workspace_id = $1
         AND (is_archived = FALSE OR is_archived IS NULL)`,
      [workspaceId]
    );
    const targetSessionId = args.sessionId.trim();
    const allowedSessionIds = new Set(collectDescendantSessionIds(rows, metaSessionId));
    if (!allowedSessionIds.has(targetSessionId)) {
      throw new Error(
        `Session ${targetSessionId} is not in the task tree created by Head Agent ${metaSessionId}`
      );
    }

    const targetIds = args.cascade
      ? [
          targetSessionId,
          ...collectDescendantSessionIds(rows, targetSessionId)
            .filter((sessionId) => allowedSessionIds.has(sessionId)),
        ]
      : [targetSessionId];
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const results: InterruptSessionNodeResult[] = [];
    for (const sessionId of targetIds) {
      const status = rowById.get(sessionId)?.status ?? 'idle';
      const wasActive = status === 'running' || status === 'waiting_for_input';
      if (wasActive) {
        // Mark the interrupt intent before aborting the provider. Its stream can
        // settle during stopSession and publish session:completed before the
        // canonical session:interrupted event reaches this service.
        this.interruptedChildSessionIds.add(sessionId);
      }
      const stopResult = await this.aiService.stopSession(sessionId, queueAction);
      const inactiveTransport =
        stopResult.error === 'No active provider for session'
        || stopResult.error === 'No active terminal for session';
      const outcome: InterruptSessionNodeResult['outcome'] = stopResult.success
        ? (wasActive ? 'interrupted' : 'already-ended')
        : (inactiveTransport ? 'already-ended' : 'failed');
      const nodeResult: InterruptSessionNodeResult = {
        sessionId,
        outcome,
        queue: stopResult.queue,
      };
      if (stopResult.paused !== undefined) {
        nodeResult.paused = stopResult.paused;
      }
      if (outcome === 'already-ended') {
        nodeResult.reason = stopResult.error || `Session was already ${status}`;
      } else if (outcome === 'failed') {
        nodeResult.reason = stopResult.error || 'Stop failed';
      }
      if (outcome !== 'interrupted') {
        this.interruptedChildSessionIds.delete(sessionId);
      } else {
        await AISessionsRepository.updateMetadata(sessionId, {
          metadata: { interruptedByHead: true },
        });
        this.broadcastSessionListRefresh(workspaceId, sessionId);
        try {
          await this.updateWorkOrderStatusForSession(
            sessionId,
            'interrupted',
            'Interrupted by Head Agent',
          );
        } catch (error) {
          console.error(`[MetaAgentService] Failed to update interrupted work-order for child ${sessionId}:`, error);
        }
      }
      results.push(nodeResult);
    }

    return JSON.stringify({
      success: results.every((result) => result.outcome !== 'failed'),
      cascade: args.cascade ?? false,
      queueAction,
      results,
    }, null, 2);
  }

  /** Stop a Head's active children and cancel slots before any release can refill them. */
  public async stopAndClearHeadSession(
    metaSessionId: string,
    workspaceId: string,
  ): Promise<{ success: boolean; stoppedChildren: number; clearedDispatches: number }> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }

    const { rows } = await databaseWorker.query<TaskTreeSessionRow>(
      `SELECT id, created_by_session_id, status
       FROM ai_sessions
       WHERE workspace_id = $1
         AND (is_archived = FALSE OR is_archived IS NULL)`,
      [workspaceId],
    );
    const childIds = collectDescendantSessionIds(rows, metaSessionId);
    const { rows: cancelledDispatches } = await databaseWorker.query<{ reserved_session_id: string }>(
      `UPDATE dispatch_queue
       SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE head_session_id = $1 AND status IN ('queued', 'dispatching')
       RETURNING reserved_session_id`,
      [metaSessionId],
    );
    await Promise.all(cancelledDispatches.map(async ({ reserved_session_id }) => {
      await AISessionsRepository.updateMetadata(reserved_session_id, {
        metadata: { dispatchQueued: false },
      });
      this.broadcastSessionListRefresh(workspaceId, reserved_session_id);
    }));

    const childResults = await Promise.all(childIds.map(async (sessionId) =>
      JSON.parse(await this.interruptSession(metaSessionId, workspaceId, {
        sessionId,
        queueAction: 'clear',
      })) as { success: boolean },
    ));
    const headResult = await this.aiService.stopSession(metaSessionId, 'clear');
    return {
      success: headResult.success && childResults.every((result) => result.success),
      stoppedChildren: childIds.length,
      clearedDispatches: cancelledDispatches.length,
    };
  }

  private shouldBypassChildAgentExecutionForTests(): boolean {
    return (
      process.env.PLAYWRIGHT === '1' ||
      process.env.PLAYWRIGHT_TEST === 'true' ||
      process.env.NODE_ENV === 'test'
    );
  }

  private async persistSyntheticInputMessage(sessionId: string, prompt: string): Promise<void> {
    await AgentMessagesRepository.create({
      sessionId,
      source: 'nimbalyst-meta-agent',
      direction: 'input',
      content: prompt,
      createdAt: new Date(),
      searchable: true,
    });
  }

  private async persistTextApprovalReminder(sessionId: string, workspacePath: string): Promise<void> {
    await AgentMessagesRepository.create({
      sessionId,
      source: 'nimbalyst-meta-agent',
      direction: 'input',
      content: `<SYSTEM_REMINDER>${TEXT_APPROVAL_REMINDER}</SYSTEM_REMINDER>`,
      createdAt: new Date(),
      searchable: false,
      metadata: {
        promptType: 'system_reminder',
        reminderKind: 'text_plan_approval',
        actionPrompt: TEXT_APPROVAL_CORRECTION,
      },
    });
    broadcastMessageLogged(sessionId, workspacePath);
  }

  private async handleHeadTurnCompleted(sessionId: string, workspacePath?: string): Promise<void> {
    const head = await AISessionsRepository.get(sessionId);
    if (!workspacePath || head?.agentRole !== 'meta-agent') return;
    const { rows } = await databaseWorker.query<{ direction: string; content: unknown }>(
      `SELECT direction, content FROM ai_agent_messages WHERE session_id = $1 ORDER BY created_at DESC, id DESC LIMIT 80`,
      [sessionId],
    );
    const turnRows: Array<{ direction: string; content: unknown }> = [];
    for (const row of rows) {
      if (row.direction === 'input') break;
      turnRows.push(row);
    }
    const submittedPlanThisTurn = turnRows.some((row) => {
      try {
        const value = typeof row.content === 'string' ? JSON.parse(row.content) : row.content as Record<string, unknown>;
        return value?.type === 'nimbalyst_tool_use' && value.name === 'ExitPlanMode' && !!(value.input as Record<string, unknown> | undefined)?.planId;
      } catch { return false; }
    });
    const finalText = turnRows
      .map((row) => extractMessageText(typeof row.content === 'string' ? row.content : JSON.stringify(row.content)))
      .find((text): text is string => !!text) ?? null;
    const { rows: approvedPlans } = await databaseWorker.query<{ id: string }>(
      `SELECT id FROM tracker_items WHERE workspace = $1 AND type = 'plan' AND source_ref = $2 AND data->>'status' = 'ready-for-development' LIMIT 1`,
      [workspacePath, `meta-agent-submitted-plan:${sessionId}`],
    );
    if (shouldShowTextApprovalGuard({ finalText, submittedPlanThisTurn, hasApprovedPlan: approvedPlans.length > 0 })) {
      await this.persistTextApprovalReminder(sessionId, workspacePath);
    }
  }

  private broadcastSessionListRefresh(workspacePath: string, sessionId: string): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('sessions:refresh-list', { workspacePath, sessionId });
      }
    }
  }

  private async clearInterruptedByHeadMarker(
    sessionId: string,
    workspacePath?: string,
  ): Promise<void> {
    const session = await AISessionsRepository.get(sessionId);
    if (session?.metadata?.interruptedByHead !== true) {
      return;
    }
    await AISessionsRepository.updateMetadata(sessionId, {
      metadata: { interruptedByHead: false },
    });
    const refreshWorkspacePath = workspacePath ?? session.workspacePath;
    if (refreshWorkspacePath) {
      this.broadcastSessionListRefresh(refreshWorkspacePath, sessionId);
    }
  }

  public async start(aiService: AIService): Promise<void> {
    if (this.started) {
      return;
    }

    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = (async () => {
      this.aiService = aiService;
      this.sessionManager = new SessionManager();
      await this.sessionManager.initialize();

      setMetaAgentToolFns({
        listWorktrees: (_metaSessionId, workspaceId) =>
          this.listWorktreesJson(workspaceId),
        submitPlan: (metaSessionId, workspaceId, args, signal, mcpCall) =>
          this.submitPlan(metaSessionId, workspaceId, args, signal, {
            requestId: mcpCall?.requestId,
            resolveOriginalMcpCall: mcpCall?.resolveOriginalMcpCall,
          }),
        createSession: (metaSessionId, workspaceId, args) =>
          this.createChildSession(metaSessionId, workspaceId, args),
        spawnSession: (callerSessionId, workspaceId, args) =>
          this.spawnSession(callerSessionId, workspaceId, args),
        getSessionStatus: (_metaSessionId, workspaceId, targetSessionId) =>
          this.getSessionStatusJson(targetSessionId, workspaceId),
        getSessionResult: (_metaSessionId, workspaceId, targetSessionId) =>
          this.getSessionResultJson(targetSessionId, workspaceId),
        sendPrompt: (_metaSessionId, workspaceId, targetSessionId, prompt) =>
          this.sendPromptToSession(targetSessionId, workspaceId, prompt),
        interruptSession: (metaSessionId, workspaceId, args) =>
          this.interruptSession(metaSessionId, workspaceId, args),
        respondToPrompt: (_metaSessionId, workspaceId, args) =>
          this.respondToPrompt(workspaceId, args),
        listSpawnedSessions: (metaSessionId, workspaceId) =>
          this.listSpawnedSessionsJson(metaSessionId, workspaceId),
      });

      const result = await startMetaAgentServer();
      this.serverPort = result.port;
      console.log(`[MetaAgentService] MCP server started on port ${result.port}`);

      ClaudeCodeProvider.setNativeHeadPlanApprovalHandler((request) =>
        this.handleNativeHeadPlanApproval(request),
      );
      ClaudeCodeProvider.setMetaAgentServerPort(result.port);
      OpenAICodexProvider.setMetaAgentServerPort(result.port);
      OpenAICodexACPProvider.setMetaAgentServerPort(result.port);
      ClaudeCliLauncherConfig.setMetaAgentServerPort(result.port);

      this.unsubscribeStateListener = getSessionStateManager().subscribe((event) => {
        // NIM-6 follow-up: dedup signatures only describe one turn; clear them
        // when a child becomes active again so two distinct turns whose final
        // text happens to match (e.g. "done", "ok") still each notify the
        // parent.
        if (event.type === 'session:started' || event.type === 'session:streaming') {
          this.notificationSignatures.delete(event.sessionId);
          this.interruptedChildSessionIds.delete(event.sessionId);
          // `interruptedChildSessionIds` only survives this process. Persist the
          // clear too, so a child that resumes after a reload no longer appears
          // interrupted in the session list or Kanban board.
          void this.clearInterruptedByHeadMarker(event.sessionId, event.workspacePath).catch((error) => {
            console.error(`[MetaAgentService] Failed to clear interrupted marker for child ${event.sessionId}:`, error);
          });
          this.clearReleasedDispatchPromptsForSession(event.sessionId);
          void this.updateWorkOrderStatusForSession(event.sessionId, 'running').catch((error) => {
            console.error(`[MetaAgentService] Failed to update running work-order for child ${event.sessionId}:`, error);
          });
          return;
        }
        if (event.type === 'session:completed' || event.type === 'session:error' || event.type === 'session:waiting' || event.type === 'session:interrupted') {
          if (event.type === 'session:completed') {
            void this.handleHeadTurnCompleted(event.sessionId, event.workspacePath).catch((error) => {
              console.error(`[MetaAgentService] Failed to check Head text approval request for ${event.sessionId}:`, error);
            });
          }
          void this.handleChildSessionEvent(event.sessionId, event.type);
        }
      });

      this.registerIpcHandlers();
      this.started = true;
      await this.drainAllDispatchQueues();
    })();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.unsubscribeStateListener?.();
    this.unsubscribeStateListener = null;
    this.notificationSignatures.clear();
    this.interruptedChildSessionIds.clear();
    this.releasedDispatchPromptIdsByHead.clear();
    await shutdownMetaAgentServer();
    ClaudeCodeProvider.setNativeHeadPlanApprovalHandler(null);
    ClaudeCodeProvider.setMetaAgentServerPort(null);
    OpenAICodexProvider.setMetaAgentServerPort(null);
    OpenAICodexACPProvider.setMetaAgentServerPort(null);
    ClaudeCliLauncherConfig.setMetaAgentServerPort(null);
    this.serverPort = null;
    this.started = false;
  }

  /**
   * Launch a sibling session in the same workstream from a user-triggered
   * action prompt (the Actions dropdown in the AI composer). This is the
   * non-MCP entry point: unlike `spawnSession` (called from the meta-agent
   * MCP server), this is invoked from a human IPC and returns a typed
   * result, not stringified JSON.
   *
   * Workstream/worktree/model resolution mirrors `spawnSession` exactly:
   * - sibling under the parent's workstream (creating the container if needed)
   * - inherit parent's worktree unless `useWorktree=true`
   * - explicit `model` wins; otherwise inherit caller's model
   *
   * When `autoSubmit=true` the prompt is queued and processing starts; when
   * `autoSubmit=false` the session is created with no queued prompt so the
   * renderer can prefill the draft input for the user to edit before sending.
   */
  public async launchActionSession(
    parentSessionId: string,
    workspaceId: string,
    args: {
      prompt: string;
      title?: string;
      model?: string;
      autoSubmit: boolean;
      useWorktree?: boolean;
    }
  ): Promise<{
    sessionId: string;
    workstreamId: string | null;
    worktreeId: string | null;
    promotedParent: boolean;
    queuedInitialPrompt: boolean;
  }> {
    if (!args?.prompt?.trim()) {
      throw new Error('prompt is required');
    }

    const parent = await AISessionsRepository.get(parentSessionId);
    if (!parent || parent.workspacePath !== workspaceId) {
      throw new Error(`Parent session ${parentSessionId} not found in this workspace`);
    }

    const resolved = await this.resolveOrCreateWorkstream(parent, workspaceId);
    const workstreamId = resolved.workstreamId;

    // Meta-agent children ALWAYS run in the parent's working directory (the
    // shared workspace), never a fresh isolated worktree. The parent synthesizes
    // by reading each child's written deliverable; a child that writes into its
    // own worktree leaves the parent unable to find the file. So we ignore the
    // requested useWorktree and inherit the parent's worktree (the main checkout
    // for a top-level meta-agent).
    const inheritedWorktreeId = parent.worktreeId ?? undefined;

    // Explicit model wins; otherwise inherit caller's model (e.g. keep "opus"
    // on "opus") rather than dropping to the global default.
    const effectiveModel = args.model ?? parent.model ?? undefined;

    // Pass prompt only when autoSubmit is true; createChildSessionInternal
    // queues + triggers only when a prompt is supplied. For prefill mode we
    // omit it so nothing runs until the user hits Send in the new session.
    const childResult = await this.createChildSessionInternal(parentSessionId, workspaceId, {
      title: args.title,
      prompt: args.autoSubmit ? args.prompt : undefined,
      useWorktree: false,
      worktreeId: inheritedWorktreeId,
      model: effectiveModel,
      parentSessionIdOverride: workstreamId,
    });

    // Always fire-and-forget for human-triggered launches — the user can
    // watch the new session themselves; no need to surface child-completion
    // notifications back to the originating session.
    await AISessionsRepository.updateMetadata(childResult.sessionId, {
      metadata: { notifyParent: false },
    });

    return {
      sessionId: childResult.sessionId,
      workstreamId,
      worktreeId: childResult.worktreeId ?? null,
      promotedParent: resolved.promotedParent,
      queuedInitialPrompt: childResult.queuedInitialPrompt,
    };
  }

  private registerIpcHandlers(): void {
    if (this.ipcHandlersRegistered) {
      return;
    }

    safeHandle('meta-agent:list-spawned-sessions', async (_event, metaSessionId: string, workspaceId: string) => {
      try {
        const sessions = await this.getSpawnedSessions(metaSessionId, workspaceId);
        return { success: true, sessions };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), sessions: [] };
      }
    });

    safeHandle('meta-agent:stop-and-clear', async (_event, metaSessionId: string, workspaceId: string) => {
      try {
        return await this.stopAndClearHeadSession(metaSessionId, workspaceId);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    if (process.env.PLAYWRIGHT === '1' || process.env.PLAYWRIGHT_TEST === 'true' || process.env.NODE_ENV === 'test') {
      safeHandle('meta-agent:get-server-port', async () => {
        return { success: true, port: this.serverPort };
      });
    }

    this.ipcHandlersRegistered = true;
  }

  private validateSessionIntent(intent: SessionIntent | undefined): asserts intent is SessionIntent {
    if (intent !== 'investigation' && intent !== 'implementation') {
      throw new Error(SESSION_INTENT_ERROR);
    }
  }

  private async assertDispatchAuthorized(
    workspaceId: string,
    args: { intent?: SessionIntent; planId?: string },
  ): Promise<void> {
    this.validateSessionIntent(args.intent);
    if (args.intent === 'investigation') {
      return;
    }

    const planId = args.planId?.trim();
    if (!planId) {
      throw new Error(IMPLEMENTATION_PLAN_APPROVAL_ERROR);
    }

    const { rows } = await databaseWorker.query<{ data: unknown }>(
      `SELECT data
       FROM tracker_items
       WHERE id = $1
         AND workspace = $2
         AND type = 'plan'
         AND (archived = FALSE OR archived IS NULL)
       LIMIT 1`,
      [planId, workspaceId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(IMPLEMENTATION_PLAN_APPROVAL_ERROR);
    }

    try {
      const data = typeof row.data === 'string'
        ? JSON.parse(row.data)
        : ((row.data as Record<string, unknown> | null) ?? {});
      if (data.status !== 'ready-for-development') {
        throw new Error(IMPLEMENTATION_PLAN_APPROVAL_ERROR);
      }
    } catch (error) {
      if (error instanceof Error && error.message === IMPLEMENTATION_PLAN_APPROVAL_ERROR) {
        throw error;
      }
      throw new Error(IMPLEMENTATION_PLAN_APPROVAL_ERROR);
    }
  }

  private validateEffortLevel(effortLevel: EffortLevel | undefined): void {
    if (effortLevel !== undefined && !VALID_EFFORT_LEVELS.has(effortLevel)) {
      throw new Error('effortLevel must be one of low, medium, high, xhigh, or max');
    }
  }

  private validateChildDispatchArgs(args: CreateChildSessionArgs): void {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }
    if (args.useWorktree && args.worktreeId) {
      throw new Error('useWorktree and worktreeId cannot be combined');
    }
    this.validateEffortLevel(args.effortLevel);

    const childUpdatePrefix = '[Child Session Update]';
    const promptHead = args.prompt?.trim() ?? '';
    const titleHead = args.title?.trim() ?? '';
    if (promptHead.startsWith(childUpdatePrefix) || titleHead.startsWith(childUpdatePrefix)) {
      throw new Error(
        'Refusing to spawn a child session from a child-completion notification ' +
        '(prompt/title begins with "[Child Session Update]").'
      );
    }
  }

  private async resolveChildRouting(
    metaSessionId: string,
    args: Pick<CreateChildSessionArgs, 'provider' | 'model'>,
  ): Promise<{ provider: AIProviderType; model: string }> {
    let parentProvider: string | null = null;
    let parentModel: string | null = null;
    try {
      const parentSession = await AISessionsRepository.get(metaSessionId);
      if (parentSession) {
        parentProvider = parentSession.provider ?? null;
        parentModel = normalizeStoredChildModelIdentifier(parentProvider, parentSession.model ?? null);
      }
    } catch {
      // Best-effort lookup; fall through to the configured default.
    }

    const defaultModel =
      parentModel
      || normalizeStoredChildModelIdentifier(null, getDefaultAIModel())
      || 'claude-code:opus';
    const explicitModelProvider =
      args.provider
      ?? (args.model?.includes(':') ? ModelIdentifier.tryParse(args.model)?.provider ?? null : null)
      ?? parentProvider;
    const explicitModel = normalizeStoredChildModelIdentifier(explicitModelProvider, args.model ?? null);
    const model = explicitModel || defaultModel;
    const parsed = ModelIdentifier.tryParse(model);
    const provider = (args.provider || parsed?.provider || parentProvider || 'claude-code') as AIProviderType;
    const parentModelProvider = parentModel
      ? (ModelIdentifier.tryParse(parentModel)?.provider ?? parentProvider)
      : null;
    const normalizedModel =
      explicitModel
      || (parentModel && parentModelProvider === provider ? parentModel : null)
      || ModelIdentifier.getDefaultModelId(provider);

    return { provider, model: normalizedModel };
  }

  private async getDispatchCounts(
    metaSessionId: string,
    workspaceId: string,
  ): Promise<{ inFlightCount: number; totalCount: number }> {
    // Queued dispatches now own a placeholder `ai_sessions` row from the moment
    // they are enqueued (so they are visible on the board). Those rows must not
    // affect capacity: a placeholder is not running, and counting it toward the
    // lifetime total would double-count it once the drain loop dispatches it
    // (`drainDispatchQueueForHead` adds `successfulDispatches` on top of the
    // baseline it read). Excluding every reserved session whose queue row has not
    // reached 'dispatched' keeps both numbers identical to the pre-placeholder
    // behaviour: a child counts exactly when it becomes a real dispatch.
    const releasedPromptIds = await this.getReleasedExecutingPromptIds(metaSessionId);
    // Pending work always occupies a slot. Only an `executing` row that has
    // already emitted its completion boundary is ignored until the child starts again.
    const unreleasedExecutingPredicate = releasedPromptIds.length > 0
      ? `AND prompts.id NOT IN (${releasedPromptIds.map((_, index) => `$${index + 3}`).join(', ')})`
      : '';
    const { rows } = await databaseWorker.query<{ in_flight: string; total: string }>(
      `SELECT
         SUM(
           CASE
             WHEN sessions.status = 'running' THEN 1
             WHEN COALESCE(sessions.status, 'idle') = 'idle'
               AND EXISTS (
                 SELECT 1
                 FROM queued_prompts prompts
                 WHERE prompts.session_id = sessions.id
                   AND (
                     prompts.status = 'pending'
                     OR (
                       prompts.status = 'executing'
                       ${unreleasedExecutingPredicate}
                     )
                   )
               )
             THEN 1
             ELSE 0
           END
         )::text AS in_flight,
         COUNT(*)::text AS total
       FROM ai_sessions sessions
       WHERE sessions.workspace_id = $1
         AND sessions.created_by_session_id = $2
         AND (sessions.is_archived = FALSE OR sessions.is_archived IS NULL)
         AND sessions.id NOT IN (
           SELECT reserved_session_id
           FROM dispatch_queue
           WHERE status <> 'dispatched'
             AND reserved_session_id IS NOT NULL
         )`,
      [workspaceId, metaSessionId, ...releasedPromptIds],
    );
    return {
      inFlightCount: Number(rows[0]?.in_flight ?? '0'),
      totalCount: Number(rows[0]?.total ?? '0'),
    };
  }

  private markDispatchPromptsReleased(
    metaSessionId: string,
    sessionId: string,
    promptIds: string[],
  ): void {
    if (promptIds.length === 0) {
      return;
    }
    let releasedPromptsBySession = this.releasedDispatchPromptIdsByHead.get(metaSessionId);
    if (!releasedPromptsBySession) {
      releasedPromptsBySession = new Map<string, Set<string>>();
      this.releasedDispatchPromptIdsByHead.set(metaSessionId, releasedPromptsBySession);
    }
    releasedPromptsBySession.set(sessionId, new Set(promptIds));
  }

  private async getReleasedExecutingPromptIds(metaSessionId: string): Promise<string[]> {
    const releasedPromptsBySession = this.releasedDispatchPromptIdsByHead.get(metaSessionId);
    if (!releasedPromptsBySession) {
      return [];
    }
    const markedPromptIds = Array.from(releasedPromptsBySession.values())
      .flatMap((promptIds) => [...promptIds]);
    if (markedPromptIds.length === 0) {
      this.releasedDispatchPromptIdsByHead.delete(metaSessionId);
      return [];
    }

    const { rows } = await databaseWorker.query<{ id: string }>(
      `SELECT id FROM queued_prompts
       WHERE status = 'executing'
         AND id IN (${markedPromptIds.map((_, index) => `$${index + 1}`).join(', ')})`,
      markedPromptIds,
    );
    const queriedPromptIds = new Set(markedPromptIds);
    const executingPromptIds = new Set(rows.map((row) => row.id));
    for (const [sessionId, promptIds] of releasedPromptsBySession) {
      for (const promptId of promptIds) {
        // A different completion can add a marker while the status query is
        // in flight. Never prune an ID that was not in this query snapshot.
        if (queriedPromptIds.has(promptId) && !executingPromptIds.has(promptId)) {
          promptIds.delete(promptId);
        }
      }
      if (promptIds.size === 0) {
        releasedPromptsBySession.delete(sessionId);
      }
    }
    if (
      releasedPromptsBySession.size === 0
      && this.releasedDispatchPromptIdsByHead.get(metaSessionId) === releasedPromptsBySession
    ) {
      this.releasedDispatchPromptIdsByHead.delete(metaSessionId);
    }
    return Array.from(
      this.releasedDispatchPromptIdsByHead.get(metaSessionId)?.values() ?? [],
    ).flatMap((promptIds) => [...promptIds]);
  }

  private clearReleasedDispatchPromptsForSession(sessionId: string): void {
    for (const [metaSessionId, releasedPromptsBySession] of this.releasedDispatchPromptIdsByHead) {
      releasedPromptsBySession.delete(sessionId);
      if (releasedPromptsBySession.size === 0) {
        this.releasedDispatchPromptIdsByHead.delete(metaSessionId);
      }
    }
  }

  private async withDispatchLock<T>(
    metaSessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.dispatchLocks.get(metaSessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const current = previous.catch(() => undefined).then(() => gate);
    this.dispatchLocks.set(metaSessionId, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.dispatchLocks.get(metaSessionId) === current) {
        this.dispatchLocks.delete(metaSessionId);
      }
    }
  }

  private async dispatchOrQueueChildSession(
    metaSessionId: string,
    workspaceId: string,
    args: InternalCreateChildSessionArgs,
    requestKind: DispatchRequestKind,
  ): Promise<ChildDispatchResult> {
    this.validateChildDispatchArgs(args);
    const routing = await this.resolveChildRouting(metaSessionId, args);
    const reservedSessionId = randomUUID();
    const preparedArgs: InternalCreateChildSessionArgs = {
      ...args,
      provider: routing.provider,
      model: routing.model,
      sessionIdOverride: reservedSessionId,
    };

    return this.withDispatchLock(metaSessionId, async () => {
      if (!(await this.dispatchQueueStore.hasQueued(metaSessionId))) {
        try {
          return await this.createChildSessionInternal(metaSessionId, workspaceId, preparedArgs);
        } catch (error) {
          if (!(error instanceof DispatchCapacityError)) {
            throw error;
          }
        }
      }

      return this.enqueueChildDispatch(
        metaSessionId,
        workspaceId,
        preparedArgs,
        requestKind,
      );
    });
  }

  private async enqueueChildDispatch(
    metaSessionId: string,
    workspaceId: string,
    args: InternalCreateChildSessionArgs,
    requestKind: DispatchRequestKind,
  ): Promise<QueuedChildSessionResult> {
    const sessionId = args.sessionIdOverride ?? randomUUID();
    const queueId = randomUUID();
    const requestedAt = new Date().toISOString();
    const title = (args.title || this.deriveTitleFromPrompt(args.prompt) || 'Meta Task').trim();
    const sourceRef = `meta-agent-work-order:${sessionId}`;
    const workOrderId = await this.createWorkOrderTrackerItem(
      workspaceId,
      sessionId,
      title,
      args.prompt?.trim(),
      args.intent ?? 'implementation',
      args.planId,
      {
        status: 'queued',
        sourceRef,
        dispatchedAt: requestedAt,
        linkSession: false,
      },
    );

    const snapshot: DispatchQueueRequestSnapshot = {
      requestKind,
      metaSessionId,
      workspaceId,
      args: {
        ...args,
        sessionIdOverride: sessionId,
        workOrderSourceRef: sourceRef,
      },
    };

    try {
      const { position } = await this.dispatchQueueStore.enqueue({
        id: queueId,
        headSessionId: metaSessionId,
        workspaceId,
        reservedSessionId: sessionId,
        requestSnapshot: snapshot,
        requestedAt,
        sourceRef,
      });
      await this.createQueuedPlaceholderSession(metaSessionId, workspaceId, args, sessionId, title, sourceRef);
      return {
        sessionId,
        status: 'queued',
        queued: true,
        queueId,
        queuePosition: position,
        title,
        provider: args.provider!,
        model: args.model!,
        createdBySessionId: metaSessionId,
        parentSessionId: args.parentSessionIdOverride ?? null,
        message: `Dispatch queued at position ${position}; it will start automatically when a Head Agent slot opens.`,
      };
    } catch (error) {
      await databaseWorker.query(`DELETE FROM tracker_items WHERE id = $1`, [workOrderId]).catch(() => undefined);
      this.emitTrackerItemsChanged();
      throw error;
    }
  }

  /**
   * Give a queued dispatch a real `ai_sessions` row up front, so it is visible in
   * Delegated Sessions and on the board while it waits for a slot. Without this a
   * queued item exists only in `dispatch_queue` and in a tracker card, so the
   * operator sees nothing between "queued" and "started".
   *
   * The row is a placeholder: `metadata.dispatchQueued` marks it, and
   * `getDispatchCounts` excludes it from both capacity numbers until the queue row
   * reaches 'dispatched'. `dispatchClaimedQueueItem` then reuses this exact row via
   * its existing-session branch, so nothing is created twice.
   *
   * Best-effort: the dispatch is already durably queued, and auto-resume falls back
   * to creating the session itself, so a failure here must not fail the enqueue.
   */
  private async createQueuedPlaceholderSession(
    metaSessionId: string,
    workspaceId: string,
    args: InternalCreateChildSessionArgs,
    sessionId: string,
    title: string,
    sourceRef: string,
  ): Promise<void> {
    try {
      await AISessionsRepository.create({
        id: sessionId,
        provider: args.provider!,
        model: args.model!,
        title,
        workspaceId,
        agentRole: 'standard',
        createdBySessionId: metaSessionId,
        parentSessionId: args.parentSessionIdOverride ?? null,
        hasBeenNamed: !!args.title?.trim(),
      } as any);
      await AISessionsRepository.updateMetadata(sessionId, { metadata: { dispatchQueued: true } });
      await this.applyChildSessionMetadata(sessionId, args);
      await this.linkQueuedWorkOrderToPlaceholder(sourceRef, sessionId);

      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('sessions:refresh-list', { workspacePath: workspaceId, sessionId });
        }
      }
    } catch (error) {
      console.error(`[MetaAgentService] Failed to create queued placeholder session ${sessionId}:`, error);
    }
  }

  /**
   * Link the already-created queued work-order card to its placeholder session
   * WITHOUT promoting the card out of 'queued' — that promotion belongs to
   * `attachQueuedWorkOrderToSession`, which runs when the item is really dispatched.
   */
  private async linkQueuedWorkOrderToPlaceholder(sourceRef: string, sessionId: string): Promise<void> {
    const { rows } = await databaseWorker.query<{ id: string; data: unknown }>(
      `SELECT id, data
       FROM tracker_items
       WHERE type = 'work-order' AND source_ref = $1
       LIMIT 1`,
      [sourceRef],
    );
    const row = rows[0];
    if (!row) return;
    const data = typeof row.data === 'string'
      ? JSON.parse(row.data)
      : ((row.data as Record<string, unknown> | null) ?? {});
    data.childSessionId = sessionId;
    await databaseWorker.query(
      `UPDATE tracker_items SET data = $1, updated = NOW() WHERE id = $2`,
      [JSON.stringify(data), row.id],
    );
    await createBidirectionalLink(row.id, sessionId);
    this.emitTrackerItemsChanged();
  }

  /** Reflect a permanently failed queue item on its placeholder session. */
  private async markPlaceholderSessionFailed(sessionId: string): Promise<void> {
    try {
      await databaseWorker.query(
        `UPDATE ai_sessions SET status = 'error' WHERE id = $1`,
        [sessionId],
      );
      await AISessionsRepository.updateMetadata(sessionId, { metadata: { dispatchQueued: false } });
    } catch (error) {
      console.error(`[MetaAgentService] Failed to mark placeholder session ${sessionId} failed:`, error);
    }
  }

  private async drainAllDispatchQueues(): Promise<void> {
    try {
      const headSessionIds = await this.dispatchQueueStore.listQueuedHeadSessionIds();
      for (const headSessionId of headSessionIds) {
        if (!headSessionId) continue;
        await this.drainDispatchQueueForHead(headSessionId);
      }
    } catch (error) {
      console.error('[MetaAgentService] Failed to drain persisted dispatch queues:', error);
    }
  }

  private async drainDispatchQueueForHead(metaSessionId: string): Promise<void> {
    await this.withDispatchLock(metaSessionId, async () => {
      let baselineInFlight: number | null = null;
      let baselineTotal = 0;
      let successfulDispatches = 0;

      while (true) {
        const item = await this.dispatchQueueStore.claimNext(metaSessionId);
        if (!item) return;

        if (baselineInFlight === null) {
          const counts = await this.getDispatchCounts(metaSessionId, item.workspaceId);
          baselineInFlight = counts.inFlightCount;
          baselineTotal = counts.totalCount;
        }

        const args = item.requestSnapshot.args as InternalCreateChildSessionArgs;
        const maxParallel = getEffectiveMaxParallel(args.maxParallelOverride);
        if (baselineInFlight + successfulDispatches >= maxParallel) {
          await this.dispatchQueueStore.requeue(item.id);
          return;
        }

        try {
          if (baselineTotal + successfulDispatches >= LIFETIME_BACKSTOP) {
            throw new Error(
              `Meta-agent lifetime spawn backstop reached (${LIFETIME_BACKSTOP} total children spawned by this parent); refusing to spawn more`,
            );
          }
          await this.dispatchClaimedQueueItem(item);
          successfulDispatches += 1;
        } catch (error) {
          if (error instanceof DispatchCapacityError) {
            await this.dispatchQueueStore.requeue(item.id);
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          await this.dispatchQueueStore.markFailed(item.id, message);
          await this.updateWorkOrderStatusBySourceRef(item.sourceRef, 'failed').catch((cardError) => {
            console.error(`[MetaAgentService] Failed to mark queued work-order ${item.sourceRef} failed:`, cardError);
          });
          await this.markPlaceholderSessionFailed(item.reservedSessionId);
          await this.notifyHeadOfDispatchFailure(item, message);
        }
      }
    });
  }

  private async dispatchClaimedQueueItem(item: DispatchQueueItem): Promise<void> {
    const args = item.requestSnapshot.args as InternalCreateChildSessionArgs;
    const existing = await AISessionsRepository.get(item.reservedSessionId);
    // A queued item always has a placeholder row now, so "row exists" alone no
    // longer means "this session was already fully created". Only a genuinely
    // recovered session (one that got past createChildSessionInternal before a
    // crash) may take the shortcut below — a placeholder must still go through
    // full creation, or it would silently skip worktree setup and the initial
    // prompt. `AISessionsRepository.create` upserts, so it adopts the placeholder
    // row rather than conflicting with it.
    const isQueuedPlaceholder = existing?.metadata?.dispatchQueued === true;
    if (existing && !isQueuedPlaceholder) {
      await this.applyChildSessionMetadata(item.reservedSessionId, args);
      await this.attachQueuedWorkOrderToSession(item.sourceRef, item.reservedSessionId);
      await this.ensureRecoveredInitialPrompt(item, args, existing.worktreeId);
      await this.dispatchQueueStore.markDispatched(item.id, item.reservedSessionId);
      return;
    }

    const child = await this.createChildSessionInternal(
      item.requestSnapshot.metaSessionId,
      item.requestSnapshot.workspaceId,
      {
        ...args,
        sessionIdOverride: item.reservedSessionId,
        workOrderSourceRef: item.sourceRef,
      },
    );
    await this.dispatchQueueStore.markDispatched(item.id, child.sessionId);
  }

  private async ensureRecoveredInitialPrompt(
    item: DispatchQueueItem,
    args: InternalCreateChildSessionArgs,
    worktreeId?: string | null,
  ): Promise<void> {
    const initialPrompt = args.prompt?.trim();
    if (!initialPrompt || !this.aiService) return;

    if (this.shouldBypassChildAgentExecutionForTests()) {
      const { rows } = await databaseWorker.query<{ count: number | string }>(
        `SELECT COUNT(*) AS count
         FROM ai_agent_messages
         WHERE session_id = $1 AND direction = 'input' AND content = $2`,
        [item.reservedSessionId, initialPrompt],
      );
      if (Number(rows[0]?.count ?? 0) === 0) {
        await this.persistSyntheticInputMessage(item.reservedSessionId, initialPrompt);
      }
      return;
    }

    const { rows } = await databaseWorker.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM queued_prompts
       WHERE session_id = $1 AND prompt = $2`,
      [item.reservedSessionId, initialPrompt],
    );
    if (Number(rows[0]?.count ?? '0') === 0) {
      await this.aiService.queuePromptForSession(item.reservedSessionId, initialPrompt);
    }
    let executionPath = item.workspaceId;
    const db = getDatabase();
    if (worktreeId && db) {
      const worktree = await createWorktreeStore(db).get(worktreeId);
      if (worktree?.path) executionPath = worktree.path;
    }
    await this.aiService.triggerQueuedPromptProcessingForSession(item.reservedSessionId, executionPath);
  }

  private async notifyHeadOfDispatchFailure(
    item: DispatchQueueItem,
    errorMessage: string,
  ): Promise<void> {
    if (!this.aiService) return;
    const title = typeof item.requestSnapshot.args.title === 'string'
      ? item.requestSnapshot.args.title
      : 'Queued child session';
    const notification = [
      '[Dispatch Queue Update]',
      `Dispatch queue item ${item.id} failed.`,
      `Task: ${title}`,
      `Reserved session: ${item.reservedSessionId}`,
      `Error: ${errorMessage}`,
      'The next queued item will still be attempted automatically.',
    ].join('\n');
    try {
      await this.aiService.queuePromptForSession(
        item.headSessionId,
        notification,
        undefined,
        undefined,
        'child_session_event',
      );
      const headStatus = await this.getSessionStatusRow(item.headSessionId, item.workspaceId);
      if (headStatus?.status === 'idle' || headStatus?.status === 'interrupted' || headStatus?.status === 'error') {
        await this.aiService.triggerQueuedPromptProcessingForSession(item.headSessionId, item.workspaceId);
      }
    } catch (error) {
      console.error(`[MetaAgentService] Failed to notify Head about dispatch queue item ${item.id}:`, error);
    }
  }

  private async handleNativeHeadPlanApproval(
    request: NativeHeadPlanApprovalRequest,
  ): Promise<NativeHeadPlanApprovalResult | null> {
    const metaSession = await AISessionsRepository.get(request.sessionId);
    if (
      !metaSession
      || metaSession.agentRole !== 'meta-agent'
      || !metaSession.workspacePath
    ) {
      return null;
    }

    const result = JSON.parse(await this.submitPlan(
      request.sessionId,
      metaSession.workspacePath,
      buildNativeHeadPlanArgs(request.planSummary, request.planFilePath),
      request.signal,
      {
        requestId: request.requestId,
        planFilePath: request.planFilePath,
        planSummary: request.planSummary,
      },
    )) as Record<string, unknown>;
    if (typeof result.planId !== 'string' || !result.planId.trim()) {
      throw new Error(`Native Head plan approval ${request.requestId} completed without a planId`);
    }

    return {
      approved: result.approved === true,
      planId: result.planId,
      feedback: typeof result.feedback === 'string' ? result.feedback : undefined,
      deliveryMethod: result.deliveryMethod === 'revive' ? 'revive' : 'direct',
    };
  }

  private async waitForPlanApprovalResponse(
    sessionId: string,
    requestId: string,
    planId?: string,
  ): Promise<PlanApprovalResponse> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }
    const pollStartedAt = Date.now();
    console.info(
      `[MetaAgentService] Durable plan approval waiter registered: requestId=${requestId}, sessionId=${sessionId}, planId=${planId ?? 'none'}`,
    );

    while (Date.now() - pollStartedAt <= PLAN_APPROVAL_MAX_POLL_TIME_MS) {
      if (planId) {
        await this.assertCurrentPlanApprovalRequest(planId, requestId);
      }
      const state = await this.aiService.getPlanApprovalState(sessionId, requestId);
      if (state && state.status !== 'submitted' && state.decision) {
        if (planId) {
          await this.assertCurrentPlanApprovalRequest(planId, requestId);
        }
        console.info(
          `[MetaAgentService] Durable plan approval response matched: requestId=${requestId}, approved=${state.decision === 'approved'}, planId=${planId ?? 'none'}`,
        );
        return {
          approved: state.decision === 'approved',
          decision: state.decision,
          feedback: state.feedback,
          respondedAt: state.respondedAt,
          respondedBy: state.respondedBy,
        };
      }
      const elapsedMs = Date.now() - pollStartedAt;
      const pollIntervalMs = elapsedMs < PLAN_APPROVAL_FAST_POLL_WINDOW_MS
        ? PLAN_APPROVAL_FAST_POLL_INTERVAL_MS
        : PLAN_APPROVAL_SLOW_POLL_INTERVAL_MS;
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    console.warn(
      `[MetaAgentService] Durable plan approval waiter removed: requestId=${requestId}, reason=timeout, planId=${planId ?? 'none'}`,
    );
    throw new Error('Timed out waiting for plan approval response');
  }

  private async assertCurrentPlanApprovalRequest(planId: string, requestId: string): Promise<void> {
    const { rows } = await databaseWorker.query<{ data: unknown }>(
      `SELECT data
       FROM tracker_items
       WHERE id = $1
       LIMIT 1`,
      [planId],
    );
    const row = rows[0];
    let approvalPromptId: unknown;
    try {
      const data = typeof row?.data === 'string'
        ? JSON.parse(row.data)
        : ((row?.data as Record<string, unknown> | null | undefined) ?? {});
      approvalPromptId = data.approvalPromptId;
    } catch {
      approvalPromptId = undefined;
    }

    if (approvalPromptId !== requestId) {
      console.warn(
        `[MetaAgentService] Durable plan approval waiter removed: requestId=${requestId}, reason=superseded, planId=${planId}`,
      );
      throw new PlanApprovalSupersededError(planId, requestId);
    }
  }

  private notifyTrackerItemsChanged(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('document-service:tracker-items-changed', {
          added: [],
          updated: [],
          removed: [],
          timestamp: new Date(),
        });
      }
    }
  }

  private buildPlanApprovalContinuation(
    planId: string,
    response: PlanApprovalResponse,
  ): string {
    if (response.approved) {
      return [
        '[Plan approval response]',
        `The user approved plan ${planId}.`,
        'The original approval tool turn ended. Continue with the approved implementation now; do not submit the same plan again.',
      ].join('\n');
    }
    return [
      '[Plan approval response]',
      response.decision === 'dismissed'
        ? `The user dismissed plan ${planId}.`
        : `The user requested changes to plan ${planId}.`,
      ...(response.feedback ? [`Feedback: ${response.feedback}`] : []),
      'The original approval tool turn ended. Prepare a revised plan and submit a new approval card; do not dispatch implementation yet.',
    ].join('\n');
  }

  private async deliverPlanApprovalResponse(
    metaSessionId: string,
    workspaceId: string,
    planId: string,
    requestId: string,
    response: PlanApprovalResponse,
    requestedMethod: PlanApprovalDeliveryMethod,
    directMcpResult?: string,
    resolveOriginalMcpCall?: (result: string) => boolean | Promise<boolean>,
  ): Promise<PlanApprovalDeliveryMethod> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }
    let deliveryState = await this.aiService.getPlanApprovalState(metaSessionId, requestId);
    if (!deliveryState || deliveryState.status === 'submitted') {
      throw new Error(`Plan approval ${requestId} has not been responded to`);
    }
    let deliveryMethod = requestedMethod;
    if (
      deliveryState.status === 'responded'
      && deliveryMethod === 'direct'
      && resolveOriginalMcpCall
    ) {
      let originalMcpCallReceived = false;
      try {
        originalMcpCallReceived = directMcpResult
          ? await resolveOriginalMcpCall(directMcpResult)
          : false;
      } catch (error) {
        console.warn(
          '[MetaAgentService] Original MCP plan approval response failed: requestId=' + requestId,
          error,
        );
      }
      if (!originalMcpCallReceived) {
        // The original Claude MCP request has already gone away. Its
        // transcript-only direct delivery would be invisible to that engine,
        // so revive the session instead of falsely recording a direct delivery.
        deliveryMethod = 'revive';
        console.info(
          '[MetaAgentService] Plan approval direct response unavailable; falling back to revive: requestId=' + requestId,
        );
      }
    }
    if (deliveryState.status === 'responded' && deliveryMethod === 'revive') {
      await this.sendPromptToSession(
        metaSessionId,
        workspaceId,
        this.buildPlanApprovalContinuation(planId, response),
        {
          forceProcessing: true,
          origin: 'child_session_event',
          idempotencyKey: `plan-approval-revive-${requestId}`,
          bypassExecutionForTests: false,
        },
      );
    }
    if (deliveryState.status === 'responded') {
      deliveryState = await this.aiService.markPlanApprovalDelivered(
        metaSessionId,
        requestId,
        deliveryMethod,
      );
      console.info(
        `[MetaAgentService] Plan approval transition: requestId=${requestId}, from=responded, to=delivered, method=${deliveryState.deliveryMethod ?? deliveryMethod}`,
      );
    }
    const method = deliveryState.deliveryMethod ?? deliveryMethod;
    if (deliveryState.status !== 'closed') {
      await persistInteractivePromptToolResult({
        sessionId: metaSessionId,
        toolUseId: requestId,
        result: response.approved
          ? { approved: true, planId, status: 'approved' }
          : {
              approved: false,
              planId,
              status: 'continue planning',
              feedback: response.feedback,
            },
      });
      const closedState = await this.aiService.getPlanApprovalState(metaSessionId, requestId);
      if (closedState?.status !== 'closed') {
        throw new Error(`Failed to close plan approval ${requestId}`);
      }
      console.info(
        `[MetaAgentService] Plan approval transition: requestId=${requestId}, from=delivered, to=closed, method=${method}`,
      );
      broadcastMessageLogged(metaSessionId, workspaceId);
    }
    return method;
  }

  private async submitPlan(
    metaSessionId: string,
    workspaceId: string,
    args: SubmitPlanArgs,
    signal?: AbortSignal,
    options: PlanSubmissionOptions = {},
  ): Promise<string> {
    const title = args?.title?.trim();
    const risks = args?.risks?.trim();
    const planItems = Array.isArray(args?.planItems)
      ? args.planItems.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
      : [];
    if (!title) {
      throw new Error('title is required');
    }
    if (planItems.length === 0 || planItems.length !== args.planItems.length) {
      throw new Error('planItems must be a non-empty list of non-empty strings');
    }
    if (!Number.isInteger(args.workOrderCount) || args.workOrderCount < 0) {
      throw new Error('workOrderCount must be a non-negative integer');
    }
    if (!risks) {
      throw new Error('risks is required');
    }

    const metaSession = await AISessionsRepository.get(metaSessionId);
    if (!metaSession || metaSession.workspacePath !== workspaceId) {
      throw new Error(`Head session ${metaSessionId} not found in this workspace`);
    }

    const sourceRef = `meta-agent-submitted-plan:${metaSessionId}`;
    const { rows: existingRows } = await databaseWorker.query<{ id: string; data: unknown }>(
      `SELECT id, data
       FROM tracker_items
       WHERE workspace = $1
         AND type = 'plan'
         AND source_ref = $2
         AND (archived = FALSE OR archived IS NULL)
       LIMIT 1`,
      [workspaceId, sourceRef],
    );
    const existing = existingRows[0];
    const planId = existing?.id ?? randomUUID();
    const requestId = options.requestId ?? randomUUID();
    let priorData: Record<string, unknown> = {};
    if (existing?.data) {
      try {
        priorData = typeof existing.data === 'string'
          ? JSON.parse(existing.data)
          : ((existing.data as Record<string, unknown> | null) ?? {});
      } catch {
        priorData = {};
      }
    }
    const submittedAt = new Date().toISOString();
    const planData: Record<string, unknown> = {
      ...priorData,
      title,
      status: 'in-review',
      planItems,
      workOrderCount: args.workOrderCount,
      risks,
      submittedBySessionId: metaSessionId,
      approvalPromptId: requestId,
      submittedAt,
      tags: ['meta-agent', 'user-approval'],
    };
    delete planData.approvedAt;
    delete planData.lastReviewFeedback;

    if (existing) {
      await databaseWorker.query(
        `UPDATE tracker_items
         SET data = $1, content = $2, updated = NOW(), last_indexed = NOW()
         WHERE id = $3`,
        [JSON.stringify(planData), JSON.stringify({ planItems, workOrderCount: args.workOrderCount, risks }), planId],
      );
    } else {
      await databaseWorker.query(
        `INSERT INTO tracker_items (
          id, type, type_tags, data, workspace, document_path, line_number,
          created, updated, last_indexed, sync_status,
          content, archived, source, source_ref
        ) VALUES ($1, 'plan', $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'pending', $5, FALSE, 'meta-agent', $6)`,
        [
          planId,
          ['plan'],
          JSON.stringify(planData),
          workspaceId,
          JSON.stringify({ planItems, workOrderCount: args.workOrderCount, risks }),
          sourceRef,
        ],
      );
    }
    this.notifyTrackerItemsChanged();

    await persistInteractivePromptToolUse({
      sessionId: metaSessionId,
      toolUseId: requestId,
      toolName: 'ExitPlanMode',
      input: {
        planFilePath: options.planFilePath ?? '',
        allowedPrompts: [],
        planId,
        title,
        planItems,
        workOrderCount: args.workOrderCount,
        risks,
        ...(options.planSummary?.trim() ? { planSummary: options.planSummary.trim() } : {}),
      },
    });

    const { rows: promptRows } = await databaseWorker.query<{ content: unknown }>(
      `SELECT content
       FROM ai_agent_messages
       WHERE session_id = $1
         AND content LIKE '%"type":"nimbalyst_tool_use"%'
         AND content LIKE $2
       ORDER BY id DESC
       LIMIT 20`,
      [metaSessionId, `%"id":"${requestId}"%`],
    );
    const promptWasPersisted = promptRows.some((row) => {
      try {
        const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
        return content.type === 'nimbalyst_tool_use'
          && content.name === 'ExitPlanMode'
          && content.id === requestId;
      } catch {
        return false;
      }
    });
    if (!promptWasPersisted) {
      throw new Error('Failed to persist plan approval prompt');
    }
    console.info(
      `[MetaAgentService] Plan approval transition: requestId=${requestId}, from=none, to=submitted`,
    );

    const autoApproved = store.get('metaAgentPlanAutoApprove') === true;
    if (autoApproved) {
      const aiService = this.aiService;
      if (!aiService) throw new Error('AI service not initialized');
      const delivery = await aiService.respondToInteractivePrompt({
        sessionId: metaSessionId,
        promptId: requestId,
        promptType: 'exit_plan_mode_request',
        response: { approved: true },
        respondedBy: 'desktop',
      });
      if (!delivery.success) throw new Error(delivery.error ?? 'Failed to auto-approve plan');
      console.info(
        `[MetaAgentService] Plan approval transition: requestId=${requestId}, from=submitted, to=responded, autoApproved=true`,
      );
    }

    const response = await this.waitForPlanApprovalResponse(metaSessionId, requestId, planId);
    const finalStatus = response.approved ? 'ready-for-development' : 'in-review';
    const finalData: Record<string, unknown> = {
      ...planData,
      status: finalStatus,
      ...(autoApproved ? { autoApproved: true } : {}),
    };
    if (response.approved) {
      finalData.approvedAt = new Date(response.respondedAt ?? Date.now()).toISOString();
      delete finalData.lastReviewFeedback;
    } else if (response.feedback) {
      finalData.lastReviewFeedback = response.feedback;
    }
    const { rows: finalizedRows } = await databaseWorker.query<{ id: string }>(
      `UPDATE tracker_items
       SET data = $1, updated = NOW(), last_indexed = NOW()
       WHERE id = $2
         AND data->>'approvalPromptId' = $3
       RETURNING id`,
      [JSON.stringify(finalData), planId, requestId],
    );
    if (finalizedRows.length === 0) {
      console.warn(
        `[MetaAgentService] Ignored stale plan approval response for plan ${planId}; request ${requestId} no longer matches approvalPromptId.`,
      );
      throw new PlanApprovalSupersededError(planId, requestId);
    }
    this.notifyTrackerItemsChanged();

    const resolveClaudeOriginalMcpCall = (
      metaSession.provider === 'claude-code' || metaSession.provider === 'claude-code-cli'
    )
      ? options.resolveOriginalMcpCall
      : undefined;
    const serializeMcpResult = (deliveryMethod: PlanApprovalDeliveryMethod) => JSON.stringify({
      planId,
      approved: response.approved,
      status: finalStatus,
      deliveryMethod,
      ...(autoApproved ? { autoApproved: true } : {}),
      ...(response.feedback ? { feedback: response.feedback } : {}),
    }, null, 2);
    const directMcpResult = serializeMcpResult('direct');
    const deliveryMethod = await this.deliverPlanApprovalResponse(
      metaSessionId,
      workspaceId,
      planId,
      requestId,
      response,
      signal?.aborted ? 'revive' : 'direct',
      directMcpResult,
      resolveClaudeOriginalMcpCall,
    );

    return deliveryMethod === 'direct'
      ? directMcpResult
      : serializeMcpResult(deliveryMethod);
  }

  private async createChildSession(
    metaSessionId: string,
    workspaceId: string,
    args: CreateChildSessionArgs
  ): Promise<string> {
    await this.assertDispatchAuthorized(workspaceId, args);
    const result = await this.dispatchOrQueueChildSession(
      metaSessionId,
      workspaceId,
      args,
      'create_session',
    );
    return JSON.stringify(result, null, 2);
  }

  private async createChildSessionInternal(
    metaSessionId: string,
    workspaceId: string,
    args: InternalCreateChildSessionArgs,
  ): Promise<CreatedChildSessionResult> {
    this.validateChildDispatchArgs(args);
    const aiService = this.aiService;
    if (!aiService) {
      throw new Error('AI service not initialized');
    }

    // Inherit the calling session's provider+model as the primary fallback so a
    // non-Claude parent (Gemini, OpenAI-Codex, LM Studio, etc.) spawning a child
    // via the meta-agent tools without an explicit model does NOT silently land
    // on the hardcoded Opus default and bill the user's Anthropic pool. Only fall
    // through to getDefaultAIModel() / the last-resort default when the parent
    // session cannot be loaded (orphan call) or carries no usable provider+model.
    // An explicit args.provider/args.model still wins; that is what they are for.
    const { provider, model: normalizedModel } = await this.resolveChildRouting(metaSessionId, args);

    const callerProvidedTitle = !!args.title?.trim();
    const title = (args.title || this.deriveTitleFromPrompt(args.prompt) || 'Meta Task').trim();

    // Capacity is checked before any worktree or session side effect. Public
    // Head Agent dispatches catch this typed signal and persist the request;
    // non-MCP callers retain the existing rejection behavior.
    const maxParallel = getEffectiveMaxParallel(args.maxParallelOverride);
    const { inFlightCount, totalCount } = await this.getDispatchCounts(metaSessionId, workspaceId);
    if (inFlightCount >= maxParallel) {
      throw new DispatchCapacityError(inFlightCount, maxParallel);
    }
    if (totalCount >= LIFETIME_BACKSTOP) {
      throw new Error(
        `Meta-agent lifetime spawn backstop reached (${LIFETIME_BACKSTOP} total children spawned by this parent); refusing to spawn more`
      );
    }

    let worktreeId: string | null = null;
    let worktreePath: string | null = null;

    const db = getDatabase();
    if ((args.useWorktree || args.worktreeId) && !db) {
      throw new Error('Database not initialized');
    }
    const worktreeStore = db ? createWorktreeStore(db) : null;

    if (args.worktreeId) {
      if (!worktreeStore) {
        throw new Error('Worktree store not initialized');
      }

      const existingWorktree = await worktreeStore.get(args.worktreeId);
      if (!existingWorktree) {
        throw new Error(`Worktree ${args.worktreeId} not found`);
      }
      if (existingWorktree.projectPath !== workspaceId) {
        throw new Error(`Worktree ${args.worktreeId} does not belong to this workspace`);
      }
      if (existingWorktree.isArchived) {
        throw new Error(`Worktree ${args.worktreeId} is archived`);
      }

      worktreeId = existingWorktree.id;
      worktreePath = existingWorktree.path;
    } else if (args.useWorktree) {
      if (!worktreeStore) {
        throw new Error('Worktree store not initialized');
      }

      const gitWorktreeService = new GitWorktreeService();
      const [dbNames, filesystemNames, branchNames] = await Promise.all([
        worktreeStore.getAllNames(),
        Promise.resolve(gitWorktreeService.getExistingWorktreeDirectories(workspaceId)),
        gitWorktreeService.getAllBranchNames(workspaceId),
      ]);
      const existingNames = new Set<string>();
      for (const name of dbNames) existingNames.add(name);
      for (const name of filesystemNames) existingNames.add(name);
      for (const name of branchNames) existingNames.add(name);
      const finalName = gitWorktreeService.generateUniqueWorktreeName(existingNames);
      const worktree = await gitWorktreeService.createWorktree(workspaceId, { name: finalName });
      await worktreeStore.create(worktree);
      gitRefWatcher.start(worktree.path).catch((error: Error) => {
        console.error('[MetaAgentService] Failed to start GitRefWatcher for meta-agent worktree:', error);
      });
      worktreeId = worktree.id;
      worktreePath = worktree.path;
    }

    // NIM-858: do NOT auto-promote the spawning parent to agent_role='meta-agent'.
    // The renderer META AGENT group is reserved for genuine meta-agents (created
    // via the Meta Agent button, which sets agentRole='meta-agent' at create
    // time) and their children. A standard session that spawns a sibling — via
    // the Actions-dropdown launch (launchActionSession) or the spawn_session MCP
    // tool used by /launch-new-session — must stay agentRole='standard' so it and
    // its sibling render flat (as workstream siblings), not under Meta Agent.
    //
    // A prior promotion block here claimed to be "inert" because spawn tools were
    // gated on agentRole==='meta-agent'. That gating only covers the extension-
    // agent (Gemini) branch in MessageStreamingHandler; the nimbalyst-meta-agent
    // MCP server is attached to every built-in session unconditionally
    // (McpConfigService), and launchActionSession passes a standard parent — so
    // the block actually fired and wrongly relabeled standard parents.

    const sessionId = args.sessionIdOverride ?? randomUUID();
    await AISessionsRepository.create({
      id: sessionId,
      provider,
      model: normalizedModel,
      title,
      workspaceId,
      worktreeId: worktreeId ?? undefined,
      agentRole: 'standard',
      createdBySessionId: metaSessionId,
      parentSessionId: args.parentSessionIdOverride ?? null,
      // When the meta-agent (or any caller of spawn_session) supplies an
      // explicit title, treat the session as already named so the out-of-band
      // SDK title generator (see ClaudeCodeProvider.runTitleGeneration) does
      // not clobber it via updateTitleIfNotNamed.
      hasBeenNamed: callerProvidedTitle,
    } as any);

    await this.applyChildSessionMetadata(sessionId, args);

    const initialPrompt = args.prompt?.trim();
    try {
      if (args.workOrderSourceRef) {
        await this.attachQueuedWorkOrderToSession(args.workOrderSourceRef, sessionId);
      } else {
        await this.createWorkOrderTrackerItem(
          workspaceId,
          sessionId,
          title,
          initialPrompt,
          args.intent ?? 'implementation',
          args.planId,
        );
      }
    } catch (error) {
      // Dispatch is the primary operation. A missing card can be repaired later,
      // so tracker persistence/link failures must not strand the child session.
      console.error(`[MetaAgentService] Failed to create work-order for child ${sessionId}:`, error);
    }
    const shouldBypassExecution = this.shouldBypassChildAgentExecutionForTests();

    if (initialPrompt) {
      if (shouldBypassExecution) {
        await this.persistSyntheticInputMessage(sessionId, initialPrompt);
      } else {
        await aiService.queuePromptForSession(sessionId, initialPrompt);
      }
    }

    const newChildParentId = args.parentSessionIdOverride ?? null;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('sessions:refresh-list', {
          workspacePath: workspaceId,
          sessionId,
        });
        if (worktreeId) {
          window.webContents.send('worktree:session-created', { sessionId, worktreeId });
        }
        // The general `sessions:refresh-list` only updates `sessionRegistryAtom`.
        // Workstream surfaces (tab strip, left tree) also read per-parent atoms
        // (`sessionChildrenAtom`, `workstreamStateAtom`) that the registry
        // refresh does not touch, so we send a targeted event so listeners can
        // patch those without re-fetching everything.
        if (newChildParentId) {
          window.webContents.send('sessions:child-added', {
            workspacePath: workspaceId,
            parentSessionId: newChildParentId,
            childSessionId: sessionId,
          });
        }
      }
    }

    if (initialPrompt && !shouldBypassExecution) {
      await aiService.triggerQueuedPromptProcessingForSession(sessionId, worktreePath || workspaceId);
    }

    return {
      sessionId,
      title,
      provider,
      model: normalizedModel,
      worktreeId,
      worktreePath,
      worktreeMode: args.worktreeId ? 'existing' : args.useWorktree ? 'new' : 'none',
      createdBySessionId: metaSessionId,
      queuedInitialPrompt: !!initialPrompt,
      parentSessionId: args.parentSessionIdOverride ?? null,
    };
  }

  private async spawnSession(
    parentSessionId: string,
    workspaceId: string,
    args: SpawnSessionArgs
  ): Promise<string> {
    if (!args?.prompt?.trim()) {
      throw new Error('prompt is required');
    }
    await this.assertDispatchAuthorized(workspaceId, args);

    const parent = await AISessionsRepository.get(parentSessionId);
    if (!parent || parent.workspacePath !== workspaceId) {
      throw new Error(`Parent session ${parentSessionId} not found in this workspace`);
    }

    const isolated = args.isolated === true;

    // Sibling mode: resolve (or create) a workstream container so the new
    // session shares files-edited, tabs, and workstream overview with the
    // caller. Isolated mode skips this entirely — the new session is a
    // top-level row with no parent, intended for fix-and-commit work that
    // should not pollute the caller's workstream.
    let workstreamId: string | null = null;
    let promotedParent = false;
    if (!isolated) {
      const resolved = await this.resolveOrCreateWorkstream(parent, workspaceId);
      workstreamId = resolved.workstreamId;
      promotedParent = resolved.promotedParent;
    }

    // Inherit the caller's worktree by default. spawn_session means "continue
    // work in the same checkout I'm in"; without this, a child created from a
    // worktree-resident parent silently lands in the project root and any edits
    // it makes go to the wrong tree. Skip inheritance only when the caller
    // explicitly asked for a brand-new worktree (useWorktree=true).
    const inheritedWorktreeId =
      !args.useWorktree && parent.worktreeId ? parent.worktreeId : undefined;

    // Resolve effective model: explicit `model` wins; otherwise `inheritModel`
    // copies the caller's model so the new session keeps the same provider/model
    // (e.g. opus stays on opus). Falling through to undefined lets
    // createChildSessionInternal use the global default.
    const effectiveModel =
      args.model ?? (args.inheritModel ? parent.model ?? undefined : undefined);
    const notifyOnComplete = args.notifyOnComplete === true;

    const childResult = await this.dispatchOrQueueChildSession(parentSessionId, workspaceId, {
      title: args.title,
      prompt: args.prompt,
      useWorktree: !!args.useWorktree,
      worktreeId: inheritedWorktreeId,
      model: effectiveModel,
      effortLevel: args.effortLevel,
      intent: args.intent,
      planId: args.planId,
      maxParallelOverride: args.maxParallelOverride,
      parentSessionIdOverride: workstreamId,
      notifyParent: notifyOnComplete,
    }, 'spawn_session');

    return JSON.stringify({
      ...childResult,
      isolated,
      workstreamId,
      promotedParent,
      notifyOnComplete,
    }, null, 2);
  }

  private async resolveOrCreateWorkstream(
    parent: { id: string; title?: string; provider: string; model?: string | null; sessionType?: string; parentSessionId?: string | null; worktreeId?: string | null },
    workspaceId: string
  ): Promise<{ workstreamId: string | null; promotedParent: boolean }> {
    // A worktree IS the workstream — the worktree row in the `worktrees` table is the
    // container, and every session inside it is a flat sibling keyed by `worktree_id`.
    // Never wrap a worktree-resident session in a `session_type='workstream'` row;
    // that produces a forbidden third layer (worktree → workstream → session) and
    // confuses every grouping derivation (worktreeGroupsData, FilesEditedSidebar,
    // the workstream tab strip). Hard rule: two layers max.
    if (parent.worktreeId) {
      return { workstreamId: null, promotedParent: false };
    }

    if (parent.parentSessionId) {
      return { workstreamId: parent.parentSessionId, promotedParent: false };
    }

    if (parent.sessionType === 'workstream') {
      return { workstreamId: parent.id, promotedParent: false };
    }

    const workstreamId = randomUUID();
    const workstreamTitle = (parent.title && parent.title.trim()) ? parent.title : 'Workstream';

    await AISessionsRepository.create({
      id: workstreamId,
      provider: parent.provider,
      model: parent.model ?? undefined,
      title: workstreamTitle,
      workspaceId,
      sessionType: 'workstream',
    });

    // Tag the workstream container in metadata so existing renderer code that
    // relies on metadata.isWorkstreamRoot continues to work.
    await AISessionsRepository.updateMetadata(workstreamId, {
      metadata: { isWorkstreamRoot: true },
    });

    // Reparent the original session under the new workstream container.
    await AISessionsRepository.updateMetadata(parent.id, {
      parentSessionId: workstreamId,
    });

    // Tell the renderer the original session is now a child of the workstream
    // so per-parent atoms (sessionChildrenAtom, workstreamStateAtom) get
    // patched alongside the registry refresh that fires below.
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('sessions:child-added', {
          workspacePath: workspaceId,
          parentSessionId: workstreamId,
          childSessionId: parent.id,
        });
      }
    }

    // SyncedSessionStore is now the single push path: the create() above pushes
    // title/provider/model/sessionType for the new workstream, and the
    // updateMetadata() above pushes the reparented child's parentSessionId.
    // Both reach iOS via the index channel without needing an explicit
    // pushChange here.

    return { workstreamId, promotedParent: true };
  }

  private async listWorktreesJson(workspaceId: string): Promise<string> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }

    const worktreeStore = createWorktreeStore(db);
    const worktrees = await worktreeStore.list(workspaceId);
    const summaries = await Promise.all(
      worktrees.map(async (worktree) => {
        const sessionIds = await worktreeStore.getWorktreeSessions(worktree.id);
        return {
          id: worktree.id,
          name: worktree.name,
          displayName: worktree.displayName || null,
          path: worktree.path,
          branch: worktree.branch,
          baseBranch: worktree.baseBranch,
          sessionCount: sessionIds.length,
          createdAt: worktree.createdAt,
          updatedAt: worktree.updatedAt ?? null,
        };
      })
    );

    return JSON.stringify(summaries, null, 2);
  }

  private async getSessionStatusJson(sessionId: string, workspaceId: string): Promise<string> {
    const row = await this.getSessionStatusRow(sessionId, workspaceId);
    if (!row) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const status = row.status || 'idle';
    const result: Record<string, unknown> = {
      sessionId: row.id,
      title: row.title || 'Untitled Session',
      status,
      lastActivity: toMillis(row.last_activity),
      updatedAt: toMillis(row.updated_at),
      provider: row.provider,
      model: row.model || null,
      createdBySessionId: row.created_by_session_id || null,
      agentRole: row.agent_role || 'standard',
      waitingForInput: status === 'waiting_for_input',
    };

    return JSON.stringify(result, null, 2);
  }

  private async getSessionResultJson(sessionId: string, workspaceId: string): Promise<string> {
    const data = await this.buildSessionResultData(sessionId, workspaceId);
    return JSON.stringify(data, null, 2);
  }

  private async sendPromptToSession(
    sessionId: string,
    workspaceId: string,
    prompt: string,
    options: {
      forceProcessing?: boolean;
      origin?: QueuedPromptOrigin;
      idempotencyKey?: string;
      bypassExecutionForTests?: boolean;
    } = {},
  ): Promise<string> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }
    if (!prompt?.trim()) {
      throw new Error('prompt is required');
    }

    const session = await AISessionsRepository.get(sessionId);
    if (!session || session.workspacePath !== workspaceId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const normalizedPrompt = prompt.trim();
    const shouldBypassExecution = options.bypassExecutionForTests
      ?? this.shouldBypassChildAgentExecutionForTests();
    const statusRow = await this.getSessionStatusRow(sessionId, workspaceId);
    const statusBeforeQueue = (statusRow?.status || 'idle') as SessionStatusValue;

    if (shouldBypassExecution) {
      await this.persistSyntheticInputMessage(sessionId, normalizedPrompt);
      return JSON.stringify({
        sessionId,
        queuedPromptId: null,
        prompt: normalizedPrompt,
        statusBeforeQueue,
        processingTriggered: false,
        bypassedExecutionForTest: true,
      }, null, 2);
    }

    const queued = await this.aiService.queuePromptForSession(
      sessionId,
      normalizedPrompt,
      undefined,
      undefined,
      options.origin ?? 'user',
      options.idempotencyKey,
    );
    const status = (statusRow?.status || 'idle') as SessionStatusValue;
    const processingTriggered = options.forceProcessing === true
      || status === 'idle'
      || status === 'interrupted'
      || status === 'error';

    if (processingTriggered) {
      await this.aiService.triggerQueuedPromptProcessingForSession(
        sessionId,
        session.worktreePath || session.workspacePath || workspaceId,
        options.forceProcessing === true,
      );
    }

    return JSON.stringify({
      sessionId,
      queuedPromptId: queued.id,
      prompt: queued.prompt,
      statusBeforeQueue: status,
      processingTriggered,
    }, null, 2);
  }

  private async respondToPrompt(workspaceId: string, args: {
    sessionId: string;
    promptId: string;
    promptType: PromptType;
    response: Record<string, unknown>;
  }): Promise<string> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }

    const session = await AISessionsRepository.get(args.sessionId);
    if (!session || session.workspacePath !== workspaceId) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    const result = await this.aiService.respondToInteractivePrompt({
      sessionId: args.sessionId,
      promptId: args.promptId,
      promptType: args.promptType,
      response: args.response,
      respondedBy: 'desktop',
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to respond to prompt');
    }

    return JSON.stringify({
      sessionId: args.sessionId,
      promptId: args.promptId,
      promptType: args.promptType,
      success: true,
    }, null, 2);
  }

  private async listSpawnedSessionsJson(metaSessionId: string, workspaceId: string): Promise<string> {
    const sessions = await this.getSpawnedSessions(metaSessionId, workspaceId);
    return JSON.stringify(sessions, null, 2);
  }

  private async getSpawnedSessions(metaSessionId: string, workspaceId: string): Promise<Array<Record<string, unknown>>> {
    const { rows } = await databaseWorker.query<any>(
      `SELECT id, title, provider, model, status, last_activity, created_at, updated_at, worktree_id, agent_role, created_by_session_id, metadata
       FROM ai_sessions
       WHERE workspace_id = $1
         AND created_by_session_id = $2
         AND (is_archived = FALSE OR is_archived IS NULL)
       ORDER BY created_at DESC`,
      [workspaceId, metaSessionId]
    );

    const sessions: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      // A dispatch that is still waiting for a slot has a placeholder row whose
      // raw status is 'idle'. Report it as 'queued' so Delegated Sessions shows
      // it as waiting rather than as an idle child that never started.
      const metadata = typeof row.metadata === 'string'
        ? (() => { try { return JSON.parse(row.metadata); } catch { return null; } })()
        : row.metadata;
      const isQueued = metadata?.dispatchQueued === true;
      const isInterrupted = metadata?.interruptedByHead === true && row.status !== 'running';
      const data = await this.buildSessionResultData(row.id, workspaceId, {
        title: row.title || 'Untitled Session',
        provider: row.provider,
        model: row.model || null,
        status: isQueued ? 'queued' : (isInterrupted ? 'interrupted' : (row.status || 'idle')),
        lastActivity: toMillis(row.last_activity),
        createdAt: toMillis(row.created_at)!,
        updatedAt: toMillis(row.updated_at)!,
        worktreeId: row.worktree_id || null,
      }, false);
      sessions.push({
        sessionId: data.sessionId,
        title: data.title,
        provider: data.provider,
        model: data.model,
        status: data.status,
        lastActivity: data.lastActivity,
        originalPrompt: data.originalPrompt,
        lastResponse: data.lastResponse,
        editedFiles: data.editedFiles,
        pendingPrompt: data.pendingPrompt,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        worktreeId: data.worktreeId || null,
      });
    }

    return sessions;
  }

  private async handleChildSessionEvent(sessionId: string, eventType: 'session:completed' | 'session:error' | 'session:waiting' | 'session:interrupted'): Promise<void> {
    if (eventType === 'session:interrupted') {
      this.interruptedChildSessionIds.add(sessionId);
    } else if (eventType === 'session:completed' && this.interruptedChildSessionIds.has(sessionId)) {
      return;
    }

    let releasedHeadSessionId: string | null = null;
    let slotReleased = false;
    try {
      if (!this.aiService) {
        return;
      }

      // Capture the active rows before the first await in this event handler.
      // The state listener is fire-and-forget, so a later query could see the
      // next prompt after it has already been claimed and release the wrong row.
      const completionPromptSnapshotPromise = eventType === 'session:completed'
        ? databaseWorker.query<{
            id: string;
            status: 'executing';
          }>(
            `SELECT id, status FROM queued_prompts
             WHERE session_id = $1 AND status = 'executing'`,
            [sessionId],
          )
        : null;

      const [completionPromptSnapshot, session] = await Promise.all([
        completionPromptSnapshotPromise,
        AISessionsRepository.get(sessionId),
      ]);
      if (!session || session.agentRole === 'meta-agent' || !session.createdBySessionId || !session.workspacePath) {
        return;
      }
      releasedHeadSessionId = session.createdBySessionId;
      slotReleased = eventType !== 'session:completed';

      const workOrderStatusByEvent: Record<typeof eventType, WorkOrderStatus> = {
        'session:completed': 'completed',
        'session:error': 'failed',
        'session:waiting': 'waiting',
        'session:interrupted': 'interrupted',
      };
      try {
        await this.updateWorkOrderStatusForSession(
          sessionId,
          workOrderStatusByEvent[eventType],
          eventType === 'session:interrupted' ? 'Session interrupted' : undefined,
        );
      } catch (error) {
        // Tracker state is secondary to the existing Head notification path.
        console.error(`[MetaAgentService] Failed to update work-order for child ${sessionId}:`, error);
      }

      const metaSession = await AISessionsRepository.get(session.createdBySessionId);
      if (!metaSession?.workspacePath) {
        return;
      }

      // NIM-6: session:completed fires on every turn idle, not only on terminal
      // completion. If the child still has more prompts queued AFTER the one
      // that just finished, this idle is a between-turn pause -- another
      // session:completed will follow once the queue drains. Suppress it; the
      // parent will be notified on the genuinely terminal idle (queue empty).
      //
      // The just-finished prompt is still in `executing` status at the moment
      // session:completed fires (MessageStreamingHandler marks it `completed`
      // only after endSession returns). So we count only `pending` rows --
      // counting `executing` would include the current turn itself and
      // suppress every notification, including the final terminal one.
      //
      // The other event types (error/waiting/interrupted) are always
      // meaningful and pass through.
      if (eventType === 'session:completed') {
        // Pending work is a forward-looking decision, so read it now rather
        // than trusting the event snapshot: a concurrent CLI flush may have
        // already claimed and failed that follow-up without another lifecycle event.
        const { rows: pendingRows } = await databaseWorker.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM queued_prompts
           WHERE session_id = $1 AND status = 'pending'`,
          [sessionId],
        );
        if (Number(pendingRows[0]?.count ?? '0') > 0) {
          return;
        }
        slotReleased = true;
        this.markDispatchPromptsReleased(
          session.createdBySessionId,
          sessionId,
          (completionPromptSnapshot?.rows ?? []).map((row) => row.id),
        );
      }

      // Fire-and-forget suppresses only the Head notification. Capacity release
      // still drains the durable queue via the finally block below.
      const childMetadata = (session.metadata as Record<string, unknown> | undefined) ?? undefined;
      if (childMetadata && childMetadata.notifyParent === false) {
        return;
      }

      const metaStatusRow = await this.getSessionStatusRow(metaSession.id, metaSession.workspacePath);
      const metaStatus = (metaStatusRow?.status || 'idle') as SessionStatusValue;

      const result = await this.buildSessionResultData(sessionId, session.workspacePath, undefined, false);

      // NIM-6: real dedup gate. Drop notifications whose semantic content is
      // identical to the last one delivered for this child. The previous code
      // mixed in an always-incrementing counter, which made every signature
      // unique and the dedup useless. The signature is reset on
      // session:started/session:streaming (see start()), so it only collapses
      // duplicates within a single child turn -- not across turns.
      const signature = computeNotificationSignature(eventType, result);
      if (this.notificationSignatures.get(sessionId) === signature) {
        return;
      }
      this.notificationSignatures.set(sessionId, signature);

      if (result.pendingPrompt?.promptType === 'exit_plan_mode_request') {
        await this.ensurePlanTrackerItem(session.workspacePath, sessionId, result);
      }

      const notification = this.buildNotificationMessage(eventType, result);
      await this.aiService.queuePromptForSession(
        session.createdBySessionId,
        notification,
        undefined,
        undefined,
        'child_session_event',
      );

      // All four child event types use the same internal delivery path. When
      // the parent can run, trigger its queue so the event reaches the model.
      if (metaStatus === 'idle' || metaStatus === 'interrupted' || metaStatus === 'error') {
        await this.aiService.triggerQueuedPromptProcessingForSession(metaSession.id, metaSession.workspacePath);
      }
    } catch (error) {
      console.error(`[MetaAgentService] handleChildSessionEvent failed for session ${sessionId} (${eventType}):`, error);
    } finally {
      if (slotReleased && releasedHeadSessionId) {
        await this.drainDispatchQueueForHead(releasedHeadSessionId).catch((error) => {
          console.error(`[MetaAgentService] Failed to refill a released slot for Head ${releasedHeadSessionId}:`, error);
        });
      }
    }
  }

  private buildNotificationMessage(
    eventType: 'session:completed' | 'session:error' | 'session:waiting' | 'session:interrupted',
    result: SessionResultData
  ): string {
    const lines = [
      '[Child Session Update]',
      `Session: "${result.title}" (${result.sessionId})`,
      `Status: ${result.status}`,
      `Event: ${eventType}`,
    ];

    if (result.originalPrompt) {
      lines.push(`Original task: ${result.originalPrompt}`);
    }
    if (result.recentMessages.length > 0) {
      lines.push('Recent messages:');
      for (const message of result.recentMessages) {
        const label = message.direction === 'input' ? 'User' : 'Assistant';
        lines.push(`- ${label}: ${message.text}`);
      }
    } else if (result.lastResponse) {
      lines.push(`Last response: ${result.lastResponse}`);
    }
    if (result.editedFiles.length > 0) {
      lines.push('Files modified:');
      for (const filePath of result.editedFiles) {
        lines.push(`- ${filePath}`);
      }
    }
    if (result.toolScope === 'read' || result.toolScope === 'write') {
      const denied = result.toolScope === 'read' ? 'write_file or run_command' : 'run_command';
      lines.push(
        `Tool scope: ${result.toolScope} (this child had NO ${denied}). Any claim it ran, built, or tested anything is false; "Files modified" above is the complete list of files it changed.`,
      );
    }
    if (result.pendingPrompt) {
      lines.push('');
      lines.push(`ACTION REQUIRED: This session is blocked on an interactive prompt.`);
      lines.push(`Use respond_to_prompt with these arguments:`);
      lines.push(`  sessionId: "${result.sessionId}"`);
      lines.push(`  promptId: "${result.pendingPrompt.promptId}"`);
      lines.push(`  promptType: "${result.pendingPrompt.promptType}"`);

      if (result.pendingPrompt.promptType === 'ask_user_question_request') {
        const questions = result.pendingPrompt.content?.questions;
        if (Array.isArray(questions)) {
          lines.push('  Questions:');
          for (const q of questions) {
            const questionText = q.question || q.text || JSON.stringify(q);
            lines.push(`    - ${questionText}`);
            if (Array.isArray(q.options)) {
              for (const opt of q.options) {
                const label = typeof opt === 'string' ? opt : opt.label || opt.value || JSON.stringify(opt);
                lines.push(`      * ${label}`);
              }
            }
          }
        }
        lines.push(`  response format: { "answers": { "<question text>": "<your answer>" } }`);
      } else if (result.pendingPrompt.promptType === 'permission_request') {
        const toolName = result.pendingPrompt.content?.toolName || result.pendingPrompt.content?.request?.tool || 'unknown';
        lines.push(`  Tool requesting permission: ${toolName}`);
        lines.push(`  response: { "decision": "allow", "scope": "session" }`);
      } else if (result.pendingPrompt.promptType === 'exit_plan_mode_request') {
        if (result.pendingPrompt.content?.planFilePath) {
          lines.push(`  Plan file: ${result.pendingPrompt.content.planFilePath}`);
        }
        lines.push(`  response: { "approved": true }`);
      }
    }
    if (result.errorMessage) {
      lines.push(`Error: ${result.errorMessage}`);
    }
    return lines.join('\n');
  }

  private async buildSessionResultData(
    sessionId: string,
    workspaceId: string,
    prefetchedSession?: { title: string; provider: string; model: string | null; status: string; lastActivity: number | null; createdAt: number; updatedAt: number; worktreeId: string | null },
    // Skip the heavier full-turn extract when the caller only needs preview
    // fields (the list and notification paths discard fullResponse).
    includeFullResponse: boolean = true
  ): Promise<SessionResultData> {
    let sessionTitle: string;
    let sessionProvider: string;
    let sessionModel: string | null;
    let sessionStatus: SessionStatusValue;
    let sessionLastActivity: number | null;
    let sessionCreatedAt: number;
    let sessionUpdatedAt: number;
    let sessionWorktreeId: string | null;
    let sessionToolScope: string | null = null;

    if (prefetchedSession) {
      sessionTitle = prefetchedSession.title;
      sessionProvider = prefetchedSession.provider;
      sessionModel = prefetchedSession.model;
      sessionStatus = prefetchedSession.status as SessionStatusValue;
      sessionLastActivity = prefetchedSession.lastActivity;
      sessionCreatedAt = prefetchedSession.createdAt;
      sessionUpdatedAt = prefetchedSession.updatedAt;
      sessionWorktreeId = prefetchedSession.worktreeId;
    } else {
      const session = await AISessionsRepository.get(sessionId);
      if (!session || session.workspacePath !== workspaceId) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const statusRow = await this.getSessionStatusRow(sessionId, workspaceId);
      sessionTitle = session.title || 'Untitled Session';
      sessionProvider = session.provider;
      sessionModel = session.model || null;
      sessionStatus = (statusRow?.status || 'idle') as SessionStatusValue;
      sessionLastActivity = toMillis(statusRow?.last_activity);
      sessionCreatedAt = session.createdAt;
      sessionUpdatedAt = session.updatedAt;
      sessionWorktreeId = session.worktreeId || null;
      sessionToolScope =
        ((session.metadata as Record<string, unknown> | undefined)?.toolScope as string | undefined) ?? null;
    }

    const messages = await AgentMessagesRepository.list(sessionId, { limit: 500 });
    const userPrompts = extractUserPrompts(messages);
    const recentMessages = this.extractRecentMessages(messages, 3);
    const pendingPrompt = await this.getPendingInteractivePrompt(sessionId);

    let editedFiles: string[] = [];
    try {
      const fileLinks = await SessionFilesRepository.getFilesBySession(sessionId, 'edited');
      editedFiles = fileLinks.map((file: any) => this.stripWorkspacePath(file.filePath, workspaceId));
    } catch {
      editedFiles = [];
    }

    return {
      sessionId,
      title: sessionTitle,
      provider: sessionProvider,
      model: sessionModel,
      status: sessionStatus,
      lastActivity: sessionLastActivity,
      originalPrompt: userPrompts[0] || null,
      userPrompts,
      lastResponse: this.extractLastAgentResponse(messages),
      fullResponse: includeFullResponse ? this.extractLastAgentTurn(messages, 50000) : null,
      recentMessages,
      editedFiles,
      pendingPrompt,
      errorMessage: this.extractErrorMessage(messages),
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      worktreeId: sessionWorktreeId,
      toolScope: sessionToolScope,
    };
  }

  private async getPendingInteractivePrompt(sessionId: string): Promise<PendingInteractivePrompt | null> {
    // Interactive prompts are persisted in three different formats:
    // 1. AskUserQuestion:  { type: "nimbalyst_tool_use", name: "AskUserQuestion", id: "...", input: { questions } }
    // 2. ToolPermission:   { type: "nimbalyst_tool_use", name: "ToolPermission", id: "...", input: { requestId, toolName, ... } }
    // 3. ExitPlanMode:     { type: "exit_plan_mode_request", status: "pending", requestId: "..." }
    const { rows } = await databaseWorker.query<{
      id: string;
      content: string;
      created_at: Date;
    }>(
      `SELECT id, content, created_at
       FROM ai_agent_messages
       WHERE session_id = $1
         AND (hidden = FALSE OR hidden IS NULL)
         AND (
           (content LIKE '%"type":"exit_plan_mode_request"%' AND content LIKE '%"status":"pending"%')
           OR (content LIKE '%"type":"nimbalyst_tool_use"%' AND content LIKE '%"name":"AskUserQuestion"%')
           OR (content LIKE '%"type":"nimbalyst_tool_use"%' AND content LIKE '%"name":"ToolPermission"%')
         )
       ORDER BY created_at ASC`,
      [sessionId]
    );

    for (const row of rows) {
      try {
        const content = JSON.parse(row.content);

        // Handle nimbalyst_tool_use format (AskUserQuestion and ToolPermission)
        if (content.type === 'nimbalyst_tool_use') {
          const promptId = content.id || content.input?.requestId;
          if (!promptId) {
            continue;
          }

          // Check if there's already a response for this prompt
          const escapedPromptId = this.escapeLikePattern(promptId);
          const { rows: resultRows } = await databaseWorker.query<{ id: string }>(
            `SELECT id
             FROM ai_agent_messages
             WHERE session_id = $1
               AND (
                 (content LIKE '%"type":"nimbalyst_tool_result"%' AND content LIKE $2)
                 OR (content LIKE '%"type":"ask_user_question_response"%' AND content LIKE $2)
                 OR (content LIKE '%"type":"permission_response"%' AND content LIKE $2)
               )
             LIMIT 1`,
            [sessionId, `%"${escapedPromptId}"%`]
          );

          if (resultRows.length > 0) {
            continue;
          }

          if (content.name === 'AskUserQuestion') {
            return {
              id: row.id,
              promptId,
              promptType: 'ask_user_question_request',
              createdAt: toMillis(row.created_at)!,
              content: {
                ...content,
                questions: content.input?.questions || [],
                questionId: promptId,
              },
            };
          }

          if (content.name === 'ToolPermission') {
            return {
              id: row.id,
              promptId: content.input?.requestId || promptId,
              promptType: 'permission_request',
              createdAt: toMillis(row.created_at)!,
              content: {
                type: 'permission_request',
                requestId: content.input?.requestId || promptId,
                toolName: content.input?.toolName || 'unknown',
                rawCommand: content.input?.rawCommand || '',
                pattern: content.input?.pattern || '',
                patternDisplayName: content.input?.patternDisplayName || '',
                isDestructive: content.input?.isDestructive || false,
                warnings: content.input?.warnings || [],
                status: 'pending',
              },
            };
          }

          continue;
        }

        // Handle exit_plan_mode_request format
        if (content.type === 'exit_plan_mode_request' && content.status === 'pending') {
          const promptId = content.requestId;
          if (!promptId) {
            continue;
          }

          const escapedPromptId = this.escapeLikePattern(promptId);
          const { rows: responseRows } = await databaseWorker.query<{ id: string }>(
            `SELECT id
             FROM ai_agent_messages
             WHERE session_id = $1
               AND content LIKE '%"type":"exit_plan_mode_response"%'
               AND content LIKE $2
             LIMIT 1`,
            [sessionId, `%"requestId":"${escapedPromptId}"%`]
          );

          if (responseRows.length > 0) {
            continue;
          }

          return {
            id: row.id,
            promptId,
            promptType: 'exit_plan_mode_request',
            createdAt: toMillis(row.created_at)!,
            content,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async getSessionStatusRow(sessionId: string, workspaceId: string): Promise<any | null> {
    const { rows } = await databaseWorker.query<any>(
      `SELECT id, title, provider, model, status, last_activity, updated_at, created_by_session_id, agent_role
       FROM ai_sessions
       WHERE id = $1 AND workspace_id = $2
       LIMIT 1`,
      [sessionId, workspaceId]
    );
    return rows[0] || null;
  }

  private async ensurePlanTrackerItem(workspaceId: string, sessionId: string, result: SessionResultData): Promise<void> {
    const pendingPrompt = result.pendingPrompt;
    if (!pendingPrompt || pendingPrompt.promptType !== 'exit_plan_mode_request') {
      return;
    }

    const sourceRef = `meta-agent-plan:${sessionId}:${pendingPrompt.promptId}`;
    const { rows: existing } = await databaseWorker.query<{ id: string }>(
      `SELECT id FROM tracker_items WHERE workspace = $1 AND source_ref = $2 LIMIT 1`,
      [workspaceId, sourceRef]
    );
    if (existing.length > 0) {
      return;
    }

    const trackerId = randomUUID();
    const title = `Plan review: ${result.title}`;
    const description = typeof pendingPrompt.content.planFilePath === 'string'
      ? `Plan generated by child session ${sessionId}.\nPlan file: ${pendingPrompt.content.planFilePath}`
      : `Plan generated by child session ${sessionId}.`;

    const data = {
      title,
      status: 'in-review',
      priority: 'medium',
      created: new Date().toISOString().split('T')[0],
      description,
      tags: ['meta-agent', 'plan-review'],
      childSessionId: sessionId,
    };

    await databaseWorker.query(
      `INSERT INTO tracker_items (
        id, type, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'pending', $5, FALSE, $6, $7)`,
      [
        trackerId,
        'plan',
        JSON.stringify(data),
        workspaceId,
        JSON.stringify({
          planFilePath: pendingPrompt.content.planFilePath || null,
          allowedPrompts: pendingPrompt.content.allowedPrompts || [],
        }),
        'meta-agent',
        sourceRef,
      ]
    );

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('document-service:tracker-items-changed', {
          added: [],
          updated: [],
          removed: [],
          timestamp: new Date(),
        });
      }
    }
  }

  private async createWorkOrderTrackerItem(
    workspaceId: string,
    sessionId: string,
    sessionTitle: string,
    prompt?: string,
    intent: SessionIntent = 'implementation',
    planId?: string,
    options: {
      status?: WorkOrderStatus;
      sourceRef?: string;
      dispatchedAt?: string;
      linkSession?: boolean;
    } = {},
  ): Promise<string> {
    const trackerId = randomUUID();
    const title = this.deriveTitleFromPrompt(sessionTitle) || 'Meta Task';
    const taskSummary = this.deriveTitleFromPrompt(prompt) || title;
    const dispatchedAt = options.dispatchedAt ?? new Date().toISOString();
    const sourceRef = options.sourceRef ?? `meta-agent-work-order:${sessionId}`;
    const data = {
      title,
      status: options.status ?? 'dispatched',
      childSessionId: sessionId,
      taskSummary,
      dispatchedAt,
      intent,
      ...(planId ? { planId } : {}),
    };

    await databaseWorker.query(
      `INSERT INTO tracker_items (
        id, type, type_tags, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, $2, $3, $4, $5, '', NULL, NOW(), NOW(), NOW(), 'local', NULL, FALSE, $6, $7)`,
      [
        trackerId,
        'work-order',
        ['work-order'],
        JSON.stringify(data),
        workspaceId,
        'meta-agent',
        sourceRef,
      ],
    );

    if (options.linkSession !== false) {
      await createBidirectionalLink(trackerId, sessionId);
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('document-service:tracker-items-changed', {
          added: [],
          updated: [],
          removed: [],
          timestamp: new Date(),
        });
      }
    }
    return trackerId;
  }

  private async applyChildSessionMetadata(
    sessionId: string,
    args: Pick<InternalCreateChildSessionArgs, 'effortLevel' | 'toolScope' | 'notifyParent' | 'title'>,
  ): Promise<void> {
    const metadata: Record<string, unknown> = {};
    // Record that this title came from the dispatch call, not from a model. The
    // auto-namer (SessionNamingService.applySessionTitle) renames with
    // `force: true`, which bypasses `hasBeenNamed`, so it needs this explicit
    // marker to leave operator-chosen dispatch titles alone.
    if (args.title?.trim()) {
      metadata.titleSource = 'dispatch';
    }
    if (args.effortLevel) {
      metadata.effortLevel = args.effortLevel;
    }
    if (args.toolScope === 'read' || args.toolScope === 'write') {
      metadata.toolScope = args.toolScope;
    }
    if (args.notifyParent !== undefined) {
      metadata.notifyParent = args.notifyParent;
    }
    if (Object.keys(metadata).length > 0) {
      await AISessionsRepository.updateMetadata(sessionId, { metadata });
    }
  }

  private async attachQueuedWorkOrderToSession(
    sourceRef: string,
    sessionId: string,
  ): Promise<void> {
    const { rows } = await databaseWorker.query<{ id: string; data: unknown }>(
      `SELECT id, data
       FROM tracker_items
       WHERE type = 'work-order' AND source_ref = $1
       LIMIT 1`,
      [sourceRef],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`Queued work-order ${sourceRef} not found`);
    }
    const data = typeof row.data === 'string'
      ? JSON.parse(row.data)
      : ((row.data as Record<string, unknown> | null) ?? {});
    data.status = 'dispatched';
    data.childSessionId = sessionId;
    data.dispatchedAt = new Date().toISOString();
    await databaseWorker.query(
      `UPDATE tracker_items SET data = $1, updated = NOW() WHERE id = $2`,
      [JSON.stringify(data), row.id],
    );
    await createBidirectionalLink(row.id, sessionId);
    this.emitTrackerItemsChanged();
  }

  private emitTrackerItemsChanged(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('document-service:tracker-items-changed', {
          added: [],
          updated: [],
          removed: [],
          timestamp: new Date(),
        });
      }
    }
  }

  /**
   * Work-order status lives in the tracker projection rather than the session
   * model. Invalidate that projection after each status write so open Tracker
   * and session-board views refetch through their established IPC channel.
   */
  private emitWorkOrderStatusChanged(): void {
    this.emitTrackerItemsChanged();
  }

  private async updateWorkOrderStatusForSession(
    sessionId: string,
    status: WorkOrderStatus,
    interruptionReason?: string,
  ): Promise<void> {
    const sourceRef = `meta-agent-work-order:${sessionId}`;
    await this.updateWorkOrderStatusBySourceRef(sourceRef, status, interruptionReason);
  }

  private async updateWorkOrderStatusBySourceRef(
    sourceRef: string,
    status: WorkOrderStatus,
    interruptionReason?: string,
  ): Promise<void> {
    const { rows } = await databaseWorker.query<{ id: string; data: unknown }>(
      `SELECT id, data
       FROM tracker_items
       WHERE type = 'work-order' AND source_ref = $1
       LIMIT 1`,
      [sourceRef],
    );
    const row = rows[0];
    if (!row) {
      return;
    }

    const data = typeof row.data === 'string'
      ? JSON.parse(row.data)
      : ((row.data as Record<string, unknown> | null) ?? {});
    data.status = status;
    if (interruptionReason && !data.interruptionReason) {
      data.interruptionReason = interruptionReason;
    }
    await databaseWorker.query(
      `UPDATE tracker_items SET data = $1, updated = NOW() WHERE id = $2`,
      [JSON.stringify(data), row.id],
    );

    this.emitWorkOrderStatusChanged();
  }

  private extractLastAgentResponse(messages: Array<{ direction: string; content: string; metadata?: Record<string, unknown> | null }>, maxLength: number = 500): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.direction !== 'output') continue;
      const extracted = extractMessageText(message.content, message.metadata);
      if (extracted) {
        return extracted.length > maxLength ? `${extracted.slice(0, maxLength)}...` : extracted;
      }
    }
    return null;
  }

  /**
   * The child's full final turn: every output message since the last input
   * (user) message, joined. extractLastAgentResponse returns only the single
   * last output message, which decapitates a child whose substance spans
   * several output messages (tool narration then a final answer). Capped, with
   * an explicit marker when truncated so the reader knows content was dropped.
   */
  private extractLastAgentTurn(
    messages: Array<{ direction: string; content: string; metadata?: Record<string, unknown> | null }>,
    maxLength: number = 50000
  ): string | null {
    let lastInputIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].direction === 'input') {
        lastInputIndex = index;
        break;
      }
    }
    const parts: string[] = [];
    for (let index = lastInputIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.direction !== 'output') continue;
      const text = extractMessageText(message.content, message.metadata);
      if (text) parts.push(text);
    }
    if (lastInputIndex === -1 || parts.length === 0) {
      // No input row to anchor the turn (or no output after it): use the single
      // last output message rather than concatenating output across turns.
      return this.extractLastAgentResponse(messages, maxLength);
    }
    const sep = String.fromCharCode(10) + String.fromCharCode(10);
    const joined = parts.join(sep);
    return joined.length > maxLength
      ? joined.slice(0, maxLength) + sep + '[truncated: turn exceeded ' + maxLength + ' characters]'
      : joined;
  }

  private extractRecentMessages(
    messages: Array<{ direction: string; content: string; metadata?: Record<string, unknown> | null }>,
    limit: number,
    // Cap each message so a verbose child cannot inline an unbounded block
    // into the auto-injected [Child Session Update] notification.
    maxPerMessage: number = 2000
  ): Array<{ direction: 'input' | 'output'; text: string }> {
    const collected: Array<{ direction: 'input' | 'output'; text: string }> = [];
    for (let index = messages.length - 1; index >= 0 && collected.length < limit; index -= 1) {
      const message = messages[index];
      const text = extractMessageText(message.content, message.metadata);
      if (!text) {
        continue;
      }
      collected.push({
        direction: message.direction === 'input' ? 'input' : 'output',
        text: text.length > maxPerMessage ? `${text.slice(0, maxPerMessage)}...` : text,
      });
    }
    return collected.reverse();
  }

  private extractErrorMessage(messages: Array<{ direction: string; content: string }>): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      try {
        const parsed = JSON.parse(message.content);
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          return parsed.error.trim();
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private deriveTitleFromPrompt(prompt?: string): string | null {
    if (!prompt?.trim()) {
      return null;
    }
    const firstLine = prompt.trim().split('\n')[0].trim();
    if (!firstLine) {
      return null;
    }
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[%_\\]/g, '\\$&');
  }

  private stripWorkspacePath(filePath: string, workspacePath: string): string {
    if (!workspacePath) return filePath;
    return path.relative(workspacePath, filePath);
  }
}

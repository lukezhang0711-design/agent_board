import { expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createTempWorkspace,
  launchElectronApp,
  waitForAppReady,
} from '../helpers';
import {
  dismissAPIKeyDialog,
  PLAYWRIGHT_TEST_SELECTORS,
  switchToAgentMode,
} from '../utils/testHelpers';
import {
  SCRIPTED_FINAL_SUMMARY,
  SCRIPTED_REVIVE_SUMMARY,
  ScriptedCollaborationProvider,
} from './fixtures/scriptedCollaborationProvider';

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

type MetaAgentMcpClient = {
  client: Client;
  transport: StreamableHTTPClientTransport;
};

type McpToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

type SubmittedPlan = {
  requestId: string;
  planId: string;
  completion: Promise<unknown>;
};

type PlanSubmissionArgs = {
  title: string;
  planItems: string[];
  workOrderCount: number;
  risks: string | string[];
  modules?: Array<Record<string, unknown>>;
};

type PlanApprovalVisualRoute = {
  provider: string;
  model: string;
  effortLevel: string;
};

type PlanApprovalState = {
  requestId: string;
  status: 'submitted' | 'responded' | 'delivered' | 'closed';
  decision?: 'approved' | 'rejected' | 'dismissed';
  feedback?: string;
  deliveryMethod?: 'direct' | 'revive';
  planId?: string;
};

type ChildDispatch = {
  sessionId: string;
  status?: 'queued';
  queued?: boolean;
  queueId?: string;
};

type SpawnedSession = {
  sessionId: string;
  status: string;
};

type SessionListEntry = {
  id: string;
  title: string;
  provider: string;
  model?: string;
  sessionType?: string;
  agentRole?: string;
  createdBySessionId?: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  isArchived?: boolean;
  isPinned?: boolean;
  parentSessionId?: string | null;
  worktreeId?: string | null;
  childCount?: number;
};

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;
let scriptedProvider: ScriptedCollaborationProvider;
let originalAlphaFeatures: Record<string, boolean> | null = null;
const mcpClients: MetaAgentMcpClient[] = [];
const PLAN_APPROVAL_SCREENSHOT_DIR = path.resolve(
  __dirname,
  '../../../../e2e_test_output/plan-approval-layout',
);

async function invokeElectron<T>(targetPage: Page, channel: string, ...args: unknown[]): Promise<T> {
  return await targetPage.evaluate(
    async ({ invokeChannel, invokeArgs }) => {
      return await (window as any).electronAPI.invoke(invokeChannel, ...invokeArgs);
    },
    { invokeChannel: channel, invokeArgs: args },
  );
}

async function queryDb<T>(targetPage: Page, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await invokeElectron<{ rows?: T[]; error?: string }>(targetPage, 'test:query-db', sql, params);
  if (result.error) {
    throw new Error(`Read-only E2E database query failed: ${result.error}`);
  }
  return result.rows ?? [];
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseMcpToolResult<T>(result: unknown): T {
  const mcpResult = result as McpToolResult;
  const text = mcpResult.content?.find((entry) => entry.type === 'text')?.text;
  if (mcpResult.isError || typeof text !== 'string') {
    throw new Error(`Meta-agent MCP tool failed: ${JSON.stringify(result)}`);
  }
  return JSON.parse(text) as T;
}

async function callMetaAgentTool<T>(client: MetaAgentMcpClient, name: string, args: Record<string, unknown>): Promise<T> {
  return parseMcpToolResult<T>(await client.client.callTool({ name, arguments: args }));
}

async function getMetaAgentServerPort(targetPage: Page): Promise<number> {
  const result = await invokeElectron<{ success: boolean; port: number | null }>(targetPage, 'meta-agent:get-server-port');
  if (!result.success || !result.port) {
    throw new Error(`Meta-agent MCP port unavailable: ${JSON.stringify(result)}`);
  }
  return result.port;
}

async function getMcpAuthToken(targetPage: Page): Promise<string> {
  const result = await invokeElectron<{ success: boolean; token: string | null }>(targetPage, 'mcp:get-auth-token');
  if (!result.success || !result.token) {
    throw new Error(`MCP auth token unavailable: ${JSON.stringify(result)}`);
  }
  return result.token;
}

async function createMetaAgentClient(sessionId: string): Promise<MetaAgentMcpClient> {
  const [port, token] = await Promise.all([
    getMetaAgentServerPort(page),
    getMcpAuthToken(page),
  ]);
  const transport = new StreamableHTTPClientTransport(
    new URL(
      `http://127.0.0.1:${port}/mcp?sessionId=${encodeURIComponent(sessionId)}&workspaceId=${encodeURIComponent(workspacePath)}`,
    ),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  );
  const client = new Client(
    { name: 'playwright-collaboration-chain', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  const metaClient = { client, transport };
  mcpClients.push(metaClient);
  return metaClient;
}

async function createMetaAgentSession(title: string): Promise<string> {
  const sessionId = randomUUID();
  const result = await invokeElectron<{ success: boolean; id?: string; error?: string }>(page, 'sessions:create', {
    session: {
      id: sessionId,
      provider: 'lmstudio',
      model: 'lmstudio:scripted-collaboration-model',
      title,
      agentRole: 'meta-agent',
    },
    workspaceId: workspacePath,
  });
  if (!result.success || !result.id) {
    throw new Error(`Failed to create meta-agent session: ${result.error ?? 'unknown error'}`);
  }
  return result.id;
}

async function findNewSubmittedPlan(
  targetPage: Page,
  sessionId: string,
  knownRequestIds: ReadonlySet<string>,
): Promise<{ requestId: string; planId: string } | null> {
  const rows = await queryDb<{ content: unknown }>(
    targetPage,
    `SELECT content
       FROM ai_agent_messages
      WHERE session_id = $1
        AND content LIKE '%"type":"nimbalyst_tool_use"%'
        AND content LIKE '%"name":"ExitPlanMode"%'
      ORDER BY id DESC
      LIMIT 20`,
    [sessionId],
  );
  for (const row of rows) {
    const content = parseJsonRecord(row.content);
    const requestId = typeof content?.id === 'string' ? content.id : null;
    const input = parseJsonRecord(content?.input);
    const planId = typeof input?.planId === 'string' ? input.planId : null;
    if (requestId && planId && !knownRequestIds.has(requestId)) {
      return { requestId, planId };
    }
  }
  return null;
}

async function startPlanSubmission(
  client: MetaAgentMcpClient,
  sessionId: string,
  knownRequestIds: Set<string>,
  args: PlanSubmissionArgs,
  signal?: AbortSignal,
): Promise<SubmittedPlan> {
  const completion = signal
    ? client.client.callTool({ name: 'submit_plan', arguments: args }, undefined, { signal })
    : client.client.callTool({ name: 'submit_plan', arguments: args });

  await expect.poll(
    async () => (await findNewSubmittedPlan(page, sessionId, knownRequestIds))?.requestId ?? '',
    { timeout: 10_000 },
  ).not.toBe('');

  const submitted = await findNewSubmittedPlan(page, sessionId, knownRequestIds);
  if (!submitted) {
    throw new Error('Submitted plan was not durably persisted');
  }
  knownRequestIds.add(submitted.requestId);
  return { ...submitted, completion };
}

async function getPlanApprovalVisualRoute(): Promise<PlanApprovalVisualRoute> {
  const routes = await page.evaluate(async () => {
    const response = await (window as any).electronAPI.aiGetModels();
    const grouped = response?.grouped;
    if (!response?.success || !grouped || typeof grouped !== 'object') {
      return [];
    }
    return Object.entries(grouped as Record<string, unknown>).flatMap(
      ([groupedProvider, models]) => Array.isArray(models)
        ? models.flatMap((model) => {
            if (!model || typeof model !== 'object') return [];
            const record = model as Record<string, unknown>;
            const provider = typeof record.provider === 'string'
              ? record.provider
              : groupedProvider;
            const id = typeof record.id === 'string' ? record.id : '';
            const effortLevels = Array.isArray(record.supportedEffortLevels)
              ? record.supportedEffortLevels.filter((level): level is string =>
                  typeof level === 'string',
                )
              : [];
            return provider && id.startsWith(`${provider}:`) && effortLevels.length > 0
              ? [{ provider, model: id, effortLevels }]
              : [];
          })
        : [],
    );
  });
  const route = routes.find((candidate) => candidate.effortLevels.includes('high'))
    ?? routes[0];
  if (!route) {
    throw new Error(
      `No live plan-approval model route with a supported effort level: ${JSON.stringify(routes)}`,
    );
  }
  return {
    provider: route.provider,
    model: route.model,
    effortLevel: route.effortLevels.includes('high') ? 'high' : route.effortLevels[0]!,
  };
}

async function setPlanApprovalCardWidth(card: Locator, width: number): Promise<void> {
  await card.evaluate((element, targetWidth) => {
    const renderedCard = element as HTMLElement;
    renderedCard.style.width = `${targetWidth}px`;
    renderedCard.style.maxWidth = `${targetWidth}px`;
  }, width);
  await expect(card).toHaveCSS('width', `${width}px`);
}

async function expectPlanModuleFieldsNotToOverlap(
  card: Locator,
  moduleIndex: number,
): Promise<void> {
  const overlapPairs = await card
    .getByTestId(`plan-module-fields-${moduleIndex}`)
    .evaluate((element) => {
      const boxes = Array.from(element.children).map((child, index) => {
        const rect = child.getBoundingClientRect();
        return {
          index,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      const overlaps: string[] = [];
      for (let left = 0; left < boxes.length; left += 1) {
        for (let right = left + 1; right < boxes.length; right += 1) {
          const first = boxes[left]!;
          const second = boxes[right]!;
          if (
            first.left < second.right
            && first.right > second.left
            && first.top < second.bottom
            && first.bottom > second.top
          ) {
            overlaps.push(`${first.index}:${second.index}`);
          }
        }
      }
      return overlaps;
    });
  expect(overlapPairs).toEqual([]);
}

async function expectPlanModuleFieldsToFollowContainerWidth(
  card: Locator,
  moduleIndex: number,
  expectedColumns: 1 | 2,
): Promise<void> {
  const layout = await card
    .getByTestId(`plan-module-fields-${moduleIndex}`)
    .evaluate((element) => {
      const [first, second] = Array.from(element.children);
      if (!first || !second) {
        throw new Error('Plan module must render output and input fields');
      }
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      const moduleCard = element.closest('.plan-module-card');
      return {
        containerType: moduleCard
          ? getComputedStyle(moduleCard).containerType
          : null,
        first: { top: firstRect.top, bottom: firstRect.bottom, left: firstRect.left },
        second: { top: secondRect.top, bottom: secondRect.bottom, left: secondRect.left },
      };
    });

  expect(layout.containerType).toBe('inline-size');
  if (expectedColumns === 1) {
    expect(layout.second.top).toBeGreaterThanOrEqual(layout.first.bottom);
  } else {
    expect(layout.second.top).toBeCloseTo(layout.first.top, 1);
    expect(layout.second.left).toBeGreaterThan(layout.first.left);
  }
}

/**
 * Keep the visual evidence focused on the actual paginated module region.
 * The outer approval widget also includes the surrounding chat-message frame,
 * which is intentionally much taller than the plan card in the live shell.
 */
async function capturePlanApprovalEvidence(
  card: Locator,
  screenshotPath: string,
): Promise<void> {
  const moduleRegion = card.getByTestId('plan-approval-modules');
  await moduleRegion.evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
    let ancestor = element.parentElement;
    while (ancestor) {
      if (ancestor.scrollHeight > ancestor.clientHeight) {
        const elementTop = element.getBoundingClientRect().top;
        const ancestorTop = ancestor.getBoundingClientRect().top;
        ancestor.scrollTop += elementTop - ancestorTop - 16;
      }
      ancestor = ancestor.parentElement;
    }
  });
  const headerBottom = await card
    .getByTestId('plan-approval-header')
    .evaluate((element) => element.getBoundingClientRect().bottom);
  await moduleRegion.evaluate((element, targetTop) => {
    let ancestor = element.parentElement;
    while (ancestor) {
      const overflowY = getComputedStyle(ancestor).overflowY;
      if (
        ancestor.scrollHeight > ancestor.clientHeight
        && (overflowY === 'auto' || overflowY === 'scroll')
      ) {
        ancestor.scrollTop += element.getBoundingClientRect().top - targetTop;
        return;
      }
      ancestor = ancestor.parentElement;
    }
  }, headerBottom + 12);
  const boundingBox = await moduleRegion.boundingBox();
  if (!boundingBox) {
    throw new Error('Plan approval module region has no visible bounding box');
  }
  await page.screenshot({ path: screenshotPath, clip: boundingBox });
}

function visualSmokeModules(
  route: PlanApprovalVisualRoute,
): Array<Record<string, unknown>> {
  return [1, 2, 3].map((moduleIndex) => ({
    title: `模块 ${moduleIndex}：翻页布局验收`,
    outputFiles: [
      `packages/electron/src/renderer/components/UnifiedAI/very-long-module-${moduleIndex}-output-file-name-that-must-wrap-without-overlap.tsx`,
    ],
    inputs: [
      `模块 ${moduleIndex} 的原料说明：在窄对话列里保持单列展示，不能与产出文件重叠。`,
    ],
    provider: route.provider,
    model: route.model,
    effortLevel: route.effortLevel,
    doneCriteria: `模块 ${moduleIndex} 的字段、下拉和审批动作在任意卡片宽度下均可读。`,
    ...(moduleIndex === 1
      ? {
          candidates: [
            {
              name: '方案 A',
              approach: '保留横向矩阵以便同一模块内比较。',
              pros: ['字段横向对齐'],
              cons: '窄宽度时横向滚动',
              risks: ['未选择候选方案'],
              provider: route.provider,
              model: route.model,
              effortLevel: 'low',
            },
            {
              name: '方案 B',
              approach: '使用另一条候选路线。',
              pros: ['视觉对比清楚'],
              cons: '需要横向查看',
              risks: ['需要确认选择'],
              provider: route.provider,
              model: route.model,
              effortLevel: route.effortLevel,
            },
          ],
        }
      : {}),
  }));
}

async function getPlanApprovalState(sessionId: string, requestId: string): Promise<PlanApprovalState | null> {
  const result = await invokeElectron<{ success: boolean; state: PlanApprovalState | null; error?: string }>(
    page,
    'ai:getPlanApprovalState',
    workspacePath,
    sessionId,
    requestId,
  );
  if (!result.success) {
    throw new Error(`Could not read durable approval state: ${result.error ?? 'unknown error'}`);
  }
  return result.state;
}

async function waitForClosedApproval(sessionId: string, requestId: string): Promise<PlanApprovalState> {
  await expect.poll(
    async () => (await getPlanApprovalState(sessionId, requestId))?.status ?? '',
    { timeout: 15_000 },
  ).toBe('closed');
  const state = await getPlanApprovalState(sessionId, requestId);
  if (!state) {
    throw new Error(`Closed approval ${requestId} disappeared`);
  }
  return state;
}

async function assertApprovalLifecycle(
  sessionId: string,
  requestId: string,
  expected: { decision: 'approved' | 'rejected'; method: 'direct' | 'revive'; feedback?: string },
): Promise<void> {
  // The revive route is deliberately asynchronous: the real response IPC
  // returns after durable acknowledgement, then queues the Head continuation.
  // Wait for the state machine's terminal state before reading its ordered
  // transcript evidence.
  const state = await waitForClosedApproval(sessionId, requestId);
  const rows = await queryDb<{ content: unknown }>(
    page,
    `SELECT content
       FROM ai_agent_messages
      WHERE session_id = $1
        AND content LIKE $2
      ORDER BY id ASC`,
    [sessionId, `%${requestId}%`],
  );
  const contents = rows
    .map((row) => parseJsonRecord(row.content))
    .filter((content): content is Record<string, unknown> => content !== null);

  const submittedAt = contents.findIndex((content) =>
    content.type === 'nimbalyst_tool_use'
      && content.id === requestId
      && content.name === 'ExitPlanMode',
  );
  const respondedAt = contents.findIndex((content) =>
    content.type === 'exit_plan_mode_response'
      && content.requestId === requestId
      && content.approved === (expected.decision === 'approved'),
  );
  const deliveredAt = contents.findIndex((content) =>
    content.type === 'plan_approval_delivery'
      && content.requestId === requestId
      && content.method === expected.method,
  );
  const closedAt = contents.findIndex((content) =>
    content.type === 'nimbalyst_tool_result'
      && content.tool_use_id === requestId,
  );

  expect(submittedAt).toBeGreaterThanOrEqual(0);
  expect(respondedAt).toBeGreaterThan(submittedAt);
  expect(deliveredAt).toBeGreaterThan(respondedAt);
  expect(closedAt).toBeGreaterThan(deliveredAt);

  expect(state.requestId).toBe(requestId);
  expect(state.decision).toBe(expected.decision);
  expect(state.deliveryMethod).toBe(expected.method);
  if (expected.feedback) {
    expect(state.feedback).toBe(expected.feedback);
  }
}

async function installRendererEventRecorder(targetPage: Page): Promise<void> {
  await targetPage.evaluate(() => {
    const state = globalThis as any;
    state.__collabE2eMessageEvents = [];
    state.__collabE2eMessageEventsCleanup?.();
    state.__collabE2eMessageEventsCleanup = (window as any).electronAPI.on(
      'ai:message-logged',
      (payload: unknown) => state.__collabE2eMessageEvents.push(payload),
    );
  });
}

async function resetRendererEvents(targetPage: Page): Promise<void> {
  await targetPage.evaluate(() => {
    (globalThis as any).__collabE2eMessageEvents = [];
  });
}

async function getRendererEvents(targetPage: Page, sessionId: string): Promise<unknown[]> {
  return await targetPage.evaluate((targetSessionId) => {
    const events = (globalThis as any).__collabE2eMessageEvents ?? [];
    return events.filter((event: { sessionId?: unknown }) => event?.sessionId === targetSessionId);
  }, sessionId);
}

async function selectMetaAgent(sessionId: string): Promise<void> {
  const header = page.locator(
    `[data-testid="meta-agent-group"][data-meta-session-id="${sessionId}"] [data-testid="meta-agent-group-header"]`,
  );
  // The session is created through the real main-process IPC entry point.
  // Reuse the app's existing E2E refresh helper so the already-mounted
  // SessionHistory fetches the durable session before we assert its card.
  if (!await header.isVisible().catch(() => false)) {
    await page.evaluate(async () => {
      const refresh = (globalThis as any).__testHelpers?.refreshSessions;
      if (typeof refresh !== 'function') {
        throw new Error('Renderer E2E session refresh helper is unavailable');
      }
      await refresh();
    });
  }
  if (!await header.isVisible().catch(() => false)) {
    const listResult = await invokeElectron<{ success: boolean; sessions: SessionListEntry[] }>(
      page,
      'sessions:list',
      workspacePath,
      { includeArchived: false },
    );
    const durableSession = listResult.sessions.find((session) => session.id === sessionId);
    if (!listResult.success || !durableSession) {
      throw new Error(`Durable meta-agent session ${sessionId} was not listed by the real sessions IPC`);
    }
    // The app exposes this existing E2E-only hook for IPC-created sessions.
    // The card itself still loads from the real transcript after selection.
    await page.evaluate(({ session, workspaceId }) => {
      const inject = (globalThis as any).__testHelpers?.injectSessions;
      if (typeof inject !== 'function') {
        throw new Error('Renderer E2E session injection helper is unavailable');
      }
      inject([{ ...session, workspaceId }]);
    }, { session: durableSession, workspaceId: workspacePath });
  }
  await expect(header).toBeVisible({ timeout: 10_000 });
  await header.click();
}

async function waitForPendingApprovalCard(sessionId: string): Promise<Locator> {
  await selectMetaAgent(sessionId);
  let card = page.locator('[data-testid="plan-approval-widget"][data-state="pending"]').last();
  // The first card proves the live transcript path. For a replacement card,
  // force the existing dev-only canonical reparse IPC. It emits the real
  // `transcript:session-reparsed` renderer signal, whose production listener
  // reloads the durable transcript without fabricating a message event.
  const arrivedLive = await card.isVisible().catch(() => false);
  if (!arrivedLive) {
    const reparseResult = await invokeElectron<{ success: boolean; sessionId: string }>(
      page,
      'transcript:force-reparse-session',
      sessionId,
    );
    expect(reparseResult).toMatchObject({ success: true, sessionId });
    card = page.locator('[data-testid="plan-approval-widget"][data-state="pending"]').last();
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByTestId('meta-agent-plan-marker')).toBeVisible({ timeout: 10_000 });
  return card;
}

async function createImplementationChild(
  client: MetaAgentMcpClient,
  planId: string,
  title: string,
  prompt: string,
): Promise<ChildDispatch> {
  return await callMetaAgentTool<ChildDispatch>(client, 'create_session', {
    title,
    prompt,
    intent: 'implementation',
    planId,
    maxParallelOverride: 2,
  });
}

async function listSpawnedSessions(client: MetaAgentMcpClient): Promise<SpawnedSession[]> {
  return await callMetaAgentTool<SpawnedSession[]>(client, 'list_spawned_sessions', {});
}

async function sendRealProviderTurn(sessionId: string, prompt: string): Promise<{ content: string }> {
  return await invokeElectron<{ content: string }>(
    page,
    'ai:sendMessage',
    prompt,
    undefined,
    sessionId,
    workspacePath,
  );
}

async function countChildSessions(sessionId: string): Promise<number> {
  const rows = await queryDb<{ count: string | number }>(
    page,
    `SELECT COUNT(*)::text AS count
       FROM ai_sessions
      WHERE workspace_id = $1 AND created_by_session_id = $2`,
    [workspacePath, sessionId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function countRunningChildSessions(sessionId: string): Promise<number> {
  const rows = await queryDb<{ count: string | number }>(
    page,
    `SELECT COUNT(*)::text AS count
       FROM ai_sessions
      WHERE workspace_id = $1
        AND created_by_session_id = $2
        AND status = 'running'`,
    [workspacePath, sessionId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function getDispatchStatus(reservedSessionId: string): Promise<string | null> {
  const rows = await queryDb<{ status: string }>(
    page,
    `SELECT status
       FROM dispatch_queue
      WHERE reserved_session_id = $1
      ORDER BY requested_at DESC
      LIMIT 1`,
    [reservedSessionId],
  );
  return rows[0]?.status ?? null;
}

async function getWorkOrderStatus(sessionId: string): Promise<string | null> {
  const rows = await queryDb<{ data: unknown }>(
    page,
    `SELECT data
       FROM tracker_items
      WHERE type = 'work-order'
        AND source_ref = $1
      LIMIT 1`,
    [`meta-agent-work-order:${sessionId}`],
  );
  const data = parseJsonRecord(rows[0]?.data);
  return typeof data?.status === 'string' ? data.status : null;
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  scriptedProvider = new ScriptedCollaborationProvider();
  await scriptedProvider.start();

  workspacePath = await createTempWorkspace();
  await fs.writeFile(path.join(workspacePath, 'README.md'), '# Collaboration E2E workspace\n', 'utf8');
  execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], { cwd: workspacePath, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'E2E Test'], { cwd: workspacePath, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: workspacePath, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'Initial workspace'], { cwd: workspacePath, stdio: 'pipe' });

  electronApp = await launchElectronApp({
    workspace: workspacePath,
    permissionMode: 'allow-all',
  });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
  originalAlphaFeatures = await invokeElectron<Record<string, boolean>>(page, 'alpha-features:get');
  await invokeElectron(page, 'alpha-features:set', { 'meta-agent': true });
  // The Alpha flag is read into renderer settings on startup. Reload before
  // creating the session so the real MetaAgentGroup rendering path is active.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
  await switchToAgentMode(page);
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode)).toBeVisible();
  await installRendererEventRecorder(page);
});

test.afterAll(async () => {
  for (const client of mcpClients) {
    await client.transport.terminateSession().catch(() => undefined);
    await client.transport.close().catch(() => undefined);
  }
  if (page) {
    await page.evaluate(() => {
      const state = globalThis as any;
      state.__collabE2eMessageEventsCleanup?.();
    }).catch(() => undefined);
    if (originalAlphaFeatures) {
      await invokeElectron(page, 'alpha-features:set', originalAlphaFeatures).catch(() => undefined);
    }
  }
  await electronApp?.close().catch(() => undefined);
  await scriptedProvider?.stop().catch(() => undefined);
  if (workspacePath) {
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('creates a real meta-agent session from the New Meta Agent renderer entry point', async () => {
  const beforeRows = await queryDb<{ count: string | number }>(
    page,
    `SELECT COUNT(*) AS count
       FROM ai_sessions
      WHERE workspace_id = $1`,
    [workspacePath],
  );
  const beforeCount = Number(beforeRows[0]?.count ?? 0);

  await page.getByTestId('new-dropdown-button').click();
  const newMetaAgentButton = page.getByTestId('new-meta-agent-button');
  await expect(newMetaAgentButton).toBeVisible();
  await newMetaAgentButton.click();

  await expect.poll(
    async () => {
      const rows = await queryDb<{ count: string | number }>(
        page,
        `SELECT COUNT(*) AS count
           FROM ai_sessions
          WHERE workspace_id = $1`,
        [workspacePath],
      );
      return Number(rows[0]?.count ?? 0);
    },
    { timeout: 10_000 },
  ).toBe(beforeCount + 1);

  const createdRows = await queryDb<{ id: string; agent_role: string }>(
    page,
    `SELECT id, agent_role
       FROM ai_sessions
      WHERE workspace_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [workspacePath],
  );
  expect(createdRows[0]).toMatchObject({ agent_role: 'meta-agent' });
});

test('captures paginated plan approval layouts across narrow, medium, and wide card containers', async () => {
  const headSessionId = await createMetaAgentSession('Plan approval visual smoke Head');
  const client = await createMetaAgentClient(headSessionId);
  const submittedRequestIds = new Set<string>();
  await fs.mkdir(PLAN_APPROVAL_SCREENSHOT_DIR, { recursive: true });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 1600);
  });
  await expect.poll(
    async () => await page.evaluate(() => window.innerWidth),
  ).toBeGreaterThanOrEqual(1200);
  const route = await getPlanApprovalVisualRoute();

  const plan = await startPlanSubmission(client, headSessionId, submittedRequestIds, {
    title: '三模块翻页方案卡装包烟测',
    planItems: ['逐页审阅模块', '只打回当前模块', '确认全部批准入口常驻'],
    workOrderCount: 3,
    risks: ['第 2 个模块需要修改时不得影响第 1 和第 3 个模块。'],
    modules: visualSmokeModules(route),
  });
  const card = await waitForPendingApprovalCard(headSessionId);
  const firstModule = card.getByTestId('plan-module-card-1');

  await expect(card.getByTestId('plan-module-pagination')).toContainText('第 1 个 / 共 3 个');
  await expect(firstModule).toBeVisible();
  await expect(card.getByTestId('plan-module-card-2')).toHaveCount(0);
  await expect(card.getByTestId('plan-module-model-select-1')).toHaveValue(route.model);
  await expect(card.getByTestId('plan-module-effort-select-1')).toHaveValue(route.effortLevel);

  for (const width of [360, 480, 720]) {
    await setPlanApprovalCardWidth(card, width);
    await expectPlanModuleFieldsNotToOverlap(card, 1);
    await expectPlanModuleFieldsToFollowContainerWidth(
      card,
      1,
      width === 720 ? 2 : 1,
    );
    const screenshotPath = path.join(
      PLAN_APPROVAL_SCREENSHOT_DIR,
      `plan-card-${width}-page-1.png`,
    );
    await capturePlanApprovalEvidence(card, screenshotPath);
    expect((await fs.stat(screenshotPath)).size).toBeGreaterThan(0);
  }

  // The evidence captures intentionally exceed the live chat column; return
  // to its interactive 360px width before using the visible paginator.
  await setPlanApprovalCardWidth(card, 360);
  await card.getByTestId('plan-module-next').click();
  await expect(card.getByTestId('plan-module-pagination')).toContainText('第 2 个 / 共 3 个');
  await expect(card.getByTestId('plan-module-card-1')).toHaveCount(0);
  await expect(card.getByTestId('plan-module-card-2')).toBeVisible();
  await expect(card.getByTestId('plan-module-status-dot-2')).toHaveAttribute('data-current', 'true');

  await card.getByTestId('plan-module-request-changes-2').click();
  await card
    .getByTestId('plan-module-feedback-input-2')
    .fill('第 2 个模块需要修订后再派发。');
  await card.getByTestId('plan-module-submit-changes-2').click();
  const rejectedCard = page.getByTestId('plan-approval-widget').last();
  await expect(rejectedCard.getByTestId('plan-module-status-dot-1')).toHaveAttribute('data-status', 'pending');
  await expect(rejectedCard.getByTestId('plan-module-status-dot-2')).toHaveAttribute('data-status', 'rejected');
  await expect(rejectedCard.getByTestId('plan-module-status-dot-3')).toHaveAttribute('data-status', 'pending');
  await expect(rejectedCard.getByTestId('plan-approval-revision-warning')).toContainText('1 个模块待修订');
  await setPlanApprovalCardWidth(rejectedCard, 480);
  await expectPlanModuleFieldsNotToOverlap(rejectedCard, 2);
  const rejectedScreenshotPath = path.join(
    PLAN_APPROVAL_SCREENSHOT_DIR,
    'plan-card-480-page-2-rejected.png',
  );
  await capturePlanApprovalEvidence(rejectedCard, rejectedScreenshotPath);
  expect((await fs.stat(rejectedScreenshotPath)).size).toBeGreaterThan(0);

  const rejectedPlanResult = parseMcpToolResult<{
    approved: boolean;
    feedback?: string;
  }>(await plan.completion);
  expect(rejectedPlanResult).toMatchObject({
    approved: false,
    feedback: '第 2 个模块需要修订后再派发。',
  });
  await assertApprovalLifecycle(headSessionId, plan.requestId, {
    decision: 'rejected',
    method: 'direct',
    feedback: '第 2 个模块需要修订后再派发。',
  });
});

test('replays the approved collaboration chain through real IPC, durable state, dispatch gates, and renderer events', async () => {
  const headSessionId = await createMetaAgentSession('Scripted collaboration Head');
  const client = await createMetaAgentClient(headSessionId);
  const submittedRequestIds = new Set<string>();

  const initialPlan = await startPlanSubmission(client, headSessionId, submittedRequestIds, {
    title: 'Parallel collaboration plan',
    planItems: ['Split work into three bounded work orders', 'Synthesize the completed work'],
    workOrderCount: 3,
    risks: 'The third work order must wait for an execution slot.',
  });
  const initialCard = await waitForPendingApprovalCard(headSessionId);
  await expect(initialCard).toContainText('Parallel collaboration plan');

  await resetRendererEvents(page);
  await initialCard.getByTestId('plan-approval-request-changes').click();
  await initialCard.getByTestId('plan-approval-feedback-input').fill('Split the integration task before approval.');
  await initialCard.getByTestId('plan-approval-submit-changes').click();

  const rejectedPlanResult = parseMcpToolResult<{
    approved: boolean;
    deliveryMethod: string;
    feedback?: string;
  }>(await initialPlan.completion);
  expect(rejectedPlanResult).toMatchObject({
    approved: false,
    deliveryMethod: 'direct',
    feedback: 'Split the integration task before approval.',
  });
  await assertApprovalLifecycle(headSessionId, initialPlan.requestId, {
    decision: 'rejected',
    method: 'direct',
    feedback: 'Split the integration task before approval.',
  });
  await expect.poll(
    async () => (await getRendererEvents(page, headSessionId)).length,
    { timeout: 10_000 },
  ).toBeGreaterThan(0);

  const revisedPlan = await startPlanSubmission(client, headSessionId, submittedRequestIds, {
    title: 'Parallel collaboration plan, revised',
    planItems: ['Delegate parser work', 'Delegate validation work', 'Delegate integration work'],
    workOrderCount: 3,
    risks: 'The third work order remains queued until a running sibling completes.',
  });
  const revisedCard = await waitForPendingApprovalCard(headSessionId);
  await expect(revisedCard).toContainText('Parallel collaboration plan, revised');

  await resetRendererEvents(page);
  await revisedCard.getByTestId('plan-approval-approve').click();
  const approvedPlanResult = parseMcpToolResult<{
    approved: boolean;
    planId: string;
    deliveryMethod: string;
  }>(await revisedPlan.completion);
  expect(approvedPlanResult).toMatchObject({
    approved: true,
    planId: revisedPlan.planId,
    deliveryMethod: 'direct',
  });
  await assertApprovalLifecycle(headSessionId, revisedPlan.requestId, {
    decision: 'approved',
    method: 'direct',
  });
  await expect.poll(
    async () => (await getRendererEvents(page, headSessionId)).length,
    { timeout: 10_000 },
  ).toBeGreaterThan(0);

  const childA = await createImplementationChild(
    client,
    revisedPlan.planId,
    'Parser work order',
    'Prepare the parser work order.',
  );
  const childATurn = sendRealProviderTurn(childA.sessionId, '[scripted:hold=child-a] Execute parser work.').catch(() => ({ content: '' }));
  await scriptedProvider.waitForPrompt('scripted:hold=child-a');
  await expect.poll(async () => countRunningChildSessions(headSessionId)).toBe(1);

  const childB = await createImplementationChild(
    client,
    revisedPlan.planId,
    'Validation work order',
    'Prepare the validation work order.',
  );
  const childBTurn = sendRealProviderTurn(childB.sessionId, '[scripted:hold=child-b] Execute validation work.');
  await scriptedProvider.waitForPrompt('scripted:hold=child-b');
  await expect.poll(async () => countRunningChildSessions(headSessionId)).toBe(2);

  const childC = await createImplementationChild(
    client,
    revisedPlan.planId,
    'Integration work order',
    'Prepare the integration work order.',
  );
  expect(childC).toMatchObject({ status: 'queued', queued: true });
  expect(await getDispatchStatus(childC.sessionId)).toBe('queued');

  scriptedProvider.releaseHold('child-b');
  await expect(childBTurn).resolves.toMatchObject({ content: 'Scripted provider completed the requested collaboration turn.' });
  await expect.poll(async () => getDispatchStatus(childC.sessionId), { timeout: 15_000 }).toBe('dispatched');
  await expect.poll(async () => {
    const children = await listSpawnedSessions(client);
    return children.find((child) => child.sessionId === childC.sessionId)?.status ?? '';
  }).not.toBe('queued');

  const interruptResult = await callMetaAgentTool<{
    success: boolean;
    results: Array<{ sessionId: string; outcome: string }>;
  }>(client, 'interrupt_session', {
    sessionId: childA.sessionId,
    queueAction: 'pause',
  });
  expect(interruptResult.success).toBe(true);
  expect(interruptResult.results).toContainEqual(expect.objectContaining({
    sessionId: childA.sessionId,
    outcome: 'interrupted',
  }));
  await childATurn;
  await expect.poll(async () => {
    const children = await listSpawnedSessions(client);
    return children.find((child) => child.sessionId === childA.sessionId)?.status ?? '';
  }).toBe('interrupted');

  const childrenBeforeResume = await countChildSessions(headSessionId);
  const resumeResult = await callMetaAgentTool<{
    sessionId: string;
    bypassedExecutionForTest?: boolean;
  }>(client, 'send_prompt', {
    sessionId: childA.sessionId,
    prompt: 'Resume the original parser work order in this same session.',
  });
  expect(resumeResult).toMatchObject({ sessionId: childA.sessionId, bypassedExecutionForTest: true });
  expect(await countChildSessions(headSessionId)).toBe(childrenBeforeResume);

  const childAResumedTurn = sendRealProviderTurn(
    childA.sessionId,
    '[scripted:hold=child-a-resumed] Continue parser work in the resumed session.',
  ).catch(() => ({ content: '' }));
  await scriptedProvider.waitForPrompt('scripted:hold=child-a-resumed');
  const childCTurn = sendRealProviderTurn(
    childC.sessionId,
    '[scripted:hold=child-c] Execute integration work after automatic refill.',
  ).catch(() => ({ content: '' }));
  await scriptedProvider.waitForPrompt('scripted:hold=child-c');
  await expect.poll(async () => countRunningChildSessions(headSessionId)).toBe(2);

  // The original three work orders converge before the separate stop-and-clear
  // branch below. This keeps the primary script faithful to the Head's normal
  // finish-and-summarize path rather than treating interruption as completion.
  scriptedProvider.releaseHold('child-a-resumed');
  scriptedProvider.releaseHold('child-c');
  await childAResumedTurn;
  await childCTurn;
  await expect.poll(async () => getWorkOrderStatus(childA.sessionId), { timeout: 15_000 }).toBe('completed');
  await expect.poll(async () => getWorkOrderStatus(childB.sessionId), { timeout: 15_000 }).toBe('completed');
  await expect.poll(async () => getWorkOrderStatus(childC.sessionId), { timeout: 15_000 }).toBe('completed');

  const childD = await createImplementationChild(
    client,
    revisedPlan.planId,
    'Stop-and-clear running work order A',
    'Hold this running work order until the Head stops it.',
  );
  const childDTurn = sendRealProviderTurn(
    childD.sessionId,
    '[scripted:hold=child-d] Hold the first stop-and-clear work order.',
  ).catch(() => ({ content: '' }));
  await scriptedProvider.waitForPrompt('scripted:hold=child-d');

  const childE = await createImplementationChild(
    client,
    revisedPlan.planId,
    'Stop-and-clear running work order B',
    'Hold this second running work order until the Head stops it.',
  );
  const childETurn = sendRealProviderTurn(
    childE.sessionId,
    '[scripted:hold=child-e] Hold the second stop-and-clear work order.',
  ).catch(() => ({ content: '' }));
  await scriptedProvider.waitForPrompt('scripted:hold=child-e');
  await expect.poll(async () => countRunningChildSessions(headSessionId)).toBe(2);

  const childF = await createImplementationChild(
    client,
    revisedPlan.planId,
    'Queued stop-and-clear work order',
    'This work order must be cleared before it starts.',
  );
  expect(childF).toMatchObject({ status: 'queued', queued: true });
  expect(await getDispatchStatus(childF.sessionId)).toBe('queued');

  const stopResult = await invokeElectron<{
    success: boolean;
    stoppedChildren: number;
    clearedDispatches: number;
  }>(page, 'meta-agent:stop-and-clear', headSessionId, workspacePath);
  expect(stopResult.success).toBe(true);
  expect(stopResult.stoppedChildren).toBeGreaterThanOrEqual(3);
  expect(stopResult.clearedDispatches).toBeGreaterThanOrEqual(1);
  await childDTurn;
  await childETurn;
  await expect.poll(async () => countRunningChildSessions(headSessionId), { timeout: 15_000 }).toBe(0);
  expect(await getDispatchStatus(childF.sessionId)).toBe('cancelled');

  const childrenAfterStop = await listSpawnedSessions(client);
  expect(childrenAfterStop.find((child) => child.sessionId === childD.sessionId)?.status).toBe('interrupted');
  expect(childrenAfterStop.find((child) => child.sessionId === childE.sessionId)?.status).toBe('interrupted');

  await resetRendererEvents(page);
  const summaryResult = await sendRealProviderTurn(headSessionId, 'Produce final collaboration summary.');
  expect(summaryResult.content).toBe(SCRIPTED_FINAL_SUMMARY);
  await expect.poll(async () => {
    const rows = await queryDb<{ content: unknown }>(
      page,
      `SELECT content
         FROM ai_agent_messages
        WHERE session_id = $1 AND content = $2`,
      [headSessionId, SCRIPTED_FINAL_SUMMARY],
    );
    return rows.length;
  }).toBeGreaterThan(0);
  await expect.poll(
    async () => (await getRendererEvents(page, headSessionId)).length,
    { timeout: 10_000 },
  ).toBeGreaterThan(0);
  // Provider turns are delivered incrementally, while this explicit durable
  // reload verifies that the renderer can reconstruct the final summary from
  // the canonical transcript as well.
  await expect(
    invokeElectron<{ success: boolean; sessionId: string }>(
      page,
      'transcript:force-reparse-session',
      headSessionId,
    ),
  ).resolves.toMatchObject({ success: true, sessionId: headSessionId });
  await selectMetaAgent(headSessionId);
  await expect(page.getByText(SCRIPTED_FINAL_SUMMARY).last()).toBeVisible({ timeout: 10_000 });

  // `nimtc|...` is the Codex renderer lookup form. The durable approval
  // state machine is provider-neutral, so keep the Head on the local scripted
  // transport while exercising the exact Codex-shaped IPC identifiers.
  const codexVariantHead = await createMetaAgentSession('Codex composite-ID Head');
  const codexClient = await createMetaAgentClient(codexVariantHead);
  const codexRequestIds = new Set<string>();

  const codexInitial = await startPlanSubmission(codexClient, codexVariantHead, codexRequestIds, {
    title: 'Codex composite-ID plan',
    planItems: ['Use the synthetic lookup key', 'Verify the durable response route'],
    workOrderCount: 0,
    risks: 'The raw tool ID must be recovered from the composite renderer key.',
  });
  const codexInitialCompositeId = `nimtc|${codexInitial.requestId}|1784297999209|21431`;
  await expect(
    invokeElectron<{ success: boolean }>(
      page,
      'ai:exitPlanModeConfirmResponse',
      codexInitialCompositeId,
      codexVariantHead,
      { approved: false, feedback: 'Revise the Codex-shaped plan.' },
    ),
  ).resolves.toMatchObject({ success: true });
  const codexRejectedResult = parseMcpToolResult<{ approved: boolean; deliveryMethod: string }>(await codexInitial.completion);
  expect(codexRejectedResult).toMatchObject({ approved: false, deliveryMethod: 'direct' });
  await assertApprovalLifecycle(codexVariantHead, codexInitial.requestId, {
    decision: 'rejected',
    method: 'direct',
    feedback: 'Revise the Codex-shaped plan.',
  });
  const codexRejectedState = await getPlanApprovalState(codexVariantHead, codexInitialCompositeId);
  expect(codexRejectedState?.requestId).toBe(codexInitial.requestId);

  const abortController = new AbortController();
  const codexRevision = await startPlanSubmission(codexClient, codexVariantHead, codexRequestIds, {
    title: 'Codex composite-ID plan, revised',
    planItems: ['Approve through the composite key', 'Revive the dead approval turn'],
    workOrderCount: 0,
    risks: 'The original tool call is deliberately aborted before approval.',
  }, abortController.signal);
  abortController.abort();
  expect(abortController.signal.aborted).toBe(true);
  const abortedToolCall = codexRevision.completion.then(() => 'completed', () => 'aborted');

  const codexRevisionCompositeId = `nimtc|${codexRevision.requestId}|1784297999209|21432`;
  await resetRendererEvents(page);
  await expect(
    invokeElectron<{ success: boolean }>(
      page,
      'ai:exitPlanModeConfirmResponse',
      codexRevisionCompositeId,
      codexVariantHead,
      { approved: true },
    ),
  ).resolves.toMatchObject({ success: true });
  await assertApprovalLifecycle(codexVariantHead, codexRevision.requestId, {
    decision: 'approved',
    method: 'revive',
  });
  expect(['aborted', 'completed']).toContain(await abortedToolCall);
  const codexRevivedState = await getPlanApprovalState(codexVariantHead, codexRevisionCompositeId);
  expect(codexRevivedState).toMatchObject({
    requestId: codexRevision.requestId,
    status: 'closed',
    decision: 'approved',
    deliveryMethod: 'revive',
  });
  await scriptedProvider.waitForPrompt(`[Plan approval response]`);
  await expect.poll(async () => {
    const rows = await queryDb<{ content: unknown }>(
      page,
      `SELECT content
         FROM ai_agent_messages
        WHERE session_id = $1 AND content = $2`,
      [codexVariantHead, SCRIPTED_REVIVE_SUMMARY],
    );
    return rows.length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(
    async () => (await getRendererEvents(page, codexVariantHead)).length,
    { timeout: 10_000 },
  ).toBeGreaterThan(0);
});

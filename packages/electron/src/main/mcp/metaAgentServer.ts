import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";
import { randomUUID } from "crypto";
import {
  getDefaultDispatchPermissionKnobs,
  isDispatchDisturbanceLevel,
  isDispatchPermissionScope,
  type DispatchDisturbanceLevel,
  type DispatchPermissionScope,
} from "@nimbalyst/runtime/ai/server/dispatchPermissionKnobs";
import { requireMcpAuth } from "./mcpAuth";
import { resolveProjectPath } from "../utils/workspaceDetection";

type SessionIntent = "investigation" | "implementation";
/** Raw engine-declared value; providers must not be translated to a product enum. */
export type EffortLevel = string;
type CompletionCriteria = {
  outputFiles?: string[];
};

export type StructuredPlanText = string | string[];

export type PlanCandidate = {
  name: string;
  approach: string;
  pros: StructuredPlanText;
  cons: StructuredPlanText;
  risks: StructuredPlanText;
  provider: string;
  model: string;
  /**
   * Internal-only: preserves exactly what Head submitted for validation feedback.
   * It is deliberately non-enumerable, so it cannot reach the persisted card.
   */
  rawModelForValidation?: string;
  effortLevel?: EffortLevel;
  /** Worker role used to supply default dispatch knobs. */
  intent: SessionIntent;
  permissionScope: DispatchPermissionScope;
  disturbanceLevel: DispatchDisturbanceLevel;
  skillBundleName?: string;
  skillIds?: string[];
};

export type PlanModule = {
  title: string;
  outputFiles: string[];
  inputs: string[];
  provider: string;
  model: string;
  /**
   * Internal-only: preserves exactly what Head submitted for validation feedback.
   * It is deliberately non-enumerable, so it cannot reach the persisted card.
   */
  rawModelForValidation?: string;
  /** Internal submission-time marker; the card must wait for catalog confirmation. */
  modelCatalogPending?: boolean;
  effortLevel?: EffortLevel;
  /** Worker role used to supply default dispatch knobs. */
  intent: SessionIntent;
  permissionScope: DispatchPermissionScope;
  disturbanceLevel: DispatchDisturbanceLevel;
  skillBundleName?: string;
  skillIds?: string[];
  doneCriteria: string;
  candidates?: PlanCandidate[];
};

type CreateSessionArgs = {
  title?: string;
  provider?: string;
  model?: string;
  effortLevel?: EffortLevel;
  prompt?: string;
  useWorktree?: boolean;
  worktreeId?: string;
  toolScope?: string;
  intent: SessionIntent;
  planId?: string;
  /** Stable 1-based module position within the approved plan. */
  moduleIndex?: number;
  /** Explicit file deliverables named by the module completion standard. */
  outputFiles?: string[];
  completionCriteria?: CompletionCriteria;
  skillBundleName?: string;
  skillIds?: string[];
  maxParallelOverride?: number;
};

type RequestRedispatchArgs = {
  trackerItemId: string;
  provider: string;
  model: string;
  effortLevel?: EffortLevel;
  prompt: string;
  changeSummary: string;
  permissionScope: DispatchPermissionScope;
  disturbanceLevel: DispatchDisturbanceLevel;
  skillBundleName?: string;
  skillIds: string[];
};

type SpawnSessionArgs = {
  title?: string;
  prompt: string;
  useWorktree?: boolean;
  model?: string;
  effortLevel?: EffortLevel;
  notifyOnComplete?: boolean;
  intent: SessionIntent;
  planId?: string;
  /** Stable 1-based module position within the approved plan. */
  moduleIndex?: number;
  /** Explicit file deliverables named by the module completion standard. */
  outputFiles?: string[];
  completionCriteria?: CompletionCriteria;
  maxParallelOverride?: number;
  /**
   * When true, the new session is created at the top level — no parent,
   * no workstream container, no shared files-edited or tabs with the
   * caller. Use for fix-and-commit-separately work that should not pollute
   * the caller's workstream. When false (the default), the new session is
   * spawned as a sibling under the caller's workstream.
   */
  isolated?: boolean;
};

export type SubmitPlanArgs = {
  title: string;
  planItems: string[];
  workOrderCount: number;
  /** New calls use a list; the string form remains accepted for old callers. */
  risks: string | string[];
  /** Optional structured fields for the productized approval card. */
  modules?: PlanModule[];
};

const SUBMIT_PLAN_EXAMPLE = {
  title: "Implement the approved plan",
  planItems: ["Inspect the current workspace"],
  workOrderCount: 1,
  risks: [],
  modules: [
    {
      title: "Approval card",
      outputFiles: ["packages/electron/src/renderer/components/UnifiedAI/PlanApprovalWidget.tsx"],
      inputs: ["Existing approval-card behavior"],
      provider: "openai-codex",
      model: "gpt-5.4-mini",
      effortLevel: "medium",
      intent: "implementation",
      permissionScope: "workspace-write",
      disturbanceLevel: "on-failure",
      doneCriteria: "The card renders the fields and the approval test passes.",
      candidates: [
        {
          name: "方案 A",
          approach: "Render candidates as aligned matrix columns.",
          pros: ["Same fields share one row", "Easy to compare"],
          cons: "Narrow windows need horizontal scrolling.",
          risks: ["A stale choice could be approved."],
          provider: "openai-codex",
          model: "gpt-5.4-mini",
          effortLevel: "low",
          intent: "implementation",
          permissionScope: "workspace-write",
          disturbanceLevel: "on-failure",
        },
      ],
    },
  ],
};

const REQUEST_REDISPATCH_EXAMPLE: RequestRedispatchArgs = {
  trackerItemId: "failed-work-order-id",
  provider: "openai-codex",
  model: "openai-codex:gpt-5.6-sol",
  effortLevel: "high",
  prompt: "Revised task prompt for the replacement worker.",
  changeSummary: "Switch from the timed-out engine and narrow the task brief.",
  permissionScope: "workspace-write",
  disturbanceLevel: "on-failure",
  skillBundleName: "施工包",
  skillIds: [],
};

const SUBMIT_PLAN_DESCRIPTION = [
  "REQUIRED before any implementation, file write, or state change. Submit the only valid user-approval card; never ask for approval in chat text (the user will not answer it). Read-only investigation is exempt. Creates or updates one durable plan card and waits for approval; resubmit revisions here.",
  "Copy this complete minimal legal call:",
  JSON.stringify(SUBMIT_PLAN_EXAMPLE, null, 2),
  "title is a string and is required.",
  "planItems is a non-empty array of non-empty strings and is required.",
  "workOrderCount is an optional non-negative integer; omit it to use planItems.length.",
  "risks is a required array of strings and may be empty; [] means no risks were declared.",
  "modules is optional for backward compatibility. Each module records title, outputFiles, inputs, provider, a model taken from a list_models id (or that id's portion after the colon), optional model-declared effortLevel, intent, permissionScope, disturbanceLevel, optional skillBundleName/skillIds, and doneCriteria. resolvedModel is display-only and must never be used as a model value. Omitted knobs default by intent: investigation = read-only + never; implementation = workspace-write + on-failure. Omit skillBundleName and skillIds unless skills must be narrowed; omission preserves the engine's native default. skillIds: [] explicitly grants no skills.",
  "When there are multiple approaches, put them in modules[].candidates[] with name, approach, pros, cons, risks, provider, model, optional effortLevel, and optional intent/permissionScope/disturbanceLevel/skillBundleName/skillIds; do not write serial comparison paragraphs.",
].join("\n");

function submitPlanValidationError(message: string, example: string): Error {
  return new Error(`${message}. Correct example: ${example}`);
}

function requestRedispatchValidationError(message: string): Error {
  return new Error(`${message}. Correct example: ${JSON.stringify(REQUEST_REDISPATCH_EXAMPLE)}`);
}

/**
 * Validate and fill the submit_plan boundary once so the MCP and OpenAI-shaped
 * provider paths give the model the same actionable response.
 */
export function normalizeSubmitPlanArgs(value: Record<string, unknown> | undefined): SubmitPlanArgs {
  const args = value ?? {};
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title) {
    throw submitPlanValidationError(
      "title is required",
      '"title": "Implement the approved plan"',
    );
  }

  const rawPlanItems = args.planItems;
  const planItems = Array.isArray(rawPlanItems)
    ? rawPlanItems.map((item) => typeof item === "string" ? item.trim() : "")
    : [];
  if (
    !Array.isArray(rawPlanItems)
    || planItems.length === 0
    || planItems.some((item) => item.length === 0)
  ) {
    throw submitPlanValidationError(
      "planItems must be a non-empty list of non-empty strings",
      '"planItems": ["Inspect the current workspace"]',
    );
  }

  const workOrderCount = args.workOrderCount === undefined
    ? planItems.length
    : args.workOrderCount;
  if (typeof workOrderCount !== "number" || !Number.isInteger(workOrderCount) || workOrderCount < 0) {
    throw submitPlanValidationError(
      "workOrderCount must be a non-negative integer",
      '"workOrderCount": 1 (or omit it to use planItems.length)',
    );
  }

  const rawRisks = args.risks;
  let risks: string | string[];
  if (Array.isArray(rawRisks)) {
    const normalizedRisks = rawRisks.map((risk) => typeof risk === "string" ? risk.trim() : "");
    if (normalizedRisks.some((risk) => risk.length === 0)) {
      throw submitPlanValidationError(
        "risks must be a list of strings (an empty list is allowed)",
        '"risks": []',
      );
    }
    risks = normalizedRisks;
  } else if (typeof rawRisks === "string" && rawRisks.trim()) {
    // Keep accepting the historical string shape so already-configured Heads do
    // not regress while the advertised shape moves to a list.
    risks = rawRisks.trim();
  } else {
    throw submitPlanValidationError(
      "risks is required and must be a list of strings (an empty list is allowed)",
      '"risks": []',
    );
  }

  const modules = normalizePlanModules(args.modules);

  return {
    title,
    planItems,
    workOrderCount,
    risks,
    ...(modules === undefined ? {} : { modules }),
  };
}

function normalizeNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw submitPlanValidationError(
      `${fieldName} must be a non-empty string`,
      JSON.stringify(SUBMIT_PLAN_EXAMPLE),
    );
  }
  return value.trim();
}

function withRawModelForValidation<T extends PlanModule | PlanCandidate>(
  value: T,
  rawModel: unknown,
): T {
  if (typeof rawModel === 'string') {
    Object.defineProperty(value, 'rawModelForValidation', {
      value: rawModel,
      enumerable: false,
    });
  }
  return value;
}

function normalizeStringList(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw submitPlanValidationError(
      `${fieldName} must be an array of strings`,
      JSON.stringify(SUBMIT_PLAN_EXAMPLE),
    );
  }
  const normalized = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (normalized.some((item) => item.length === 0)) {
    throw submitPlanValidationError(
      `${fieldName} must contain only non-empty strings`,
      JSON.stringify(SUBMIT_PLAN_EXAMPLE),
    );
  }
  return normalized;
}

function normalizeOptionalSkillBundleName(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw submitPlanValidationError(
    `${fieldName} must be a non-empty string when provided`,
    JSON.stringify(SUBMIT_PLAN_EXAMPLE),
  );
}

function normalizeOptionalSkillIds(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeStringList(value, fieldName);
}

function normalizeStructuredText(value: unknown, fieldName: string): StructuredPlanText {
  if (typeof value === 'string') return normalizeNonEmptyString(value, fieldName);
  return normalizeStringList(value, fieldName);
}

function normalizeOptionalEffortLevel(value: unknown, fieldName: string): EffortLevel | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw submitPlanValidationError(
    `${fieldName} must be an engine-declared non-empty string when provided`,
    JSON.stringify(SUBMIT_PLAN_EXAMPLE),
  );
}

function normalizePlanIntent(
  value: unknown,
  fieldName: string,
  fallback: SessionIntent = 'implementation',
): SessionIntent {
  if (value === undefined || value === null) return fallback;
  if (value === 'investigation' || value === 'implementation') return value;
  throw submitPlanValidationError(
    `${fieldName} must be "investigation" or "implementation" when provided`,
    JSON.stringify(SUBMIT_PLAN_EXAMPLE),
  );
}

function normalizeDispatchPermissionScope(
  value: unknown,
  fieldName: string,
  fallback: DispatchPermissionScope,
): DispatchPermissionScope {
  if (value === undefined || value === null) return fallback;
  if (isDispatchPermissionScope(value)) return value;
  throw submitPlanValidationError(
    `${fieldName} must be "read-only", "workspace-write", or "danger-full-access" when provided`,
    JSON.stringify(SUBMIT_PLAN_EXAMPLE),
  );
}

function normalizeDispatchDisturbanceLevel(
  value: unknown,
  fieldName: string,
  fallback: DispatchDisturbanceLevel,
): DispatchDisturbanceLevel {
  if (value === undefined || value === null) return fallback;
  if (isDispatchDisturbanceLevel(value)) return value;
  throw submitPlanValidationError(
    `${fieldName} must be "never", "on-failure", or "on-request" when provided`,
    JSON.stringify(SUBMIT_PLAN_EXAMPLE),
  );
}

function normalizePlanCandidate(
  value: unknown,
  moduleIndex: number,
  candidateIndex: number,
  moduleIntent: SessionIntent,
): PlanCandidate {
  if (!value || typeof value !== 'object') {
    throw submitPlanValidationError(
      `modules[${moduleIndex}].candidates[${candidateIndex}] must be an object`,
      JSON.stringify(SUBMIT_PLAN_EXAMPLE),
    );
  }
  const candidate = value as Record<string, unknown>;
  const effortLevel = normalizeOptionalEffortLevel(
    candidate.effortLevel,
    `modules[${moduleIndex}].candidates[${candidateIndex}].effortLevel`,
  );
  const intent = normalizePlanIntent(
    candidate.intent,
    `modules[${moduleIndex}].candidates[${candidateIndex}].intent`,
    moduleIntent,
  );
  const defaults = getDefaultDispatchPermissionKnobs(intent);
  const skillBundleName = normalizeOptionalSkillBundleName(
    candidate.skillBundleName,
    `modules[${moduleIndex}].candidates[${candidateIndex}].skillBundleName`,
  );
  const skillIds = normalizeOptionalSkillIds(
    candidate.skillIds,
    `modules[${moduleIndex}].candidates[${candidateIndex}].skillIds`,
  );
  return withRawModelForValidation({
    name: normalizeNonEmptyString(candidate.name, `modules[${moduleIndex}].candidates[${candidateIndex}].name`),
    approach: normalizeNonEmptyString(candidate.approach, `modules[${moduleIndex}].candidates[${candidateIndex}].approach`),
    pros: normalizeStructuredText(candidate.pros, `modules[${moduleIndex}].candidates[${candidateIndex}].pros`),
    cons: normalizeStructuredText(candidate.cons, `modules[${moduleIndex}].candidates[${candidateIndex}].cons`),
    risks: normalizeStructuredText(candidate.risks, `modules[${moduleIndex}].candidates[${candidateIndex}].risks`),
    provider: normalizeNonEmptyString(candidate.provider, `modules[${moduleIndex}].candidates[${candidateIndex}].provider`),
    model: normalizeNonEmptyString(candidate.model, `modules[${moduleIndex}].candidates[${candidateIndex}].model`),
    ...(effortLevel ? { effortLevel } : {}),
    intent,
    permissionScope: normalizeDispatchPermissionScope(
      candidate.permissionScope,
      `modules[${moduleIndex}].candidates[${candidateIndex}].permissionScope`,
      defaults.permissionScope,
    ),
    disturbanceLevel: normalizeDispatchDisturbanceLevel(
      candidate.disturbanceLevel,
      `modules[${moduleIndex}].candidates[${candidateIndex}].disturbanceLevel`,
      defaults.disturbanceLevel,
    ),
    ...(skillBundleName ? { skillBundleName } : {}),
    ...(skillIds !== undefined ? { skillIds } : {}),
  }, candidate.model);
}

function normalizePlanModules(value: unknown): PlanModule[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw submitPlanValidationError(
      'modules must be an array of objects',
      JSON.stringify(SUBMIT_PLAN_EXAMPLE),
    );
  }

  return value.map((rawModule, moduleIndex) => {
    if (!rawModule || typeof rawModule !== 'object') {
      throw submitPlanValidationError(
        `modules[${moduleIndex}] must be an object`,
        JSON.stringify(SUBMIT_PLAN_EXAMPLE),
      );
    }
    const module = rawModule as Record<string, unknown>;
    const rawCandidates = module.candidates;
    if (rawCandidates !== undefined && !Array.isArray(rawCandidates)) {
      throw submitPlanValidationError(
        `modules[${moduleIndex}].candidates must be an array`,
        JSON.stringify(SUBMIT_PLAN_EXAMPLE),
      );
    }
    const effortLevel = normalizeOptionalEffortLevel(
      module.effortLevel,
      `modules[${moduleIndex}].effortLevel`,
    );
    const intent = normalizePlanIntent(
      module.intent,
      `modules[${moduleIndex}].intent`,
    );
    const defaults = getDefaultDispatchPermissionKnobs(intent);
    const skillBundleName = normalizeOptionalSkillBundleName(
      module.skillBundleName,
      `modules[${moduleIndex}].skillBundleName`,
    );
    const skillIds = normalizeOptionalSkillIds(
      module.skillIds,
      `modules[${moduleIndex}].skillIds`,
    );
    return withRawModelForValidation({
      title: normalizeNonEmptyString(module.title, `modules[${moduleIndex}].title`),
      outputFiles: normalizeStringList(module.outputFiles, `modules[${moduleIndex}].outputFiles`),
      inputs: normalizeStringList(module.inputs, `modules[${moduleIndex}].inputs`),
      provider: normalizeNonEmptyString(module.provider, `modules[${moduleIndex}].provider`),
      model: normalizeNonEmptyString(module.model, `modules[${moduleIndex}].model`),
      ...(effortLevel ? { effortLevel } : {}),
      intent,
      permissionScope: normalizeDispatchPermissionScope(
        module.permissionScope,
        `modules[${moduleIndex}].permissionScope`,
        defaults.permissionScope,
      ),
      disturbanceLevel: normalizeDispatchDisturbanceLevel(
        module.disturbanceLevel,
        `modules[${moduleIndex}].disturbanceLevel`,
        defaults.disturbanceLevel,
      ),
      ...(skillBundleName ? { skillBundleName } : {}),
      ...(skillIds !== undefined ? { skillIds } : {}),
      doneCriteria: normalizeNonEmptyString(module.doneCriteria, `modules[${moduleIndex}].doneCriteria`),
      ...(rawCandidates === undefined
        ? {}
        : { candidates: rawCandidates.map((candidate, candidateIndex) => normalizePlanCandidate(candidate, moduleIndex, candidateIndex, intent)) }),
    }, module.model);
  });
}

function normalizeRequestRedispatchArgs(value: Record<string, unknown> | undefined): RequestRedispatchArgs {
  const args = value ?? {};
  const trackerItemId = typeof args.trackerItemId === "string" ? args.trackerItemId.trim() : "";
  const provider = typeof args.provider === "string" ? args.provider.trim() : "";
  const model = typeof args.model === "string" ? args.model.trim() : "";
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const changeSummary = typeof args.changeSummary === "string" ? args.changeSummary.trim() : "";
  if (!trackerItemId) throw requestRedispatchValidationError("trackerItemId is required");
  if (!provider) throw requestRedispatchValidationError("provider is required");
  if (!model) throw requestRedispatchValidationError("model is required");
  if (!prompt) throw requestRedispatchValidationError("prompt is required");
  if (!changeSummary) throw requestRedispatchValidationError("changeSummary is required");
  if (!isDispatchPermissionScope(args.permissionScope)) {
    throw requestRedispatchValidationError("permissionScope must be read-only, workspace-write, or danger-full-access");
  }
  if (!isDispatchDisturbanceLevel(args.disturbanceLevel)) {
    throw requestRedispatchValidationError("disturbanceLevel must be never, on-failure, or on-request");
  }
  if (!Array.isArray(args.skillIds)) {
    throw requestRedispatchValidationError("skillIds must be an array of non-empty strings");
  }
  const skillIds = args.skillIds.map((candidate, index) => {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    throw requestRedispatchValidationError(`skillIds[${index}] must be a non-empty string`);
  });
  const effortLevel = args.effortLevel === undefined
    ? undefined
    : normalizeOptionalEffortLevel(args.effortLevel, "effortLevel");
  const skillBundleName = normalizeOptionalSkillBundleName(args.skillBundleName, "skillBundleName");
  return {
    trackerItemId,
    provider,
    model,
    ...(effortLevel ? { effortLevel } : {}),
    prompt,
    changeSummary,
    permissionScope: args.permissionScope,
    disturbanceLevel: args.disturbanceLevel,
    ...(skillBundleName ? { skillBundleName } : {}),
    skillIds,
  };
}

/**
 * The original MCP call that is waiting for a plan approval result.
 *
 * Claude keeps a submit_plan call open while the user reviews the card. Its
 * approval result must settle this call, rather than only being written to the
 * transcript for a later model turn.
 */
interface SubmitPlanMcpCall {
  requestId: string;
  resolveOriginalMcpCall: (result: string) => boolean;
  /** Records the durable card ID before the original MCP request starts waiting. */
  setSubmittedPlanId: (planId: string) => void;
}

interface MetaAgentServerOptions {
  /**
   * Kept configurable for deterministic liveness tests. Production uses the
   * 30-second default, leaving a 10x margin below Claude's 300-second
   * no-progress watchdog.
   */
  planApprovalProgressIntervalMs?: number;
}

type RespondToPromptArgs = {
  sessionId: string;
  promptId: string;
  promptType:
    | "permission_request"
    | "ask_user_question_request"
    | "exit_plan_mode_request";
  response: Record<string, unknown>;
};

type InterruptSessionArgs = {
  sessionId: string;
  cascade?: boolean;
  queueAction?: "pause" | "clear";
};

interface MetaAgentToolFns {
  listModels?: (
    metaSessionId: string,
    workspaceId: string,
  ) => Promise<string>;
  listWorktrees: (
    metaSessionId: string,
    workspaceId: string
  ) => Promise<string>;
  submitPlan: (
    metaSessionId: string,
    workspaceId: string,
    args: SubmitPlanArgs,
    signal?: AbortSignal,
    mcpCall?: SubmitPlanMcpCall,
  ) => Promise<string>;
  requestRedispatch: (
    metaSessionId: string,
    workspaceId: string,
    args: RequestRedispatchArgs
  ) => Promise<string>;
  createSession: (
    metaSessionId: string,
    workspaceId: string,
    args: CreateSessionArgs
  ) => Promise<string>;
  spawnSession: (
    callerSessionId: string,
    workspaceId: string,
    args: SpawnSessionArgs
  ) => Promise<string>;
  getSessionStatus: (
    metaSessionId: string,
    workspaceId: string,
    targetSessionId: string
  ) => Promise<string>;
  getSessionResult: (
    metaSessionId: string,
    workspaceId: string,
    targetSessionId: string
  ) => Promise<string>;
  sendPrompt: (
    metaSessionId: string,
    workspaceId: string,
    targetSessionId: string,
    prompt: string
  ) => Promise<string>;
  respondToPrompt: (
    metaSessionId: string,
    workspaceId: string,
    args: RespondToPromptArgs
  ) => Promise<string>;
  listSpawnedSessions: (
    metaSessionId: string,
    workspaceId: string
  ) => Promise<string>;
  interruptSession: (
    metaSessionId: string,
    workspaceId: string,
    args: InterruptSessionArgs
  ) => Promise<string>;
}

interface TransportMetadata {
  transport: SSEServerTransport;
  aiSessionId: string;
  workspaceId: string;
}

interface StreamableTransportMetadata {
  transport: StreamableHTTPServerTransport;
  aiSessionId: string;
  workspaceId: string;
}

const activeTransports = new Map<string, TransportMetadata>();
const activeStreamableTransports = new Map<string, StreamableTransportMetadata>();
const PLAN_APPROVAL_PROGRESS_HEARTBEAT_INTERVAL_MS = 30_000;
const PLAN_APPROVAL_PROGRESS_MESSAGE = "Waiting for user plan approval.";

let httpServerInstance: any = null;
let toolFns: MetaAgentToolFns | null = null;

export function setMetaAgentToolFns(fns: MetaAgentToolFns): void {
  toolFns = fns;
}

/**
 * OpenAI-shaped tool definition. Mirrors the chat-completions function-calling
 * format that extension-agent tool loops (e.g. the gemini-antigravity
 * ToolLoopProtocol) consume. Built-in providers ignore this — they discover the
 * same tools over the SSE MCP server instead.
 */
export interface MetaAgentOpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * The single source-of-truth list of meta-agent tools, in MCP
 * `{ name, description, inputSchema }` shape. Both the SSE MCP server's
 * ListTools handler (built-in providers) and `getMetaAgentOpenAITools`
 * (extension-agent providers) read from this so the two presentation paths
 * never drift.
 */
const META_AGENT_TOOL_DEFS: Array<{
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}> = [
  {
    name: "list_models",
    description:
      "Read the current verified provider/model catalog before delegating. Use only the exact model IDs returned here when calling create_session or submit_plan. resolvedModel is display-only; never put it in a model field. The response also reports discovery failures, caches, and allowed thinking-effort levels.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_worktrees",
    description:
      "List the available git worktrees for this workspace so you can attach a child session to an existing branch or decide whether to create a fresh worktree.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "submit_plan",
    description: SUBMIT_PLAN_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          description: "REQUIRED. String title for the proposed implementation plan.",
        },
        planItems: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
          description: "REQUIRED. Non-empty ordered list of concrete string plan items to present for approval.",
        },
        workOrderCount: {
          type: "integer",
          minimum: 0,
          description: "OPTIONAL. Non-negative integer number of work orders; omitted values use planItems.length.",
        },
        risks: {
          type: "array",
          minItems: 0,
          items: { type: "string", minLength: 1 },
          description: "REQUIRED. List of string implementation risks and tradeoffs; use [] when none are declared.",
        },
        modules: {
          type: "array",
          description: "OPTIONAL structured module fields. Omit for legacy planItems-only cards. Use candidates for multiple approaches.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1, description: "Module name." },
              outputFiles: { type: "array", items: { type: "string", minLength: 1 }, description: "Expected output paths relative to the project root." },
              inputs: { type: "array", items: { type: "string", minLength: 1 }, description: "Inputs/materials used by the module." },
              provider: { type: "string", minLength: 1, description: "Provider ID for this module." },
              model: { type: "string", minLength: 1, description: "Use a list_models catalog id (or the provider-local part after ':'); never use resolvedModel." },
              effortLevel: { type: "string", minLength: 1, description: "Optional exact raw effort value declared by this model in list_models; omit when its list is empty." },
              intent: { type: "string", enum: ["investigation", "implementation"], description: "Optional worker role. Omitted defaults to implementation; investigation defaults to read-only + never, implementation to workspace-write + on-failure." },
              permissionScope: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"], description: "Optional suggested permission scope. Omitted values use the worker-role default." },
              disturbanceLevel: { type: "string", enum: ["never", "on-failure", "on-request"], description: "Optional suggested owner-interruption level. Omitted values use the worker-role default." },
              skillBundleName: { type: "string", minLength: 1, description: "Optional skill bundle suggestion from the user's Skill Library. It is a shortcut only; the approval card expands it into explicit skill tags." },
              skillIds: { type: "array", items: { type: "string", minLength: 1 }, description: "Optional explicit skill id suggestions. Omit to preserve the engine native default; [] explicitly grants no skills." },
              doneCriteria: { type: "string", minLength: 1, description: "Concrete completion standard." },
              candidates: {
                type: "array",
                description: "Optional alternative approaches. Required when there is more than one viable approach.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", minLength: 1 },
                    approach: { type: "string", minLength: 1 },
                    pros: { oneOf: [{ type: "string", minLength: 1 }, { type: "array", items: { type: "string", minLength: 1 } }] },
                    cons: { oneOf: [{ type: "string", minLength: 1 }, { type: "array", items: { type: "string", minLength: 1 } }] },
                    risks: { oneOf: [{ type: "string", minLength: 1 }, { type: "array", items: { type: "string", minLength: 1 } }] },
                    provider: { type: "string", minLength: 1 },
                    model: { type: "string", minLength: 1, description: "Use a list_models catalog id (or the provider-local part after ':'); never use resolvedModel." },
                    effortLevel: { type: "string", minLength: 1, description: "Optional exact raw model-declared effort value." },
                    intent: { type: "string", enum: ["investigation", "implementation"], description: "Optional worker role; defaults to the module role." },
                    permissionScope: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"], description: "Optional suggested permission scope; defaults by role." },
                    disturbanceLevel: { type: "string", enum: ["never", "on-failure", "on-request"], description: "Optional suggested owner-interruption level; defaults by role." },
                    skillBundleName: { type: "string", minLength: 1, description: "Optional skill bundle suggestion. The approval card expands it to explicit skill tags." },
                    skillIds: { type: "array", items: { type: "string", minLength: 1 }, description: "Optional explicit skill id suggestions. Omit to preserve the engine native default; [] explicitly grants no skills." },
                  },
                  required: ["name", "approach", "pros", "cons", "risks", "provider", "model"],
                },
              },
            },
            required: ["title", "outputFiles", "inputs", "provider", "model", "doneCriteria"],
          },
        },
      },
      required: ["title", "planItems", "risks"],
    },
  },
  {
    name: "request_redispatch",
    description:
      "Request owner approval to redispatch an already failed work-order with changed parameters. This tool NEVER dispatches by itself: it renders a RedispatchWorkOrder confirmation card in the owner's Head conversation. For failed work-orders, do not call create_session directly; use this tool and wait for the owner to approve or reject the card. The owner can edit the final provider/model/effort/permission knobs/skills/task prompt on the card before approval.",
    inputSchema: {
      type: "object",
      properties: {
        trackerItemId: {
          type: "string",
          minLength: 1,
          description: "REQUIRED. ID of the failed work-order tracker card to redispatch.",
        },
        provider: {
          type: "string",
          minLength: 1,
          description: "REQUIRED. Suggested provider ID for the retry, e.g. openai-codex or antigravity-gemini-agent.",
        },
        model: {
          type: "string",
          minLength: 1,
          description: "REQUIRED. Suggested provider-qualified model ID from list_models. If you pass a provider-local model name, it is qualified against provider.",
        },
        effortLevel: {
          type: "string",
          minLength: 1,
          description: "Optional exact raw effort value declared by this model in list_models; omit when unsupported.",
        },
        prompt: {
          type: "string",
          minLength: 1,
          description: "REQUIRED. Suggested final task prompt for the replacement worker. Include any fix to the failed task brief here.",
        },
        changeSummary: {
          type: "string",
          minLength: 1,
          description: "REQUIRED. Short explanation of what changed from the failed attempt and why.",
        },
        permissionScope: {
          type: "string",
          enum: ["read-only", "workspace-write", "danger-full-access"],
          description: "REQUIRED. Suggested permission scope for the retry.",
        },
        disturbanceLevel: {
          type: "string",
          enum: ["never", "on-failure", "on-request"],
          description: "REQUIRED. Suggested owner-interruption level for the retry.",
        },
        skillBundleName: {
          type: "string",
          minLength: 1,
          description: "Optional skill bundle suggestion. The confirmation card expands it into explicit skill tags.",
        },
        skillIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "REQUIRED. Explicit skill ids for the retry. Use [] when no skills should be granted.",
        },
      },
      required: [
        "trackerItemId",
        "provider",
        "model",
        "prompt",
        "changeSummary",
        "permissionScope",
        "disturbanceLevel",
        "skillIds",
      ],
    },
  },
  {
    name: "create_session",
    description:
      "Spawn a new child session for a focused task. Set intent=\"investigation\" for read-only investigation, which may be dispatched without a plan. Set intent=\"implementation\" only with planId for a user-approved plan. Can optionally create a dedicated worktree or attach the session to an existing worktree, then seed it with an initial prompt. Pass toolScope to control the child's capabilities: use \"read\" or \"write\" for analyze/research tasks so the child cannot run builds or claim to have run them; \"full\" (default) grants run_command.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Optional title for the child session.",
        },
        provider: {
          type: "string",
          description:
            "Optional. OMIT to inherit the calling session provider and model (recommended: a Gemini meta-agent then spawns Gemini children). Set this only to deliberately run the child on a different provider, and if you set it, also pass a matching model (e.g. provider claude-code with model claude-code:opus). Do NOT set claude-code with a non-claude-code model.",
        },
        model: {
          type: "string",
          description: "Optional explicit model identifier.",
        },
        effortLevel: {
          type: "string",
          description:
            "Optional exact raw value from the selected model's list_models supportedEffortLevels. Omit it when the model has no independent effort dimension.",
        },
        prompt: {
          type: "string",
          description: "Optional initial prompt to queue for the child session immediately after creation.",
        },
        useWorktree: {
          type: "boolean",
          description:
            "Ignored. Child sessions always run in the SHARED workspace so you (the parent) can read the files they write and synthesize them. A fresh worktree would isolate the child's deliverable where you cannot reach it. Tell the child to save deliverables to the workspace root.",
        },
        worktreeId: {
          type: "string",
          description: "Ignored. Children run in the shared workspace (see useWorktree).",
        },
        toolScope: {
          type: "string",
          enum: ["read", "write", "full"],
          description:
            "Capability scope for the child. \"read\" = read_file/list_files/search_files only (pure investigation). \"write\" = those plus write_file but NO run_command, so the child can save a file deliverable (e.g. a report) yet cannot build/test/run anything. \"full\" (default) = all tools including run_command. Use read or write for analyze/research tasks so the child physically cannot run a build, and reserve full for tasks that must build/test.",
        },
        intent: {
          type: "string",
          enum: ["investigation", "implementation"],
          description:
            "REQUIRED. investigation is for read-only work and needs no plan; implementation changes the product and requires an approved planId.",
        },
        planId: {
          type: "string",
          description: "Required when intent is implementation. ID of the approved plan card.",
        },
        moduleIndex: {
          type: "integer",
          minimum: 1,
          description:
            "Stable 1-based module position in the approved plan. Pass the same value on every dispatch/retry of that module; a title change must not create a second work-order card.",
        },
        outputFiles: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description:
            "Optional file paths explicitly named as deliverables by this module's completion standard. They are resolved relative to the workspace and must exist before an implementation work-order can become completed.",
        },
        completionCriteria: {
          type: "object",
          properties: {
            outputFiles: {
              type: "array",
              items: { type: "string", minLength: 1 },
            },
          },
          description:
            "Optional structured completion standard. Only explicitly named outputFiles are checked; content requirements are not auto-checked.",
        },
        skillBundleName: {
          type: "string",
          description: "Optional skill bundle name from the user's Skill Library. Omitted means no skills are granted unless the approved plan module supplied a final skill list.",
        },
        skillIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Optional explicit final skill ids for this child. The product filters disabled or missing skills before dispatch.",
        },
        maxParallelOverride: {
          type: "integer",
          minimum: 1,
          description:
            "Optional positive integer for this dispatch only. It can only lower the global Head Agent concurrency limit; values above the global setting are capped to that setting.",
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "spawn_session",
    description:
      "Spawn a new session from the calling session. Set intent=\"investigation\" for read-only investigation, which may be dispatched without a plan. Set intent=\"implementation\" only with planId for a user-approved plan. By default the new session runs as a sibling under the same workstream as the caller (sharing files-edited, tabs, and get_workstream_overview); if the caller is not yet part of a workstream, a workstream container is created and the caller is reparented under it. The new session also inherits the caller's working directory: if the caller is running in a worktree, the spawned session runs in that same worktree (so its edits land where the user is looking). Pass isolated=true to instead create a top-level session with no parent and no workstream — use this when the new session should fix-and-commit work independently without polluting the caller's workstream. Pass useWorktree=true to give the spawned session its OWN new worktree instead of inheriting the caller's. Fire-and-forget by default — the calling session is not notified when the spawned session completes; pass notifyOnComplete=true to opt in. Use this for the /launch-new-session flow.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "REQUIRED. Self-contained handoff brief for the new session. Should describe the task, relevant file paths, decisions already made, and a pointer back to the current session id (the new session can call get_session_summary to read more).",
        },
        title: {
          type: "string",
          description: "Optional short title for the new session.",
        },
        isolated: {
          type: "boolean",
          description:
            "Default false. When true, the new session is created at the top level — no parent, no workstream container, no shared files-edited or tabs with the caller. Use for fix-and-commit-separately work that should not pollute the caller's workstream.",
        },
        useWorktree: {
          type: "boolean",
          description:
            "Default false. By default the spawned session inherits the caller's working directory: if the caller is in a worktree, the new session runs in that same worktree; if the caller is in the main checkout, the new session runs there too. Set true only when the user explicitly asks for the new session to get its OWN new worktree (separate branch and working directory) — this creates a fresh worktree rather than inheriting the caller's.",
        },
        model: {
          type: "string",
          description:
            "Optional explicit model identifier (e.g. 'claude-code:opus'). When omitted, the new session uses the global default model unless inheritModel=true. Wins over inheritModel when both are set.",
        },
        effortLevel: {
          type: "string",
          description:
            "Optional exact raw value from the selected model's list_models supportedEffortLevels. Omit it when the model has no independent effort dimension.",
        },
        inheritModel: {
          type: "boolean",
          description:
            "Default false. When true and `model` is not set, the spawned session uses the caller's model so it stays on the same provider/model (e.g. opus stays on opus). Ignored when `model` is provided explicitly.",
        },
        notifyOnComplete: {
          type: "boolean",
          description:
            "Default false. When false (the default), the calling session receives no follow-up prompt when the spawned session completes/errors/waits — fire and forget. Set true only when the caller specifically wants to be told the result and continue working with it.",
        },
        intent: {
          type: "string",
          enum: ["investigation", "implementation"],
          description:
            "REQUIRED. investigation is for read-only work and needs no plan; implementation changes the product and requires an approved planId.",
        },
        planId: {
          type: "string",
          description: "Required when intent is implementation. ID of the approved plan card.",
        },
        moduleIndex: {
          type: "integer",
          minimum: 1,
          description:
            "Stable 1-based module position in the approved plan. Pass the same value on every dispatch/retry of that module; a title change must not create a second work-order card.",
        },
        outputFiles: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description:
            "Optional file paths explicitly named as deliverables by this module's completion standard. They are resolved relative to the workspace and must exist before an implementation work-order can become completed.",
        },
        completionCriteria: {
          type: "object",
          properties: {
            outputFiles: {
              type: "array",
              items: { type: "string", minLength: 1 },
            },
          },
          description:
            "Optional structured completion standard. Only explicitly named outputFiles are checked; content requirements are not auto-checked.",
        },
        maxParallelOverride: {
          type: "integer",
          minimum: 1,
          description:
            "Optional positive integer for this dispatch only. It can only lower the global Head Agent concurrency limit; values above the global setting are capped to that setting.",
        },
      },
      required: ["prompt", "intent"],
    },
  },
  {
    name: "get_session_status",
    description:
      "Get the current status of a child session including last activity time and whether it is waiting for input.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The session ID to inspect.",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "get_session_result",
    description:
      "Get the current or final result of a session including prompts, recent responses, edited files, and pending interactive prompts.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The session ID to inspect.",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "send_prompt",
    description:
      "Queue a follow-up prompt for a child session. Use this first to resume an interrupted child in the same session and preserve its context; processing starts immediately for idle, interrupted, or errored sessions. Create a replacement only when this original session cannot resume, and state the reason to the user.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The target child session ID.",
        },
        prompt: {
          type: "string",
          description: "The follow-up prompt to send.",
        },
      },
      required: ["sessionId", "prompt"],
    },
  },
  {
    name: "interrupt_session",
    description:
      "Interrupt a child session created by this Head Agent. Set cascade=true to interrupt the target and every descendant in its task tree. This stops active turns but does not revert file changes. queueAction=\"pause\" (default) preserves queued prompts in a paused state; queueAction=\"clear\" removes active queued prompts. Returns the actual outcome and queue action for every targeted session. Targets outside this Head Agent's task tree are rejected.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The child session ID to interrupt.",
        },
        cascade: {
          type: "boolean",
          default: false,
          description: "Default false. When true, also interrupt every descendant of the target session.",
        },
        queueAction: {
          type: "string",
          enum: ["pause", "clear"],
          default: "pause",
          description: "Default pause. Preserve queued prompts in a paused state, or clear active queued prompts.",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "respond_to_prompt",
    description:
      "Answer a child session's interactive prompt such as AskUserQuestion, ExitPlanMode, or ToolPermission.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The child session waiting for input.",
        },
        promptId: {
          type: "string",
          description: "The interactive prompt ID.",
        },
        promptType: {
          type: "string",
          enum: [
            "permission_request",
            "ask_user_question_request",
            "exit_plan_mode_request",
          ],
          description: "The kind of prompt being answered.",
        },
        response: {
          type: "object",
          description: "Prompt-specific response payload.",
        },
      },
      required: ["sessionId", "promptId", "promptType", "response"],
    },
  },
  {
    name: "list_spawned_sessions",
    description:
      "List all child sessions created by this meta-agent session, including current status and a short summary.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Return the meta-agent tools in OpenAI function-calling shape so an
 * extension-agent backend (which renders tools as JSON in its system prompt)
 * can present them. Built-in providers do NOT use this — they connect to the
 * SSE MCP server and discover the tools via ListTools. The two paths share
 * `META_AGENT_TOOL_DEFS` so descriptions stay in sync.
 */
// Extension-agent meta-agents (e.g. gemini-antigravity) receive their meta-agent
// tools through this OpenAI-shaped list. Built-in providers (claude-code,
// openai-codex) instead discover tools over the SSE MCP server and are gated by
// BaseAgentProvider.META_AGENT_ALLOWED_TOOLS, which deliberately OMITS
// spawn_session. spawn_session creates a workstream container (the
// launch-new-session flow) and reparents the child under it, which pulls the
// child out of the META AGENT group and breaks clean meta-agent nesting. To make
// extension-agent meta-agents behave identically to the built-ins, mirror that
// allowlist here so spawn_session is never offered (the meta-agent system prompt
// only references create_session). Keep in sync with the meta-agent subset of
// BaseAgentProvider.META_AGENT_ALLOWED_TOOLS.
const EXTENSION_META_AGENT_ALLOWED_TOOLS = new Set<string>([
  "list_models",
  "list_worktrees",
  "submit_plan",
  "request_redispatch",
  "create_session",
  "get_session_status",
  "get_session_result",
  "send_prompt",
  "interrupt_session",
  "respond_to_prompt",
  "list_spawned_sessions",
]);

export function getMetaAgentOpenAITools(): MetaAgentOpenAITool[] {
  return META_AGENT_TOOL_DEFS
    .filter((t) => EXTENSION_META_AGENT_ALLOWED_TOOLS.has(t.name))
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));
}

/**
 * Dispatch a parsed meta-agent tool call to the registered tool fns and return
 * its text result. Shared by the SSE MCP server's CallTool handler (built-in
 * providers) and the PrivilegedExtensionHost `toolExecutor` broker
 * (extension-agent providers) so the dispatch logic lives in exactly one place.
 *
 * `name` may carry the `mcp__nimbalyst-meta-agent__` prefix; it is stripped.
 * `workspaceId` is normalized to its canonical repo path via resolveProjectPath
 * so worktree-rooted callers still resolve to the parent repo.
 *
 * Throws if the tool fns are not yet registered or the tool name is unknown.
 */
export async function dispatchMetaAgentTool(
  name: string,
  aiSessionId: string,
  workspaceId: string,
  args: Record<string, unknown> | undefined,
  context?: {
    signal?: AbortSignal;
    submitPlanMcpCall?: SubmitPlanMcpCall;
  },
): Promise<string> {
  if (!toolFns) {
    throw new Error("Meta-agent service not initialized");
  }
  const toolName = name.replace(/^mcp__nimbalyst-meta-agent__/, "");
  // Normalize the workspaceId to its canonical repo path (worktree callers
  // pass the worktree dir; sessions compare by exact parent-repo path).
  const effectiveWorkspaceId = resolveProjectPath(workspaceId);

  switch (toolName) {
    case "list_models":
      if (!toolFns.listModels) throw new Error('Model catalog tool is not initialized');
      return toolFns.listModels(aiSessionId, effectiveWorkspaceId);
    case "list_worktrees":
      return toolFns.listWorktrees(aiSessionId, effectiveWorkspaceId);
    case "submit_plan": {
      const submitPlanArgs = normalizeSubmitPlanArgs(args);
      if (context?.submitPlanMcpCall) {
        return toolFns.submitPlan(
          aiSessionId,
          effectiveWorkspaceId,
          submitPlanArgs,
          context.signal,
          context.submitPlanMcpCall,
        );
      }
      if (context?.signal) {
        return toolFns.submitPlan(
          aiSessionId,
          effectiveWorkspaceId,
          submitPlanArgs,
          context.signal,
        );
      }
      return toolFns.submitPlan(
        aiSessionId,
        effectiveWorkspaceId,
        submitPlanArgs,
      );
    }
    case "request_redispatch":
      return toolFns.requestRedispatch(
        aiSessionId,
        effectiveWorkspaceId,
        normalizeRequestRedispatchArgs(args),
      );
    case "create_session":
      return toolFns.createSession(aiSessionId, effectiveWorkspaceId, (args ?? {}) as CreateSessionArgs);
    case "spawn_session":
      return toolFns.spawnSession(aiSessionId, effectiveWorkspaceId, (args ?? {}) as SpawnSessionArgs);
    case "get_session_status":
      return toolFns.getSessionStatus(
        aiSessionId,
        effectiveWorkspaceId,
        (args?.sessionId as string) ?? ""
      );
    case "get_session_result":
      return toolFns.getSessionResult(
        aiSessionId,
        effectiveWorkspaceId,
        (args?.sessionId as string) ?? ""
      );
    case "send_prompt":
      return toolFns.sendPrompt(
        aiSessionId,
        effectiveWorkspaceId,
        (args?.sessionId as string) ?? "",
        (args?.prompt as string) ?? ""
      );
    case "interrupt_session":
      return toolFns.interruptSession(
        aiSessionId,
        effectiveWorkspaceId,
        (args ?? {}) as InterruptSessionArgs
      );
    case "respond_to_prompt":
      return toolFns.respondToPrompt(aiSessionId, effectiveWorkspaceId, (args ?? {}) as RespondToPromptArgs);
    case "list_spawned_sessions":
      return toolFns.listSpawnedSessions(aiSessionId, effectiveWorkspaceId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function cleanupMetaAgentServer(): void {
  for (const [transportId, metadata] of activeTransports.entries()) {
    try {
      if (metadata.transport.onclose) {
        metadata.transport.onclose();
      }
      const res = (metadata.transport as any).res;
      if (res && !res.headersSent) {
        res.end();
      }
    } catch (error) {
      console.error(`[Meta Agent MCP] Error closing transport ${transportId}:`, error);
    }
  }
  activeTransports.clear();

  for (const [id, metadata] of activeStreamableTransports.entries()) {
    try {
      void metadata.transport.close().catch((error) => {
        console.error(`[Meta Agent MCP] Error closing streamable transport ${id}:`, error);
      });
    } catch (error) {
      console.error(`[Meta Agent MCP] Error closing streamable transport ${id}:`, error);
    }
  }
  activeStreamableTransports.clear();
}

function getPlanApprovalProgressIntervalMs(options: MetaAgentServerOptions): number {
  const configuredIntervalMs = options.planApprovalProgressIntervalMs;
  return typeof configuredIntervalMs === "number"
    && Number.isFinite(configuredIntervalMs)
    && configuredIntervalMs > 0
    ? configuredIntervalMs
    : PLAN_APPROVAL_PROGRESS_HEARTBEAT_INTERVAL_MS;
}

function startPlanApprovalProgressHeartbeat(
  extra: {
    _meta?: { progressToken?: string | number };
    sendNotification: (notification: {
      method: "notifications/progress";
      params: {
        progressToken: string | number;
        progress: number;
        message: string;
      };
    }) => Promise<void>;
  },
  intervalMs: number,
): () => void {
  const progressToken = extra._meta?.progressToken;
  if (typeof progressToken !== "string" && typeof progressToken !== "number") {
    console.info(
      '[MCP:nimbalyst-meta-agent] Plan approval heartbeat inactive: progressToken missing; relying on the configured Head MCP timeout.',
    );
    return () => {};
  }

  let stopped = false;
  let progress = 0;
  const timer = setInterval(() => {
    if (stopped) {
      return;
    }
    void extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress: ++progress,
        message: PLAN_APPROVAL_PROGRESS_MESSAGE,
      },
    }).catch((error) => {
      // A closed MCP transport is handled by the approval settlement fallback;
      // do not turn one missed heartbeat into an unhandled rejection.
      console.warn("[MCP:nimbalyst-meta-agent] Plan approval progress notification failed:", error);
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function awaitSubmitPlanMcpResult(
  name: string,
  aiSessionId: string,
  workspaceId: string,
  args: Record<string, unknown> | undefined,
  extra: {
    signal: AbortSignal;
    _meta?: { progressToken?: string | number };
    sendNotification: (notification: {
      method: "notifications/progress";
      params: {
        progressToken: string | number;
        progress: number;
        message: string;
      };
    }) => Promise<void>;
  },
  progressIntervalMs: number,
): Promise<string> {
  const stopHeartbeat = startPlanApprovalProgressHeartbeat(extra, progressIntervalMs);
  let settled = false;
  let submittedPlanId: string | undefined;
  let resolveOriginalResult!: (result: string) => void;
  let rejectOriginalResult!: (error: Error) => void;

  const clearAbortListener = () => {
    extra.signal.removeEventListener("abort", rejectForAbort);
  };
  const settleResult = (result: string): boolean => {
    if (settled || extra.signal.aborted) {
      return false;
    }
    settled = true;
    clearAbortListener();
    resolveOriginalResult(result);
    return true;
  };
  const rejectForAbort = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearAbortListener();
    const guidance = submittedPlanId
      ? `Plan card is still awaiting approval; do not resubmit. Continue with planId ${submittedPlanId}.`
      : 'submit_plan MCP call was cancelled before the plan card was persisted';
    rejectOriginalResult(new Error(guidance));
  };

  const originalResult = new Promise<string>((resolve, reject) => {
    resolveOriginalResult = resolve;
    rejectOriginalResult = reject;
  });

  if (extra.signal.aborted) {
    rejectForAbort();
  } else {
    extra.signal.addEventListener("abort", rejectForAbort, { once: true });
  }

  const mcpCall: SubmitPlanMcpCall = {
    requestId: randomUUID(),
    resolveOriginalMcpCall: settleResult,
    setSubmittedPlanId: (planId) => {
      submittedPlanId = planId.trim() || undefined;
    },
  };

  void dispatchMetaAgentTool(
    name,
    aiSessionId,
    workspaceId,
    args,
    {
      signal: extra.signal,
      submitPlanMcpCall: mcpCall,
    },
  ).then(
    // Non-Claude callers and pre-existing adapters return directly. Claude's
    // settlement path resolves this same promise before it marks delivery.
    (result) => {
      settleResult(result);
    },
    (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAbortListener();
      rejectOriginalResult(error instanceof Error ? error : new Error(String(error)));
    },
  );

  try {
    return await originalResult;
  } finally {
    clearAbortListener();
    stopHeartbeat();
  }
}

export function shutdownMetaAgentServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServerInstance) {
      resolve();
      return;
    }

    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    try {
      cleanupMetaAgentServer();
    } catch (error) {
      console.error("[Meta Agent MCP] Error cleaning up transports:", error);
    }

    try {
      if (httpServerInstance?.closeAllConnections) {
        httpServerInstance.closeAllConnections();
      }
    } catch (error) {
      console.error("[Meta Agent MCP] Error closing connections:", error);
    }

    try {
      if (httpServerInstance?.close) {
        httpServerInstance.close((err?: Error) => {
          if (err) {
            console.error("[Meta Agent MCP] Error closing server:", err);
          }
          httpServerInstance = null;
          finish();
        });
      } else {
        httpServerInstance = null;
        finish();
      }
    } catch (error) {
      console.error("[Meta Agent MCP] Error during shutdown:", error);
      httpServerInstance = null;
      finish();
    }

    setTimeout(() => {
      httpServerInstance = null;
      finish();
    }, 1000);
  });
}

export async function startMetaAgentServer(
  startPort: number = 3461,
  options: MetaAgentServerOptions = {},
): Promise<{ httpServer: any; port: number }> {
  let port = startPort;
  let httpServer: any = null;
  let remainingAttempts = 100;

  while (remainingAttempts > 0) {
    try {
      httpServer = await tryCreateMetaAgentServer(port, options);
      break;
    } catch (error: any) {
      if (error?.code === "EADDRINUSE") {
        port += 1;
        remainingAttempts -= 1;
      } else {
        throw error;
      }
    }
  }

  if (!httpServer) {
    throw new Error(
      `[Meta Agent MCP] Could not find an available port after trying 100 ports starting from ${startPort}`
    );
  }

  httpServerInstance = httpServer;
  return { httpServer, port };
}

function createMetaAgentMcpServer(
  aiSessionId: string,
  workspaceId: string,
  options: MetaAgentServerOptions,
): Server {
  const server = new Server(
    {
      name: "nimbalyst-meta-agent",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  (server as { onerror?: (error: Error) => void }).onerror = (error: Error) => {
    console.error("[MCP:nimbalyst-meta-agent] Server error:", error);
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Single source of truth: the same defs `getMetaAgentOpenAITools` exposes
    // to extension-agent providers. Keeps the two presentation paths in sync.
    return {
      tools: META_AGENT_TOOL_DEFS,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: any, extra) => {
    const { name, arguments: args } = request.params;

    if (!toolFns) {
      return {
        content: [{ type: "text", text: "Error: Meta-agent service not initialized" }],
        isError: true,
      };
    }

    try {
      // workspaceId normalization to its canonical repo path now happens inside
      // dispatchMetaAgentTool (shared with the toolExecutor broker path). When
      // the caller session lives inside a git worktree, the MCP server is
      // launched with workspaceId = worktree directory, but sessions compare
      // workspace ids by exact string match against the renderer's active
      // workspace (the parent repo path).
      const toolName = name.replace(/^mcp__nimbalyst-meta-agent__/, "");
      const text = toolName === "submit_plan"
        ? await awaitSubmitPlanMcpResult(
            name,
            aiSessionId,
            workspaceId,
            args,
            extra,
            getPlanApprovalProgressIntervalMs(options),
          )
        : await dispatchMetaAgentTool(
            name,
            aiSessionId,
            workspaceId,
            args,
            { signal: extra.signal },
          );
      return {
        content: [{ type: "text", text }],
        isError: false,
      };
    } catch (error) {
      // Preserve the prior MethodNotFound surfacing for unknown tools.
      if (error instanceof Error && error.message.startsWith("Unknown tool:")) {
        throw new McpError(ErrorCode.MethodNotFound, error.message);
      }
      if (error instanceof McpError) throw error;
      console.error(`[MCP:nimbalyst-meta-agent] Tool "${name}" failed:`, error);
      console.error(`[MCP:nimbalyst-meta-agent] Tool args:`, JSON.stringify(args).slice(0, 500));
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

function getMcpSessionIdHeader(req: IncomingMessage): string | undefined {
  const headerValue = req.headers["mcp-session-id"];
  if (Array.isArray(headerValue)) return headerValue[0];
  if (typeof headerValue === "string" && headerValue.length > 0) return headerValue;
  return undefined;
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

async function readJsonBody(req: IncomingMessage): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buf.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new Error("Request body too large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) return undefined;
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function isInitializeMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "method" in value &&
    (value as Record<string, unknown>).method === "initialize"
  );
}

function isInitializePayload(payload: unknown): boolean {
  if (!payload) return false;
  if (Array.isArray(payload)) return payload.some((entry) => isInitializeMessage(entry));
  return isInitializeMessage(payload);
}

async function tryCreateMetaAgentServer(
  port: number,
  options: MetaAgentServerOptions,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const parsedUrl = parseUrl(req.url || "", true);
      const pathname = parsedUrl.pathname;
      const mcpSessionIdHeader = getMcpSessionIdHeader(req);

      // Issue #146: drop `Access-Control-Allow-Origin: *`; bearer token is
      // the sole gate. SDK subprocesses don't care about CORS.
      if (req.method === "OPTIONS") {
        res.writeHead(200, {
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Authorization, Content-Type, mcp-session-id, mcp-protocol-version",
        });
        res.end();
        return;
      }

      // Issue #146: every non-OPTIONS request to /mcp must carry the
      // per-launch bearer token.
      if (pathname === "/mcp" && !requireMcpAuth(req)) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      if (pathname === "/mcp" && req.method === "GET") {
        if (mcpSessionIdHeader) {
          const metadata = activeStreamableTransports.get(mcpSessionIdHeader);
          if (!metadata) {
            res.writeHead(404);
            res.end("Streamable session not found");
            return;
          }

          try {
            await metadata.transport.handleRequest(req, res);
          } catch (error) {
            console.error("[Meta Agent MCP] Error handling streamable GET:", error);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end("Internal server error");
            }
          }
          return;
        }

        const aiSessionId = parsedUrl.query.sessionId as string;
        const workspaceId = parsedUrl.query.workspaceId as string;

        if (!aiSessionId || typeof aiSessionId !== "string") {
          res.writeHead(400);
          res.end("Missing or invalid sessionId parameter");
          return;
        }

        if (!workspaceId || typeof workspaceId !== "string") {
          res.writeHead(400);
          res.end("Missing or invalid workspaceId parameter");
          return;
        }

        const server = createMetaAgentMcpServer(aiSessionId, workspaceId, options);
        const transport = new SSEServerTransport("/mcp", res);
        activeTransports.set(transport.sessionId, {
          transport,
          aiSessionId,
          workspaceId,
        });

        server.connect(transport).then(() => {
          transport.onclose = () => {
            activeTransports.delete(transport.sessionId);
          };
        }).catch((error) => {
          console.error("[Meta Agent MCP] Connection error:", error);
          activeTransports.delete(transport.sessionId);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });
        return;
      }

      if (pathname === "/mcp" && req.method === "POST") {
        const legacyTransportSessionId = parsedUrl.query.sessionId as string | undefined;
        if (legacyTransportSessionId !== undefined && typeof legacyTransportSessionId !== "string") {
          res.writeHead(400);
          res.end("Invalid sessionId parameter");
          return;
        }

        const legacyMetadata = legacyTransportSessionId
          ? activeTransports.get(legacyTransportSessionId)
          : undefined;

        if (legacyMetadata && !mcpSessionIdHeader) {
          try {
            await legacyMetadata.transport.handlePostMessage(req, res);
          } catch (error) {
            console.error("[Meta Agent MCP] Error handling legacy SSE POST:", error);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end("Internal server error");
            }
          }
          return;
        }

        const parsedBody = await readJsonBody(req);
        if (
          !mcpSessionIdHeader &&
          legacyTransportSessionId &&
          !isInitializePayload(parsedBody)
        ) {
          res.writeHead(404);
          res.end("Transport session not found");
          return;
        }

        let streamableMetadata = mcpSessionIdHeader
          ? activeStreamableTransports.get(mcpSessionIdHeader)
          : undefined;

        if (mcpSessionIdHeader && !streamableMetadata) {
          res.writeHead(404);
          res.end("Streamable session not found");
          return;
        }

        if (!streamableMetadata) {
          if (!isInitializePayload(parsedBody)) {
            res.writeHead(400);
            res.end("Missing sessionId");
            return;
          }

          const aiSessionId = parsedUrl.query.sessionId as string;
          const workspaceId = parsedUrl.query.workspaceId as string;

          if (!aiSessionId || typeof aiSessionId !== "string") {
            res.writeHead(400);
            res.end("Missing or invalid sessionId parameter");
            return;
          }

          if (!workspaceId || typeof workspaceId !== "string") {
            res.writeHead(400);
            res.end("Missing or invalid workspaceId parameter");
            return;
          }

          const server = createMetaAgentMcpServer(aiSessionId, workspaceId, options);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (streamableSessionId) => {
              activeStreamableTransports.set(streamableSessionId, {
                transport,
                aiSessionId,
                workspaceId,
              });
            },
          });

          transport.onclose = () => {
            const streamableSessionId = transport.sessionId;
            if (streamableSessionId) {
              activeStreamableTransports.delete(streamableSessionId);
            }
          };

          transport.onerror = (error) => {
            console.error("[Meta Agent MCP] Streamable transport error:", error);
          };

          await server.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
          return;
        }

        try {
          await streamableMetadata.transport.handleRequest(req, res, parsedBody);
        } catch (error) {
          console.error("[Meta Agent MCP] Error handling streamable POST:", error);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal server error");
          }
        }
        return;
      }

      if (pathname === "/mcp" && req.method === "DELETE") {
        if (!mcpSessionIdHeader) {
          res.writeHead(400);
          res.end("Missing Mcp-Session-Id header");
          return;
        }

        const metadata = activeStreamableTransports.get(mcpSessionIdHeader);
        if (!metadata) {
          res.writeHead(404);
          res.end("Streamable session not found");
          return;
        }

        try {
          await metadata.transport.handleRequest(req, res);
        } catch (error) {
          console.error("[Meta Agent MCP] Error handling DELETE:", error);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal server error");
          }
        }
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(port, "127.0.0.1", (err?: Error) => {
      if (err) {
        reject(err);
      }
    });

    httpServer.on("listening", () => {
      httpServer.unref();
      resolve(httpServer);
    });

    httpServer.on("error", reject);
  });
}

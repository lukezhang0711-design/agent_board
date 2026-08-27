/**
 * Per-dispatch permission controls.
 *
 * The product asks for the same two decisions across engines, but this module
 * intentionally preserves each engine's native vocabulary at the boundary.
 * It never manufactures an unsupported tier: a downgrade is explicit in the
 * returned receipt and is persisted by the dispatch service.
 */

export type DispatchPermissionScope =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';

export type DispatchDisturbanceLevel =
  | 'never'
  | 'on-failure'
  | 'on-request';

export type DispatchWorkerIntent = 'investigation' | 'implementation';

export interface DispatchPermissionKnobs {
  permissionScope: DispatchPermissionScope;
  disturbanceLevel: DispatchDisturbanceLevel;
}

export interface DispatchPermissionCapabilities {
  permissionScopes: readonly DispatchPermissionScope[];
  disturbanceLevels: readonly DispatchDisturbanceLevel[];
}

export interface CodexNativeDispatchPermissions {
  sandbox: DispatchPermissionScope;
  approvalPolicy: DispatchDisturbanceLevel;
}

export interface ClaudeSdkNativeDispatchPermissions {
  permissionMode: 'auto' | 'bypassPermissions' | 'dontAsk';
  /** `tools` is Claude SDK's true availability allow-list. */
  tools?: string[];
  /** `allowedTools` pre-approves only the named native tools. */
  allowedTools?: string[];
  disallowedTools?: string[];
  allowDangerouslySkipPermissions?: boolean;
}

export interface ClaudeCliNativeDispatchPermissions {
  permissionMode: 'auto' | 'bypassPermissions' | 'dontAsk';
  /** CLI's native availability allow-list; unlike allowedTools, this limits tools. */
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
}

export interface GeminiNativeDispatchPermissions {
  mode: 'plan' | 'accept-edits';
  dangerouslySkipPermissions?: boolean;
}

export interface DispatchPermissionResolution {
  engine: 'codex' | 'claude' | 'gemini' | 'unsupported';
  requested: DispatchPermissionKnobs;
  effective: DispatchPermissionKnobs;
  native: {
    codex?: CodexNativeDispatchPermissions;
    claudeSdk?: ClaudeSdkNativeDispatchPermissions;
    claudeCli?: ClaudeCliNativeDispatchPermissions;
    gemini?: GeminiNativeDispatchPermissions;
  };
  /** Visible receipt text whenever the engine cannot express a requested tier. */
  notice?: string;
}

const ALL_PERMISSION_SCOPES: readonly DispatchPermissionScope[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
];

const ALL_DISTURBANCE_LEVELS: readonly DispatchDisturbanceLevel[] = [
  'never',
  'on-failure',
  'on-request',
];

const CLAUDE_READ_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'LS',
] as const;

const CLAUDE_WORKSPACE_WRITE_TOOLS = [
  ...CLAUDE_READ_TOOLS,
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookRead',
  'NotebookEdit',
] as const;

const CLAUDE_READ_ONLY_DISALLOWED_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'Task',
  'Agent',
  'Workflow',
  'REPL',
] as const;

const CLAUDE_WORKSPACE_WRITE_DISALLOWED_TOOLS = [
  'Bash',
  'Task',
  'Agent',
  'Workflow',
  'REPL',
] as const;

export function getDefaultDispatchPermissionKnobs(
  intent: DispatchWorkerIntent,
): DispatchPermissionKnobs {
  return intent === 'investigation'
    ? { permissionScope: 'read-only', disturbanceLevel: 'never' }
    : { permissionScope: 'workspace-write', disturbanceLevel: 'on-failure' };
}

export function isDispatchPermissionScope(
  value: unknown,
): value is DispatchPermissionScope {
  return value === 'read-only'
    || value === 'workspace-write'
    || value === 'danger-full-access';
}

export function isDispatchDisturbanceLevel(
  value: unknown,
): value is DispatchDisturbanceLevel {
  return value === 'never'
    || value === 'on-failure'
    || value === 'on-request';
}

export function readDispatchPermissionKnobs(
  value: unknown,
  intent: DispatchWorkerIntent = 'implementation',
): DispatchPermissionKnobs {
  const fallback = getDefaultDispatchPermissionKnobs(intent);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  return {
    permissionScope: isDispatchPermissionScope(record.permissionScope)
      ? record.permissionScope
      : fallback.permissionScope,
    disturbanceLevel: isDispatchDisturbanceLevel(record.disturbanceLevel)
      ? record.disturbanceLevel
      : fallback.disturbanceLevel,
  };
}

/** Accept only durable receipts written by this module before reusing them. */
export function readDispatchPermissionResolution(
  value: unknown,
): DispatchPermissionResolution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.engine !== 'codex'
    && record.engine !== 'claude'
    && record.engine !== 'gemini'
    && record.engine !== 'unsupported'
  ) {
    return undefined;
  }
  const requestedRecord = record.requested && typeof record.requested === 'object'
    && !Array.isArray(record.requested)
    ? record.requested as Record<string, unknown>
    : null;
  const effectiveRecord = record.effective && typeof record.effective === 'object'
    && !Array.isArray(record.effective)
    ? record.effective as Record<string, unknown>
    : null;
  if (
    !requestedRecord
    || !effectiveRecord
    || !isDispatchPermissionScope(requestedRecord.permissionScope)
    || !isDispatchDisturbanceLevel(requestedRecord.disturbanceLevel)
    || !isDispatchPermissionScope(effectiveRecord.permissionScope)
    || !isDispatchDisturbanceLevel(effectiveRecord.disturbanceLevel)
    || !record.native
    || typeof record.native !== 'object'
    || Array.isArray(record.native)
  ) {
    return undefined;
  }
  const requested = readDispatchPermissionKnobs(requestedRecord);
  const effective = readDispatchPermissionKnobs(effectiveRecord);
  return {
    engine: record.engine,
    requested,
    effective,
    native: record.native as DispatchPermissionResolution['native'],
    ...(typeof record.notice === 'string' && record.notice.trim()
      ? { notice: record.notice.trim() }
      : {}),
  };
}

export function getDispatchPermissionScopeLabel(
  value: DispatchPermissionScope,
): string {
  switch (value) {
    case 'read-only':
      return '只读';
    case 'workspace-write':
      return '只写自己工地';
    case 'danger-full-access':
      return '全放开';
  }
}

export function getDispatchDisturbanceLevelLabel(
  value: DispatchDisturbanceLevel,
): string {
  switch (value) {
    case 'never':
      return '从不问';
    case 'on-failure':
      return '失败才问';
    case 'on-request':
      return '高危必问';
  }
}

export function getDispatchPermissionCapabilities(
  provider: string | null | undefined,
): DispatchPermissionCapabilities {
  const normalized = provider?.trim() ?? '';
  if (normalized === 'openai-codex') {
    return {
      permissionScopes: ALL_PERMISSION_SCOPES,
      disturbanceLevels: ALL_DISTURBANCE_LEVELS,
    };
  }
  if (normalized === 'claude-code' || normalized === 'claude-code-cli') {
    return {
      permissionScopes: ALL_PERMISSION_SCOPES,
      disturbanceLevels: ['never', 'on-request'],
    };
  }
  if (normalized === 'antigravity-gemini-agent') {
    return {
      permissionScopes: ['read-only', 'workspace-write'],
      disturbanceLevels: ['never', 'on-request'],
    };
  }
  return { permissionScopes: [], disturbanceLevels: [] };
}

function addNotice(parts: string[], provider: string, requested: string, effective: string): void {
  parts.push(
    `${provider}：该引擎不支持“${requested}”，按“${effective}”执行。`,
  );
}

function resolveClaudeNativePermissions(
  effective: DispatchPermissionKnobs,
): Pick<DispatchPermissionResolution['native'], 'claudeSdk' | 'claudeCli'> {
  const sdkScopeTools = effective.permissionScope === 'read-only'
    ? [...CLAUDE_READ_TOOLS]
    : effective.permissionScope === 'workspace-write'
      ? [...CLAUDE_WORKSPACE_WRITE_TOOLS]
      : undefined;
  const cliScopeTools = sdkScopeTools;
  const cliDisallowedTools = effective.permissionScope === 'read-only'
    ? [...CLAUDE_READ_ONLY_DISALLOWED_TOOLS]
    : effective.permissionScope === 'workspace-write'
      ? [...CLAUDE_WORKSPACE_WRITE_DISALLOWED_TOOLS]
      : undefined;

  let permissionMode: ClaudeSdkNativeDispatchPermissions['permissionMode'];
  let allowDangerouslySkipPermissions = false;
  if (effective.disturbanceLevel === 'never') {
    if (effective.permissionScope === 'danger-full-access') {
      permissionMode = 'bypassPermissions';
      allowDangerouslySkipPermissions = true;
    } else {
      permissionMode = 'dontAsk';
    }
  } else {
    // Claude's `auto` permission mode is the available native equivalent of
    // “high-risk must ask”: it approves safe actions and escalates risky ones.
    permissionMode = 'auto';
  }

  return {
    claudeSdk: {
      permissionMode,
      ...(sdkScopeTools ? { tools: sdkScopeTools } : {}),
      ...(effective.disturbanceLevel === 'never' && sdkScopeTools
        ? { allowedTools: sdkScopeTools }
        : {}),
      ...(allowDangerouslySkipPermissions
        ? { allowDangerouslySkipPermissions: true }
        : {}),
    },
    claudeCli: {
      permissionMode,
      ...(cliScopeTools ? { tools: cliScopeTools } : {}),
      ...(cliScopeTools ? { allowedTools: cliScopeTools } : {}),
      ...(cliDisallowedTools ? { disallowedTools: cliDisallowedTools } : {}),
      ...(effective.disturbanceLevel === 'never'
        ? { dangerouslySkipPermissions: true }
        : {}),
    },
  };
}

/**
 * Translate product values only at the engine boundary. The result is both the
 * source for native parameters and the durable audit receipt.
 */
export function resolveDispatchPermission(
  provider: string | null | undefined,
  requestedInput: DispatchPermissionKnobs,
): DispatchPermissionResolution {
  const requested = readDispatchPermissionKnobs(requestedInput);
  const normalized = provider?.trim() ?? '';

  if (normalized === 'openai-codex') {
    return {
      engine: 'codex',
      requested,
      effective: requested,
      native: {
        codex: {
          sandbox: requested.permissionScope,
          approvalPolicy: requested.disturbanceLevel,
        },
      },
    };
  }

  if (normalized === 'claude-code' || normalized === 'claude-code-cli') {
    const notices: string[] = [];
    const effective: DispatchPermissionKnobs = {
      permissionScope: requested.permissionScope,
      disturbanceLevel: requested.disturbanceLevel === 'on-failure'
        ? 'on-request'
        : requested.disturbanceLevel,
    };
    if (requested.disturbanceLevel === 'on-failure') {
      addNotice(notices, 'Claude', '失败才问', '高危必问');
    }
    return {
      engine: 'claude',
      requested,
      effective,
      native: resolveClaudeNativePermissions(effective),
      ...(notices.length > 0 ? { notice: notices.join(' ') } : {}),
    };
  }

  if (normalized === 'antigravity-gemini-agent') {
    const notices: string[] = [];
    const effective: DispatchPermissionKnobs = {
      permissionScope: requested.permissionScope === 'danger-full-access'
        ? 'workspace-write'
        : requested.permissionScope,
      disturbanceLevel: requested.disturbanceLevel === 'on-failure'
        ? 'on-request'
        : requested.disturbanceLevel,
    };
    if (requested.permissionScope === 'danger-full-access') {
      addNotice(notices, 'Gemini', '全放开', '只写自己工地');
    }
    if (requested.disturbanceLevel === 'on-failure') {
      addNotice(notices, 'Gemini', '失败才问', '高危必问');
    }
    return {
      engine: 'gemini',
      requested,
      effective,
      native: {
        gemini: {
          mode: effective.permissionScope === 'read-only' ? 'plan' : 'accept-edits',
          ...(effective.disturbanceLevel === 'never'
            ? { dangerouslySkipPermissions: true }
            : {}),
        },
      },
      ...(notices.length > 0 ? { notice: notices.join(' ') } : {}),
    };
  }

  return {
    engine: 'unsupported',
    requested,
    effective: requested,
    native: {},
    notice: `${normalized || '该'}引擎：该引擎不支持这两项原生映射，未发送权限参数。`,
  };
}

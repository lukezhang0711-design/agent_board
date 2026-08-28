/**
 * Per-dispatch skill grants.
 *
 * A skill bundle is only a fast input surface. Dispatch always stores and
 * executes the flattened final skill id list so the receipt says what the
 * worker actually received.
 */

export type DispatchSkillEngine = 'claude' | 'codex' | 'gemini';

export type DispatchSkillSource = 'user' | 'project' | 'plugin' | 'builtin' | 'config';

export type DispatchSkillScope = 'global' | 'project' | 'plugin' | 'config';

export interface DispatchSkillDescriptor {
  id: string;
  name: string;
  engine: DispatchSkillEngine;
  source: DispatchSkillSource;
  scope: DispatchSkillScope;
  description?: string;
  path?: string;
}

export interface DispatchSkillBundle {
  id: string;
  name: string;
  skillIds: string[];
}

export interface DispatchSkillSettings {
  disabledSkillIds: string[];
  bundles: DispatchSkillBundle[];
}

export interface DispatchSkillSelection {
  skillBundleName?: string;
  skillIds: string[];
}

export interface DispatchSkillSelectionOverride {
  original: DispatchSkillSelection;
  approved: DispatchSkillSelection;
}

export interface ClaudeSdkNativeDispatchSkills {
  /** Claude Agent SDK's native skill availability allow-list. [] means no skills. */
  skills: string[];
}

export interface ClaudeCliNativeDispatchSkills {
  /**
   * Claude CLI has no documented per-session `--skills` flag. Keep the names
   * in the audit receipt and use Skill permission rules only as a best effort.
   */
  skills: string[];
  allowedTools: string[];
  disableSlashCommands?: boolean;
}

export interface GeminiNativeDispatchSkills {
  include_only: string[];
  preToolUse: {
    include_only: string[];
  };
}

export interface CodexNativeDispatchSkills {
  control: 'skills/config/write';
  includeOnly: string[];
  disabledSkillNames: string[];
  config: Record<string, unknown>;
  notice: typeof CODEX_SKILL_CONTROL_NOTICE;
}

export interface DispatchSkillResolution {
  engine: DispatchSkillEngine | 'unsupported';
  requested: DispatchSkillSelection;
  effective: DispatchSkillSelection;
  effectiveSkillNames: string[];
  native: {
    claudeSdk?: ClaudeSdkNativeDispatchSkills;
    claudeCli?: ClaudeCliNativeDispatchSkills;
    gemini?: GeminiNativeDispatchSkills;
    codex?: CodexNativeDispatchSkills;
  };
  notice?: string;
}

export const DISPATCH_SKILL_SETTINGS_KEY = 'dispatchSkillLibrary';

export const CODEX_SKILL_CONTROL_NOTICE =
  'Codex：技能管控只能会话级禁用、无逐次审批。';
export const CLAUDE_CLI_SKILL_CONTROL_NOTICE =
  'Claude CLI：本机 CLI 只验证到禁用全部技能，未验证到指定技能白名单参数；完整白名单走 Claude Agent SDK。';

export const DEFAULT_DISPATCH_SKILL_BUNDLES: readonly DispatchSkillBundle[] = [
  { id: 'construction', name: '施工包', skillIds: [] },
  { id: 'research', name: '调研包', skillIds: [] },
  { id: 'docs', name: '文档包', skillIds: [] },
];

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item)),
  )];
}

export function createDispatchSkillId(
  engine: DispatchSkillEngine,
  source: DispatchSkillSource,
  name: string,
): string {
  return `${engine}:${source}:${name.trim()}`;
}

export function readDispatchSkillSettings(value: unknown): DispatchSkillSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      disabledSkillIds: [],
      bundles: DEFAULT_DISPATCH_SKILL_BUNDLES.map((bundle) => ({ ...bundle })),
    };
  }
  const record = value as Record<string, unknown>;
  const bundlesInput = Array.isArray(record.bundles)
    ? record.bundles
    : DEFAULT_DISPATCH_SKILL_BUNDLES;
  const bundles = bundlesInput.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const bundle = candidate as Record<string, unknown>;
    const name = normalizeString(bundle.name);
    if (!name) return [];
    return [{
      id: normalizeString(bundle.id) ?? `bundle-${name}`,
      name,
      skillIds: normalizeStringList(bundle.skillIds),
    }];
  });
  return {
    disabledSkillIds: normalizeStringList(record.disabledSkillIds),
    bundles,
  };
}

export function normalizeDispatchSkillSelection(
  value: unknown,
): DispatchSkillSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const skillIds = normalizeStringList(record.skillIds ?? record.skills);
  const bundleName = normalizeString(record.skillBundleName ?? record.bundleName);
  const hasSkillIdsField = Array.isArray(record.skillIds) || Array.isArray(record.skills);
  if (skillIds.length === 0 && !bundleName && !hasSkillIdsField) return undefined;
  return {
    ...(bundleName ? { skillBundleName: bundleName } : {}),
    skillIds,
  };
}

export function sameDispatchSkillSelection(
  left: DispatchSkillSelection,
  right: DispatchSkillSelection,
): boolean {
  if ((left.skillBundleName ?? '') !== (right.skillBundleName ?? '')) return false;
  if (left.skillIds.length !== right.skillIds.length) return false;
  const leftIds = [...left.skillIds].sort();
  const rightIds = [...right.skillIds].sort();
  return leftIds.every((id, index) => id === rightIds[index]);
}

export function getDispatchSkillEngineForProvider(
  provider: string | null | undefined,
): DispatchSkillEngine | undefined {
  const normalized = provider?.trim();
  if (normalized === 'claude-code' || normalized === 'claude-code-cli') return 'claude';
  if (normalized === 'openai-codex') return 'codex';
  if (normalized === 'antigravity-gemini-agent') return 'gemini';
  return undefined;
}

export function filterEnabledDispatchSkills(
  skills: readonly DispatchSkillDescriptor[],
  settingsInput: unknown,
): DispatchSkillDescriptor[] {
  const settings = readDispatchSkillSettings(settingsInput);
  const disabled = new Set(settings.disabledSkillIds);
  return skills.filter((skill) => !disabled.has(skill.id));
}

export function sanitizeDispatchSkillSettingsForLibrary(
  settingsInput: unknown,
  skills: readonly DispatchSkillDescriptor[],
): DispatchSkillSettings {
  const settings = readDispatchSkillSettings(settingsInput);
  const knownIds = new Set(skills.map((skill) => skill.id));
  const disabled = new Set(settings.disabledSkillIds.filter((id) => knownIds.has(id)));
  return {
    disabledSkillIds: [...disabled],
    bundles: settings.bundles.map((bundle) => ({
      ...bundle,
      skillIds: bundle.skillIds.filter((id) => knownIds.has(id) && !disabled.has(id)),
    })),
  };
}

function skillNameFromId(skillId: string): string {
  const parts = skillId.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : skillId;
}

export function resolveDispatchSkills(
  provider: string | null | undefined,
  requestedInput: unknown,
  knownSkills: readonly DispatchSkillDescriptor[] = [],
  settingsInput?: unknown,
): DispatchSkillResolution | undefined {
  const requested = normalizeDispatchSkillSelection(requestedInput);
  if (!requested) return undefined;

  const engine = getDispatchSkillEngineForProvider(provider);
  const settings = readDispatchSkillSettings(settingsInput);
  const disabled = new Set(settings.disabledSkillIds);
  const selectedBundle = requested.skillBundleName
    ? settings.bundles.find((bundle) =>
        bundle.name === requested.skillBundleName || bundle.id === requested.skillBundleName,
      )
    : undefined;
  const requestedSkillIds = requested.skillIds.length > 0 || !selectedBundle
    ? requested.skillIds
    : selectedBundle.skillIds;
  const knownById = new Map(knownSkills.map((skill) => [skill.id, skill]));
  const hasKnownSkills = knownSkills.length > 0;
  const effectiveSkills = requestedSkillIds.flatMap((skillId) => {
    if (disabled.has(skillId)) return [];
    const known = knownById.get(skillId);
    if (known) {
      return !engine || known.engine === engine ? [known] : [];
    }
    if (hasKnownSkills) return [];
    return [{
      id: skillId,
      name: skillNameFromId(skillId),
      engine: engine ?? 'codex',
      source: 'config',
      scope: 'config',
    } satisfies DispatchSkillDescriptor];
  });
  const effectiveSkillIds = [...new Set(effectiveSkills.map((skill) => skill.id))];
  const effectiveSkillNames = [...new Set(effectiveSkills.map((skill) => skill.name))];
  const effective: DispatchSkillSelection = {
    ...(requested.skillBundleName ? { skillBundleName: requested.skillBundleName } : {}),
    skillIds: effectiveSkillIds,
  };

  if (!engine) {
    return {
      engine: 'unsupported',
      requested,
      effective,
      effectiveSkillNames,
      native: {},
      notice: `${provider?.trim() || '该'}引擎：该引擎不支持技能白名单，未发送技能参数。`,
    };
  }

  if (engine === 'claude') {
    const isClaudeCli = provider?.trim() === 'claude-code-cli';
    return {
      engine,
      requested,
      effective,
      effectiveSkillNames,
      native: {
        claudeSdk: { skills: effectiveSkillNames },
        claudeCli: {
          skills: effectiveSkillNames,
          allowedTools: effectiveSkillNames.map((name) => `Skill(${name})`),
          ...(effectiveSkillNames.length === 0 ? { disableSlashCommands: true } : {}),
        },
      },
      ...(isClaudeCli && effectiveSkillNames.length > 0
        ? { notice: CLAUDE_CLI_SKILL_CONTROL_NOTICE }
        : {}),
    };
  }

  if (engine === 'gemini') {
    return {
      engine,
      requested,
      effective,
      effectiveSkillNames,
      native: {
        gemini: {
          include_only: effectiveSkillNames,
          preToolUse: { include_only: effectiveSkillNames },
        },
      },
    };
  }

  const codexSkills = knownSkills.filter((skill) =>
    skill.engine === 'codex' && !disabled.has(skill.id),
  );
  const disabledSkillNames = codexSkills
    .filter((skill) => !effectiveSkillIds.includes(skill.id))
    .map((skill) => skill.name);
  return {
    engine,
    requested,
    effective,
    effectiveSkillNames,
    native: {
      codex: {
        control: 'skills/config/write',
        includeOnly: effectiveSkillNames,
        disabledSkillNames,
        config: {
          'skills.include_only': effectiveSkillNames,
          'skills.disabled': disabledSkillNames,
        },
        notice: CODEX_SKILL_CONTROL_NOTICE,
      },
    },
    notice: CODEX_SKILL_CONTROL_NOTICE,
  };
}

export function readDispatchSkillResolution(
  value: unknown,
): DispatchSkillResolution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.engine !== 'claude'
    && record.engine !== 'codex'
    && record.engine !== 'gemini'
    && record.engine !== 'unsupported'
  ) {
    return undefined;
  }
  const requested = normalizeDispatchSkillSelection(record.requested);
  const effective = normalizeDispatchSkillSelection(record.effective);
  if (!requested || !effective || !record.native || typeof record.native !== 'object' || Array.isArray(record.native)) {
    return undefined;
  }
  return {
    engine: record.engine,
    requested,
    effective,
    effectiveSkillNames: normalizeStringList(record.effectiveSkillNames),
    native: record.native as DispatchSkillResolution['native'],
    ...(typeof record.notice === 'string' && record.notice.trim()
      ? { notice: record.notice.trim() }
      : {}),
  };
}

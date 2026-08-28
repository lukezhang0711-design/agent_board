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

export const DISPATCH_SKILL_SETTINGS_KEY = 'dispatchSkillLibrary';

export const CODEX_SKILL_CONTROL_NOTICE =
  'Codex：技能管控只能会话级禁用、无逐次审批。';

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

export function filterEnabledDispatchSkills(
  skills: readonly DispatchSkillDescriptor[],
  settingsInput: unknown,
): DispatchSkillDescriptor[] {
  const settings = readDispatchSkillSettings(settingsInput);
  const disabled = new Set(settings.disabledSkillIds);
  return skills.filter((skill) => !disabled.has(skill.id));
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

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
  content?: string;
}

export interface MergedSkillCard {
  name: string;
  descriptors: DispatchSkillDescriptor[];
  engines: Record<DispatchSkillEngine, boolean>;
  contentMatch?: 'same' | 'different';
  rawDescription?: string;
  summary: string;
  hasDescription: boolean;
  estimatedTokens: number;
  scopes: DispatchSkillScope[];
  sources: DispatchSkillSource[];
  bundleNames: string[];
  disabled: boolean;
  hasCodex: boolean;
  paths: string[];
}

export interface SkillFamilyGroup {
  id: string;
  name: string;
  cards: MergedSkillCard[];
  totalTokens: number;
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

export function estimateSkillTokens(text?: string): number {
  if (!text || !text.trim()) return 0;
  return Math.ceil(text.trim().length / 3.5);
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 10000) {
    const wan = (tokens / 10000).toFixed(1);
    return `${wan.endsWith('.0') ? wan.slice(0, -2) : wan} 万`;
  }
  return tokens.toLocaleString();
}

export function extractOneSentenceSummary(description?: string): string {
  if (!description || !description.trim()) {
    return '这个技能没有自带说明';
  }
  const trimmed = description.trim();
  const match = /^([^\n。!！?？]+(?:[。!！?？]|\.\s|$))/m.exec(trimmed);
  const firstSentence = match ? match[1].trim() : trimmed;
  if (firstSentence.length > 120) {
    return firstSentence.slice(0, 120) + '...';
  }
  return firstSentence;
}

export function extractSkillPrefix(name: string): string {
  const normalized = name.trim().toLowerCase();
  const token = normalized.split(/[-_:]/)[0];
  if (token.endsWith('ing') && token.length > 5) {
    return token.slice(0, -3);
  }
  return token;
}

export function mergeSkillsByName(
  skills: readonly DispatchSkillDescriptor[],
  settings: DispatchSkillSettings,
): MergedSkillCard[] {
  const map = new Map<string, DispatchSkillDescriptor[]>();
  for (const skill of skills) {
    const key = skill.name.trim();
    if (!key) continue;
    const existing = map.get(key) ?? [];
    existing.push(skill);
    map.set(key, existing);
  }

  const result: MergedSkillCard[] = [];
  for (const [name, descriptors] of map.entries()) {
    const engines = {
      claude: descriptors.some((d) => d.engine === 'claude'),
      codex: descriptors.some((d) => d.engine === 'codex'),
      gemini: descriptors.some((d) => d.engine === 'gemini'),
    };

    const contentsWithData = descriptors
      .map((d) => d.content)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);

    let contentMatch: 'same' | 'different' | undefined;
    if (contentsWithData.length >= 2) {
      const first = contentsWithData[0].trim();
      const allSame = contentsWithData.every((c) => c.trim() === first);
      contentMatch = allSame ? 'same' : 'different';
    }

    const rawDescription = descriptors.find((d) => d.description?.trim())?.description?.trim();
    const hasDescription = Boolean(rawDescription);
    const summary = extractOneSentenceSummary(rawDescription);
    const estimatedTokens = estimateSkillTokens(rawDescription);

    const descriptorIds = new Set(descriptors.map((d) => d.id));
    const disabled = descriptors.every((d) => settings.disabledSkillIds.includes(d.id));

    const bundleNames = settings.bundles
      .filter((b) => b.skillIds.some((id) => descriptorIds.has(id)))
      .map((b) => b.name);

    const scopes = [...new Set(descriptors.map((d) => d.scope))];
    const sources = [...new Set(descriptors.map((d) => d.source))];
    const paths = [...new Set(descriptors.map((d) => d.path).filter((p): p is string => Boolean(p)))];

    result.push({
      name,
      descriptors,
      engines,
      contentMatch,
      rawDescription,
      summary,
      hasDescription,
      estimatedTokens,
      scopes,
      sources,
      bundleNames,
      disabled,
      hasCodex: engines.codex,
      paths,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function groupSkillsByFamily(cards: MergedSkillCard[]): SkillFamilyGroup[] {
  const candidateMap = new Map<string, MergedSkillCard[]>();
  for (const card of cards) {
    const prefix = extractSkillPrefix(card.name);
    const list = candidateMap.get(prefix) ?? [];
    list.push(card);
    candidateMap.set(prefix, list);
  }

  const families: SkillFamilyGroup[] = [];
  const ungrouped: MergedSkillCard[] = [];

  for (const [prefix, groupCards] of candidateMap.entries()) {
    if (groupCards.length >= 2) {
      const totalTokens = groupCards.reduce((sum, c) => sum + c.estimatedTokens, 0);
      families.push({
        id: `family-${prefix}`,
        name: prefix,
        cards: groupCards.sort((a, b) => a.name.localeCompare(b.name)),
        totalTokens,
      });
    } else {
      ungrouped.push(...groupCards);
    }
  }

  families.sort((a, b) => a.name.localeCompare(b.name));

  if (ungrouped.length > 0) {
    const totalTokens = ungrouped.reduce((sum, c) => sum + c.estimatedTokens, 0);
    families.push({
      id: 'family-other',
      name: '其他技能',
      cards: ungrouped.sort((a, b) => a.name.localeCompare(b.name)),
      totalTokens,
    });
  }

  return families;
}

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

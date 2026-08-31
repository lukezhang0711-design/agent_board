export type DispatchSkillEngine = 'claude' | 'codex' | 'gemini';

export type DispatchSkillSource = 'user' | 'project' | 'plugin' | 'builtin' | 'config';

export type DispatchSkillScope = 'global' | 'project' | 'plugin' | 'config';

export const SKILL_CATEGORIES = [
  '规划决策',
  '开发实现',
  '质量保障',
  '界面设计',
  '文档写作',
  '发布部署',
  '安全管控',
  '工具环境',
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const CATEGORY_REPRESENTATIVE_USAGES: Record<SkillCategory, string> = {
  规划决策: '出方案、拆任务、追问打磨、评审计划',
  开发实现: '照方案实现、测试驱动、迁移改造、解冲突',
  质量保障: '排障、代码审查、测试、性能回归',
  界面设计: '设计稿、视觉审查、生成页面',
  文档写作: '文档、文章、交接、导出',
  发布部署: '合并 PR、部署、上线后监控',
  安全管控: '危险命令拦截、改动范围锁定、安全审计',
  工具环境: '浏览器、上下文存取、环境配置',
};

export interface DispatchSkillDescriptor {
  id: string;
  name: string;
  engine: DispatchSkillEngine;
  source: DispatchSkillSource;
  scope: DispatchSkillScope;
  description?: string;
  path?: string;
  content?: string;
  category?: SkillCategory;
  summaryZh?: string;
  enrichmentFailed?: boolean;
}

export interface MergedSkillCard {
  name: string;
  descriptors: DispatchSkillDescriptor[];
  engines: Record<DispatchSkillEngine, boolean>;
  contentMatch?: 'same' | 'different';
  rawDescription?: string;
  summary: string;
  summaryZh: string;
  category: SkillCategory;
  enrichmentFailed?: boolean;
  hasDescription: boolean;
  estimatedTokens: number;
  scopes: DispatchSkillScope[];
  sources: DispatchSkillSource[];
  bundleNames: string[];
  disabled: boolean;
  hasCodex: boolean;
  paths: string[];
}

export interface SkillCategoryGroup {
  category: SkillCategory;
  representativeUsage: string;
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

    const enrichedDesc = descriptors.find((d) => d.summaryZh?.trim());
    const summaryZh = enrichedDesc?.summaryZh?.trim()
      ?? (hasDescription ? summary : '这个技能没有自带说明');
    const categoryCandidate = descriptors.find((d) => d.category && SKILL_CATEGORIES.includes(d.category))?.category;
    const category: SkillCategory = categoryCandidate ?? '工具环境';
    const enrichmentFailed = descriptors.some((d) => d.enrichmentFailed);

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
      summaryZh,
      category,
      enrichmentFailed,
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

export function groupSkillsByCategory(cards: MergedSkillCard[]): SkillCategoryGroup[] {
  const map = new Map<SkillCategory, MergedSkillCard[]>();
  for (const cat of SKILL_CATEGORIES) {
    map.set(cat, []);
  }
  for (const card of cards) {
    const cat = SKILL_CATEGORIES.includes(card.category) ? card.category : '工具环境';
    map.get(cat)!.push(card);
  }

  return SKILL_CATEGORIES.map((category) => {
    const groupCards = (map.get(category) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const totalTokens = groupCards.reduce((sum, c) => sum + c.estimatedTokens, 0);
    return {
      category,
      representativeUsage: CATEGORY_REPRESENTATIVE_USAGES[category],
      cards: groupCards,
      totalTokens,
    };
  });
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

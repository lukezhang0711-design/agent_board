export const DEFAULT_SKILL_CATEGORIES = [
  '规划决策',
  '开发实现',
  '质量保障',
  '界面设计',
  '文档写作',
  '发布部署',
  '安全管控',
  '工具环境',
] as const;

export type SkillCategory = string;

export interface SkillTaxonomyEntry {
  category: string;
  /** A short Chinese description for the owner-facing Skill Library. */
  summaryZh?: string;
}

export interface SkillTaxonomy {
  categories: string[];
  skills: Record<string, SkillTaxonomyEntry>;
}

export function normalizeSkillTaxonomyKey(name: string): string {
  return name.trim().toLowerCase();
}

export function hasChineseSkillSummary(value: string | undefined): boolean {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

export function createDefaultSkillTaxonomy(): SkillTaxonomy {
  return {
    categories: [...DEFAULT_SKILL_CATEGORIES],
    skills: {},
  };
}

/**
 * Reads the one taxonomy field stored beside the existing Skill Library data.
 * Invalid entries are ignored so a bad old value cannot blank the library.
 */
export function readSkillTaxonomy(value: unknown): SkillTaxonomy | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.categories)) return undefined;

  const categories = [...new Set(record.categories.flatMap((candidate) => {
    if (typeof candidate !== 'string') return [];
    const category = candidate.trim();
    return category ? [category] : [];
  }))];
  if (categories.length === 0) return undefined;

  const categorySet = new Set(categories);
  const skills: Record<string, SkillTaxonomyEntry> = {};
  if (record.skills && typeof record.skills === 'object' && !Array.isArray(record.skills)) {
    for (const [rawName, rawEntry] of Object.entries(record.skills as Record<string, unknown>)) {
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
      const name = normalizeSkillTaxonomyKey(rawName);
      const entry = rawEntry as Record<string, unknown>;
      const category = typeof entry.category === 'string' ? entry.category.trim() : '';
      if (!name || !categorySet.has(category)) continue;
      const summary = typeof entry.summaryZh === 'string' ? entry.summaryZh.trim() : '';
      skills[name] = {
        category,
        ...(hasChineseSkillSummary(summary) ? { summaryZh: summary } : {}),
      };
    }
  }

  return { categories, skills };
}

export function getEffectiveSkillTaxonomy(value: unknown): SkillTaxonomy {
  return readSkillTaxonomy(value) ?? createDefaultSkillTaxonomy();
}

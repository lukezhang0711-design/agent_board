import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DEFAULT_SKILL_CATEGORIES,
  type SkillCategory,
} from '../../shared/skillTaxonomy';

/** Factory defaults only. Owner-approved taxonomy data is the runtime source of truth. */
export const SKILL_CATEGORIES = DEFAULT_SKILL_CATEGORIES;
export type { SkillCategory } from '../../shared/skillTaxonomy';

export const CATEGORY_REPRESENTATIVE_USAGES: Record<(typeof SKILL_CATEGORIES)[number], string> = {
  规划决策: '出方案、拆任务、追问打磨、评审计划',
  开发实现: '照方案实现、测试驱动、迁移改造、解冲突',
  质量保障: '排障、代码审查、测试、性能回归',
  界面设计: '设计稿、视觉审查、生成页面',
  文档写作: '文档、文章、交接、导出',
  发布部署: '合并 PR、部署、上线后监控',
  安全管控: '危险命令拦截、改动范围锁定、安全审计',
  工具环境: '浏览器、上下文存取、环境配置',
};

export interface SkillEnrichmentResult {
  category: SkillCategory;
  summaryZh: string;
  enrichmentFailed?: boolean;
}

export interface SkillEnrichmentCacheEntry extends SkillEnrichmentResult {
  hash: string;
  updatedAt: string;
}

interface DiskCacheFormat {
  version: number;
  entries: Record<string, SkillEnrichmentCacheEntry>;
}

// Built-in high-quality Chinese descriptions (< 30 characters) and taxonomy for common skills
const KNOWN_SKILL_CATALOG: Record<string, { category: SkillCategory; summaryZh: string }> = {
  'ask-matt': { category: '工具环境', summaryZh: '寻找适合当前场景的工作流与技能指引' },
  'autoplan': { category: '规划决策', summaryZh: '自动串联 CEO、设计、工程等多维度方案评审' },
  'benchmark': { category: '质量保障', summaryZh: '使用无头浏览器对应用进行性能回归与基准测试' },
  'benchmark-models': { category: '质量保障', summaryZh: '跨模型运行基准测试，对比各模型的能力表现' },
  'browse': { category: '工具环境', summaryZh: '启动快速无头浏览器，用于页面测试与交互验证' },
  'open-gstack-browser': { category: '工具环境', summaryZh: '启动带界面的 Chromium 浏览器进行 AI 协同操控' },
  'canary': { category: '发布部署', summaryZh: '部署上线后进行金丝雀监控，验证线上健康状态' },
  'careful': { category: '安全管控', summaryZh: '危险命令安全防护，在执行高危破坏性操作前告警' },
  'codebase-design': { category: '开发实现', summaryZh: '设计深层模块结构，建立清晰的代码架构与词汇' },
  'codex': { category: '工具环境', summaryZh: '调用 OpenAI Codex 命令行进行独立评审与代码辅助' },
  'context-restore': { category: '工具环境', summaryZh: '恢复此前保存的工作上下文、git 状态与决策记录' },
  'context-save': { category: '工具环境', summaryZh: '保存当前工作上下文、分支状态与决策记录到磁盘' },
  'cso': { category: '安全管控', summaryZh: '开启安全官模式，执行基础设施与代码安全审计' },
  'decision-mapping': { category: '规划决策', summaryZh: '将散乱想法拆解梳理为有序的调研与任务执行图' },
  'deep-planning': { category: '规划决策', summaryZh: '需要深度思考与方案权衡时，制定详尽架构规划' },
  'design-an-interface': { category: '界面设计', summaryZh: '为功能探索并生成多个截然不同的 UI 界面方案' },
  'design-consultation': { category: '界面设计', summaryZh: '深入理解产品与用户需求，提供界面设计咨询' },
  'design-html': { category: '界面设计', summaryZh: '生成生产级高质量 HTML 页面与 UI 呈现' },
  'design-review': { category: '界面设计', summaryZh: '从设计师视角审查界面视觉、间距与排版一致性' },
  'design-shotgun': { category: '界面设计', summaryZh: '批量生成多种 AI 设计变体并开启对比面板' },
  'devex-review': { category: '质量保障', summaryZh: '使用浏览器实测开发者体验，审查易用性与文档' },
  'diagnosing-bugs': { category: '质量保障', summaryZh: '排查疑难 Bug 与性能退化问题时进行系统诊断' },
  'document-generate': { category: '文档写作', summaryZh: '为新功能、模块或整个工程从头生成完整文档' },
  'document-release': { category: '文档写作', summaryZh: '发布上线后根据代码变更对照更新项目文档' },
  'domain-modeling': { category: '规划决策', summaryZh: '梳理并构建领域模型，统一业务术语与实体关系' },
  'edit-article': { category: '文档写作', summaryZh: '重构文章结构、优化文字表达并提升论述清晰度' },
  'freeze': { category: '安全管控', summaryZh: '锁定文件改动范围，禁止修改指定目录以外的文件' },
  'git-guardrails-claude-code': { category: '安全管控', summaryZh: '配置 Git 钩子拦截 force push 等高危操作' },
  'grill-me': { category: '规划决策', summaryZh: '通过连环追问面试，高强度打磨和推敲方案' },
  'grill-with-docs': { category: '文档写作', summaryZh: '追问打磨方案并同步产出架构决策记录与术语表' },
  'grilling': { category: '规划决策', summaryZh: '高强度追问和压力测试方案中的漏洞与盲点' },
  'gstack': { category: '工具环境', summaryZh: '快速无头浏览器工具，用于 QA 测试与页面交互' },
  'gstack-upgrade': { category: '工具环境', summaryZh: '检测并升级 gstack 到最新版本' },
  'guard': { category: '安全管控', summaryZh: '全方位安全防护：拦截危险命令并限定改动目录' },
  'handoff': { category: '文档写作', summaryZh: '压缩当前会话上下文，生成供下一位交接的文档' },
  'health': { category: '质量保障', summaryZh: '聚合运行类型检查、代码规范、测试与质量体检' },
  'implement': { category: '开发实现', summaryZh: '依据 PRD 需求或 Issue 任务清单编写代码实现' },
  'improve-codebase-architecture': { category: '开发实现', summaryZh: '扫描代码库架构改进点并输出可视化重构建议' },
  'investigate': { category: '质量保障', summaryZh: '系统化排查根本原因：调查、分析、假设与验证' },
  'land-and-deploy': { category: '发布部署', summaryZh: '合并 PR、等待 CI、部署上线并验证线上健康度' },
  'landing-report': { category: '发布部署', summaryZh: '查看版本发布队列看板与各版本占用状态' },
  'learn': { category: '文档写作', summaryZh: '检索、整理与导出跨会话积累的项目认知与经验' },
  'make-pdf': { category: '文档写作', summaryZh: '将 Markdown 文件转换为出版级高质量 PDF 文档' },
  'migrate-to-shoehorn': { category: '开发实现', summaryZh: '将测试文件中的类型断言迁移改造至 shoehorn' },
  'obsidian-vault': { category: '文档写作', summaryZh: '在 Obsidian 双链知识库中检索、创建与管理笔记' },
  'office-hours': { category: '规划决策', summaryZh: '以创业导师模式对产品需求真实性与定位深度复盘' },
  'pair-agent': { category: '工具环境', summaryZh: '生成配对密钥，将远程 AI Agent 与本地浏览器连接' },
  'plan-ceo-review': { category: '规划决策', summaryZh: '以 CEO 视角重新审视业务目标与核心产品价值' },
  'plan-design-review': { category: '规划决策', summaryZh: '以设计视角对产品交互与视觉规划进行维度评审' },
  'plan-devex-review': { category: '规划决策', summaryZh: '以开发者体验视角对接口易用性与上手路径评审' },
  'plan-eng-review': { category: '规划决策', summaryZh: '以工程主管视角敲定系统架构、数据流与边界方案' },
  'plan-tune': { category: '规划决策', summaryZh: '调优规划阶段的提问灵敏度与思考倾向' },
  'prototype': { category: '开发实现', summaryZh: '快速构建原型应用，用于验证状态流与业务逻辑' },
  'qa': { category: '质量保障', summaryZh: '以对话方式记录缺陷并自动在 Issue 跟踪器建单' },
  'qa-only': { category: '质量保障', summaryZh: '系统化测试 Web 应用并产出结构化测试报告' },
  'request-refactor-plan': { category: '规划决策', summaryZh: '通过访谈梳理小步重构方案并创建任务工单' },
  'resolving-merge-conflicts': { category: '开发实现', summaryZh: '在 Git 合并或变基发生冲突时协助分析与解决' },
  'retro': { category: '质量保障', summaryZh: '分析提交历史与代码指标，开展每周研发复盘' },
  'review': { category: '质量保障', summaryZh: '对比指定基准节点，对代码改动开展全面审查' },
  'scaffold-exercises': { category: '开发实现', summaryZh: '脚手架生成配套练习题、解析与测试目录结构' },
  'scrape': { category: '工具环境', summaryZh: '通过浏览器提取网页内容并生成结构化抓取结果' },
  'setup-browser-cookies': { category: '工具环境', summaryZh: '将宿主浏览器 Cookie 导入无头浏览器调试会话' },
  'setup-deploy': { category: '发布部署', summaryZh: '配置云平台部署参数，准备自动上线流程' },
  'setup-gbrain': { category: '工具环境', summaryZh: '初始化本地或远程 gbrain 记忆数据库环境' },
  'setup-matt-pocock-skills': { category: '工具环境', summaryZh: '为当前仓库配置工单标签与技能工作流规范' },
  'setup-pre-commit': { category: '质量保障', summaryZh: '配置 Husky 与 lint-staged 代码提交前检查' },
  'ship': { category: '发布部署', summaryZh: '执行发版流程：合并基线、测试、改版本号与写日志' },
  'skillify': { category: '工具环境', summaryZh: '将网页抓取流程固化为可长期复用的技能' },
  'sync-gbrain': { category: '工具环境', summaryZh: '同步最新代码索引至 gbrain 并更新提示词上下文' },
  'tdd': { category: '开发实现', summaryZh: '按测试驱动开发流程，先写测试再编码实现功能' },
  'teach': { category: '文档写作', summaryZh: '在当前工作区内向用户讲解技能知识与开发概念' },
  'to-issues': { category: '规划决策', summaryZh: '将方案或 PRD 拆解为可独立认领的 Issue 工单' },
  'to-prd': { category: '规划决策', summaryZh: '将当前讨论要点整理为正式 PRD 需求文档并提交' },
  'triage': { category: '规划决策', summaryZh: '对工单与 PR 进行分类、复现核验与初步定级' },
  'ubiquitous-language': { category: '规划决策', summaryZh: '提取业务通用术语词汇表，消除命名歧义' },
  'unfreeze': { category: '安全管控', summaryZh: '解除文件修改锁定，恢复对所有目录的编辑权限' },
  'writing-beats': { category: '文档写作', summaryZh: '将文章核心观点梳理为分步推进的情节节拍' },
  'writing-fragments': { category: '文档写作', summaryZh: '通过问答挖掘并提炼写作素材片段与核心论据' },
  'writing-great-skills': { category: '文档写作', summaryZh: '编写高质量技能规范的原则、范式与编写指引' },
  'writing-shape': { category: '文档写作', summaryZh: '将零散材料通过对话加工塑造成结构完整的文章' },
  'apple-design': { category: '界面设计', summaryZh: '遵循 Apple 风格设计规范指引进行前端与 UI 实现' },
  'frontend-design': { category: '界面设计', summaryZh: '打造高品质、生产级别的现代化前端界面' },
  'linear-design': { category: '界面设计', summaryZh: '遵循 Linear 风格设计规范指引进行前端与 UI 实现' },
  'vercel-design': { category: '界面设计', summaryZh: '遵循 Vercel 风格设计规范指引进行前端与 UI 实现' },
  'front-design': { category: '界面设计', summaryZh: '采用移动端优先理念构建高质量前端界面' },
  'playwright': { category: '工具环境', summaryZh: '使用 Playwright 在终端驱动真实浏览器自动化' },
  'screenshot': { category: '工具环境', summaryZh: '截取全屏或特定窗口的系统屏幕截图' },
  'ai-hotspot-radar': { category: '工具环境', summaryZh: '汇总、排序并提取 AI 领域最新热点动态' },
  'qdii-dca-advisor': { category: '工具环境', summaryZh: '协助进行 QDII 境外指数基金定投决策与测算' },
};

export function computeSkillHash(name: string, description?: string, content?: string): string {
  const normName = name.trim();
  const normDesc = (description ?? '').trim();
  const normContent = (content ?? '').trim();
  return crypto
    .createHash('sha256')
    .update(`${normName}:${normDesc}:${normContent}`, 'utf8')
    .digest('hex');
}

/**
 * Heuristic classifier for skills not found in KNOWN_SKILL_CATALOG
 */
export function inferSkillCategory(name: string, description?: string): SkillCategory {
  const text = `${name} ${description ?? ''}`.toLowerCase();

  // 1. 安全管控
  if (
    /\b(security|safe|safety|cso|guard|careful|freeze|unfreeze|permission|audit|guardrail|block)\b/.test(text)
    || /(安全|防护|拦截|权限|锁定|审计|限制)/.test(text)
  ) {
    return '安全管控';
  }

  // 2. 发布部署
  if (
    /\b(deploy|ship|release|canary|landing|land-and-deploy|publish|production|ci)\b/.test(text)
    || /(部署|上线|发布|发版|金丝雀|出包)/.test(text)
  ) {
    return '发布部署';
  }

  // 3. 界面设计
  if (
    /\b(design|ui|ux|frontend|html|css|style|visual|mockup|wireframe|page|theme|view)\b/.test(text)
    || /(界面|视觉|排版|设计|样式|前端|美化)/.test(text)
  ) {
    return '界面设计';
  }

  // 4. 文档写作
  if (
    /\b(document|doc|docs|article|writing|write|handoff|pdf|notes|obsidian|learn|teach|glossary|readme)\b/.test(text)
    || /(文档|文章|写作|交接|笔记|导出|教学|总结)/.test(text)
  ) {
    return '文档写作';
  }

  // 5. 质量保障
  if (
    /\b(qa|review|diagnos|investigat|debug|bug|benchmark|retro|health|test|lint|audit)\b/.test(text)
    || /(排障|审查|测试|质量|体检|复盘|诊断|基准)/.test(text)
  ) {
    return '质量保障';
  }

  // 6. 开发实现
  if (
    /\b(implement|code|tdd|prototype|conflict|migrate|scaffold|refactor|feature|build|patch)\b/.test(text)
    || /(实现|开发|编码|原型|迁移|驱动|冲突|脚手架)/.test(text)
  ) {
    return '开发实现';
  }

  // 7. 规划决策
  if (
    /\b(plan|planning|decision|grill|interview|autoplan|office-hours|issues|prd|triage|spec|requirement)\b/.test(text)
    || /(方案|拆任务|需求|规划|决策|打磨|追问|评审|工单)/.test(text)
  ) {
    return '规划决策';
  }

  // 8. 兜底归工具环境
  return '工具环境';
}

function truncateTo30(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 30) return trimmed;
  return trimmed.slice(0, 29) + '…';
}

/**
 * Generate Chinese one-sentence summary (<= 30 chars) and category for a skill.
 */
export function generateSkillEnrichment(
  name: string,
  description?: string,
  _content?: string,
): SkillEnrichmentResult {
  const trimmedDesc = (description ?? '').trim();

  // 原文没有说明的技能：如实标"这个技能没有自带说明"，不许编
  if (!trimmedDesc) {
    return {
      category: '工具环境',
      summaryZh: '这个技能没有自带说明',
      enrichmentFailed: false,
    };
  }

  const normalizedName = name.trim().toLowerCase();
  const catalogEntry = KNOWN_SKILL_CATALOG[normalizedName];
  if (catalogEntry) {
    return {
      category: catalogEntry.category,
      summaryZh: truncateTo30(catalogEntry.summaryZh),
      enrichmentFailed: false,
    };
  }

  const category = inferSkillCategory(name, description);

  // If already Chinese, take the first sentence and cap to 30 chars
  const hasChinese = /[\u4e00-\u9fa5]/.test(trimmedDesc);
  if (hasChinese) {
    const firstSentenceMatch = /^([^。!！?？\n]+)/.exec(trimmedDesc);
    const firstSentence = firstSentenceMatch ? firstSentenceMatch[1].trim() : trimmedDesc;
    return {
      category,
      summaryZh: truncateTo30(firstSentence),
      enrichmentFailed: false,
    };
  }

  // If not Chinese and not in catalog: mark as untranslated (enrichmentFailed: true)
  let cleanDesc = trimmedDesc.replace(/^A\s+/i, '').replace(/^An\s+/i, '');
  const firstSentence = cleanDesc.split(/\.|\n/)[0].trim();
  const rawSummary = firstSentence || trimmedDesc;

  return {
    category,
    summaryZh: rawSummary.length > 120 ? rawSummary.slice(0, 120) + '...' : rawSummary,
    enrichmentFailed: true,
  };
}

export class SkillTaxonomyCacheManager {
  private cachePath: string;
  private memoryCache: Map<string, SkillEnrichmentCacheEntry> = new Map();
  private loaded: boolean = false;
  private dirty: boolean = false;

  constructor(customPath?: string) {
    if (customPath) {
      this.cachePath = customPath;
    } else {
      let baseDir = path.join(os.homedir(), '.nimbalyst');
      try {
        // In electron main process, use app.getPath('userData') if available
        const electron = require('electron');
        if (electron?.app?.getPath) {
          baseDir = electron.app.getPath('userData');
        }
      } catch {
        // Fall back to ~/.nimbalyst
      }
      this.cachePath = path.join(baseDir, 'skill-taxonomy-cache.json');
    }
  }

  public getCachePath(): string {
    return this.cachePath;
  }

  public load(): void {
    if (this.loaded) return;
    this.memoryCache.clear();
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf8');
        const data = JSON.parse(raw) as DiskCacheFormat;
        if (data && data.version === 1 && data.entries && typeof data.entries === 'object') {
          for (const [hash, entry] of Object.entries(data.entries)) {
            if (entry && typeof entry === 'object' && typeof entry.category === 'string') {
              this.memoryCache.set(hash, entry);
            }
          }
        }
      }
    } catch (err) {
      // Corrupt cache is safely ignored
    }
    this.loaded = true;
    this.dirty = false;
  }

  public get(hash: string): SkillEnrichmentCacheEntry | undefined {
    this.load();
    return this.memoryCache.get(hash);
  }

  public set(hash: string, entry: SkillEnrichmentResult): void {
    this.load();
    const fullEntry: SkillEnrichmentCacheEntry = {
      ...entry,
      hash,
      updatedAt: new Date().toISOString(),
    };
    this.memoryCache.set(hash, fullEntry);
    this.dirty = true;
  }

  public save(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: DiskCacheFormat = {
        version: 1,
        entries: Object.fromEntries(this.memoryCache.entries()),
      };
      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2), 'utf8');
      this.dirty = false;
    } catch {
      // Ignore disk write errors in restricted environments
    }
  }

  public enrichAndCache(
    name: string,
    description?: string,
    content?: string,
    generator: typeof generateSkillEnrichment = generateSkillEnrichment,
  ): SkillEnrichmentResult {
    this.load();
    const hash = computeSkillHash(name, description, content);
    const cached = this.get(hash);
    if (cached) {
      return {
        category: cached.category,
        summaryZh: cached.summaryZh,
        enrichmentFailed: cached.enrichmentFailed,
      };
    }

    const generated = generator(name, description, content);
    this.set(hash, generated);
    this.save();
    return generated;
  }
}

export const skillTaxonomyCacheManager = new SkillTaxonomyCacheManager();

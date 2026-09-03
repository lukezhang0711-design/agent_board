import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATEGORY_REPRESENTATIVE_USAGES,
  KNOWN_SKILL_CATALOG,
  SKILL_CATEGORIES,
  SkillTaxonomyCacheManager,
  computeSkillHash,
  generateSkillEnrichment,
  inferSkillCategory,
  type SkillCategory,
} from '../SkillTaxonomyEnricher';

describe('SkillTaxonomyEnricher (施工单 GJ 验收套件)', () => {
  let tmpDir: string | null = null;
  let cacheFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxonomy-test-'));
    cacheFile = path.join(tmpDir, 'skill-taxonomy-cache.json');
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('绿②: 8类类名和代表用途完整且逐字一致', () => {
    const expectedCategories: SkillCategory[] = [
      '规划决策',
      '开发实现',
      '质量保障',
      '界面设计',
      '文档写作',
      '发布部署',
      '安全管控',
      '工具环境',
    ];
    expect(SKILL_CATEGORIES).toEqual(expectedCategories);

    expect(CATEGORY_REPRESENTATIVE_USAGES['规划决策']).toBe('出方案、拆任务、追问打磨、评审计划');
    expect(CATEGORY_REPRESENTATIVE_USAGES['开发实现']).toBe('照方案实现、测试驱动、迁移改造、解冲突');
    expect(CATEGORY_REPRESENTATIVE_USAGES['质量保障']).toBe('排障、代码审查、测试、性能回归');
    expect(CATEGORY_REPRESENTATIVE_USAGES['界面设计']).toBe('设计稿、视觉审查、生成页面');
    expect(CATEGORY_REPRESENTATIVE_USAGES['文档写作']).toBe('文档、文章、交接、导出');
    expect(CATEGORY_REPRESENTATIVE_USAGES['发布部署']).toBe('合并 PR、部署、上线后监控');
    expect(CATEGORY_REPRESENTATIVE_USAGES['安全管控']).toBe('危险命令拦截、改动范围锁定、安全审计');
    expect(CATEGORY_REPRESENTATIVE_USAGES['工具环境']).toBe('浏览器、上下文存取、环境配置');
  });

  it('绿⑥: 9 条死条目已清、connect-chrome 已补（两条断言）', () => {
    // 1. 断言 9 条死条目已彻底从表中清除
    const deadEntries = [
      'apple-design',
      'frontend-design',
      'linear-design',
      'vercel-design',
      'front-design',
      'playwright',
      'screenshot',
      'ai-hotspot-radar',
      'qdii-dca-advisor',
    ];
    for (const dead of deadEntries) {
      expect(KNOWN_SKILL_CATALOG[dead], `死条目 ${dead} 不得存在`).toBeUndefined();
    }

    // 2. 断言 connect-chrome 已补齐且类别准确
    expect(KNOWN_SKILL_CATALOG['connect-chrome']).toEqual({
      category: '工具环境',
      summaryZh: '连接或启动 Chrome 浏览器进行 AI 协同操控',
    });

    // 表总条目数刚好为 81 条（对齐本机 81 个技能）
    expect(Object.keys(KNOWN_SKILL_CATALOG).length).toBe(81);
  });

  it('绿①: 表外技能经生成后拿到 30 字以内的中文说明（夹具断言）', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockAiGenerator = vi.fn().mockResolvedValue('启动快速浏览器并执行自动化交互测试验证');
    manager.setAiGenerator(mockAiGenerator);

    const res = await manager.enrichAsync(
      'unseen-browser-tool',
      'Launch an automated browser session for verifying interactive UI components.',
      'content',
      undefined,
      mockAiGenerator,
    );

    expect(mockAiGenerator).toHaveBeenCalledTimes(1);
    expect(res.enrichmentFailed).toBe(false);
    expect(res.summaryZh).toBe('启动快速浏览器并执行自动化交互测试验证');
    expect(res.summaryZh.length).toBeLessThanOrEqual(30);
    expect(res.category).toBe('界面设计');
  });

  it('绿②: 同一技能内容不变时第二次不再触发生成（断言生成函数只被调用一次）', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockAiGenerator = vi.fn().mockResolvedValue('自动提取通用术语');
    manager.setAiGenerator(mockAiGenerator);

    // 第一次调用触发生成
    const res1 = await manager.enrichAsync(
      'my-custom-skill',
      'Extract business terminology to form a ubiquitous glossary',
      'v1',
      undefined,
      mockAiGenerator,
    );
    expect(mockAiGenerator).toHaveBeenCalledTimes(1);
    expect(res1.summaryZh).toBe('自动提取通用术语');

    // 第二次调用读取缓存，不触发生成
    const res2 = await manager.enrichAsync(
      'my-custom-skill',
      'Extract business terminology to form a ubiquitous glossary',
      'v1',
      undefined,
      mockAiGenerator,
    );
    expect(mockAiGenerator).toHaveBeenCalledTimes(1);
    expect(res2.summaryZh).toBe('自动提取通用术语');
  });

  it('绿③: 生成失败时保留原文且 enrichmentFailed 为 true（夹具制造一次失败，逐字段断言）', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockAiGenerator = vi.fn().mockRejectedValue(new Error('Network error or rate limited'));
    manager.setAiGenerator(mockAiGenerator);

    const rawDesc = 'Execute secure network audits across all container clusters';
    const res = await manager.enrichAsync(
      'network-audit-skill',
      rawDesc,
      'v1',
      undefined,
      mockAiGenerator,
    );

    expect(mockAiGenerator).toHaveBeenCalledTimes(1);
    // 逐字段断言
    expect(res.enrichmentFailed).toBe(true);
    expect(res.summaryZh).toBe(rawDesc);
    expect(res.category).toBe('安全管控');
  });

  it('绿④: 反向断言——任何路径下都不会产出与原文无关的编造中文（失败路径断言 summaryZh 等于喂入的原文）', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockAiGenerator = vi.fn().mockRejectedValue(new Error('CLI process crashed'));
    manager.setAiGenerator(mockAiGenerator);

    const englishDesc = 'Analyze SQL performance metrics and optimize query indexes';
    const res = await manager.enrichAsync(
      'sql-perf-optimizer',
      englishDesc,
      'v1',
      undefined,
      mockAiGenerator,
    );

    // 失败路径断言 summaryZh 严格等于喂入的原文，绝无编造的中文文本
    expect(res.summaryZh).toBe(englishDesc);
    expect(res.enrichmentFailed).toBe(true);
    expect(/[\u4e00-\u9fa5]/.test(res.summaryZh)).toBe(false);
  });

  it('绿⑤: 反向断言——生成不阻塞页面（断言技能库首屏渲染不等待生成完成）', () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    let generatorStarted = false;
    const slowAiGenerator = vi.fn().mockImplementation(async () => {
      generatorStarted = true;
      await new Promise((r) => setTimeout(r, 5000));
      return '耗时生成结果';
    });
    manager.setAiGenerator(slowAiGenerator);

    const start = Date.now();
    // 同步调用 enrichAndCache，必须立即返回，首屏渲染不阻塞
    const immediateRes = manager.enrichAndCache(
      'brand-new-slow-skill',
      'This is a complex skill that takes 5 seconds to summarize.',
    );
    const elapsed = Date.now() - start;

    // 同步返回耗时远小于 100ms
    expect(elapsed).toBeLessThan(100);
    expect(immediateRes.enrichmentFailed).toBe(true);
    expect(immediateRes.summaryZh).toContain('This is a complex skill');
  });

  it('绿⑦: 命中写死表时不触发生成（断言生成函数未被调用）', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockAiGenerator = vi.fn().mockResolvedValue('不应该被调用的结果');
    manager.setAiGenerator(mockAiGenerator);

    // 测试命中写死表中的技能（如 connect-chrome 或 handoff）
    const res = await manager.enrichAsync(
      'connect-chrome',
      'Launch GStack Browser Chromium for AI collaboration.',
      'v1',
      undefined,
      mockAiGenerator,
    );

    expect(mockAiGenerator).not.toHaveBeenCalled();
    expect(res.summaryZh).toBe('连接或启动 Chrome 浏览器进行 AI 协同操控');
    expect(res.category).toBe('工具环境');
    expect(res.enrichmentFailed).toBe(false);
  });

  it('绿⑧: 「这个技能没有自带说明」这条既有诚实兜底零回归', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockAiGenerator = vi.fn();
    manager.setAiGenerator(mockAiGenerator);

    // 空说明或全空格
    const resEmpty = await manager.enrichAsync('empty-desc-skill', '', 'v1', undefined, mockAiGenerator);
    expect(mockAiGenerator).not.toHaveBeenCalled();
    expect(resEmpty.summaryZh).toBe('这个技能没有自带说明');
    expect(resEmpty.enrichmentFailed).toBe(false);

    const resWhitespace = await manager.enrichAsync('whitespace-skill', '   ', 'v1', undefined, mockAiGenerator);
    expect(mockAiGenerator).not.toHaveBeenCalled();
    expect(resWhitespace.summaryZh).toBe('这个技能没有自带说明');
    expect(resWhitespace.enrichmentFailed).toBe(false);
  });

  it('绿⑨: 未生成出中文的表外技能同步返回 enrichmentFailed === true 且保留英文原文 (不许拿英文冒充中文)', () => {
    const untranslated = generateSkillEnrichment(
      'some-brand-new-custom-skill',
      'This is an advanced custom tool for compiling special assets.',
    );
    expect(untranslated.enrichmentFailed).toBe(true);
    expect(untranslated.summaryZh).toContain('This is an advanced custom tool');
    expect(untranslated.category).toBe('工具环境');
  });

  it('inferSkillCategory properly classifies domain keywords into the 8 fixed categories', () => {
    expect(inferSkillCategory('plan-something', 'create a plan')).toBe('规划决策');
    expect(inferSkillCategory('code-builder', 'implement code changes')).toBe('开发实现');
    expect(inferSkillCategory('app-qa', 'run QA and tests')).toBe('质量保障');
    expect(inferSkillCategory('page-mockup', 'design UI interface and css')).toBe('界面设计');
    expect(inferSkillCategory('article-maker', 'write documentation and article')).toBe('文档写作');
    expect(inferSkillCategory('ship-it', 'deploy to production')).toBe('发布部署');
    expect(inferSkillCategory('command-guard', 'safety guardrails for dangerous operations')).toBe('安全管控');
    expect(inferSkillCategory('my-random-tool', 'random unknown helper')).toBe('工具环境');
  });
});

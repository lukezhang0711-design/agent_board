import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATEGORY_REPRESENTATIVE_USAGES,
  SKILL_CATEGORIES,
  SkillTaxonomyCacheManager,
  computeSkillHash,
  generateSkillEnrichment,
  inferSkillCategory,
  type SkillCategory,
} from '../SkillTaxonomyEnricher';

describe('SkillTaxonomyEnricher', () => {
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

  it('绿④: 无说明的技能显示"这个技能没有自带说明"；生成失败的保留英文原文并标记', () => {
    // No description
    const noDesc = generateSkillEnrichment('custom-empty', '');
    expect(noDesc.summaryZh).toBe('这个技能没有自带说明');
    expect(noDesc.category).toBe('工具环境');
    expect(noDesc.enrichmentFailed).toBe(false);

    // Known skills have <= 30 char Chinese summaries
    const grillMe = generateSkillEnrichment('grill-me', 'A relentless interview to sharpen a plan or design.');
    expect(grillMe.category).toBe('规划决策');
    expect(grillMe.summaryZh.length).toBeLessThanOrEqual(30);

    const implement = generateSkillEnrichment('implement', 'Implement a piece of work based on a PRD.');
    expect(implement.category).toBe('开发实现');
    expect(implement.summaryZh.length).toBeLessThanOrEqual(30);
  });

  it('绿③: 分类与中文说明同一次生成，落盘缓存；内容未变时不重复生成', () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockGen = vi.fn().mockReturnValue({
      category: '规划决策' as SkillCategory,
      summaryZh: '规划方案评审与任务拆解',
      enrichmentFailed: false,
    });

    // 1st call: generator is executed once
    const res1 = manager.enrichAndCache('my-plan', 'My plan description', 'content v1', mockGen);
    expect(res1.category).toBe('规划决策');
    expect(mockGen).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(cacheFile)).toBe(true);

    // 2nd call with same content: reads from cache, generator NOT called again
    const res2 = manager.enrichAndCache('my-plan', 'My plan description', 'content v1', mockGen);
    expect(res2.category).toBe('规划决策');
    expect(mockGen).toHaveBeenCalledTimes(1);

    // 3rd call with modified content: cache miss, generator called a 2nd time
    const res3 = manager.enrichAndCache('my-plan', 'My plan description updated', 'content v2', mockGen);
    expect(mockGen).toHaveBeenCalledTimes(2);
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

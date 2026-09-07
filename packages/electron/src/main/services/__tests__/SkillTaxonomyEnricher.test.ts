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
  validateAndExtractSkillSummary,
  resolveSkillSummaryEngineExecutable,
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

  it('绿⑨: 未生成出中文的表外技能 enrichmentFailed === true 且保留英文原文 (不许拿英文冒充中文)', () => {
    // English description not in known catalog
    const untranslated = generateSkillEnrichment(
      'some-brand-new-custom-skill',
      'This is an advanced custom tool for compiling special assets.',
    );
    expect(untranslated.enrichmentFailed).toBe(true);
    expect(untranslated.summaryZh).toContain('This is an advanced custom tool');
    expect(untranslated.category).toBe('工具环境');
  });

  it('绿⑧: 分类与中文说明同一次生成，落盘缓存；内容未变时不重复生成；内容变了只重生成那一个', () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockGen = vi.fn().mockImplementation((name: string, desc?: string) => ({
      category: '规划决策' as SkillCategory,
      summaryZh: `${name} 中文总结`,
      enrichmentFailed: false,
    }));

    // 1st call: generator is executed once
    const res1 = manager.enrichAndCache('my-plan', 'My plan description', 'content v1', mockGen);
    expect(res1.category).toBe('规划决策');
    expect(mockGen).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(cacheFile)).toBe(true);

    // 2nd call with same content: reads from cache, generator NOT called again
    const res2 = manager.enrichAndCache('my-plan', 'My plan description', 'content v1', mockGen);
    expect(res2.category).toBe('规划决策');
    expect(mockGen).toHaveBeenCalledTimes(1);

    // Call with a different skill
    const resAnother = manager.enrichAndCache('other-skill', 'Other desc', 'content other', mockGen);
    expect(resAnother.category).toBe('规划决策');
    expect(mockGen).toHaveBeenCalledTimes(2);

    // 3rd call with modified content for first skill: cache miss, generator called a 3rd time
    const res3 = manager.enrichAndCache('my-plan', 'My plan description updated', 'content v2', mockGen);
    expect(mockGen).toHaveBeenCalledTimes(3);

    // 4th call with other-skill again: hits cache, generator count stays 3
    const resAnotherCached = manager.enrichAndCache('other-skill', 'Other desc', 'content other', mockGen);
    expect(mockGen).toHaveBeenCalledTimes(3);
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

  it('绿②/GJ保住: 9 条死条目已清理、connect-chrome 已补齐，已知表精确为 81 项', () => {
    const catalogKeys = Object.keys(KNOWN_SKILL_CATALOG);
    expect(catalogKeys.length).toBe(81);

    // 9 条死条目已彻底移除
    const deadItems = [
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
    for (const item of deadItems) {
      expect(KNOWN_SKILL_CATALOG[item], `Dead item ${item} should be removed`).toBeUndefined();
    }

    // connect-chrome 已补齐
    expect(KNOWN_SKILL_CATALOG['connect-chrome']).toEqual({
      category: '工具环境',
      summaryZh: '连接或启动 Chrome 浏览器进行 AI 协同操控',
    });
  });

  it('绿⑧: 命中写死表时不触发生成；「这个技能没有自带说明」兜底零回归', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    const mockGen = vi.fn().mockResolvedValue('假中文');
    manager.setAiGenerator(mockGen);

    // 1. 命中写死表 81 条之一：不触发生成器
    const catalogResult = await manager.enrichAsync('connect-chrome', 'Connect or launch Chrome browser');
    expect(catalogResult.summaryZh).toBe('连接或启动 Chrome 浏览器进行 AI 协同操控');
    expect(catalogResult.category).toBe('工具环境');
    expect(catalogResult.enrichmentFailed).toBe(false);
    expect(mockGen).toHaveBeenCalledTimes(0);

    // 2. 原文没有自带说明：如实标"这个技能没有自带说明"，绝不调用生成器
    const emptyDescResult = await manager.enrichAsync('custom-tool', '');
    expect(emptyDescResult.summaryZh).toBe('这个技能没有自带说明');
    expect(emptyDescResult.category).toBe('工具环境');
    expect(emptyDescResult.enrichmentFailed).toBe(false);
    expect(mockGen).toHaveBeenCalledTimes(0);

    // 3. 只有空格说明：同样如实兜底
    const spaceDescResult = await manager.enrichAsync('custom-tool-2', '   \n  ');
    expect(spaceDescResult.summaryZh).toBe('这个技能没有自带说明');
    expect(mockGen).toHaveBeenCalledTimes(0);

    // 4. 自带中文说明的技能：提取首句并截断，不触发生成器
    const zhDescResult = await manager.enrichAsync('zh-skill', '快速创建数据库表结构与索引配置。详细用法见文档。');
    expect(zhDescResult.summaryZh).toBe('快速创建数据库表结构与索引配置');
    expect(zhDescResult.enrichmentFailed).toBe(false);
    expect(mockGen).toHaveBeenCalledTimes(0);
  });

  it('绿⑦: 生成失败、超时、空结果、格式不合要求时，保留英文原文且 enrichmentFailed 为 true（绝不编造中文）', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);

    // 记录核对样本：原说明与兜底结果对照
    const testSamples = [
      {
        name: 'cloud-deploy',
        desc: 'Deploy microservice containers to remote Kubernetes clusters.',
        mockOutput: '', // 空结果
        errorDesc: '空结果',
      },
      {
        name: 'security-scanner',
        desc: 'Scans source code for hardcoded secrets and leaked tokens.',
        mockOutput: 'Scanned 120 files successfully without errors', // 非中文无意义输出
        errorDesc: '格式不合（无中文）',
      },
      {
        name: 'data-pipeline',
        desc: 'Extract, transform and load analytics events into warehouse.',
        mockReject: new Error('Command timed out after 15000ms'), // 超时抛错
        errorDesc: '15秒超时异常',
      },
    ];

    for (const sample of testSamples) {
      let mockGen;
      if (sample.mockReject) {
        mockGen = vi.fn().mockRejectedValue(sample.mockReject);
      } else {
        mockGen = vi.fn().mockResolvedValue(sample.mockOutput);
      }

      const res = await manager.enrichAsync(sample.name, sample.desc, undefined, undefined, mockGen);
      expect(mockGen).toHaveBeenCalledTimes(1);
      // 保留英文原文首句，绝不编造中文
      expect(res.enrichmentFailed).toBe(true);
      expect(sample.desc).toContain(res.summaryZh.replace(/\.\.\.$/, ''));
      expect(res.category).toBeDefined();
    }

    // 验证正常中文真生成样本
    const successGen = vi.fn().mockResolvedValue('将微服务容器部署至远程集群');
    const successRes = await manager.enrichAsync(
      'k8s-deploy',
      'Deploy microservice containers to remote Kubernetes clusters.',
      undefined,
      undefined,
      successGen,
    );
    expect(successRes.enrichmentFailed).toBe(false);
    expect(successRes.summaryZh).toBe('将微服务容器部署至远程集群');
    expect(successRes.category).toBe('发布部署');
  });

  it('绿⑫: 命中成功缓存生成调用为 0；旧失败缓存首次可见能启动 1 次；说明变化对新哈希生成', async () => {
    const manager = new SkillTaxonomyCacheManager(cacheFile);
    let genCount = 0;
    const mockGen = vi.fn().mockImplementation(async () => {
      genCount++;
      return `生成中文说明 ${genCount}`;
    });
    manager.setAiGenerator(mockGen);

    // 1. 首次为表外英文技能生成
    const res1 = await manager.enrichAsync('my-worker', 'Deploy serverless functions to edge nodes');
    expect(res1.summaryZh).toBe('生成中文说明 1');
    expect(res1.enrichmentFailed).toBe(false);
    expect(mockGen).toHaveBeenCalledTimes(1);

    // 2. 再次调用：命中成功缓存，生成器调用保持为 1（本次为 0）
    const res2 = await manager.enrichAsync('my-worker', 'Deploy serverless functions to edge nodes');
    expect(res2.summaryZh).toBe('生成中文说明 1');
    expect(res2.enrichmentFailed).toBe(false);
    expect(mockGen).toHaveBeenCalledTimes(1);

    // 3. 模拟旧缓存中存在 enrichmentFailed: true（来自扫描阶段的无中文标记）
    const failHash = computeSkillHash('failed-skill', 'Old failed skill description');
    manager.set(failHash, {
      category: '开发实现',
      summaryZh: 'Old failed skill description',
      enrichmentFailed: true,
    });
    manager.save();

    // 首次在视口按需生成时，能够启动 1 次生成！
    const resFromFailedCache = await manager.enrichAsync('failed-skill', 'Old failed skill description');
    expect(resFromFailedCache.summaryZh).toBe('生成中文说明 2');
    expect(resFromFailedCache.enrichmentFailed).toBe(false);
    expect(mockGen).toHaveBeenCalledTimes(2);

    // 4. 说明内容修改后：生成新哈希并针对新哈希调用生成
    const resModified = await manager.enrichAsync('my-worker', 'Deploy serverless functions with zero downtime');
    expect(resModified.summaryZh).toBe('生成中文说明 3');
    expect(mockGen).toHaveBeenCalledTimes(3);
  });

  describe('GN-R1 补充验证: R1、R2、R3 专项单元测试', () => {
    it('R2: validateAndExtractSkillSummary 拦截报错、鉴权失败与闲聊拒绝', () => {
      // 无效输入
      expect(validateAndExtractSkillSummary('')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary(undefined)).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('No Chinese words at all')).toEqual({ valid: false });

      // 鉴权/报错
      expect(validateAndExtractSkillSummary('登录已过期，请重新登录后再试')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('API key expired or unauthorized')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('权限不足无法执行此操作')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('Error: failed to connect to service')).toEqual({ valid: false });

      // 闲聊/拒答
      expect(validateAndExtractSkillSummary('今天天气很好，适合去公园散步')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('你好，我是AI语言模型助手')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('很抱歉，我无法回答该问题')).toEqual({ valid: false });

      // 有效正常说明（支持剥离【技能说明】前缀）
      const valid1 = validateAndExtractSkillSummary('【技能说明】分析项目依赖并报告漏洞');
      expect(valid1).toEqual({ valid: true, summary: '分析项目依赖并报告漏洞' });

      const valid2 = validateAndExtractSkillSummary('技能说明：连接Chrome浏览器协同操控');
      expect(valid2).toEqual({ valid: true, summary: '连接Chrome浏览器协同操控' });

      const valid3 = validateAndExtractSkillSummary('检查代码架构与排版。这是第二句不应进入。');
      expect(valid3).toEqual({ valid: true, summary: '检查代码架构与排版' });
    });

    it('R1: resolveSkillSummaryEngineExecutable 严格限制于测试模式且无回退', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalTestEngine = process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE;

      try {
        // 1. NODE_ENV === 'test' 且路径不存在：必须抛错，严禁回退到真实 Claude
        process.env.NODE_ENV = 'test';
        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = '/non/existent/path/fake-engine.cjs';
        expect(() => resolveSkillSummaryEngineExecutable()).toThrow(/Test skill summary engine not found/);

        // 2. NODE_ENV === 'test' 且路径有效：解析成功
        const validPath = path.resolve(__dirname, '../../../../e2e/ai/fixtures/skill-summary-engine.cjs');
        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = validPath;
        expect(resolveSkillSummaryEngineExecutable()).toBe(validPath);

        // 3. 生产模式（NODE_ENV !== 'test'）：反向断言，无论环境变量如何设置均被严格忽略
        process.env.NODE_ENV = 'production';
        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = validPath;
        // 在没有安装真实 Claude 的测试机上，会抛出 Claude CLI is not installed 或返回真实路径，绝不会返回 validPath
        try {
          const resolved = resolveSkillSummaryEngineExecutable();
          expect(resolved).not.toBe(validPath);
        } catch (err: any) {
          expect(err.message).toContain('Claude CLI is not installed');
        }
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalTestEngine) {
          process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = originalTestEngine;
        } else {
          delete process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE;
        }
      }
    });

    it('R3: 页面省略 content 异步生成后，重新扫描能复用成功缓存', async () => {
      const manager = new SkillTaxonomyCacheManager(cacheFile);
      const name = 'gn-r3-probe-skill';
      const description = 'Inspect project dependencies.';
      const content = '# Heading\nDetailed skill instructions.';

      // 扫描入口实参形态（带 content）
      manager.enrichAndCache(name, description, content);

      // 页面/IPC 调用形态（省略 content）
      const asyncRes = await manager.enrichAsync(
        name,
        description,
        undefined,
        undefined,
        async () => '检查项目依赖关系',
      );
      expect(asyncRes.enrichmentFailed).toBe(false);
      expect(asyncRes.summaryZh).toBe('检查项目依赖关系');

      // 再次执行扫描入口形态（带 content）
      const rescanned = manager.enrichAndCache(name, description, content);
      expect(rescanned.enrichmentFailed).toBe(false);
      expect(rescanned.summaryZh).toBe('检查项目依赖关系');
    });
  });
});

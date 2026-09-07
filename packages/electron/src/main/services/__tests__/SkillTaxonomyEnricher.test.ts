import fs from 'fs';
import { createHash } from 'node:crypto';
import { computeSkillContentKey } from '../../../renderer/utils/dispatchSkillLibrary';
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
  parseEngineSuccessOutput,
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


  it('GN-R4: 默认缓存路径在首次访问时确定，显式隔离缓存路径仍优先', () => {
    const home = vi.spyOn(os, 'homedir').mockReturnValue(path.join(tmpDir!, 'before-bootstrap'));
    try {
      const manager = new SkillTaxonomyCacheManager();
      const explicit = new SkillTaxonomyCacheManager(cacheFile);
      home.mockReturnValue(path.join(tmpDir!, 'after-bootstrap'));
      expect(manager.getCachePath()).toBe(path.join(tmpDir!, 'after-bootstrap', '.nimbalyst', 'skill-taxonomy-cache.json'));
      expect(explicit.getCachePath()).toBe(cacheFile);
    } finally {
      home.mockRestore();
    }
  });

  const success = { type: 'result', subtype: 'success', is_error: false, result: '检查账户余额与错误记录' };
  it.each<[string, unknown, number, boolean]>([
    ['missing', { type: 'result', subtype: 'success', result: '检查项目依赖' }, 0, true],
    ...[null, 'true', 'false', 1, 0, true].map<[string, unknown, number, boolean]>(value => [
      `is_error-${JSON.stringify(value)}`, { ...success, is_error: value }, 0, true,
    ]),
    ['boolean-false', success, 0, false],
    ['bad-json', '{broken json', 0, true],
    ['plain-text', '账户余额不足', 0, true],
    ['wrong-type', { ...success, type: 'assistant' }, 0, true],
    ['error-branch-false', { ...success, subtype: 'error_during_execution' }, 0, true],
    ['error-branch-true', { ...success, subtype: 'error_during_execution', is_error: true }, 0, true],
    ['empty-result', { ...success, result: ' ' }, 0, true],
    ['non-string-result', { ...success, result: 1 }, 0, true],
    ['non-chinese', { ...success, result: 'Inspect modules' }, 0, true],
    ['first-sentence', { ...success, result: '检查项目依赖。随后说明不入缓存。' }, 0, false],
    ['error-exit-false', success, 1, true],
    ['error-exit-missing', { type: 'result', subtype: 'success', result: '检查项目依赖' }, 1, true],
  ])('GN-R4: 真实进程协议矩阵 %s，stdout/参数/次数/最终缓存均可追溯', async (label, payload, exitCode, failed) => {
    const script = path.join(tmpDir!, 'engine.cjs');
    const calls = path.join(tmpDir!, 'calls.jsonl');
    const stdout = typeof payload === 'string' ? payload : JSON.stringify(payload);
    fs.writeFileSync(script, `#!/usr/bin/env node
const fs = require('fs');
const stdout = ${JSON.stringify(stdout)};
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({pid:process.pid,args:process.argv.slice(2),stdout,exitCode:${exitCode},hasApiKey:'ANTHROPIC_API_KEY' in process.env})+'\\n');
process.stdout.write(stdout);
process.exitCode = ${exitCode};
`);
    fs.chmodSync(script, 0o755);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NIMBALYST_TEST_SKILL_SUMMARY_ENGINE', script);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-sentinel-must-be-removed');
    try {
      const manager = new SkillTaxonomyCacheManager(cacheFile);
      const result = await manager.enrichAsync('gn-r4-protocol', 'Inspect modules.', '# Body');
      const starts = fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const evidence = { label, stdout, starts, startCount: starts.length, result, cache };
      console.log('GN_R4_PROTOCOL', JSON.stringify(evidence));
      if (process.env.NIMBALYST_GN_EVIDENCE_DIR) {
        fs.writeFileSync(path.join(process.env.NIMBALYST_GN_EVIDENCE_DIR, `protocol-${label}.json`), JSON.stringify(evidence, null, 2));
      }
      expect(starts).toHaveLength(1);
      expect(starts[0].hasApiKey).toBe(false);
      const args = starts[0].args as string[];
      expect(args.slice(0, 7)).toEqual(['--tools', '', '--safe-mode', '--disable-slash-commands', '--strict-mcp-config', '--output-format', 'json']);
      expect(result.enrichmentFailed).toBe(failed);
      expect(Object.values(cache.entries).filter((entry: any) => entry.enrichmentFailed === false)).toHaveLength(failed ? 0 : 1);
      expect(new SkillTaxonomyCacheManager(cacheFile).get(computeSkillHash('gn-r4-protocol', 'Inspect modules.', '# Body'))).toMatchObject(result);
      if (failed) expect(result.summaryZh).toBe('Inspect modules');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('GN-R4: 前后台数组身份一致，任意分隔符都是原文，旧冒号缓存不回退', async () => {
    for (const separator of [':', ':::', '\n', '\0', '\\"']) {
      const a = ['skill', `Inspect${separator}notes`, '# body'] as const;
      const b = ['skill', 'Inspect', `notes${separator}# body`] as const;
      expect(computeSkillContentKey(...a)).not.toBe(computeSkillContentKey(...b));
      expect(computeSkillHash(...a)).not.toBe(computeSkillHash(...b));
      for (const [name, description, content] of [a, b]) {
        expect(computeSkillHash(name, description, content)).toBe(createHash('sha256').update(computeSkillContentKey(name, description, content)).digest('hex'));
      }
    }
    expect(computeSkillContentKey(' skill ', undefined, ' \n')).toBe(computeSkillContentKey('skill', '', ''));
    expect(computeSkillHash(' skill ', undefined, ' \n')).toBe(computeSkillHash('skill', '', ''));
    const name = 'chief-content-identity';
    const versions = [
      ['Inspect dependencies:notes', '# body'],
      ['Inspect dependencies', 'notes:# body'],
      ['Inspect dependencies changed', 'notes:# body'], // 只改说明
      ['Inspect dependencies', 'notes:# body changed'], // 只改正文
    ];
    const oldHash = createHash('sha256').update(`${name}:${versions[0].join(':')}`).digest('hex');
    const oldEntry = { category: '工具环境', summaryZh: '错误旧编号摘要', enrichmentFailed: false, hash: oldHash };
    fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, entries: { [oldHash]: oldEntry } }));
    const calls = path.join(tmpDir!, 'identity-calls.jsonl');
    const script = path.join(tmpDir!, 'identity-engine.cjs');
    fs.writeFileSync(script, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const result = args[args.indexOf('-p')+1].includes('dependencies:notes') ? '检查旧内容' : '检查新内容';
const stdout = JSON.stringify({type:'result',subtype:'success',is_error:false,result});
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({pid:process.pid,args,stdout})+'\\n');
process.stdout.write(stdout);
`);
    fs.chmodSync(script, 0o755);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NIMBALYST_TEST_SKILL_SUMMARY_ENGINE', script);
    const steps: unknown[] = [];
    try {
      for (const [index, count] of [[0, 1], [1, 2], [0, 2], [1, 2], [1, 2], [2, 3], [3, 4]]) {
        const [description, content] = versions[index];
        const result = await new SkillTaxonomyCacheManager(cacheFile).enrichAsync(name, description, content);
        const starts = fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        steps.push({ name, description, content, hash: computeSkillHash(name, description, content), result, starts: starts.length });
        expect(result.summaryZh).toBe(index === 0 ? '检查旧内容' : '检查新内容');
        expect(result.enrichmentFailed).toBe(false);
        expect(starts).toHaveLength(count);
      }
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      expect(cache.entries[oldHash]).toEqual(oldEntry); // 自然忽略，保留真实旧数据
      const evidence = { steps, starts: fs.readFileSync(calls, 'utf8'), cache };
      console.log('GN_R4_CACHE_IDENTITY', JSON.stringify(evidence));
      if (process.env.NIMBALYST_GN_EVIDENCE_DIR) {
        fs.writeFileSync(path.join(process.env.NIMBALYST_GN_EVIDENCE_DIR, 'cache-identity.json'), JSON.stringify(evidence, null, 2));
      }
    } finally {
      vi.unstubAllEnvs();
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

  describe('GN-R3 专项单元测试: 输出判定、测试隔离与内容身份', () => {
    it('GN-R3: parseEngineSuccessOutput 严格校验 SDKResultSuccess 结构', () => {
      // 1. 明确成功分支：放行
      const validJson = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '排查服务器连接超时',
      });
      expect(parseEngineSuccessOutput(validJson)).toBe('排查服务器连接超时');

      // 2. 错误/异常结果分支：拦截
      expect(() => parseEngineSuccessOutput(JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Simulated engine failure'],
      }))).toThrow(/subtype/);

      // 3. is_error 为 true：拦截
      expect(() => parseEngineSuccessOutput(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: '排查服务器连接超时',
      }))).toThrow(/is_error/);

      // 4. 未约定的错误对象（如 {"message":"账户余额不足"}）：拦截
      expect(() => parseEngineSuccessOutput('{"message":"账户余额不足"}')).toThrow(/type/);

      // 5. 原始非 JSON 文本（如 "账户余额不足" 或 "周末适合看一场电影"）：拦截
      expect(() => parseEngineSuccessOutput('账户余额不足')).toThrow(/valid JSON/);
      expect(() => parseEngineSuccessOutput('周末适合看一场电影')).toThrow(/valid JSON/);
      expect(() => parseEngineSuccessOutput('')).toThrow(/empty/);
      expect(() => parseEngineSuccessOutput(undefined)).toThrow(/empty/);

      // 6. 字段类型错误或空 result：拦截
      expect(() => parseEngineSuccessOutput(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '',
      }))).toThrow(/empty/);

      expect(() => parseEngineSuccessOutput(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 12345,
      }))).toThrow(/string/);
    });

    it('GN-R3: validateAndExtractSkillSummary 放行合法业务主题，仅作中文格式与首句提取校验', () => {
      // 无效输入
      expect(validateAndExtractSkillSummary('')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary(undefined)).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('No Chinese words at all')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('中')).toEqual({ valid: false });
      expect(validateAndExtractSkillSummary('这是一个超过三十个汉字长度的超级超级超级超级超级超级超级长的技能中文描述说明语句')).toEqual({ valid: false });

      // 合法业务主题（绝无业务词黑名单，排障/食谱/React错误边界/天气/认证等均放行）
      expect(validateAndExtractSkillSummary('排查服务器连接超时')).toEqual({ valid: true, summary: '排查服务器连接超时' });
      expect(validateAndExtractSkillSummary('生成每周食谱与购物清单')).toEqual({ valid: true, summary: '生成每周食谱与购物清单' });
      expect(validateAndExtractSkillSummary('分析 React ErrorBoundary 故障')).toEqual({ valid: true, summary: '分析 React ErrorBoundary 故障' });
      expect(validateAndExtractSkillSummary('查询城市天气预报')).toEqual({ valid: true, summary: '查询城市天气预报' });
      expect(validateAndExtractSkillSummary('检查 OAuth 认证配置')).toEqual({ valid: true, summary: '检查 OAuth 认证配置' });

      // 支持剥离【技能说明】前缀与提取首句
      const valid1 = validateAndExtractSkillSummary('【技能说明】分析项目依赖并报告漏洞');
      expect(valid1).toEqual({ valid: true, summary: '分析项目依赖并报告漏洞' });

      const valid2 = validateAndExtractSkillSummary('技能说明：连接Chrome浏览器协同操控');
      expect(valid2).toEqual({ valid: true, summary: '连接Chrome浏览器协同操控' });

      const valid3 = validateAndExtractSkillSummary('检查代码架构与排版。这是第二句不应进入。');
      expect(valid3).toEqual({ valid: true, summary: '检查代码架构与排版' });
    });

    it('GN-R2: resolveSkillSummaryEngineExecutable 四种互斥分支与严苛测试隔离', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalTestEngine = process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE;
      const validPath = path.resolve(__dirname, '../../../../e2e/ai/fixtures/skill-summary-engine.cjs');

      try {
        // 1. 测试模式、变量未配置或为空值：直接失败，绝不回退真实程序
        process.env.NODE_ENV = 'test';
        delete process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE;
        expect(() => resolveSkillSummaryEngineExecutable()).toThrow(/Test skill summary engine is not configured/);

        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = '   ';
        expect(() => resolveSkillSummaryEngineExecutable()).toThrow(/Test skill summary engine is not configured/);

        // 2. 测试模式、非绝对路径或文件不存在：直接失败
        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = 'relative/path.cjs';
        expect(() => resolveSkillSummaryEngineExecutable()).toThrow(/must be an absolute path/);

        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = '/non/existent/path/fake-engine.cjs';
        expect(() => resolveSkillSummaryEngineExecutable()).toThrow(/Test skill summary engine not found/);

        // 3. 测试模式、有效绝对路径：返回指定测试程序
        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = validPath;
        expect(resolveSkillSummaryEngineExecutable()).toBe(validPath);

        // 4. 正常运行模式：无论环境变量如何设置均被严格忽略
        process.env.NODE_ENV = 'production';
        process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = validPath;
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

    it('GN-R2: 统一定义 name+description+content 内容身份指纹与去重', async () => {
      const manager = new SkillTaxonomyCacheManager(cacheFile);
      const name = 'same-name-skill';
      const descA = 'Inspect project dependencies.';
      const contentA = '# Project A\nDependency tree.';
      const descB = 'Deploy a new service.';
      const contentB = '# Project B\nDeployment scripts.';

      const hashA = computeSkillHash(name, descA, contentA);
      const hashB = computeSkillHash(name, descB, contentB);
      expect(hashA).not.toBe(hashB);

      // 为 Project A 生成并写入缓存
      const resA = await manager.enrichAsync(name, descA, contentA, undefined, async () => '分析项目依赖');
      expect(resA.summaryZh).toBe('分析项目依赖');
      expect(resA.enrichmentFailed).toBe(false);

      // 同名异内容 Project B 能够生成新说明，不被 A 污染
      const resB = await manager.enrichAsync(name, descB, contentB, undefined, async () => '发布新服务');
      expect(resB.summaryZh).toBe('发布新服务');
      expect(resB.enrichmentFailed).toBe(false);

      // 重新访问 Project A 内容，命中 A 的缓存
      const resACached = manager.enrichAndCache(name, descA, contentA);
      expect(resACached.summaryZh).toBe('分析项目依赖');

      // 重新访问 Project B 内容，命中 B 的缓存
      const resBCached = manager.enrichAndCache(name, descB, contentB);
      expect(resBCached.summaryZh).toBe('发布新服务');
    });

    it('GN-R3: 真实假进程调用验证，无成功标记/错误退出/坏JSON/空摘要均拦截且假程序只启动一次', async () => {
      const execDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-r3-process-test-'));
      const scriptPath = path.join(execDir, 'engine.cjs');
      const counterFile = path.join(execDir, 'counter.txt');
      const argsLogFile = path.join(execDir, 'args.json');

      const createFakeEngine = (stdoutOutput: string, exitCode = 0) => {
        const code = `#!/usr/bin/env node
const fs = require('fs');
let c = 0;
try { c = parseInt(fs.readFileSync(${JSON.stringify(counterFile)}, 'utf8'), 10) || 0; } catch {}
fs.writeFileSync(${JSON.stringify(counterFile)}, String(c + 1), 'utf8');
fs.writeFileSync(${JSON.stringify(argsLogFile)}, JSON.stringify(process.argv.slice(2)), 'utf8');
process.stdout.write(${JSON.stringify(stdoutOutput)});
process.exitCode = ${exitCode};
`;
        fs.writeFileSync(scriptPath, code, 'utf8');
        fs.chmodSync(scriptPath, 0o755);
      };

      const originalNodeEnv = process.env.NODE_ENV;
      const originalEngine = process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE;
      process.env.NODE_ENV = 'test';
      process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = scriptPath;

      try {
        // 1. 合法业务主题成功返回
        createFakeEngine(JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '排查服务器连接超时',
        }), 0);
        fs.writeFileSync(counterFile, '0', 'utf8');
        const manager1 = new SkillTaxonomyCacheManager(path.join(execDir, 'c1.json'));
        const res1 = await manager1.enrichAsync('skill-timeout', 'Diagnose server connection timeouts.');
        expect(res1.enrichmentFailed).toBe(false);
        expect(res1.summaryZh).toBe('排查服务器连接超时');
        expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');
        const capturedArgs = JSON.parse(fs.readFileSync(argsLogFile, 'utf8'));
        expect(capturedArgs).toContain('--output-format');
        expect(capturedArgs).toContain('json');
        expect(capturedArgs).toContain('--tools');

        // 2. 错误退出（exitCode=1）但 stdout 有合法中文：坚决拦截
        createFakeEngine(JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '检查项目依赖',
        }), 1);
        fs.writeFileSync(counterFile, '0', 'utf8');
        const manager2 = new SkillTaxonomyCacheManager(path.join(execDir, 'c2.json'));
        const res2 = await manager2.enrichAsync('skill-exit-1', 'Inspect project dependencies.');
        expect(res2.enrichmentFailed).toBe(true);
        expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');

        // 3. 错误分支有中文（subtype: error_during_execution）：坚决拦截
        createFakeEngine(JSON.stringify({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['服务认证已失效，请重新登录'],
        }), 0);
        fs.writeFileSync(counterFile, '0', 'utf8');
        const manager3 = new SkillTaxonomyCacheManager(path.join(execDir, 'c3.json'));
        const res3 = await manager3.enrichAsync('skill-error-subtype', 'Inspect project dependencies.');
        expect(res3.enrichmentFailed).toBe(true);
        expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');

        // 4. 原始非 JSON 文本（无成功标记）：坚决拦截
        createFakeEngine('账户余额不足', 0);
        fs.writeFileSync(counterFile, '0', 'utf8');
        const manager4 = new SkillTaxonomyCacheManager(path.join(execDir, 'c4.json'));
        const res4 = await manager4.enrichAsync('skill-raw-text', 'Inspect project dependencies.');
        expect(res4.enrichmentFailed).toBe(true);
        expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');

        // 5. 坏 JSON：坚决拦截
        createFakeEngine('{"type":"result", broken json', 0);
        fs.writeFileSync(counterFile, '0', 'utf8');
        const manager5 = new SkillTaxonomyCacheManager(path.join(execDir, 'c5.json'));
        const res5 = await manager5.enrichAsync('skill-bad-json', 'Inspect project dependencies.');
        expect(res5.enrichmentFailed).toBe(true);
        expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');

        // 6. 空摘要：坚决拦截
        createFakeEngine(JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: '   ',
        }), 0);
        fs.writeFileSync(counterFile, '0', 'utf8');
        const manager6 = new SkillTaxonomyCacheManager(path.join(execDir, 'c6.json'));
        const res6 = await manager6.enrichAsync('skill-empty-result', 'Inspect project dependencies.');
        expect(res6.enrichmentFailed).toBe(true);
        expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');

        // 7. 摘要不是字符串：坚决拦截
        createFakeEngine(JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 12345,
        }), 0);
        fs.writeFileSync(counterFile, '0', 'utf8');
        const manager7 = new SkillTaxonomyCacheManager(path.join(execDir, 'c7.json'));
        const res7 = await manager7.enrichAsync('skill-non-string', 'Inspect project dependencies.');
        expect(res7.enrichmentFailed).toBe(true);
        expect(fs.readFileSync(counterFile, 'utf8')).toBe('1');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalEngine) {
          process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE = originalEngine;
        } else {
          delete process.env.NIMBALYST_TEST_SKILL_SUMMARY_ENGINE;
        }
        fs.rmSync(execDir, { recursive: true, force: true });
      }
    });
  });
});

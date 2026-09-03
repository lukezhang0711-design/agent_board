import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
  };
});

import { DispatchSkillLibraryService } from '../DispatchSkillLibraryService';
import {
  skillTaxonomyCacheManager,
  KNOWN_SKILL_CATALOG,
} from '../SkillTaxonomyEnricher';

describe('施工单 GJ2 — 真实生产扫描链路生成与并发/反向断言验收', () => {
  let tmpRoot: string | null = null;
  let cacheFile: string | null = null;
  let service: DispatchSkillLibraryService;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skills-gj2-'));
    cacheFile = path.join(tmpRoot, 'cache.json');
    (skillTaxonomyCacheManager as any).cachePath = cacheFile;
    (skillTaxonomyCacheManager as any).memoryCache.clear();
    (skillTaxonomyCacheManager as any).loaded = false;
    (skillTaxonomyCacheManager as any).dirty = false;
    (skillTaxonomyCacheManager as any).inFlightHashes.clear();
    (skillTaxonomyCacheManager as any).updateListeners = [];
    service = new DispatchSkillLibraryService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    skillTaxonomyCacheManager.setAiGenerator(undefined as any);
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  function makeTempHome() {
    if (!tmpRoot) throw new Error('tmpRoot not initialized');
    const home = path.join(tmpRoot, 'home');
    const workspace = path.join(tmpRoot, 'workspace');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: '' });
    return { home, workspace };
  }

  function writeSkill(filePath: string, name: string, description: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `---\nname: ${name}\ndescription: ${description}\n---\n${description}\n`,
      'utf8',
    );
  }

  it('绿①: 生产路径确实会调用生成——走一遍真实扫描入口后，注入的生成器被调用', async () => {
    const { home, workspace } = makeTempHome();
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'custom-aws-deployer', 'SKILL.md'),
      'custom-aws-deployer',
      'Deploys container applications directly to AWS ECS cluster with rollbacks',
    );

    let generatorCalled = false;
    let receivedPrompt = '';
    skillTaxonomyCacheManager.setAiGenerator(async (prompt) => {
      generatorCalled = true;
      receivedPrompt = prompt;
      return '帮用户一键将容器部署到 AWS ECS 集群';
    });

    // Call REAL scan entry point
    const res = service.listSkillsDetailed(workspace);

    // Wait for background async task to resolve
    await vi.waitFor(() => {
      expect(generatorCalled).toBe(true);
    }, { timeout: 2000 });

    expect(receivedPrompt).toContain('AWS ECS');
  });

  it('绿②: 首屏不阻塞——断言扫描入口在生成器尚未 resolve 时就已返回结果，且返回的是原文', async () => {
    const { home, workspace } = makeTempHome();
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'slow-generator-skill', 'SKILL.md'),
      'slow-generator-skill',
      'Performs long-running deep analysis on Kubernetes pod metrics',
    );

    let resolveGenerator!: (val: string) => void;
    const generatorPromise = new Promise<string>((resolve) => {
      resolveGenerator = resolve;
    });

    skillTaxonomyCacheManager.setAiGenerator(async () => {
      return await generatorPromise;
    });

    const startTime = Date.now();
    // Synchronous scan call
    const result = service.listSkillsDetailed(workspace);
    const elapsed = Date.now() - startTime;

    // Must return immediately (< 50ms)
    expect(elapsed).toBeLessThan(100);

    // Initial returned summary must be original raw text
    const found = result.skills.find((s) => s.name === 'slow-generator-skill');
    expect(found).toBeDefined();
    expect(found?.summaryZh).toContain('Kubernetes pod metrics');
    expect(found?.enrichmentFailed).toBe(true);

    // Now resolve generator
    resolveGenerator('分析 Kubernetes 节点指标');
    await vi.waitFor(() => {
      const cached = skillTaxonomyCacheManager.get(
        (skillTaxonomyCacheManager as any).memoryCache.keys().next().value,
      );
      expect(cached?.enrichmentFailed).toBe(false);
    });
  });

  it('绿③: 生成完成后发出 dispatch-skills:updated 事件', async () => {
    const { home, workspace } = makeTempHome();
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'event-emitter-skill', 'SKILL.md'),
      'event-emitter-skill',
      'Automates database schema migrations safely',
    );

    let updateEventEmitted = false;
    skillTaxonomyCacheManager.onUpdate(() => {
      updateEventEmitted = true;
    });

    skillTaxonomyCacheManager.setAiGenerator(async () => {
      return '自动化安全执行数据库迁移';
    });

    service.listSkillsDetailed(workspace);

    await vi.waitFor(() => {
      expect(updateEventEmitted).toBe(true);
    });
  });

  it('绿④: 并发上限生效——喂 10 个待生成技能，断言同时在跑的不超过 3 个', async () => {
    const { home, workspace } = makeTempHome();

    // Create 10 skills outside the static table
    for (let i = 1; i <= 10; i++) {
      writeSkill(
        path.join(workspace, '.agents', 'skills', `batch-skill-${i}`, 'SKILL.md'),
        `batch-skill-${i}`,
        `Comprehensive automation task number ${i} for enterprise cloud systems`,
      );
    }

    let activeCount = 0;
    let maxActiveCount = 0;
    let completedCount = 0;

    skillTaxonomyCacheManager.setAiGenerator(async (prompt) => {
      activeCount++;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      // simulate realistic async network / CLI latency
      await new Promise((resolve) => setTimeout(resolve, 30));
      activeCount--;
      completedCount++;
      return `辅助用户自动化处理任务第 ${completedCount} 项`;
    });

    service.listSkillsDetailed(workspace);

    await vi.waitFor(() => {
      expect(completedCount).toBe(10);
    }, { timeout: 5000 });

    // Assert concurrency never exceeded 3
    expect(maxActiveCount).toBeLessThanOrEqual(3);
    expect(maxActiveCount).toBeGreaterThan(0);
  });

  it('绿⑤: 同一次扫描中同一技能只生成一次', async () => {
    const { home, workspace } = makeTempHome();
    // Same skill present in workspace
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'dedup-scan-skill', 'SKILL.md'),
      'dedup-scan-skill',
      'Runs security compliance checks against SOC2 requirements',
    );

    let callCount = 0;
    skillTaxonomyCacheManager.setAiGenerator(async () => {
      callCount++;
      return '执行 SOC2 安全合规检查';
    });

    service.listSkillsDetailed(workspace);

    await vi.waitFor(() => {
      expect(callCount).toBe(1);
    });

    // Run scan again immediately
    service.listSkillsDetailed(workspace);
    // Give async event loop tick
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Since it's already cached, generator is not called again
    expect(callCount).toBe(1);
  });

  it('绿⑦: 既有行为零回归——命中写死表不触发生成、无说明兜底、失败保留原文且下次可重试', async () => {
    const { home, workspace } = makeTempHome();

    // 1. Skill in KNOWN_SKILL_CATALOG (e.g. connect-chrome)
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'connect-chrome', 'SKILL.md'),
      'connect-chrome',
      'Connects Chrome browser for AI automation',
    );

    // 2. Empty description skill
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'empty-desc-skill', 'SKILL.md'),
      'empty-desc-skill',
      '',
    );

    // 3. Table-outside skill that will fail generation
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'failing-skill', 'SKILL.md'),
      'failing-skill',
      'Raw english description that should not be fabricated',
    );

    let generatorCallCount = 0;
    skillTaxonomyCacheManager.setAiGenerator(async (prompt) => {
      generatorCallCount++;
      throw new Error('AI engine temporarily offline');
    });

    const scanResult = service.listSkillsDetailed(workspace);

    // connect-chrome gets catalog summary directly without invoking AI
    const chromeSkill = scanResult.skills.find((s) => s.name === 'connect-chrome');
    expect(chromeSkill?.summaryZh).toBe(KNOWN_SKILL_CATALOG['connect-chrome'].summaryZh);
    expect(chromeSkill?.enrichmentFailed).toBeFalsy();

    // empty description gets standard fallback
    const emptySkill = scanResult.skills.find((s) => s.name === 'empty-desc-skill');
    expect(emptySkill?.summaryZh).toBe('这个技能没有自带说明');
    expect(emptySkill?.enrichmentFailed).toBeFalsy();

    // Failing skill triggers generator once, fails, and preserves raw text + enrichmentFailed: true
    await vi.waitFor(() => {
      expect(generatorCallCount).toBe(1);
    });

    const failedSkill = scanResult.skills.find((s) => s.name === 'failing-skill');
    expect(failedSkill?.summaryZh).toContain('Raw english description');
    expect(failedSkill?.enrichmentFailed).toBe(true);

    // Failures can be retried in future runs because enrichmentFailed: true is not treated as permanent success
    const secondScan = service.listSkillsDetailed(workspace);
    await vi.waitFor(() => {
      expect(generatorCallCount).toBe(2);
    });
  });

  it('绿⑧ (反向断言): 任何路径下都不会产出与原文无关的编造假中文', async () => {
    const { home, workspace } = makeTempHome();
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'foreign-custom-tool', 'SKILL.md'),
      'foreign-custom-tool',
      'Specialized low-level hardware debugging interface',
    );

    // Simulate complete generator failure
    skillTaxonomyCacheManager.setAiGenerator(async () => {
      throw new Error('Network timeout');
    });

    service.listSkillsDetailed(workspace);

    await vi.waitFor(() => {
      const keys = Array.from((skillTaxonomyCacheManager as any).memoryCache.keys());
      expect(keys.length).toBeGreaterThan(0);
    });

    const entry = Array.from((skillTaxonomyCacheManager as any).memoryCache.values())[0] as any;
    expect(entry.enrichmentFailed).toBe(true);
    // Asserts no invented Chinese words like "智能分析" or "管理工具"
    expect(entry.summaryZh).not.toMatch(/[\u4e00-\u9fa5]/);
    expect(entry.summaryZh).toContain('Specialized low-level hardware debugging interface');
  });
});

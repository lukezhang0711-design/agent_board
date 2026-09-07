import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => Promise<any> | any>();
  return {
    handlers,
  };
});

vi.mock('../../utils/ipcRegistry', () => ({
  safeHandle: (channel: string, handler: (...args: any[]) => Promise<any> | any) => {
    mocks.handlers.set(channel, handler);
  },
  safeOn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getName: vi.fn(() => 'nimbalyst'),
    getVersion: vi.fn(() => '0.65.4'),
    isPackaged: false,
    on: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(() => []),
  },
  session: {
    defaultSession: {
      setSpellCheckerEnabled: vi.fn(),
    },
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
  },
}));

vi.mock('../../utils/store', () => ({
  getAppSetting: vi.fn(),
  setAppSetting: vi.fn(),
  setPreferredAgentLanguage: vi.fn(),
  getWorkspaceState: vi.fn(),
  updateWorkspaceState: vi.fn(),
  getTheme: vi.fn(),
  getThemeSync: vi.fn(),
  getResolvedThemeSync: vi.fn(),
  isCompletionSoundEnabled: vi.fn(),
  setCompletionSoundEnabled: vi.fn(),
  getCompletionSoundType: vi.fn(),
  setCompletionSoundType: vi.fn(),
  getReleaseChannel: vi.fn(),
  setReleaseChannel: vi.fn(),
  getRecentItems: vi.fn(),
  getDefaultAIModel: vi.fn(),
  setDefaultAIModel: vi.fn(),
  getDefaultEffortLevel: vi.fn(),
  setDefaultEffortLevel: vi.fn(),
  isAnalyticsEnabled: vi.fn(),
  setAnalyticsEnabled: vi.fn(),
  getSessionSyncConfig: vi.fn(),
  setSessionSyncConfig: vi.fn(),
  isExtensionDevToolsEnabled: vi.fn(),
  setExtensionDevToolsEnabled: vi.fn(),
  getAlphaFeatures: vi.fn(),
  setAlphaFeatures: vi.fn(),
  getBetaFeatures: vi.fn(),
  setBetaFeatures: vi.fn(),
  getEnableAllBetaFeatures: vi.fn(),
  setEnableAllBetaFeatures: vi.fn(),
  getDeveloperFeatures: vi.fn(),
  setDeveloperFeatures: vi.fn(),
  isDeveloperFeatureAvailable: vi.fn(),
  isShowTrayIcon: vi.fn(),
  getMultiProjectMode: vi.fn(),
  setMultiProjectMode: vi.fn(),
  getOpenProjectPaths: vi.fn(),
  setOpenProjectPaths: vi.fn(),
  getActiveProjectPath: vi.fn(),
  setActiveProjectPath: vi.fn(),
  getRestorePreviousProjectsOnLaunch: vi.fn(),
  setRestorePreviousProjectsOnLaunch: vi.fn(),
  getOnboardingState: vi.fn(),
  updateOnboardingState: vi.fn(),
  isDeveloperMode: vi.fn(),
  setDeveloperMode: vi.fn(),
  isFeatureWalkthroughCompleted: vi.fn(),
  setFeatureWalkthroughCompleted: vi.fn(),
  isWorktreeOnboardingShown: vi.fn(),
  setWorktreeOnboardingShown: vi.fn(),
  getClaudeCodeSettings: vi.fn(),
  setClaudeCodeProjectCommandsEnabled: vi.fn(),
  setClaudeCodeUserCommandsEnabled: vi.fn(),
  getAgentWorkflowSourceSettings: vi.fn(),
  getAgentWorkflowExportSettings: vi.fn(),
  setAgentWorkflowSourceSettings: vi.fn(),
  setAgentWorkflowExportSettings: vi.fn(),
}));

vi.mock('../../services/CLIManager', () => ({
  getEnhancedPath: vi.fn(() => process.env.PATH),
}));

vi.mock('../../services/DispatchSkillLibraryService', () => ({
  dispatchSkillLibraryService: {
    listSkillsDetailed: vi.fn(() => ({ skills: [], errors: [] })),
  },
}));

vi.mock('../../services/SessionNamingService', () => ({
  SessionNamingService: {
    getInstance: () => ({ setLanguage: vi.fn() }),
  },
}));

vi.mock('../../services/autoUpdater', () => ({
  autoUpdaterService: {
    reconfigureFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    getStatus: vi.fn(),
  },
}));

import {
  registerSettingsHandlers,
  _resetSkillGenerationStateForTest,
  _getActiveGlobalSkillGenerationsForTest,
  _getWindowSkillSessionForTest,
} from '../SettingsHandlers';
import { skillTaxonomyCacheManager } from '../../services/SkillTaxonomyEnricher';

function createMockSender(id: number) {
  const listeners = new Map<string, Function[]>();
  return {
    id,
    isDestroyed: () => false,
    once: (event: string, fn: Function) => {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    destroy: () => {
      const list = listeners.get('destroyed') ?? [];
      for (const fn of list) {
        fn();
      }
    },
  };
}

function getHandler(channel: string): (...args: any[]) => Promise<any> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

describe('SettingsHandlers.skillSummaries (施工单 GN: 按需生成限额与并发门禁)', () => {
  let tmpCacheDir: string;
  let tmpCacheFile: string;

  beforeEach(() => {
    tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-skill-summary-test-'));
    tmpCacheFile = path.join(tmpCacheDir, 'skill-taxonomy-cache.json');
    (skillTaxonomyCacheManager as any).cachePath = tmpCacheFile;
    (skillTaxonomyCacheManager as any).memoryCache.clear();
    (skillTaxonomyCacheManager as any).loaded = false;
    _resetSkillGenerationStateForTest();
    mocks.handlers.clear();
    registerSettingsHandlers();
  });

  afterEach(() => {
    _resetSkillGenerationStateForTest();
    vi.restoreAllMocks();
    if (tmpCacheDir) {
      fs.rmSync(tmpCacheDir, { recursive: true, force: true });
    }
  });

  it('绿⑤: 单次页面会话生成总数不超过 20（50 个未翻译技能夹具）', async () => {
    const generateSummaryHandler = getHandler('dispatch-skills:generate-summary');

    let generatorCalls = 0;
    const mockGenerator = vi.fn().mockImplementation(async (desc: string) => {
      generatorCalls++;
      return `第 ${generatorCalls} 个技能中文总结`;
    });
    skillTaxonomyCacheManager.setAiGenerator(mockGenerator);

    const sender = createMockSender(101);
    const event = { sender };

    // 顺序请求 50 个未翻译的全新英文技能
    const results = [];
    for (let i = 1; i <= 50; i++) {
      const res = await generateSummaryHandler(event, {
        name: `english-skill-${i}`,
        description: `This is unique description for english skill number ${i} to test quota limits.`,
      });
      results.push(res);
    }

    // 前 20 个正常触发了生成调用
    for (let i = 0; i < 20; i++) {
      expect(results[i].success).toBe(true);
      expect(results[i].enrichmentFailed).toBe(false);
      expect(results[i].summaryZh).toBe(`第 ${i + 1} 个技能中文总结`);
    }

    // 第 21 到 50 个全部被限额拦截
    for (let i = 20; i < 50; i++) {
      expect(results[i].success).toBe(false);
      expect(results[i].skipped).toBe(true);
      expect(results[i].reason).toBe('quota_exceeded');
      expect(results[i].enrichmentFailed).toBe(true);
    }

    // 实际启动的生成调用严格锁定在 20 次，绝不多调一次
    expect(generatorCalls).toBe(20);
    expect(mockGenerator).toHaveBeenCalledTimes(20);

    const sessionState = _getWindowSkillSessionForTest(101);
    expect(sessionState?.callCount).toBe(20);
  });

  it('绿⑪: 反复滚动、搜索、切页与离开重进累计不超过 20；同一内容失败不重试；窗口关闭重置会话', async () => {
    const generateSummaryHandler = getHandler('dispatch-skills:generate-summary');
    const setVisibilityHandler = getHandler('dispatch-skills:set-page-visibility');

    let callCount = 0;
    const mockGenerator = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Simulated engine failure');
      }
      return `成功生成 ${callCount}`;
    });
    skillTaxonomyCacheManager.setAiGenerator(mockGenerator);

    const sender = createMockSender(201);
    const event = { sender };

    // 1. 同一内容失败后不重试
    const failRes1 = await generateSummaryHandler(event, {
      name: 'failing-skill',
      description: 'A tool that fails on first generation.',
    });
    expect(failRes1.enrichmentFailed).toBe(true);
    expect(mockGenerator).toHaveBeenCalledTimes(1);

    // 再次请求同一 failing-skill：被拦截，不重复调用生成器
    const failRes2 = await generateSummaryHandler(event, {
      name: 'failing-skill',
      description: 'A tool that fails on first generation.',
    });
    expect(failRes2.skipped).toBe(true);
    expect(failRes2.reason).toBe('already_attempted');
    expect(mockGenerator).toHaveBeenCalledTimes(1);

    // 2. 切页 / 离开再回来（set-page-visibility: false 然后 true）
    await setVisibilityHandler(event, false);
    // 离开时如果又有请求进来，直接拦截
    const leaveRes = await generateSummaryHandler(event, {
      name: 'skill-while-left',
      description: 'A tool called when page is hidden.',
    });
    expect(leaveRes.skipped).toBe(true);
    expect(leaveRes.reason).toBe('page_not_visible');
    expect(mockGenerator).toHaveBeenCalledTimes(1);

    // 回来：可见性重置为 true，但累计的 callCount 不重置
    await setVisibilityHandler(event, true);
    const resumeRes = await generateSummaryHandler(event, {
      name: 'skill-resumed',
      description: 'A tool called after returning to page.',
    });
    expect(resumeRes.success).toBe(true);
    expect(resumeRes.enrichmentFailed).toBe(false);
    expect(mockGenerator).toHaveBeenCalledTimes(2);

    // 3. 窗口销毁并重新打开：新窗口开启新会话
    sender.destroy();
    expect(_getWindowSkillSessionForTest(201)).toBeUndefined();

    // 新窗口（senderId: 202）
    const newSender = createMockSender(202);
    const newEvent = { sender: newSender };
    const newWinRes = await generateSummaryHandler(newEvent, {
      name: 'failing-skill', // 之前失败过的技能在全新窗口中可再次尝试 1 次
      description: 'A tool that fails on first generation.',
    });
    expect(newWinRes.success).toBe(true);
    expect(mockGenerator).toHaveBeenCalledTimes(3);
  });

  it('绿⑬: 两个窗口同时打开技能库时总并发不超过 3；页面离开后新增启动数为 0；工作区/窗口隔离', async () => {
    const generateSummaryHandler = getHandler('dispatch-skills:generate-summary');
    const setVisibilityHandler = getHandler('dispatch-skills:set-page-visibility');

    let activeInGenerator = 0;
    let maxSeenConcurrent = 0;
    const resolvers: Array<() => void> = [];

    const mockGenerator = vi.fn().mockImplementation(async () => {
      activeInGenerator++;
      maxSeenConcurrent = Math.max(maxSeenConcurrent, activeInGenerator);
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      activeInGenerator--;
      return '并发生成结果';
    });
    skillTaxonomyCacheManager.setAiGenerator(mockGenerator);

    const window1Sender = createMockSender(301);
    const window2Sender = createMockSender(302);

    // 窗口 1 发起 2 个生成
    const p1 = generateSummaryHandler({ sender: window1Sender }, { name: 'w1-s1', description: 'desc 1' });
    const p2 = generateSummaryHandler({ sender: window1Sender }, { name: 'w1-s2', description: 'desc 2' });

    // 窗口 2 发起 1 个生成，总并发达到 3
    const p3 = generateSummaryHandler({ sender: window2Sender }, { name: 'w2-s1', description: 'desc 3' });

    // 窗口 2 发起第 4 个生成：由于全局并发已满 3，直接被拦截
    const p4 = generateSummaryHandler({ sender: window2Sender }, { name: 'w2-s2', description: 'desc 4' });
    const res4 = await p4;
    expect(res4.skipped).toBe(true);
    expect(res4.reason).toBe('concurrency_limit');

    // 释放前 3 个
    while (resolvers.length > 0) {
      resolvers.shift()?.();
    }
    const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res3.success).toBe(true);
    expect(maxSeenConcurrent).toBeLessThanOrEqual(3);

    // 页面离开后新增启动数为 0
    await setVisibilityHandler({ sender: window1Sender }, false);
    const preCallCount = mockGenerator.mock.calls.length;
    const pLeave = await generateSummaryHandler({ sender: window1Sender }, { name: 'w1-s5', description: 'desc 5' });
    expect(pLeave.skipped).toBe(true);
    expect(pLeave.reason).toBe('page_not_visible');
    expect(mockGenerator.mock.calls.length).toBe(preCallCount);
  });
});

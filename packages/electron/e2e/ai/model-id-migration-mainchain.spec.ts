/**
 * FB-109 main-chain regression: a persisted legacy Claude selectable ID must
 * be upgraded only after the live SDK catalog proves its resolvedModel match.
 *
 * This deliberately calls the public `sessions:create` IPC rather than
 * driving a sidebar button. The IPC is the shared production persistence path
 * for both normal and Meta Agent creation, and this keeps the test focused on
 * the migration contract rather than renderer timing.
 */

import { _electron, test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTempWorkspace } from '../helpers';

const LEGACY_FABLE_MODEL = 'claude-code:fable-1m';
const FABLE_RESOLVED_MODELS = new Set(['claude-fable-5', 'claude-fable-5[1m]']);

type LiveClaudeCandidate = {
  id: string;
  resolvedModel?: string;
};

type SessionCreateResponse = {
  success: boolean;
  id?: string;
  error?: string;
};

type SessionListResponse = {
  success: boolean;
  sessions: Array<{
    id: string;
    model?: string;
    agentRole?: string;
  }>;
};

async function invokeElectron<T>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ({ invokeChannel, invokeArgs }) => {
      return await (window as any).electronAPI.invoke(invokeChannel, ...invokeArgs);
    },
    { invokeChannel: channel, invokeArgs: args },
  );
}

/**
 * `ai:getModels` waits for the enabled catalog fetch. Require runtime proof
 * rather than accepting a retained cache or placeholder row as a migration
 * target.
 */
async function getVerifiedFableCandidate(page: Page): Promise<LiveClaudeCandidate | null> {
  // Startup can navigate the window mid-poll, destroying the evaluate
  // context; report "not ready yet" so expect.poll retries instead of failing.
  return getVerifiedFableCandidateOnce(page).catch(() => null);
}

async function getVerifiedFableCandidateOnce(page: Page): Promise<LiveClaudeCandidate | null> {
  return page.evaluate(async () => {
    const response = await (window as any).electronAPI.invoke('ai:getModels');
    const status = response?.catalogStatuses?.['claude-code'];
    if (
      response?.success !== true
      || status?.modelSource !== 'runtime'
      || status?.verified !== true
      || status?.lastError
    ) {
      return null;
    }

    return response.models?.find((model: any) => (
      model.provider === 'claude-code'
      && model.unverifiedPlaceholder !== true
      && typeof model.resolvedModel === 'string'
      && ['claude-fable-5', 'claude-fable-5[1m]'].includes(model.resolvedModel)
    )) ?? null;
  });
}

/**
 * The main bundle imports application modules before bootstrap.ts runs. Pass
 * Electron's own user-data switch as well as the app's explicit environment
 * variables so the preseeded electron-store file is visible from process
 * start, not only after bootstrap has set a later app path.
 */
async function launchWithPreseededUserData(
  workspacePath: string,
  userDataPath: string,
): Promise<ElectronApplication> {
  // The dev server may bind IPv4 or IPv6 depending on the host — probe both,
  // matching findDevServerUrl in e2e/helpers.ts.
  let rendererReachable = false;
  for (const rendererUrl of ['http://127.0.0.1:5273', 'http://[::1]:5273']) {
    try {
      const rendererResponse = await fetch(rendererUrl, { method: 'HEAD' });
      if (rendererResponse.ok) {
        rendererReachable = true;
        break;
      }
    } catch {
      // try the next address family
    }
  }
  if (!rendererReachable) {
    throw new Error('Electron renderer server is unavailable on 127.0.0.1:5273 and [::1]:5273');
  }

  const electronMain = path.resolve(__dirname, '../../out/main/index.js');
  const electronCwd = path.resolve(__dirname, '../../../');
  const { ELECTRON_RUN_AS_NODE, ELECTRON_NO_ATTACH_CONSOLE, NODE_PATH, ...cleanEnv } = process.env;

  return _electron.launch({
    args: [
      electronMain,
      `--user-data-dir=${userDataPath}`,
      '--workspace',
      workspacePath,
    ],
    cwd: electronCwd,
    env: {
      ...cleanEnv,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'playwright-test-key',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:5273',
      PLAYWRIGHT: '1',
      NIMBALYST_CDP_PORT: '9333',
      NIMBALYST_USER_DATA_DIR: userDataPath,
      NIMBALYST_USER_DATA_PATH: userDataPath,
      NIMBALYST_PERMISSION_MODE: 'allow-all',
    },
  });
}

test.describe.configure({ mode: 'serial', timeout: 90_000 });

test('FB-109: sessions:create migrates the persisted legacy default for normal and Meta sessions', async () => {
  const workspacePath = await createTempWorkspace();
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'fb109-model-id-migration-'));
  let electronApp: ElectronApplication | undefined;

  // electron-store reads this before the renderer starts. It is intentionally
  // the old spelling that Build 45 users have persisted.
  await fs.writeFile(
    path.join(userDataPath, 'app-settings.json'),
    JSON.stringify({
      defaultAIModel: LEGACY_FABLE_MODEL,
      alphaFeatures: { 'meta-agent': true },
      onboardingCompleted: true,
      unifiedOnboardingCompleted: true,
    }),
    'utf8',
  );

  try {
    electronApp = await launchWithPreseededUserData(workspacePath, userDataPath);
    expect(await electronApp.evaluate(({ app }) => app.getPath('userData'))).toBe(userDataPath);
    const page = await electronApp.firstWindow();

    // Do not wait for the workspace sidebar: model migration is main-process
    // work, while preload availability is sufficient for real IPC calls.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof (window as any).electronAPI?.invoke === 'function');

    // Channel health can complete the same legal migration before the renderer
    // has exposed IPC. Capture the boot value now, then below require it to be
    // either the preseeded spelling or the sole live-proven canonical spelling
    // (never an arbitrary fallback model).
    const defaultAtBoot = await invokeElectron<string | undefined>(
      page,
      'settings:get-default-ai-model',
    );

    await expect.poll(
      () => getVerifiedFableCandidate(page),
      {
        timeout: 60_000,
        intervals: [250, 500, 1_000],
        message: '等待 Claude 实时目录提供 fable 的 resolvedModel 等价项',
      },
    ).not.toBeNull();

    const canonical = await getVerifiedFableCandidate(page);
    expect(canonical).not.toBeNull();
    expect(canonical?.id).toMatch(/^claude-code:/);
    expect(FABLE_RESOLVED_MODELS.has(canonical?.resolvedModel ?? '')).toBe(true);
    expect([LEGACY_FABLE_MODEL, canonical?.id]).toContain(defaultAtBoot);

    const normalSessionId = randomUUID();
    const metaSessionId = randomUUID();

    // Omitting the model exercises the persisted global default migration.
    await expect(invokeElectron<SessionCreateResponse>(page, 'sessions:create', {
      session: {
        id: normalSessionId,
        provider: 'claude-code',
        model: null,
        title: 'FB-109 migrated normal session',
      },
      workspaceId: workspacePath,
    })).resolves.toMatchObject({ success: true, id: normalSessionId });

    // Supplying the old ID explicitly exercises session-level migration on the
    // same production creation IPC used by New Meta Agent.
    await expect(invokeElectron<SessionCreateResponse>(page, 'sessions:create', {
      session: {
        id: metaSessionId,
        provider: 'claude-code',
        model: LEGACY_FABLE_MODEL,
        title: 'FB-109 migrated Meta Agent',
        agentRole: 'meta-agent',
      },
      workspaceId: workspacePath,
    })).resolves.toMatchObject({ success: true, id: metaSessionId });

    await expect(invokeElectron<string | undefined>(page, 'settings:get-default-ai-model'))
      .resolves.toBe(canonical?.id);

    const listed = await invokeElectron<SessionListResponse>(
      page,
      'sessions:list',
      workspacePath,
      { includeArchived: false },
    );
    expect(listed.success).toBe(true);
    expect(listed.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: normalSessionId,
        model: canonical?.id,
        agentRole: 'standard',
      }),
      expect.objectContaining({
        id: metaSessionId,
        model: canonical?.id,
        agentRole: 'meta-agent',
      }),
    ]));
  } finally {
    await electronApp?.close();
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => undefined);
  }
});

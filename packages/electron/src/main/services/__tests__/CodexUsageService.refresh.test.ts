import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const electronMocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: electronMocks.send },
    }],
  },
}));

import { CodexUsageService } from '../CodexUsageService';
import type { CodexUsageData } from '../../../shared/usage';

const tempRoots: string[] = [];

async function createCodexSnapshot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-usage-refresh-'));
  tempRoots.push(root);
  const dayDir = join(root, '2026', '07', '17');
  await mkdir(dayDir, { recursive: true });
  await writeFile(
    join(dayDir, 'rollout-test.jsonl'),
    `${JSON.stringify({
      timestamp: '2026-07-17T06:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          limit_id: 'codex',
          primary: {
            used_percent: 47,
            window_minutes: 300,
            resets_at: 4_102_444_800,
          },
        },
      },
    })}\n`,
    'utf8',
  );
  return root;
}

afterEach(async () => {
  vi.useRealTimers();
  electronMocks.send.mockClear();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CodexUsageService refresh resilience', () => {
  it('keeps the last valid pool and marks it stale when source data disappears', async () => {
    const sessionsDir = await createCodexSnapshot();
    const service = new CodexUsageService({ sessionsDir });
    const initial = await service.refresh();
    const initialPool = initial.pools['openai-codex:codex'];

    await rm(sessionsDir, { recursive: true, force: true });
    const failed = await service.refresh();

    expect(failed.pools['openai-codex:codex']).toMatchObject({
      utilization: 47,
      updatedAt: initialPool.updatedAt,
      stale: true,
    });
    expect(failed.lastUpdated).toBe(initial.lastUpdated);
    expect(failed.error).toBeTruthy();
  });

  it('refreshes the cached pools within 10 seconds after a Codex turn completes', async () => {
    const sessionsDir = await createCodexSnapshot();
    const rolloutPath = join(sessionsDir, '2026', '07', '17', 'rollout-test.jsonl');
    const service = new CodexUsageService({ sessionsDir });
    await service.refresh();
    await writeFile(
      rolloutPath,
      `${JSON.stringify({
        timestamp: '2026-07-17T06:01:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            limit_id: 'codex',
            primary: {
              used_percent: 55,
              window_minutes: 300,
              resets_at: 4_102_444_800,
            },
          },
        },
      })}\n`,
      'utf8',
    );
    vi.useFakeTimers();

    const refreshPromise = service.recordTurnCompleted();
    await vi.advanceTimersByTimeAsync(10_000);
    await refreshPromise;

    expect(service.getCachedUsage()?.pools['openai-codex:codex'].utilization).toBe(55);
  });

  it('shares one in-flight refresh promise and emits one ordered update', async () => {
    const sessionsDir = await createCodexSnapshot();
    const service = new CodexUsageService({ sessionsDir });
    const originalScan = (service as any).findLatestUsageSnapshot.bind(service);
    let releaseScan!: () => void;
    const scanGate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    const scan = vi.spyOn(service as any, 'findLatestUsageSnapshot').mockImplementation(async () => {
      await scanGate;
      return originalScan();
    });

    const first = service.refresh();
    const second = service.refresh();

    expect(second).toBe(first);
    expect(scan).toHaveBeenCalledTimes(1);
    releaseScan();
    const [firstUsage, secondUsage] = await Promise.all([first, second]);

    expect(secondUsage).toBe(firstUsage);
    expect(electronMocks.send).toHaveBeenCalledTimes(1);
    expect(service.getCachedUsage()).toBe(firstUsage);
  });

  it('runs exactly one trailing refresh when turns complete during an external refresh', async () => {
    const sessionsDir = await createCodexSnapshot();
    const service = new CodexUsageService({ sessionsDir, turnRefreshDelayMs: 1_000 });
    const originalScan = (service as any).findLatestUsageSnapshot.bind(service);
    let releaseFirstScan!: () => void;
    const firstScanGate = new Promise<void>((resolve) => {
      releaseFirstScan = resolve;
    });
    let scanCalls = 0;
    vi.spyOn(service as any, 'findLatestUsageSnapshot').mockImplementation(async () => {
      scanCalls += 1;
      if (scanCalls === 1) await firstScanGate;
      return originalScan();
    });
    vi.useFakeTimers();

    const externalRefresh = service.refresh();
    const turnRefresh = service.recordTurnCompleted();
    service.recordTurnCompleted();
    service.recordTurnCompleted();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(scanCalls).toBe(1);
    releaseFirstScan();
    await externalRefresh;
    await vi.waitFor(() => expect(scanCalls).toBe(2));
    await turnRefresh;

    expect(scanCalls).toBe(2);
  });

  it('runs a trailing refresh when another Codex turn completes during a refresh', async () => {
    const pendingRefreshes: Array<(usage: CodexUsageData) => void> = [];
    const emptyUsage: CodexUsageData = {
      provider: 'openai-codex',
      pools: {},
      lastUpdated: null,
    };
    class ControlledCodexUsageService extends CodexUsageService {
      refreshCalls = 0;

      override refresh(): Promise<CodexUsageData> {
        this.refreshCalls += 1;
        return new Promise((resolve) => pendingRefreshes.push(resolve));
      }
    }
    vi.useFakeTimers();
    const service = new ControlledCodexUsageService({ turnRefreshDelayMs: 1_000 });

    const refreshQueue = service.recordTurnCompleted();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.refreshCalls).toBe(1);

    const secondTurn = service.recordTurnCompleted();
    const thirdTurn = service.recordTurnCompleted();
    expect(secondTurn).toBe(refreshQueue);
    expect(thirdTurn).toBe(refreshQueue);
    pendingRefreshes.shift()?.(emptyUsage);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(service.refreshCalls).toBe(2);
    pendingRefreshes.shift()?.(emptyUsage);
    await refreshQueue;
  });
});

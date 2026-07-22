import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ioTrace = vi.hoisted(() => ({
  fullReads: [] as string[],
  rangeReads: [] as Array<{
    path: string;
    position: number | null;
    requestedBytes: number | null;
    bytesRead: number;
  }>,
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: unknown[]) => {
      ioTrace.fullReads.push(String(args[0]));
      return (actual.readFile as (...readArgs: unknown[]) => unknown)(...args);
    },
    open: async (...args: unknown[]) => {
      const handle = await (actual.open as (...openArgs: unknown[]) => Promise<{
        read: (...readArgs: unknown[]) => Promise<{ bytesRead: number }>;
      }>)(...args);
      const filePath = String(args[0]);
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'read') {
            return async (...readArgs: unknown[]) => {
              const result = await target.read(...readArgs);
              ioTrace.rangeReads.push({
                path: filePath,
                position: typeof readArgs[3] === 'number' ? readArgs[3] : null,
                requestedBytes: typeof readArgs[2] === 'number' ? readArgs[2] : null,
                bytesRead: result.bytesRead,
              });
              return result;
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => tmpdir() },
}));

import { CodexUsageService } from '../CodexUsageService';

const tempRoots: string[] = [];
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

interface RateWindow {
  used_percent: number;
  window_minutes: number;
  resets_at: number;
}

function tokenCountEvent(options: {
  timestamp?: string;
  limitId: string;
  utilization: number;
  resetsAt: number;
  secondary?: RateWindow;
  totalTokens?: number;
}): string {
  return JSON.stringify({
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: options.totalTokens ?? 100 },
        last_token_usage: { total_tokens: 10 },
      },
      rate_limits: {
        limit_id: options.limitId,
        primary: {
          used_percent: options.utilization,
          window_minutes: 300,
          resets_at: options.resetsAt,
        },
        secondary: options.secondary,
      },
    },
  });
}

async function createRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function createService(
  sessionsDir: string,
  options: Record<string, unknown> = {},
): CodexUsageService {
  return new CodexUsageService({ sessionsDir, ...options } as never);
}

function rolloutReads(): string[] {
  return ioTrace.fullReads.filter((filePath) => filePath.includes('rollout-'));
}

afterEach(async () => {
  vi.useRealTimers();
  ioTrace.fullReads.length = 0;
  ioTrace.rangeReads.length = 0;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CodexUsageService incremental index', () => {
  it('matches a forced full scan through append, new file, deletion, rewrite, truncation, and expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-22T04:00:00.000Z'));
    const root = await createRoot('codex-usage-equivalence-');
    const dayDir = join(root, '2026', '07', '22');
    const cachePath = join(root, '.cache', 'usage-index.json');
    const rolloutPath = join(dayDir, 'rollout-primary.jsonl');
    await mkdir(dayDir, { recursive: true });

    const nowSeconds = Date.now() / 1000;
    const primaryReset = nowSeconds + 60;
    const secondary = {
      used_percent: 20,
      window_minutes: 10_080,
      resets_at: nowSeconds + 3_600,
    };
    const initialLines = [
      tokenCountEvent({
        timestamp: '2026-07-22T04:00:00.000Z',
        limitId: 'switching_pool',
        utilization: 10,
        resetsAt: primaryReset,
        secondary,
      }),
      tokenCountEvent({
        limitId: 'mtime_fallback_pool',
        utilization: 30,
        resetsAt: nowSeconds + 3_600,
      }),
    ];
    await writeFile(rolloutPath, `${initialLines.join('\n')}\n`, 'utf8');

    const incremental = createService(root, { cachePath });
    const full = createService(root, { useIncrementalIndex: false });
    const expectEquivalent = async () => {
      const incrementalUsage = await incremental.refresh();
      const fullUsage = await full.refresh();
      expect(incrementalUsage).toEqual(fullUsage);
      return incrementalUsage;
    };

    await expectEquivalent();

    await appendFile(
      rolloutPath,
      `${tokenCountEvent({
        timestamp: '2026-07-22T04:00:10.000Z',
        limitId: 'appended_pool',
        utilization: 40,
        resetsAt: nowSeconds + 3_600,
      })}\n`,
      'utf8',
    );
    expect((await expectEquivalent()).pools['openai-codex:appended_pool'].utilization).toBe(40);

    const addedPath = join(dayDir, 'rollout-added.jsonl');
    await writeFile(
      addedPath,
      `${tokenCountEvent({
        timestamp: '2026-07-22T04:00:20.000Z',
        limitId: 'new_file_pool',
        utilization: 50,
        resetsAt: nowSeconds + 3_600,
      })}\n`,
      'utf8',
    );
    expect((await expectEquivalent()).pools['openai-codex:new_file_pool'].stale).toBe(false);

    await rm(addedPath);
    expect((await expectEquivalent()).pools['openai-codex:new_file_pool'].stale).toBe(true);

    const rewrittenLines = [
      tokenCountEvent({
        timestamp: '2026-07-22T04:00:00.000Z',
        limitId: 'switching_pool',
        utilization: 90,
        resetsAt: primaryReset,
        secondary: { ...secondary, used_percent: 40 },
      }),
      tokenCountEvent({
        limitId: 'mtime_fallback_pool',
        utilization: 70,
        resetsAt: nowSeconds + 3_600,
      }),
    ];
    const rewrittenContent = `${rewrittenLines.join('\n')}\n`;
    expect(Buffer.byteLength(rewrittenContent)).toBe(Buffer.byteLength(`${initialLines.join('\n')}\n`));
    await writeFile(rolloutPath, rewrittenContent, 'utf8');
    const touchedAt = new Date(Date.now() + 5_000);
    await utimes(rolloutPath, touchedAt, touchedAt);
    expect((await expectEquivalent()).pools['openai-codex:switching_pool'].utilization).toBe(90);

    vi.setSystemTime(new Date(Date.now() + 61_000));
    const afterExpiry = await expectEquivalent();
    expect(afterExpiry.pools['openai-codex:switching_pool']).toMatchObject({
      utilization: 40,
      windowMinutes: 10_080,
      stale: false,
    });

    vi.setSystemTime(new Date((secondary.resets_at + 1) * 1_000));
    expect((await expectEquivalent()).pools['openai-codex:switching_pool']).toMatchObject({
      utilization: 40,
      stale: true,
    });

    await writeFile(
      rolloutPath,
      `${tokenCountEvent({
        timestamp: '2026-07-22T04:02:00.000Z',
        limitId: 'truncated_pool',
        utilization: 80,
        resetsAt: Date.now() / 1_000 + 3_600,
      })}\n`,
      'utf8',
    );
    expect((await expectEquivalent()).pools['openai-codex:truncated_pool'].utilization).toBe(80);
  });

  it('persists the index across service instances and rebuilds a corrupt cache', async () => {
    const root = await createRoot('codex-usage-persistence-');
    const dayDir = join(root, '2026', '07', '22');
    const rolloutPath = join(dayDir, 'rollout-persisted.jsonl');
    const cachePath = join(root, '.cache', 'usage-index.json');
    await mkdir(dayDir, { recursive: true });
    await writeFile(
      rolloutPath,
      `${tokenCountEvent({
        timestamp: '2026-07-22T04:00:00.000Z',
        limitId: 'persisted_pool',
        utilization: 25,
        resetsAt: 4_102_444_800,
      })}\n`,
      'utf8',
    );

    const firstUsage = await createService(root, { cachePath }).refresh();
    await access(cachePath);
    ioTrace.fullReads.length = 0;

    const restoredUsage = await createService(root, { cachePath }).refresh();
    expect(restoredUsage).toEqual(firstUsage);
    expect(rolloutReads()).toEqual([]);

    await writeFile(cachePath, '{not-json', 'utf8');
    ioTrace.fullReads.length = 0;
    const rebuiltUsage = await createService(root, { cachePath }).refresh();
    expect(rebuiltUsage.pools['openai-codex:persisted_pool'].utilization).toBe(25);
    expect(rolloutReads()).toEqual([rolloutPath]);
    const rebuiltCache = await readFile(cachePath, 'utf8');
    expect(() => JSON.parse(rebuiltCache)).not.toThrow();

    const structurallyCorrupt = JSON.parse(rebuiltCache) as {
      files: Record<string, {
        records: Array<{ rateLimits: { primary: { used_percent: unknown } } }>;
      }>;
    };
    structurallyCorrupt.files[rolloutPath].records[0].rateLimits.primary.used_percent = 'broken';
    await writeFile(cachePath, JSON.stringify(structurallyCorrupt), 'utf8');
    ioTrace.fullReads.length = 0;
    const structurallyRebuiltUsage = await createService(root, { cachePath }).refresh();
    expect(structurallyRebuiltUsage.pools['openai-codex:persisted_pool'].utilization).toBe(25);
    expect(rolloutReads()).toEqual([rolloutPath]);

    ioTrace.fullReads.length = 0;
    ioTrace.rangeReads.length = 0;
    const repairedCacheUsage = await createService(root, { cachePath }).refresh();
    expect(repairedCacheUsage.pools['openai-codex:persisted_pool'].utilization).toBe(25);
    expect(rolloutReads()).toEqual([]);
    expect(ioTrace.rangeReads.filter((read) => read.path.includes('rollout-'))).toEqual([]);
  });

  it('rebuilds a same-inode rollout that was rewritten with larger content', async () => {
    const root = await createRoot('codex-usage-rewrite-grow-');
    const dayDir = join(root, '2026', '07', '22');
    const rolloutPath = join(dayDir, 'rollout-rewritten.jsonl');
    await mkdir(dayDir, { recursive: true });
    await writeFile(
      rolloutPath,
      `${tokenCountEvent({
        timestamp: '2026-07-22T04:00:00.000Z',
        limitId: 'old_pool',
        utilization: 10,
        resetsAt: 4_102_444_800,
      })}\n`,
      'utf8',
    );

    const service = createService(root);
    await service.refresh();
    const previousStat = await stat(rolloutPath);
    await writeFile(
      rolloutPath,
      `${' '.repeat(4_096)}${tokenCountEvent({
        timestamp: '2026-07-22T04:01:00.000Z',
        limitId: 'rewritten_pool',
        utilization: 70,
        resetsAt: 4_102_444_800,
      })}\n`,
      'utf8',
    );
    const rewrittenStat = await stat(rolloutPath);
    expect(rewrittenStat.ino).toBe(previousStat.ino);
    expect(rewrittenStat.size).toBeGreaterThan(previousStat.size);
    ioTrace.fullReads.length = 0;

    const usage = await service.refresh();

    expect(rolloutReads()).toEqual([rolloutPath]);
    expect(usage.pools['openai-codex:rewritten_pool']).toMatchObject({
      utilization: 70,
      stale: false,
    });
    expect(usage.pools['openai-codex:old_pool'].stale).toBe(true);
  });

  it('does not reread 100 unchanged files and parses only an appended suffix from a 50 MiB rollout', async () => {
    const root = await createRoot('codex-usage-scale-');
    const dayDir = join(root, '2026', '07', '22');
    const cachePath = join(root, '.cache', 'usage-index.json');
    await mkdir(dayDir, { recursive: true });
    const resetsAt = 4_102_444_800;

    const smallWrites = Array.from({ length: 99 }, async (_, index) => {
      const filePath = join(dayDir, `rollout-small-${String(index).padStart(3, '0')}.jsonl`);
      await writeFile(
        filePath,
        `${tokenCountEvent({
          timestamp: `2026-07-22T04:${String(index % 60).padStart(2, '0')}:00.000Z`,
          limitId: `small_pool_${index}`,
          utilization: index,
          resetsAt,
        })}\n`,
        'utf8',
      );
    });
    await Promise.all(smallWrites);

    const largePath = join(dayDir, 'rollout-large.jsonl');
    const largeEvent = tokenCountEvent({
      timestamp: '2026-07-22T04:00:00.000Z',
      limitId: 'large_pool',
      utilization: 1,
      resetsAt,
    });
    await writeFile(
      largePath,
      `${' '.repeat(LARGE_FILE_BYTES - Buffer.byteLength(largeEvent) - 1)}${largeEvent}\n`,
      'utf8',
    );
    expect((await stat(largePath)).size).toBeGreaterThanOrEqual(LARGE_FILE_BYTES);

    const service = createService(root, { cachePath });
    await service.refresh();
    expect(new Set(rolloutReads()).size).toBe(100);

    ioTrace.fullReads.length = 0;
    ioTrace.rangeReads.length = 0;
    await service.refresh();
    expect(rolloutReads()).toEqual([]);
    expect(ioTrace.rangeReads.filter((read) => read.path.includes('rollout-'))).toEqual([]);

    const oldSize = (await stat(largePath)).size;
    const appendedLine = `${tokenCountEvent({
      timestamp: '2026-07-22T05:00:00.000Z',
      limitId: 'large_pool',
      utilization: 77,
      resetsAt,
    })}\n`;
    await appendFile(largePath, appendedLine, 'utf8');
    ioTrace.fullReads.length = 0;
    ioTrace.rangeReads.length = 0;

    const appendedUsage = await service.refresh();

    expect(appendedUsage.pools['openai-codex:large_pool'].utilization).toBe(77);
    expect(rolloutReads()).toEqual([]);
    const rolloutRangeReads = ioTrace.rangeReads.filter((read) => read.path.includes('rollout-'));
    expect(new Set(rolloutRangeReads.map((read) => read.path))).toEqual(new Set([largePath]));
    const appendedReads = rolloutRangeReads.filter((read) => read.path === largePath);
    expect(appendedReads.some((read) => (
      read.position === oldSize
      && read.bytesRead === Buffer.byteLength(appendedLine)
    ))).toBe(true);
    expect(appendedReads.reduce((total, read) => total + read.bytesRead, 0))
      .toBeLessThanOrEqual(Buffer.byteLength(appendedLine) + 16 * 1024);
  });
});

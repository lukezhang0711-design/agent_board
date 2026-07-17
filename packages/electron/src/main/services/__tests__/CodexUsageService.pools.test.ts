import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import { CodexUsageService } from '../CodexUsageService';

const tempRoots: string[] = [];
const FUTURE_RESET_SECONDS = 4_102_444_800;

function tokenCountEvent(
  timestamp: string,
  limitId: string,
  utilization: number,
  windowMinutes = 300,
  resetsAt = FUTURE_RESET_SECONDS,
  limitName: string | null = null,
): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        limit_id: limitId,
        limit_name: limitName,
        primary: {
          used_percent: utilization,
          window_minutes: windowMinutes,
          resets_at: resetsAt,
        },
      },
    },
  });
}

async function createSessionFile(lines: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-usage-pools-'));
  tempRoots.push(root);
  const dayDir = join(root, '2026', '07', '17');
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dayDir, 'rollout-test.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CodexUsageService pool collection', () => {
  it('keeps codex, codex_bengalfox, and an unknown limit_id as three independent pools', async () => {
    const sessionsDir = await createSessionFile([
      tokenCountEvent(
        '2026-07-17T06:00:00.000Z',
        'codex',
        63,
        300,
        FUTURE_RESET_SECONDS,
        'Codex standard',
      ),
      tokenCountEvent('2026-07-17T06:01:00.000Z', 'codex_bengalfox', 0),
      tokenCountEvent('2026-07-17T06:02:00.000Z', 'codex_future_pool', 60),
    ]);
    const service = new CodexUsageService({ sessionsDir });

    const usage = await service.refresh();

    expect(Object.keys(usage.pools).sort()).toEqual([
      'openai-codex:codex',
      'openai-codex:codex_bengalfox',
      'openai-codex:codex_future_pool',
    ]);
    expect(usage.pools['openai-codex:codex']).toMatchObject({
      provider: 'openai-codex',
      limitId: 'codex',
      name: 'Codex standard',
      utilization: 63,
      stale: false,
    });
    expect(usage.pools['openai-codex:codex_bengalfox'].utilization).toBe(0);
    expect(usage.pools['openai-codex:codex_future_pool'].utilization).toBe(60);
  });

  it('does not regress a pool percentage within the same reset cycle', async () => {
    const sessionsDir = await createSessionFile([
      tokenCountEvent('2026-07-17T06:00:00.000Z', 'codex', 63),
      tokenCountEvent('2026-07-17T06:01:00.000Z', 'codex', 0),
    ]);
    const service = new CodexUsageService({ sessionsDir });

    const usage = await service.refresh();

    expect(usage.pools['openai-codex:codex']).toMatchObject({
      utilization: 63,
      updatedAt: Date.parse('2026-07-17T06:01:00.000Z'),
    });
  });

  it('accepts a lower percentage after the pool moves to a new reset cycle', async () => {
    const sessionsDir = await createSessionFile([
      tokenCountEvent('2026-07-17T06:00:00.000Z', 'codex', 63, 300, FUTURE_RESET_SECONDS),
      tokenCountEvent('2026-07-17T06:01:00.000Z', 'codex', 4, 300, FUTURE_RESET_SECONDS + 300),
    ]);

    const usage = await new CodexUsageService({ sessionsDir }).refresh();

    expect(usage.pools['openai-codex:codex'].utilization).toBe(4);
  });

  it('does not let an older snapshot replace a newer cached snapshot', async () => {
    const sessionsDir = await createSessionFile([
      tokenCountEvent('2026-07-17T06:02:00.000Z', 'codex', 60),
    ]);
    const rolloutPath = join(sessionsDir, '2026', '07', '17', 'rollout-test.jsonl');
    const service = new CodexUsageService({ sessionsDir });
    await service.refresh();

    await writeFile(
      rolloutPath,
      `${tokenCountEvent('2026-07-17T06:00:00.000Z', 'codex', 20)}\n`,
      'utf8',
    );
    const usage = await service.refresh();

    expect(usage.pools['openai-codex:codex']).toMatchObject({
      utilization: 60,
      updatedAt: Date.parse('2026-07-17T06:02:00.000Z'),
    });
  });

  it('collects a new pool even when its snapshot is outside the five most recent files', async () => {
    const sessionsDir = await createSessionFile([
      tokenCountEvent('2026-07-17T06:00:00.000Z', 'codex', 63),
    ]);
    const dayDir = join(sessionsDir, '2026', '07', '17');
    for (let index = 0; index < 5; index += 1) {
      await writeFile(
        join(dayDir, `rollout-recent-${index}.jsonl`),
        `${tokenCountEvent(`2026-07-17T06:0${index}:00.000Z`, `recent_pool_${index}`, index)}\n`,
        'utf8',
      );
    }
    const olderPath = join(dayDir, 'rollout-older.jsonl');
    await writeFile(
      olderPath,
      `${tokenCountEvent('2026-07-16T06:00:00.000Z', 'pool_beyond_five', 22)}\n`,
      'utf8',
    );
    await utimes(olderPath, new Date('2026-07-16T06:00:00.000Z'), new Date('2026-07-16T06:00:00.000Z'));

    const usage = await new CodexUsageService({ sessionsDir }).refresh();

    expect(usage.pools['openai-codex:pool_beyond_five']).toMatchObject({
      limitId: 'pool_beyond_five',
      utilization: 22,
    });
  });
});

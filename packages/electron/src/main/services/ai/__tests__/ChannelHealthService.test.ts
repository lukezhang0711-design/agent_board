import { describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_HEALTH_AUTO_DEDUPE_MS,
  CHANNEL_HEALTH_PROMPT,
  CHANNEL_HEALTH_TIMEOUT_MS,
  ChannelHealthError,
  ChannelHealthService,
  channelHealthFailureCopy,
  classifyChannelHealthError,
  type ChannelHealthChannel,
} from '../ChannelHealthService';

const channels: ChannelHealthChannel[] = [
  { id: 'claude-code', displayName: 'Claude（嵌入式）', transport: 'streaming' },
  { id: 'claude-code-cli', displayName: 'Claude CLI', transport: 'claude-cli' },
  { id: 'openai-codex', displayName: 'Codex', transport: 'streaming' },
  { id: 'gemini-fixture', displayName: 'Gemini', transport: 'streaming' },
];

function event(): Electron.IpcMainInvokeEvent {
  return { sender: {} } as Electron.IpcMainInvokeEvent;
}

describe('ChannelHealthService', () => {
  it('GREEN: four-channel fixture constructs success, unauthenticated, and timeout states with structured logs', async () => {
    let fixture: 'success' | 'not_logged_in' | 'timeout' = 'success';
    const logs: string[] = [];
    const runChannel = vi.fn(async () => {
      if (fixture === 'not_logged_in') {
        throw new ChannelHealthError('not_logged_in');
      }
      if (fixture === 'timeout') {
        throw new ChannelHealthError('timeout');
      }
      return { firstResponseMs: 12, completionMs: 34, responseText: 'pong' };
    });
    const service = new ChannelHealthService({
      listEnabledChannels: () => channels,
      runChannel,
      isAutoCheckEnabled: () => true,
      log: (line) => logs.push(line),
    });

    for (const expected of ['healthy', 'failed', 'failed'] as const) {
      const snapshot = await service.runManually({ event: event(), workspacePath: '/fixture' });
      expect(snapshot.results).toHaveLength(4);
      expect(snapshot.running).toBe(false);
      expect(snapshot.results.every((result) => result.state === expected)).toBe(true);
      if (fixture === 'not_logged_in') {
        expect(snapshot.results.every((result) => result.failureKind === 'not_logged_in')).toBe(true);
      }
      if (fixture === 'timeout') {
        expect(snapshot.results.every((result) => result.failureKind === 'timeout')).toBe(true);
      }
      fixture = fixture === 'success'
        ? 'not_logged_in'
        : fixture === 'not_logged_in'
          ? 'timeout'
          : 'timeout';
    }

    expect(runChannel).toHaveBeenCalledWith(expect.objectContaining({
      prompt: CHANNEL_HEALTH_PROMPT,
      workspacePath: '/fixture',
    }));
    expect(logs).toHaveLength(12);
    expect(logs.every((line) => line.startsWith('[ChannelHealth] '))).toBe(true);
    expect(logs.join('\n')).not.toContain(CHANNEL_HEALTH_PROMPT);
    expect(JSON.parse(logs[0].slice('[ChannelHealth] '.length))).toMatchObject({
      channel: 'claude-code',
      result: 'healthy',
      firstResponseMs: 12,
      completionMs: 34,
      trigger: 'manual',
    });
    const parsedLogs = logs.map((line) => JSON.parse(line.slice('[ChannelHealth] '.length)));
    expect(parsedLogs.filter((entry) => entry.result === 'failed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ failureClass: 'not_logged_in' }),
      expect.objectContaining({ failureClass: 'timeout' }),
    ]));
  });

  it('marks a completed response slower than ten seconds as yellow', async () => {
    const service = new ChannelHealthService({
      listEnabledChannels: () => [channels[0]],
      runChannel: async () => ({ responseText: 'pong', firstResponseMs: 400, completionMs: 10_001 }),
      isAutoCheckEnabled: () => true,
      log: vi.fn(),
    });

    const snapshot = await service.runManually({ event: event(), workspacePath: '/fixture' });
    expect(snapshot.results[0]).toMatchObject({
      state: 'slow',
      firstResponseMs: 400,
      completionMs: 10_001,
    });
  });

  it('RED: waits for a Codex fixture that completes in 25 seconds, then marks it slow instead of timing out', async () => {
    vi.useFakeTimers();
    try {
      const codex = channels.find((channel) => channel.id === 'openai-codex')!;
      const service = new ChannelHealthService({
        listEnabledChannels: () => [codex],
        runChannel: () => new Promise((resolve) => {
          setTimeout(() => {
            resolve({ responseText: 'pong', firstResponseMs: 12_000, completionMs: 25_000 });
          }, 25_000);
        }),
        isAutoCheckEnabled: () => true,
        log: vi.fn(),
      });

      const snapshotPromise = service.runManually({ event: event(), workspacePath: '/fixture' });
      await vi.advanceTimersByTimeAsync(25_000);

      await expect(snapshotPromise).resolves.toMatchObject({
        results: [expect.objectContaining({
          id: 'openai-codex',
          state: 'slow',
          completionMs: 25_000,
        })],
      });
      expect(CHANNEL_HEALTH_TIMEOUT_MS).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('RED: reports a missing API key with the actionable key-setup guidance', () => {
    expect(classifyChannelHealthError(new Error('Anthropic API key not configured')))
      .toBe('missing_api_key');
    expect(channelHealthFailureCopy('claude', 'missing_api_key')).toEqual({
      summary: '未配置密钥',
      guidance: '在设置中填入 API Key，或不使用此通道可忽略',
    });
  });

  it('RED: keeps disabled extension rows visible without sending a health request', async () => {
    const enabled = channels[0];
    const disabledExtension = {
      id: 'gemini-fixture',
      displayName: 'Gemini',
      transport: 'streaming',
      enabled: false,
    } as ChannelHealthChannel;
    const runChannel = vi.fn(async () => ({ responseText: 'pong', completionMs: 20 }));
    const service = new ChannelHealthService({
      listEnabledChannels: () => [enabled, disabledExtension],
      runChannel,
      isAutoCheckEnabled: () => true,
      log: vi.fn(),
    });

    const snapshot = await service.runManually({ event: event(), workspacePath: '/fixture' });

    expect(runChannel).toHaveBeenCalledTimes(1);
    expect(snapshot.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'gemini-fixture',
        state: 'disabled',
        summary: '未启用',
      }),
    ]));
  });

  it('RED: surfaces an unavailable Claude auth precheck as a retryable neutral result', async () => {
    const service = new ChannelHealthService({
      listEnabledChannels: () => [channels[1]],
      runChannel: async () => {
        throw new ChannelHealthError('auth_check_timeout');
      },
      isAutoCheckEnabled: () => true,
      log: vi.fn(),
    });

    const snapshot = await service.runManually({ event: event(), workspacePath: '/fixture' });

    expect(snapshot.results[0]).toMatchObject({
      state: 'unknown',
      failureKind: 'auth_check_timeout',
      summary: '检测超时',
    });
    expect(snapshot.results[0].guidance).toContain('重试');
  });

  it('throttles automatic checks for ten minutes but lets manual retries run', async () => {
    let now = 1_000;
    const runChannel = vi.fn(async () => ({ responseText: 'pong', completionMs: 20 }));
    const service = new ChannelHealthService({
      listEnabledChannels: () => channels,
      runChannel,
      isAutoCheckEnabled: () => true,
      log: vi.fn(),
      now: () => now,
    });

    await service.runOnStartup({ event: event(), workspacePath: '/fixture' });
    await service.runOnStartup({ event: event(), workspacePath: '/fixture' });
    expect(runChannel).toHaveBeenCalledTimes(channels.length);

    await service.runManually({ event: event(), workspacePath: '/fixture', channelId: 'claude-code' });
    expect(runChannel).toHaveBeenCalledTimes(channels.length + 1);

    now += CHANNEL_HEALTH_AUTO_DEDUPE_MS;
    await service.runOnStartup({ event: event(), workspacePath: '/fixture' });
    expect(runChannel).toHaveBeenCalledTimes(channels.length * 2 + 1);
  });

  it('does not automatically run when the startup setting is disabled', async () => {
    const runChannel = vi.fn(async () => ({ responseText: 'pong', completionMs: 1 }));
    const log = vi.fn();
    const service = new ChannelHealthService({
      listEnabledChannels: () => channels,
      runChannel,
      isAutoCheckEnabled: () => false,
      log,
    });

    const snapshot = await service.runOnStartup({ event: event(), workspacePath: '/fixture' });
    expect(runChannel).not.toHaveBeenCalled();
    expect(snapshot.results.every((result) => result.state === 'never')).toBe(true);
    expect(log).toHaveBeenCalledWith('[ChannelHealth] {"event":"startup-skipped","reason":"disabled"}');
  });

  it('continues checking subsequent channels after one channel fails', async () => {
    const runChannel = vi.fn(async ({ channel }: { channel: ChannelHealthChannel }) => {
      if (channel.id === 'claude-code') {
        throw new ChannelHealthError('engine_error');
      }
      return { responseText: 'pong', completionMs: 30 };
    });
    const service = new ChannelHealthService({
      listEnabledChannels: () => channels.slice(0, 2),
      runChannel,
      isAutoCheckEnabled: () => true,
      log: vi.fn(),
    });

    const snapshot = await service.runManually({ event: event(), workspacePath: '/fixture' });
    expect(snapshot.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude-code', state: 'failed', failureKind: 'engine_error' }),
      expect.objectContaining({ id: 'claude-code-cli', state: 'healthy' }),
    ]));
    expect(runChannel).toHaveBeenCalledTimes(2);
  });
});

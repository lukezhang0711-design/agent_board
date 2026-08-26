import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

import { spawn } from 'child_process';
import {
  AntigravityAgyModelError,
  AntigravityAgyNotInstalledError,
  AntigravityAgyNotLoggedInError,
  AntigravityAgyTimeoutError,
  AntigravityServerManager,
  probeGeminiOAuthFiles,
} from '../ServerManager';

type MockChild = ChildProcess & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const spawnMock = vi.fn();
const existsSyncMock = vi.mocked(fs.existsSync);
const readFileSyncMock = vi.mocked(fs.readFileSync);

function freshManager(): AntigravityServerManager {
  (AntigravityServerManager as unknown as { instance: unknown }).instance = null;
  return new AntigravityServerManager(spawnMock as unknown as typeof spawn);
}

function mockEnvironment({ desktop = false, agy = true } = {}): void {
  vi.spyOn(AntigravityServerManager, 'desktopBinaryPath')
    .mockReturnValue('/fixture/Antigravity.app/language_server');
  vi.spyOn(AntigravityServerManager, 'agyPathCandidates')
    .mockReturnValue(['/fixture/home/.local/bin/agy']);
  existsSyncMock.mockImplementation((candidate) => {
    const value = String(candidate);
    return (desktop && value === '/fixture/Antigravity.app/language_server')
      || (agy && value === '/fixture/home/.local/bin/agy');
  });
}

function mockGeminiOAuthFiles({ refreshToken = 'refresh-token-is-long-enough', includeAgy = false }: {
  refreshToken?: string | null;
  includeAgy?: boolean;
} = {}): void {
  const root = path.join(os.homedir(), '.gemini');
  const values: Record<string, string> = {
    [path.join(root, 'settings.json')]: JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }),
    [path.join(root, 'google_accounts.json')]: JSON.stringify({ active: 'account@example.com' }),
    [path.join(root, 'oauth_creds.json')]: JSON.stringify({
      access_token: 'access-token',
      expiry: '2099-01-01T00:00:00.000Z',
      ...(refreshToken === null ? {} : { refresh_token: refreshToken }),
    }),
  };
  existsSyncMock.mockImplementation((candidate) => {
    const value = String(candidate);
    return value in values || (includeAgy && value === '/fixture/home/.local/bin/agy');
  });
  readFileSyncMock.mockImplementation((candidate) => values[String(candidate)]!);
}

function mockChild({
  stdout = '',
  stderr = '',
  code = 0,
  close = true,
  closeDelayMs = 0,
} = {}): MockChild {
  const child = new EventEmitter() as unknown as MockChild;
  child.stdout = new EventEmitter() as unknown as MockChild['stdout'];
  child.stderr = new EventEmitter() as unknown as MockChild['stderr'];
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    if (close) {
      if (closeDelayMs > 0) setTimeout(() => child.emit('close', code), closeDelayMs);
      else child.emit('close', code);
    }
  });
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
  existsSyncMock.mockReset();
  readFileSyncMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agy CLI dynamic model catalog', () => {
  it('discovers a new agy model and forwards that exact value for a request', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock
      .mockReturnValueOnce(mockChild({
        stdout: 'Fetching available models...\ngemini-3.1-flash-low\tGemini 3.1 Flash (Low)\n',
      }))
      .mockImplementationOnce(() => mockChild({
        stdout: JSON.stringify({ result: 'dynamic', conversation_id: 'dynamic-1' }),
      }));

    const manager = freshManager();
    const catalog = await manager.getAvailableAgyModels();
    expect(catalog.map((model) => model.key)).toContain('gemini-3.1-flash-low');

    await expect(manager.getModelResponse('one', 'gemini-3.1-flash-low'))
      .resolves.toBe('dynamic');
    expect(spawnMock.mock.calls[1][1]).toEqual([
      '-p', 'one',
      '--model', 'gemini-3.1-flash-low',
      '--output-format', 'json',
      '--print-timeout', '120s',
    ]);
  });

  it('RED EO: retains third-party rows exactly as agy returned them instead of filtering or composing a tier', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      stdout: [
        'gemini-3.1-pro',
        'claude-sonnet-4-6',
        'gpt-oss-120b-medium',
      ].join('\n'),
    }));

    const manager = freshManager();
    const catalog = await manager.getAvailableAgyModels();

    expect(catalog.map((model) => model.agyModel)).toEqual([
      'gemini-3.1-pro',
      'claude-sonnet-4-6',
      'gpt-oss-120b-medium',
    ]);
    expect(catalog.map((model) => model.agyModel)).not.toContain('gemini-3.1-pro-medium');
  });

  it('GREEN EO: presents exactly the 14 raw TSV model rows, excluding the agy progress preamble', async () => {
    mockEnvironment({ desktop: false, agy: true });
    const rawRows: ReadonlyArray<readonly [string, string]> = [
      ['gemini-3.7-flash-high', 'Gemini 3.7 Flash (High)'],
      ['gemini-3.7-flash-medium', 'Gemini 3.7 Flash (Medium)'],
      ['gemini-3.7-flash-low', 'Gemini 3.7 Flash (Low)'],
      ['gemini-3.6-flash-high', 'Gemini 3.6 Flash (High)'],
      ['gemini-3.6-flash-medium', 'Gemini 3.6 Flash (Medium)'],
      ['gemini-3.6-flash-low', 'Gemini 3.6 Flash (Low)'],
      ['gemini-3.5-flash-high', 'Gemini 3.5 Flash (High)'],
      ['gemini-3.5-flash-medium', 'Gemini 3.5 Flash (Medium)'],
      ['gemini-3.5-flash-low', 'Gemini 3.5 Flash (Low)'],
      ['gemini-3.1-pro-high', 'Gemini 3.1 Pro (High)'],
      ['gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)'],
      ['claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)'],
      ['claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'],
      ['gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)'],
    ];
    spawnMock.mockReturnValue(mockChild({
      stdout: [
        'Fetching available models...',
        ...rawRows.map(([id, name]) => `${id}\t${name}`),
      ].join('\n'),
    }));

    const catalog = await freshManager().getAvailableAgyModels();

    expect(catalog.map(({ key, agyModel, displayName }) => ({ key, agyModel, displayName }))).toEqual(
      rawRows.map(([id, name]) => ({ key: id, agyModel: id, displayName: name })),
    );
    expect(catalog.map((model) => model.agyModel)).not.toContain('Fetching available models...');
  });

  it('caches the dynamic catalog for repeated reads', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      stdout: 'gemini-3.6-flash-high\ngemini-3.1-flash-low\n',
    }));

    const manager = freshManager();
    const first = await manager.getAvailableAgyModels();
    const second = await manager.getAvailableAgyModels();

    expect(second).toEqual(first);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate a static catalog when agy models fails', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({ code: 1, stderr: 'agy models unavailable' }));

    const manager = freshManager();
    await expect(manager.getAvailableAgyModels()).rejects.toThrow('agy models unavailable');
  });

  it('RED EU: classifies an 11-second agy models call as unknown timeout under a 10-second limit', async () => {
    vi.useFakeTimers();
    try {
      mockEnvironment({ desktop: false, agy: true });
      spawnMock.mockReturnValue(mockChild({
        stdout: 'Gemini 3.7 Flash (High)\n',
        closeDelayMs: 11_000,
      }));

      const resultPromise = freshManager().probeAgyLogin(10_000);
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(11_000);

      await expect(resultPromise).resolves.toMatchObject({
        state: 'unknown',
        reason: 'timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('GREEN EU: returns local logged-in state without invoking agy models', async () => {
    mockGeminiOAuthFiles();

    const result = await freshManager().probeAgyLogin();

    expect(result).toMatchObject({ state: 'logged-in' });
    expect(result.completionMs).toBeLessThan(1_000);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('GREEN EU: falls back to agy models when the local refresh token is missing', async () => {
    mockEnvironment({ desktop: false, agy: true });
    mockGeminiOAuthFiles({ refreshToken: null, includeAgy: true });
    spawnMock.mockReturnValue(mockChild({ stdout: 'Gemini 3.7 Flash (High)\n' }));

    const result = await freshManager().probeAgyLogin();

    expect(result).toMatchObject({ state: 'logged-in' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(['models']);
  });

  it('GREEN EU: falls back to agy models when local OAuth files are unreadable', async () => {
    mockEnvironment({ desktop: false, agy: true });
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockImplementation(() => {
      throw new Error('fixture unreadable');
    });
    spawnMock.mockReturnValue(mockChild({ stdout: 'Gemini 3.7 Flash (High)\n' }));

    const result = await freshManager().probeAgyLogin();

    expect(result).toMatchObject({ state: 'logged-in' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(['models']);
  });

  it('GREEN EU: accepts an 11-second agy models call under the new 30-second default', async () => {
    vi.useFakeTimers();
    try {
      mockEnvironment({ desktop: false, agy: true });
      vi.spyOn(AntigravityServerManager, 'getGeminiLoginProbe').mockReturnValue({
        state: 'logged-out',
        reason: 'credentials_missing',
        completionMs: 0,
      });
      spawnMock.mockReturnValue(mockChild({
        stdout: 'Gemini 3.7 Flash (High)\n',
        closeDelayMs: 11_000,
      }));

      const resultPromise = freshManager().probeAgyLogin();
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(11_000);

      await expect(resultPromise).resolves.toMatchObject({ state: 'logged-in' });
      expect(spawnMock.mock.calls[0]?.[1]).toEqual(['models']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('GREEN EU: keeps a real timeout unknown when agy models exceeds the new 30-second default', async () => {
    vi.useFakeTimers();
    try {
      mockEnvironment({ desktop: false, agy: true });
      vi.spyOn(AntigravityServerManager, 'getGeminiLoginProbe').mockReturnValue({
        state: 'logged-out',
        reason: 'credentials_missing',
        completionMs: 0,
      });
      const child = mockChild({
        stdout: 'Gemini 3.7 Flash (High)\n',
        closeDelayMs: 31_000,
      });
      spawnMock.mockReturnValue(child);

      const resultPromise = freshManager().probeAgyLogin();
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(31_000);

      await expect(resultPromise).resolves.toMatchObject({
        state: 'unknown',
        reason: 'timeout',
      });
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('GREEN EO: probes login with `agy models` only, never a prompt or effort flag', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({ stdout: 'Gemini 3.7 Flash (High)\n' }));

    const manager = freshManager();
    await expect(manager.probeAgyLogin()).resolves.toMatchObject({ state: 'logged-in' });

    const [, args, options] = spawnMock.mock.calls[0];
    expect(args).toEqual(['models']);
    expect(args).not.toContain('-p');
    expect(args).not.toContain('--effort');
    expect(options).toMatchObject({ stdio: ['ignore', 'pipe', 'pipe'] });
  });
});

describe('agy CLI process boundary', () => {
  it('detects CLI-only install and sends the raw one-shot model command', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      stdout: JSON.stringify({ result: 'pong', conversation_id: 'conv-1' }),
    }));

    const manager = freshManager();
    expect(AntigravityServerManager.isInstalled()).toBe(true);
    const response = await manager.getModelResponse(
      'Reply with one word: pong',
      'gemini-3.6-flash-high',
      2_000,
      'session-1',
    );

    expect(response).toBe('pong');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [binary, args] = spawnMock.mock.calls[0];
    expect(binary).toBe('/fixture/home/.local/bin/agy');
    expect(args).toEqual([
      '-p', 'Reply with one word: pong',
      '--model', 'gemini-3.6-flash-high',
      '--output-format', 'json',
      '--print-timeout', '2s',
    ]);
  });

  it('continues the same agy conversation on later calls', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValueOnce(mockChild({
      stdout: JSON.stringify({ result: 'first', session_id: 'conv-42' }),
    }));

    const manager = freshManager();
    await expect(manager.getModelResponse('one', 'gemini-3.6-flash-high', 2_000, 'session-2'))
      .resolves.toBe('first');
    spawnMock.mockReturnValueOnce(mockChild({
      stdout: JSON.stringify({ result: 'second' }),
    }));
    await expect(manager.getModelResponse('two', 'gemini-3.6-flash-high', 2_000, 'session-2'))
      .resolves.toBe('second');

    expect(spawnMock.mock.calls[1][1]).toEqual([
      '-p', 'two',
      '--conversation', 'conv-42',
      '--output-format', 'json',
      '--print-timeout', '2s',
    ]);
  });

  it('RED EO: sends an unlisted explicit model to agy unchanged instead of host-rejecting it', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      code: 1,
      stderr: 'Print mode: invalid --model "future-engine-model"',
    }));
    const manager = freshManager();

    const error = await manager.getModelResponse('one', 'future-engine-model')
      .catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityAgyModelError);
    expect(spawnMock).toHaveBeenCalledWith(
      '/fixture/home/.local/bin/agy',
      expect.arrayContaining(['--model', 'future-engine-model']),
      expect.any(Object),
    );
  });

  it('does not mistake agy’s invalid-model list for a model reply', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      code: 1,
      stderr: 'Print mode: invalid --model "gemini-3.6-flash-high"\nAvailable models:\n  Gemini 3.6 Flash (High)',
    }));
    const manager = freshManager();

    const error = await manager.getModelResponse('one', 'gemini-3.6-flash-high').catch((err) => err);
    expect(error).toMatchObject({ name: 'AntigravityAgyModelError' });
    expect(error).toHaveProperty('message', expect.stringMatching(/model list is not a response/));
  });

  it('reports a missing CLI as not installed', async () => {
    mockEnvironment({ desktop: false, agy: false });
    const manager = freshManager();

    await expect(manager.getModelResponse('one', 'gemini-3.6-flash-high'))
      .rejects.toBeInstanceOf(AntigravityAgyNotInstalledError);
    await expect(manager.getModelResponse('one', 'gemini-3.6-flash-high'))
      .rejects.toThrow(/未安装/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('surfaces agy auth failure with the terminal-login guidance', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      code: 1,
      stderr: 'not authenticated: run agy login in a terminal',
    }));
    const manager = freshManager();

    const error = await manager.getModelResponse('one', 'gemini-3.6-flash-high').catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityAgyNotLoggedInError);
    expect(error).toHaveProperty('message', expect.stringMatching(/终端登录 antigravity/));
  });

  it('uses desktop binary before agy when both are present', () => {
    mockEnvironment({ desktop: true, agy: true });
    expect(AntigravityServerManager.binaryPath())
      .toBe('/fixture/Antigravity.app/language_server');
    expect(AntigravityServerManager.isInstalled()).toBe(true);
  });

  it('keeps the per-user agy path before PATH fallback candidates', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/fixture/bin:/another/bin';
    try {
      const candidates = AntigravityServerManager.agyPathCandidates();
      expect(candidates[0]).toMatch(/\.local\/bin\/agy$/);
      expect(candidates).toContain('/fixture/bin/agy');
      expect(candidates).toContain('/another/bin/agy');
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it('GREEN EO: keeps an expired access token logged in when the Gemini refresh token exists', () => {
    const values: Record<string, string> = {
      '/fixture/home/.gemini/settings.json': JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }),
      '/fixture/home/.gemini/google_accounts.json': JSON.stringify({ active: 'account@example.com' }),
      '/fixture/home/.gemini/oauth_creds.json': JSON.stringify({
        access_token: 'expired-access-token',
        expiry: '2020-01-01T00:00:00.000Z',
        refresh_token: 'refresh-token-is-long-enough',
      }),
    };
    expect(probeGeminiOAuthFiles({
      homedir: () => '/fixture/home',
      existsSync: (candidate) => candidate in values,
      readFileSync: (candidate) => values[candidate]!,
    })).toBe('logged-in');
  });

  it('does not pass credential environment variables or tokens to agy', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      stdout: JSON.stringify({ result: 'pong', conversation_id: 'conv-env' }),
    }));
    const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
    const originalAntigravityToken = process.env.ANTIGRAVITY_ACCESS_TOKEN;
    process.env.GOOGLE_API_KEY = 'must-not-cross-boundary';
    process.env.ANTIGRAVITY_ACCESS_TOKEN = 'must-not-cross-boundary';
    try {
      const manager = freshManager();
      await expect(manager.getModelResponse('one', 'gemini-3.6-flash-high'))
        .resolves.toBe('pong');
      const options = spawnMock.mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
      expect(options.env?.GOOGLE_API_KEY).toBeUndefined();
      expect(options.env?.ANTIGRAVITY_ACCESS_TOKEN).toBeUndefined();
      expect(options.env?.HOME).toBe(process.env.HOME);
    } finally {
      if (originalGoogleApiKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = originalGoogleApiKey;
      if (originalAntigravityToken === undefined) delete process.env.ANTIGRAVITY_ACCESS_TOKEN;
      else process.env.ANTIGRAVITY_ACCESS_TOKEN = originalAntigravityToken;
    }
  });

  it('kills a hung print process at the outer timeout', async () => {
    mockEnvironment({ desktop: false, agy: true });
    const child = mockChild({ close: false });
    spawnMock.mockReturnValue(child);
    const manager = freshManager();

    const error = await manager.getModelResponse('one', 'gemini-3.6-flash-high', 10)
      .catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityAgyTimeoutError);
    expect(error).toMatchObject({
      name: 'AntigravityAgyTimeoutError',
      message: expect.stringMatching(
        /^agy print mode timed out after \d+s \(\d+ms elapsed; limit 1s\)$/,
      ),
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

import { EventEmitter } from 'events';
import * as fs from 'fs';
import type { ChildProcess } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

import { spawn } from 'child_process';
import {
  AGY_MODEL_MAP,
  AntigravityAgyModelError,
  AntigravityAgyNotInstalledError,
  AntigravityAgyNotLoggedInError,
  AntigravityAgyTimeoutError,
  AntigravityServerManager,
  mapAgyModel,
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

function mockChild({ stdout = '', stderr = '', code = 0, close = true } = {}): MockChild {
  const child = new EventEmitter() as unknown as MockChild;
  child.stdout = new EventEmitter() as unknown as MockChild['stdout'];
  child.stderr = new EventEmitter() as unknown as MockChild['stderr'];
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    if (close) child.emit('close', code);
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

describe('agy CLI model mapping', () => {
  it('maps the extension model keys to real agy model ids', () => {
    expect(AGY_MODEL_MAP).toEqual({
      'gemini-3-flash-agent': 'gemini-3.6-flash-high',
      'gemini-3.5-flash-low': 'gemini-3.6-flash-medium',
      'gemini-3.5-flash-extra-low': 'gemini-3.6-flash-low',
    });
    expect(mapAgyModel('gemini-3-flash-agent')).toBe('gemini-3.6-flash-high');
  });
});

describe('agy CLI dynamic model catalog', () => {
  it('discovers a new agy model and maps it for a request', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock
      .mockReturnValueOnce(mockChild({
        stdout: 'Available models:\n  gemini-3.1-flash-low\n',
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

  it('falls back to the existing static catalog when agy models fails', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({ code: 1, stderr: 'agy models unavailable' }));

    const manager = freshManager();
    await expect(manager.getAvailableAgyModels()).resolves.toEqual([
      expect.objectContaining({ key: 'gemini-3-flash-agent', agyModel: 'gemini-3.6-flash-high' }),
      expect.objectContaining({ key: 'gemini-3.5-flash-low', agyModel: 'gemini-3.6-flash-medium' }),
      expect.objectContaining({ key: 'gemini-3.5-flash-extra-low', agyModel: 'gemini-3.6-flash-low' }),
    ]);
  });
});

describe('agy CLI process boundary', () => {
  it('detects CLI-only install and sends the mapped one-shot command', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      stdout: JSON.stringify({ result: 'pong', conversation_id: 'conv-1' }),
    }));

    const manager = freshManager();
    expect(AntigravityServerManager.isInstalled()).toBe(true);
    const response = await manager.getModelResponse(
      'Reply with one word: pong',
      'gemini-3-flash-agent',
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
    await expect(manager.getModelResponse('one', 'gemini-3-flash-agent', 2_000, 'session-2'))
      .resolves.toBe('first');
    spawnMock.mockReturnValueOnce(mockChild({
      stdout: JSON.stringify({ result: 'second' }),
    }));
    await expect(manager.getModelResponse('two', 'gemini-3-flash-agent', 2_000, 'session-2'))
      .resolves.toBe('second');

    expect(spawnMock.mock.calls[1][1]).toEqual([
      '-p', 'two',
      '--conversation', 'conv-42',
      '--output-format', 'json',
      '--print-timeout', '2s',
    ]);
  });

  it('does not spawn when the extension model has no agy mapping', async () => {
    mockEnvironment({ desktop: false, agy: true });
    const manager = freshManager();

    const error = await manager.getModelResponse('one', 'gemini-model-that-does-not-exist')
      .catch((err) => err);
    expect(error).toBeInstanceOf(AntigravityAgyModelError);
    expect(error).toHaveProperty(
      'message',
      expect.stringContaining(
        'supported extension models: gemini-3-flash-agent, gemini-3.5-flash-low, gemini-3.5-flash-extra-low',
      ),
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('does not mistake agy’s invalid-model list for a model reply', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockChild({
      code: 1,
      stderr: 'Print mode: invalid --model "gemini-3.6-flash-high"\nAvailable models:\n  Gemini 3.6 Flash (High)',
    }));
    const manager = freshManager();

    const error = await manager.getModelResponse('one', 'gemini-3-flash-agent').catch((err) => err);
    expect(error).toMatchObject({ name: 'AntigravityAgyModelError' });
    expect(error).toHaveProperty('message', expect.stringMatching(/model list is not a response/));
  });

  it('reports a missing CLI as not installed', async () => {
    mockEnvironment({ desktop: false, agy: false });
    const manager = freshManager();

    await expect(manager.getModelResponse('one', 'gemini-3-flash-agent'))
      .rejects.toBeInstanceOf(AntigravityAgyNotInstalledError);
    await expect(manager.getModelResponse('one', 'gemini-3-flash-agent'))
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

    const error = await manager.getModelResponse('one', 'gemini-3-flash-agent').catch((err) => err);
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

  it('probes the agy OAuth file read-only and rejects an expired access-only token', () => {
    const tokenPathSuffix = '/.gemini/antigravity-cli/antigravity-oauth-token';
    existsSyncMock.mockImplementation((candidate) => String(candidate).endsWith(tokenPathSuffix));
    readFileSyncMock.mockReturnValue(JSON.stringify({
      token: {
        access_token: 'redacted-test-token',
        expiry: '2020-01-01T00:00:00.000Z',
      },
    }));
    expect(AntigravityServerManager.hasAgyAuth()).toBe(false);
    expect(readFileSyncMock).toHaveBeenCalledWith(expect.stringContaining(tokenPathSuffix), 'utf8');
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
      await expect(manager.getModelResponse('one', 'gemini-3-flash-agent'))
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

    const error = await manager.getModelResponse('one', 'gemini-3-flash-agent', 10)
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

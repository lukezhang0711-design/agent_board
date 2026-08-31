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
  type AntigravityEndpoint,
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
  stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
};

const spawnMock = vi.fn();
const existsSyncMock = vi.mocked(fs.existsSync);
const readFileSyncMock = vi.mocked(fs.readFileSync);

function freshManager(): AntigravityServerManager {
  (AntigravityServerManager as unknown as { instance: unknown }).instance = null;
  return new AntigravityServerManager(spawnMock as unknown as typeof spawn);
}

function withPlatform(platform: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => {
    if (descriptor) Object.defineProperty(process, 'platform', descriptor);
  };
}

type DiscoveryTestManager = {
  discoverRunningHub(): Promise<AntigravityEndpoint | null>;
  currentEndpoint(): AntigravityEndpoint | null;
  stop(): void;
  runCommand: ReturnType<typeof vi.fn>;
  isHealthy: ReturnType<typeof vi.fn>;
};

function discoveryManager(): DiscoveryTestManager {
  const manager = freshManager() as unknown as DiscoveryTestManager;
  manager.runCommand = vi.fn(async (command: string) => {
    if (command === 'ps') {
      return [
        ' 5375 /Applications/Antigravity.app/Contents/Resources/bin/language_server --standalone --subclient_type hub --csrf_token csrf-mac --https_server_port 0',
        ' 9999 /usr/bin/other_process',
      ].join('\n');
    }
    if (command === 'lsof') {
      return [
        'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
        'language 5375 luke   42u  IPv4      0      0t0  TCP 127.0.0.1:57558 (LISTEN)',
        'language 5375 luke   43u  IPv4      0      0t0  TCP 127.0.0.1:57557 (LISTEN)',
      ].join('\n');
    }
    return '';
  });
  manager.isHealthy = vi.fn(async () => true);
  return manager;
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
  child.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
  }) as MockChild['stdin'];
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

function mockStreamChild({
  conversationId = 'conv-stream',
  responseForInput,
  emitInit = true,
}: {
  conversationId?: string;
  responseForInput: (line: string, child: MockChild, turn: number) => void;
  emitInit?: boolean;
}): MockChild {
  const child = mockChild({ close: false });
  let buffered = '';
  let turn = 0;
  child.stdin.write.mockImplementation((chunk: Buffer | string) => {
    buffered += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    let idx: number;
    while ((idx = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, idx);
      buffered = buffered.slice(idx + 1);
      if (!line.trim()) continue;
      turn += 1;
      responseForInput(line, child, turn);
    }
    return true;
  });
  child.stdin.end.mockImplementation(() => {
    child.emit('close', 0);
  });
  if (emitInit) {
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        event: 'init',
        conversation_id: conversationId,
        init: { permission_mode: 'always-proceed' },
      }) + '\n'));
    });
  }
  return child;
}

function emitStreamResult(child: MockChild, conversationId: string, response: string): void {
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    event: 'result',
    result: {
      conversation_id: conversationId,
      status: 'SUCCESS',
      response,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 2,
      },
    },
  }) + '\n'));
}

function emitStreamErrorResult(child: MockChild, message: string, conversationId = ''): void {
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    event: 'result',
    result: {
      conversation_id: conversationId,
      status: 'ERROR',
      response: '',
      error: message,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
      },
    },
  }) + '\n'));
}

function expectDefaultStreamArgs(args: unknown, model = 'gemini-3.6-flash-high'): void {
  expect(args).toEqual([
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--print-timeout', '1500s',
    '--model', model,
    '--print=',
  ]);
}

beforeEach(() => {
  spawnMock.mockReset();
  existsSyncMock.mockReset();
  readFileSyncMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('desktop hub discovery', () => {
  it('RED FP: discovers a running macOS hub instead of returning null on non-Windows', async () => {
    const restorePlatform = withPlatform('darwin');
    try {
      const manager = discoveryManager();

      await expect(manager.discoverRunningHub()).resolves.toEqual({
        httpsPort: 57557,
        csrf: 'csrf-mac',
        owned: false,
      });
      expect(manager.runCommand).toHaveBeenCalledWith('ps', ['-axo', 'pid=,command=']);
      expect(manager.runCommand).toHaveBeenCalledWith('lsof', [
        '-nP',
        '-iTCP',
        '-sTCP:LISTEN',
        '-a',
        '-p',
        '5375',
      ]);
    } finally {
      restorePlatform();
    }
  });

  it('GREEN FP: rejects a discovered macOS hub when Heartbeat is unhealthy', async () => {
    const restorePlatform = withPlatform('darwin');
    try {
      const manager = discoveryManager();
      manager.isHealthy.mockResolvedValue(false);

      await expect(manager.discoverRunningHub()).resolves.toBeNull();
      expect(manager.isHealthy).toHaveBeenCalledWith({
        httpsPort: 57557,
        csrf: 'csrf-mac',
        owned: false,
      });
      expect(manager.currentEndpoint()).toBeNull();
    } finally {
      restorePlatform();
    }
  });

  it('GREEN FP: attaches to a discovered macOS hub as unowned and stop does not kill it', async () => {
    const restorePlatform = withPlatform('darwin');
    try {
      const manager = discoveryManager();

      const endpoint = await manager.discoverRunningHub();

      expect(endpoint).toEqual({ httpsPort: 57557, csrf: 'csrf-mac', owned: false });
      expect(manager.currentEndpoint()).toEqual(endpoint);
      expect((manager as unknown as { child: unknown }).child).toBeNull();
      manager.stop();
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it('GREEN FP: keeps Windows PowerShell discovery behavior and selects the lower HTTPS port', async () => {
    const restorePlatform = withPlatform('win32');
    try {
      const manager = freshManager() as unknown as {
        discoverRunningHub(): Promise<AntigravityEndpoint | null>;
        runPowerShell: ReturnType<typeof vi.fn>;
        isHealthy: ReturnType<typeof vi.fn>;
      };
      manager.runPowerShell = vi.fn(async () => 'csrf-win|57558,57557');
      manager.isHealthy = vi.fn(async () => true);

      await expect(manager.discoverRunningHub()).resolves.toEqual({
        httpsPort: 57557,
        csrf: 'csrf-win',
        owned: false,
      });
      expect(manager.runPowerShell).toHaveBeenCalledOnce();
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });
});

describe('agy CLI dynamic model catalog', () => {
  it('discovers a new agy model and forwards that exact value for a request', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock
      .mockReturnValueOnce(mockChild({
        stdout: 'Fetching available models...\ngemini-3.1-flash-low\tGemini 3.1 Flash (Low)\n',
      }))
      .mockImplementationOnce(() => mockStreamChild({
        conversationId: 'dynamic-1',
        responseForInput: (_line, child) => {
          queueMicrotask(() => emitStreamResult(child, 'dynamic-1', 'dynamic'));
        },
      }));

    const manager = freshManager();
    const catalog = await manager.getAvailableAgyModels();
    expect(catalog.map((model) => model.key)).toContain('gemini-3.1-flash-low');

    await expect(manager.getModelResponse('one', 'gemini-3.1-flash-low'))
      .resolves.toBe('dynamic');
    expectDefaultStreamArgs(spawnMock.mock.calls[1][1], 'gemini-3.1-flash-low');
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
  it('detects CLI-only install and sends the raw stream-json model command', async () => {
    mockEnvironment({ desktop: false, agy: true });
    const streamChild = mockStreamChild({
      conversationId: 'conv-1',
      responseForInput: (_line, child) => {
        queueMicrotask(() => emitStreamResult(child, 'conv-1', 'pong'));
      },
    });
    spawnMock.mockReturnValue(streamChild);

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
    expectDefaultStreamArgs(args);
    expect(streamChild.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'user',
        message: { role: 'user', content: 'Reply with one word: pong' },
      }) + '\n',
    );
  });

  it('green EX-3c: forwards Gemini’s actual agy mode and permission-skip flags', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockStreamChild({
      conversationId: 'conv-policy',
      responseForInput: (_line, child) => {
        queueMicrotask(() => emitStreamResult(child, 'conv-policy', 'policy applied'));
      },
    }));

    const manager = freshManager();
    await expect(manager.getModelResponse(
      'read the workspace',
      'gemini-3.6-flash-high',
      2_000,
      'session-policy',
      '/tmp/workspace',
      { mode: 'plan', dangerouslySkipPermissions: true },
    )).resolves.toBe('policy applied');

    expect(spawnMock.mock.calls[0][1]).toEqual([
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--print-timeout', '1500s',
      '--model', 'gemini-3.6-flash-high',
      '--mode', 'plan',
      '--dangerously-skip-permissions',
      '--print=',
    ]);
  });

  it('GREEN FF-137: restarts a killed stream process with --conversation for the next turn', async () => {
    mockEnvironment({ desktop: false, agy: true });
    const firstChild = mockStreamChild({
      conversationId: 'conv-42',
      responseForInput: (_line, child) => {
        queueMicrotask(() => emitStreamResult(child, 'conv-42', 'first'));
      },
    });
    spawnMock
      .mockReturnValueOnce(firstChild)
      .mockImplementationOnce(() => mockStreamChild({
        conversationId: 'conv-42',
        responseForInput: (_line, child) => {
          queueMicrotask(() => emitStreamResult(child, 'conv-42', 'second'));
        },
      }));

    const manager = freshManager();
    await expect(manager.getModelResponse('one', 'gemini-3.6-flash-high', 2_000, 'session-2'))
      .resolves.toBe('first');
    firstChild.emit('close', 1);
    await expect(manager.getModelResponse('two', 'gemini-3.6-flash-high', 2_000, 'session-2'))
      .resolves.toBe('second');

    expect(spawnMock.mock.calls[1][1]).toEqual([
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--print-timeout', '1500s',
      '--conversation', 'conv-42',
      '--print=',
    ]);
  });

  it('GREEN FF-137: keeps an active stream-json turn alive past the old 180-second print wall', async () => {
    vi.useFakeTimers();
    try {
      mockEnvironment({ desktop: false, agy: true });
      const child = mockStreamChild({
        conversationId: 'conv-active',
        responseForInput: (_line, streamChild) => {
          setTimeout(() => {
            streamChild.stdout.emit('data', Buffer.from(JSON.stringify({
              event: 'step_update',
              step_update: {
                conversation_id: 'conv-active',
                step_index: 1,
                state: 'ACTIVE',
                step_type: 'agent_response',
                text_delta: 'still working',
              },
            }) + '\n'));
          }, 90_000);
          setTimeout(() => {
            emitStreamResult(streamChild, 'conv-active', 'finished after old wall');
          }, 181_000);
        },
      });
      spawnMock.mockReturnValue(child);

      const resultPromise = freshManager().getModelResponse(
        'slow active turn',
        'gemini-3.6-flash-high',
        180_000,
        'session-active',
      );
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(90_000);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(91_000);

      await expect(resultPromise).resolves.toBe('finished after old wall');
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('GREEN FF-137: reuses one stream-json agy process for multiple turns in the same session', async () => {
    mockEnvironment({ desktop: false, agy: true });
    const streamChild = mockStreamChild({
      conversationId: 'conv-reuse',
      responseForInput: (_line, child, turn) => {
        queueMicrotask(() => {
          emitStreamResult(child, 'conv-reuse', turn === 1 ? 'first' : 'second');
        });
      },
    });
    spawnMock.mockImplementation((_binary, args) => {
      if (Array.isArray(args) && args.includes('--input-format')) {
        return streamChild;
      }
      return mockChild({
        stdout: JSON.stringify({
          result: spawnMock.mock.calls.length === 1 ? 'first' : 'second',
          conversation_id: 'conv-reuse',
        }),
      });
    });

    const manager = freshManager();
    await expect(manager.getModelResponse('one', 'gemini-3.6-flash-high', 2_000, 'session-reuse'))
      .resolves.toBe('first');
    await expect(manager.getModelResponse('two', 'gemini-3.6-flash-high', 2_000, 'session-reuse'))
      .resolves.toBe('second');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(streamChild.stdin.write).toHaveBeenCalledTimes(2);
    expectDefaultStreamArgs(spawnMock.mock.calls[0][1]);
  });

  it('RED EO: sends an unlisted explicit model to agy unchanged instead of host-rejecting it', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock.mockReturnValue(mockStreamChild({
      conversationId: 'conv-invalid',
      responseForInput: (_line, child) => {
        queueMicrotask(() => {
          emitStreamErrorResult(child, 'Print mode: invalid --model "future-engine-model"');
          child.emit('close', 1);
        });
      },
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
    spawnMock.mockReturnValue(mockStreamChild({
      conversationId: 'conv-invalid',
      responseForInput: (_line, child) => {
        queueMicrotask(() => {
          emitStreamErrorResult(
            child,
            'Print mode: invalid --model "gemini-3.6-flash-high"\nAvailable models:\n  Gemini 3.6 Flash (High)',
          );
          child.emit('close', 1);
        });
      },
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
    spawnMock.mockReturnValue(mockStreamChild({
      conversationId: 'conv-auth',
      responseForInput: (_line, child) => {
        queueMicrotask(() => {
          emitStreamErrorResult(child, 'not authenticated: run agy login in a terminal');
          child.emit('close', 1);
        });
      },
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
    spawnMock.mockReturnValue(mockStreamChild({
      conversationId: 'conv-env',
      responseForInput: (_line, child) => {
        queueMicrotask(() => emitStreamResult(child, 'conv-env', 'pong'));
      },
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

  it('GREEN FF-137: reports a no-activity timeout when stream-json emits no turn events', async () => {
    vi.useFakeTimers();
    try {
      mockEnvironment({ desktop: false, agy: true });
      const child = mockStreamChild({
        conversationId: 'conv-idle',
        responseForInput: () => {
          /* stay silent after receiving the turn */
        },
      });
      spawnMock.mockReturnValue(child);
      const manager = freshManager();

      const errorPromise = manager.getModelResponse('one', 'gemini-3.6-flash-high', 10_000)
        .catch((err) => err);
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(240_000);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(AntigravityAgyTimeoutError);
      expect(error).toMatchObject({
        name: 'AntigravityAgyTimeoutError',
        message: expect.stringMatching(/无活动超时/),
      });
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('GREEN FF-137: reports a total-duration timeout separately from no-activity timeout', async () => {
    vi.useFakeTimers();
    try {
      mockEnvironment({ desktop: false, agy: true });
      const child = mockStreamChild({
        conversationId: 'conv-total',
        responseForInput: (_line, streamChild) => {
          for (let elapsed = 60_000; elapsed < 1_500_000; elapsed += 60_000) {
            setTimeout(() => {
              streamChild.stdout.emit('data', Buffer.from(JSON.stringify({
                event: 'step_update',
                step_update: {
                  conversation_id: 'conv-total',
                  state: 'ACTIVE',
                  step_type: 'agent_response',
                  text_delta: '.',
                },
              }) + '\n'));
            }, elapsed);
          }
        },
      });
      spawnMock.mockReturnValue(child);
      const manager = freshManager();

      const errorPromise = manager.getModelResponse('one', 'gemini-3.6-flash-high', 10_000)
        .catch((err) => err);
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(1_500_000);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(AntigravityAgyTimeoutError);
      expect(error).toMatchObject({
        name: 'AntigravityAgyTimeoutError',
        message: expect.stringMatching(/总时长超限/),
      });
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('GREEN FF-137: falls back visibly to one-shot mode when stream-json cannot start', async () => {
    mockEnvironment({ desktop: false, agy: true });
    spawnMock
      .mockImplementationOnce(() => mockChild({
        code: 2,
        stderr: 'flag provided but not defined: --input-format',
      }))
      .mockImplementationOnce(() => mockChild({
        stdout: JSON.stringify({ result: 'fallback answer', conversation_id: 'conv-fallback' }),
      }));

    const response = await freshManager().getModelResponse(
      'one',
      'gemini-3.6-flash-high',
      10_000,
      'session-fallback',
    );

    expect(response).toBe('已回落一句话模式\n\nfallback answer');
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1][1]).toEqual([
      '-p', 'one',
      '--model', 'gemini-3.6-flash-high',
      '--output-format', 'json',
      '--print-timeout', '1500s',
    ]);
  });
});

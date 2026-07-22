import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, resolveSharedExecutableMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  resolveSharedExecutableMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../CLIManager', () => ({
  getEnhancedPath: () => '/test/bin:/usr/bin',
}));

vi.mock('@nimbalyst/runtime/electron/claudeCodeEnvironment', () => ({
  resolveClaudeCodeExecutablePath: resolveSharedExecutableMock,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    main: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

import { buildClaudeCliCommand, ClaudeAuthStateService } from '../ClaudeAuthStateService';

const loggedInJson = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'person@example.com',
  orgName: 'Example',
  subscriptionType: 'pro',
});

function result(
  stdout: string,
  exitCode = 0,
  error?: Error & { code?: string | number; killed?: boolean; signal?: string | null },
) {
  return { stdout, stderr: '', exitCode, error };
}

describe('ClaudeAuthStateService', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    resolveSharedExecutableMock.mockReset().mockReturnValue('/bundled/claude');
  });

  it('accepts logged-in only when auth method and API provider are present', async () => {
    const service = new ClaudeAuthStateService({
      now: () => 100,
      runAuthStatus: async () => result(loggedInJson),
    });

    await expect(service.getState()).resolves.toMatchObject({
      status: 'logged-in',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'person@example.com',
    });
  });

  it('wraps a Windows npm claude.cmd shim with cmd.exe for auth status', () => {
    const command = buildClaudeCliCommand(['auth', 'status', '--json'], {
      platform: 'win32',
      homedir: 'C:\\Users\\me',
      enhancedPath: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Windows\\System32',
      appData: 'C:\\Users\\me\\AppData\\Roaming',
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
      preferredExecutable: 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
      pathExists: () => true,
    });

    expect(command).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd" "auth" "status" "--json""',
      ],
    });
  });

  it.each([
    { loggedIn: true, apiProvider: 'firstParty' },
    { loggedIn: true, authMethod: 'claude.ai' },
    { loggedIn: true, authMethod: 'none', apiProvider: 'firstParty' },
    { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'none' },
  ])('does not trust loggedIn=true alone: %j', async (payload) => {
    const service = new ClaudeAuthStateService({
      runAuthStatus: async () => result(JSON.stringify(payload)),
    });

    await expect(service.getState()).resolves.toMatchObject({ status: 'check-failed' });
  });

  it('maps a complete logged-out payload to logged-out', async () => {
    const service = new ClaudeAuthStateService({
      runAuthStatus: async () => result(JSON.stringify({
        loggedIn: false,
        authMethod: 'none',
        apiProvider: 'firstParty',
      })),
    });

    await expect(service.getState()).resolves.toMatchObject({ status: 'logged-out' });
  });

  it.each([
    ['timeout', result('', 1, Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: true }))],
    ['non-zero exit', result(loggedInJson, 2)],
    ['damaged output', result('{not-json')],
  ])('maps %s to check-failed, never a login conclusion', async (_label, commandResult) => {
    const service = new ClaudeAuthStateService({
      runAuthStatus: async () => commandResult,
    });

    const state = await service.getState();
    expect(state.status).toBe('check-failed');
    expect(state.status).not.toBe('logged-in');
    expect(state.status).not.toBe('logged-out');
  });

  it('maps a command runner error to check-failed', async () => {
    const service = new ClaudeAuthStateService({
      runAuthStatus: async () => { throw new Error('spawn failed'); },
    });

    await expect(service.getState()).resolves.toMatchObject({
      status: 'check-failed',
      error: expect.stringContaining('spawn failed'),
    });
  });

  it('shares one in-flight check and reuses it within TTL', async () => {
    let resolveCommand!: (value: ReturnType<typeof result>) => void;
    const runAuthStatus = vi.fn(() => new Promise<ReturnType<typeof result>>((resolve) => {
      resolveCommand = resolve;
    }));
    let now = 100;
    const service = new ClaudeAuthStateService({ now: () => now, runAuthStatus });

    const first = service.getState();
    const second = service.getState();
    resolveCommand(result(loggedInJson));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await service.getState();
    expect(runAuthStatus).toHaveBeenCalledTimes(1);

    now += 30_001;
    runAuthStatus.mockResolvedValueOnce(result(loggedInJson));
    await service.getState();
    expect(runAuthStatus).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached state and forces the next call to re-check', async () => {
    const runAuthStatus = vi.fn().mockResolvedValue(result(loggedInJson));
    const service = new ClaudeAuthStateService({ runAuthStatus });

    await service.getState();
    service.invalidate();
    expect(service.getCachedState()).toMatchObject({ status: 'unknown', checkedAt: null });
    await service.getState();
    expect(runAuthStatus).toHaveBeenCalledTimes(2);
  });

  it('does not return a stale in-flight result after invalidation', async () => {
    let resolveFirst!: (value: ReturnType<typeof result>) => void;
    const runAuthStatus = vi.fn()
      .mockImplementationOnce(() => new Promise<ReturnType<typeof result>>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(result(JSON.stringify({
        loggedIn: false,
        authMethod: 'none',
        apiProvider: 'firstParty',
      })));
    const service = new ClaudeAuthStateService({ runAuthStatus });

    const staleCall = service.getState();
    service.invalidate();
    const currentCall = service.getState();
    await expect(currentCall).resolves.toMatchObject({ status: 'logged-out' });
    resolveFirst(result(loggedInJson));

    await expect(staleCall).resolves.toMatchObject({ status: 'logged-out' });
    expect(runAuthStatus).toHaveBeenCalledTimes(2);
  });

  it('runs claude auth status --json with inherited credential variables removed', async () => {
    const previous = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      CLAUDE_CODE_OAUTH_REFRESH_TOKEN: process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN,
      CLAUDECODE: process.env.CLAUDECODE,
    };
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: 'api-key',
      ANTHROPIC_AUTH_TOKEN: 'auth-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
      CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh-token',
      CLAUDECODE: '1',
    });
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, loggedInJson, '');
    });

    try {
      const service = new ClaudeAuthStateService();
      await service.getState();

      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [file, args, options] = execFileMock.mock.calls[0];
      expect(file).toBe('/bundled/claude');
      expect(args).toEqual(['auth', 'status', '--json']);
      expect(resolveSharedExecutableMock).toHaveBeenCalledWith({
        pathValue: '/test/bin:/usr/bin',
        allowSystemFallback: true,
      });
      expect(options).toMatchObject({ timeout: 10_000 });
      expect(options.env).toMatchObject({ PATH: '/test/bin:/usr/bin' });
      expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(options.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();
      expect(options.env.CLAUDECODE).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('maps a timeout from the real execFile adapter to check-failed', async () => {
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      expect(options.timeout).toBe(10_000);
      callback(Object.assign(new Error('command timed out'), {
        code: 'ETIMEDOUT',
        killed: true,
        signal: 'SIGTERM',
      }), '', '');
    });

    const service = new ClaudeAuthStateService();

    await expect(service.getState()).resolves.toMatchObject({
      status: 'check-failed',
      error: expect.stringContaining('timed out after 10000ms'),
    });
  });
});

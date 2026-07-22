import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../ClaudeAuthStateService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ClaudeAuthStateService')>();
  return {
    ...actual,
    claudeAuthStateService: {
      getState: vi.fn().mockResolvedValue({
        status: 'unknown',
        source: 'claude-cli-auth-status',
        checkedAt: null,
      }),
    },
  };
});

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

import { ClaudeUsageServiceImpl } from '../ClaudeUsageService';
import { ClaudeAuthStateService, type ClaudeAuthState } from '../ClaudeAuthStateService';

const loggedInState: ClaudeAuthState = {
  status: 'logged-in',
  source: 'claude-cli-auth-status',
  checkedAt: 100,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function successResponse(utilization = 21): Response {
  return jsonResponse({
    five_hour: {
      utilization,
      resets_at: '2026-07-22T12:00:00.000Z',
    },
  });
}

function unauthorizedResponse(): Response {
  return jsonResponse({ error: { message: 'Invalid authentication credentials' } }, 401);
}

type KeychainRound = Record<string, string | null>;

function makeKeychainExec(rounds: KeychainRound[]) {
  let callIndex = 0;
  return vi.fn((file, args: readonly string[], _options, callback) => {
    if (file !== 'security') {
      queueMicrotask(() => callback(null, JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0,
      }), ''));
      return;
    }
    const serviceName = args[2];
    const roundIndex = Math.min(Math.floor(callIndex / 2), rounds.length - 1);
    callIndex += 1;
    const token = rounds[roundIndex]?.[serviceName];
    queueMicrotask(() => {
      if (!token) {
        callback(Object.assign(new Error('The specified item could not be found.'), { code: 44 }), '', '');
        return;
      }
      callback(null, JSON.stringify({ claudeAiOauth: { accessToken: token } }), '');
    });
  });
}

function authReader(state: ClaudeAuthState) {
  return { getState: vi.fn().mockResolvedValue(state) };
}

function bearerTokens(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([, init]) => (
    (init?.headers as Record<string, string>).Authorization.replace('Bearer ', '')
  ));
}

describe('ClaudeUsageService authentication recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('crosses CLI JSON state and Usage 401 end-to-end without changing logged-in state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorizedResponse());
    const runAuthStatus = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
      }),
      stderr: '',
      exitCode: 0,
    });
    const authStateService = new ClaudeAuthStateService({ runAuthStatus, now: () => 100 });
    const getState = vi.spyOn(authStateService, 'getState');
    const execFileFn = makeKeychainExec([
      { 'Claude Code-credentials': 'same-token', 'Claude Code': null },
      { 'Claude Code-credentials': 'same-token', 'Claude Code': null },
    ]);
    const service = new ClaudeUsageServiceImpl({
      platform: 'darwin',
      execFileFn,
      fetchFn: fetchMock,
      authStateService,
      claudeExecutable: '/test/bin/claude',
      cliBaseEnv: {
        PATH: '/test/bin:/usr/bin',
        ANTHROPIC_API_KEY: 'must-not-leak',
        ANTHROPIC_AUTH_TOKEN: 'must-not-leak',
        CLAUDE_CODE_OAUTH_TOKEN: 'must-not-leak',
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'must-not-leak',
        CLAUDECODE: '1',
      },
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const usage = await service.refresh();

    expect(usage.error).toContain('Usage authorization failed');
    expect(usage.error).toContain('Claude Code is logged in');
    expect(usage.error).not.toContain('re-login');
    expect(getState).toHaveBeenCalledWith({ forceRefresh: true });
    expect(authStateService.getCachedState()).toMatchObject({ status: 'logged-in' });
    expect(runAuthStatus).toHaveBeenCalledOnce();
    expect(bearerTokens(fetchMock)).toEqual(['same-token', 'same-token']);

    const cliCall = execFileFn.mock.calls.find(([file]) => file === '/test/bin/claude');
    expect(cliCall?.[1]).toEqual([
      '--safe-mode',
      '--tools',
      '',
      '--no-session-persistence',
      '--output-format',
      'json',
      '-p',
      '/usage',
    ]);
    expect(cliCall?.[2]).toMatchObject({ timeout: 30_000 });
    expect(cliCall?.[2].env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(cliCall?.[2].env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(cliCall?.[2].env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(cliCall?.[2].env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();
    expect(cliCall?.[2].env.CLAUDECODE).toBeUndefined();
  });

  it('tries a valid backup keychain item when the primary item is stale', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(successResponse(42));
    const service = new ClaudeUsageServiceImpl({
      platform: 'darwin',
      execFileFn: makeKeychainExec([
        { 'Claude Code-credentials': 'stale-primary', 'Claude Code': 'valid-backup' },
        { 'Claude Code-credentials': 'stale-primary', 'Claude Code': 'valid-backup' },
      ]),
      fetchFn: fetchMock,
      authStateService: authReader(loggedInState),
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const usage = await service.refresh();

    expect(usage.pools['claude-code:five_hour'].utilization).toBe(42);
    expect(bearerTokens(fetchMock)).toEqual(['stale-primary', 'valid-backup']);
  });

  it('re-reads credentials after 401 and succeeds with a rotated token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(successResponse(63));
    const service = new ClaudeUsageServiceImpl({
      platform: 'darwin',
      execFileFn: makeKeychainExec([
        { 'Claude Code-credentials': 'old-token', 'Claude Code': null },
        { 'Claude Code-credentials': 'rotated-token', 'Claude Code': null },
      ]),
      fetchFn: fetchMock,
      authStateService: authReader(loggedInState),
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const usage = await service.refresh();

    expect(usage.pools['claude-code:five_hour'].utilization).toBe(63);
    expect(bearerTokens(fetchMock)).toEqual(['old-token', 'rotated-token']);
  });

  it('does not retry the same rotated credential twice when its one recovery attempt is rejected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorizedResponse());
    const service = new ClaudeUsageServiceImpl({
      platform: 'darwin',
      execFileFn: makeKeychainExec([
        { 'Claude Code-credentials': 'old-token', 'Claude Code': null },
        { 'Claude Code-credentials': 'rotated-token', 'Claude Code': null },
      ]),
      fetchFn: fetchMock,
      authStateService: authReader(loggedInState),
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const usage = await service.refresh();

    expect(usage.error).toContain('Usage authorization failed');
    expect(bearerTokens(fetchMock)).toEqual(['old-token', 'rotated-token']);
  });

  it('uses the token persisted by successful CLI refresh and wraps claude.cmd on Windows', async () => {
    const persistedTokens = ['old-token', 'old-token', 'fresh-token'];
    let credentialRead = 0;
    const readFile = vi.fn(async () => JSON.stringify({
      claudeAiOauth: {
        accessToken: persistedTokens[Math.min(credentialRead++, persistedTokens.length - 1)],
      },
    }));
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      queueMicrotask(() => callback(null, JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0,
      }), ''));
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorizedResponse())
      .mockResolvedValueOnce(successResponse(74));
    const service = new ClaudeUsageServiceImpl({
      platform: 'win32',
      readFile,
      execFileFn,
      fetchFn: fetchMock,
      authStateService: authReader(loggedInState),
      claudeExecutable: 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
      cliBaseEnv: {
        PATH: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Windows\\System32',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const usage = await service.refresh();

    expect(usage.pools['claude-code:five_hour'].utilization).toBe(74);
    expect(bearerTokens(fetchMock)).toEqual(['old-token', 'fresh-token']);
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(execFileFn).toHaveBeenCalledOnce();
    expect(execFileFn.mock.calls[0][0]).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(execFileFn.mock.calls[0][1]).toEqual([
      '/d',
      '/s',
      '/c',
      expect.stringContaining('claude.cmd'),
    ]);
  });

  it('distinguishes an authoritative logged-out state from Usage authorization refusal', async () => {
    const service = new ClaudeUsageServiceImpl({
      platform: 'darwin',
      execFileFn: makeKeychainExec([
        { 'Claude Code-credentials': 'expired-token', 'Claude Code': null },
        { 'Claude Code-credentials': 'expired-token', 'Claude Code': null },
      ]),
      fetchFn: vi.fn().mockResolvedValue(unauthorizedResponse()),
      authStateService: authReader({
        status: 'logged-out',
        source: 'claude-cli-auth-status',
        checkedAt: 100,
        authMethod: 'none',
        apiProvider: 'firstParty',
      }),
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const usage = await service.refresh();

    expect(usage.error).toContain('login has expired');
    expect(usage.error).toContain('log in again');
  });

  it('keeps auth uncertainty explicit when CLI status checking fails', async () => {
    const service = new ClaudeUsageServiceImpl({
      platform: 'darwin',
      execFileFn: makeKeychainExec([
        { 'Claude Code-credentials': 'rejected-token', 'Claude Code': null },
        { 'Claude Code-credentials': 'rejected-token', 'Claude Code': null },
      ]),
      fetchFn: vi.fn().mockResolvedValue(unauthorizedResponse()),
      authStateService: authReader({
        status: 'check-failed',
        source: 'claude-cli-auth-status',
        checkedAt: 100,
        error: 'timed out',
      }),
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const usage = await service.refresh();

    expect(usage.error).toContain('status check failed');
    expect(usage.error).not.toContain('log in again');
  });

  it('times out a hung request, releases the shared promise, and allows the next refresh', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(successResponse(77));
    const service = new ClaudeUsageServiceImpl({
      platform: 'linux',
      readFile: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'token' } }),
      fetchFn: fetchMock,
      authStateService: authReader(loggedInState),
      requestTimeoutMs: 10,
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const timedOut = await service.refresh();
    expect(timedOut.error).toContain('timed out after 10ms');

    const recovered = await service.refresh();
    expect(recovered.pools['claude-code:five_hour'].utilization).toBe(77);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates completed and in-flight caches so a later refresh does not reuse stale work', async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSecond = resolve; }));
    const service = new ClaudeUsageServiceImpl({
      platform: 'linux',
      readFile: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'token' } }),
      fetchFn: fetchMock,
      authStateService: authReader(loggedInState),
      requestTimeoutMs: 1000,
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const staleRefresh = service.refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    service.invalidateCache();
    expect(service.getCachedUsage()).toBeNull();

    const freshRefresh = service.refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveFirst(successResponse(5));
    resolveSecond(successResponse(88));
    await expect(freshRefresh).resolves.toMatchObject({
      pools: { 'claude-code:five_hour': { utilization: 88 } },
    });
    await expect(staleRefresh).resolves.toMatchObject({
      pools: { 'claude-code:five_hour': { utilization: 88 } },
    });

    expect(service.getCachedUsage()?.pools['claude-code:five_hour'].utilization).toBe(88);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('releases every stale waiter after invalidation without starting an implicit refresh', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const service = new ClaudeUsageServiceImpl({
      platform: 'linux',
      readFile: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'token' } }),
      fetchFn: fetchMock,
      authStateService: authReader(loggedInState),
      requestTimeoutMs: 1000,
      networkMaxRetries: 1,
      sleep: async () => undefined,
    });

    const firstWaiter = service.refresh();
    const secondWaiter = service.refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    service.invalidateCache();
    resolveFetch(successResponse(5));

    await expect(firstWaiter).resolves.toMatchObject({
      pools: {},
      error: expect.stringContaining('invalidated'),
    });
    await expect(secondWaiter).resolves.toMatchObject({
      pools: {},
      error: expect.stringContaining('invalidated'),
    });
    expect(service.getCachedUsage()).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries a transient asynchronous keychain read error using the configured retry constants', async () => {
    let primaryAttempts = 0;
    const execFileFn = vi.fn((_file, args: readonly string[], _options, callback) => {
      const serviceName = args[2];
      if (serviceName === 'Claude Code-credentials') {
        primaryAttempts += 1;
        if (primaryAttempts === 1) {
          callback(Object.assign(new Error('Keychain is locked'), { code: 1 }), '', 'locked');
          return;
        }
        callback(null, JSON.stringify({ claudeAiOauth: { accessToken: 'unlocked-token' } }), '');
        return;
      }
      callback(Object.assign(new Error('not found'), { code: 44 }), '', '');
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const service = new ClaudeUsageServiceImpl({
      platform: 'darwin',
      execFileFn,
      fetchFn: vi.fn().mockResolvedValue(successResponse()),
      authStateService: authReader(loggedInState),
      keychainMaxRetries: 3,
      keychainRetryDelayMs: 2,
      networkMaxRetries: 1,
      sleep,
    });

    const usage = await service.refresh();

    expect(usage.error).toBeUndefined();
    expect(primaryAttempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2);
  });
});

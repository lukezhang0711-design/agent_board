import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, resolveSharedExecutableMock, getAllWindowsMock, writeFileSyncMock, writeFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  resolveSharedExecutableMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: getAllWindowsMock },
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

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: writeFileSyncMock,
    writeFile: writeFileMock,
  };
});

import { ClaudeAuthStateService } from '../ClaudeAuthStateService';

const loggedInJson = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'person@example.com',
  orgName: 'Example',
  subscriptionType: 'pro',
});

const loggedOutJson = JSON.stringify({
  loggedIn: false,
  authMethod: 'none',
  apiProvider: 'firstParty',
});

function result(stdout: string, exitCode = 0) {
  return { stdout, stderr: '', exitCode };
}

describe('GREEN 4: Negative Assertions (反向断言 - 不代跑命令、不碰凭证)', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    resolveSharedExecutableMock.mockReset().mockReturnValue('/bundled/claude');
    getAllWindowsMock.mockReset().mockReturnValue([]);
    writeFileSyncMock.mockReset();
    writeFileMock.mockReset();
  });

  it('never executes login or logout commands on any transition path', async () => {
    const executedCommands: Array<{ file: string; args: string[] }> = [];

    execFileMock.mockImplementation((file, args, _options, callback) => {
      executedCommands.push({ file, args: [...args] });
      callback(null, loggedOutJson, '');
    });

    const service = new ClaudeAuthStateService({
      runAuthStatus: vi.fn()
        .mockResolvedValueOnce(result(loggedInJson))
        .mockResolvedValueOnce(result(loggedOutJson))
        .mockResolvedValueOnce(result('', 1)),
    });

    // 1. Initial check (logged-in)
    await service.getState();

    // 2. Drop check (logged-out)
    await service.getState({ forceRefresh: true });

    // 3. Check failure
    await service.getState({ forceRefresh: true });

    // 4. Invalidation
    service.invalidate();

    // Assert: all executed execFile calls must only be read-only probes (auth status / pgrep / tasklist)
    for (const cmd of executedCommands) {
      const flatArgs = cmd.args.join(' ').toLowerCase();
      expect(flatArgs).not.toContain('/login');
      expect(flatArgs).not.toContain('login');
      expect(flatArgs).not.toContain('/logout');
      expect(flatArgs).not.toContain('logout');
    }
  });

  it('never writes, modifies, or deletes any credential files during check or drop', async () => {
    const service = new ClaudeAuthStateService({
      runAuthStatus: vi.fn()
        .mockResolvedValueOnce(result(loggedInJson))
        .mockResolvedValueOnce(result(loggedOutJson)),
    });

    await service.getState();
    await service.getState({ forceRefresh: true });

    // Assert: fs write methods were never invoked
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});

import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, getStateMock, invalidateMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  getStateMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../ClaudeAuthStateService', () => ({
  claudeAuthStateService: {
    getState: getStateMock,
    invalidate: invalidateMock,
  },
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

import { ClaudeCodeDetector } from '../ClaudeCodeDetector';

function fakeProcess(output: string, code: number | null) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  queueMicrotask(() => {
    if (output) child.stdout.emit('data', Buffer.from(output));
    child.emit('close', code);
  });

  return child;
}

describe('ClaudeCodeDetector authentication state', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    getStateMock.mockReset();
    invalidateMock.mockReset();
  });

  it('reports a timed-out auth check as check-failed instead of logged in', async () => {
    spawnMock.mockImplementationOnce(() => fakeProcess('2.1.208\n', 0));
    getStateMock.mockResolvedValue({
      status: 'check-failed',
      source: 'claude-cli-auth-status',
      checkedAt: 100,
      error: 'Claude authentication check timed out after 10000ms.',
    });

    const detector = new ClaudeCodeDetector();
    const status = await detector.getStatus();

    expect(status).toMatchObject({
      loggedIn: false,
      authState: 'check-failed',
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);

    detector.clearCache();
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it('reuses only installation detection while reading every auth snapshot from the state service', async () => {
    spawnMock.mockImplementationOnce(() => fakeProcess('2.1.208\n', 0));
    getStateMock
      .mockResolvedValueOnce({
        status: 'check-failed',
        source: 'claude-cli-auth-status',
        checkedAt: 100,
        error: 'temporary failure',
      })
      .mockResolvedValueOnce({
        status: 'logged-in',
        source: 'claude-cli-auth-status',
        checkedAt: 200,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
      });

    const detector = new ClaudeCodeDetector();

    await expect(detector.getStatus()).resolves.toMatchObject({ authState: 'check-failed' });
    await expect(detector.getStatus()).resolves.toMatchObject({ authState: 'logged-in' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(getStateMock).toHaveBeenCalledTimes(2);
  });
});

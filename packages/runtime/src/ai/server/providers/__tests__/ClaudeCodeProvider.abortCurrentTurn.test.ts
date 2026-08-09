import { describe, expect, it, vi } from 'vitest';

const electronAppMock = vi.hoisted(() => ({
  getPath: vi.fn(() => '/mock/path'),
  getName: vi.fn(() => 'test-app'),
  getVersion: vi.fn(() => '1.0.0'),
  isPackaged: false,
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
  whenReady: vi.fn(async () => {}),
  quit: vi.fn(),
  isReady: vi.fn(() => true),
}));

vi.mock('electron', () => ({
  app: electronAppMock,
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return [];
    }
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  ipcRenderer: { send: vi.fn(), on: vi.fn(), invoke: vi.fn() },
}));

vi.mock('../../../../../../electron/src/main/utils/logger', () => ({
  logger: {
    main: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

import { ClaudeCodeProvider } from '../ClaudeCodeProvider';

describe('ClaudeCodeProvider hard-stop', () => {
  it('sends the SDK Query.interrupt signal and latches the turn as owner-stopped', async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);
    const resolveStreamingRace = vi.fn();
    const provider = Object.create(ClaudeCodeProvider.prototype) as any;
    provider.leadQuery = { interrupt };
    provider.interruptResolve = resolveStreamingRace;
    provider.wasInterrupted = false;
    provider.manualStopRequested = false;

    await expect(provider.abortCurrentTurn()).resolves.toEqual({ method: 'interrupt' });

    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(resolveStreamingRace).toHaveBeenCalledTimes(1);
    expect(provider.wasInterrupted).toBe(true);
    expect(provider.manualStopRequested).toBe(true);
  });
});

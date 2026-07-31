import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipc.handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipc.listeners.set(channel, handler);
    }),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

describe('ipcRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NIMBALYST_IPC_SLOW_MS', '1');
    ipc.handlers.clear();
    ipc.listeners.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('records a slow async safeOn listener in the shared IPC stats', async () => {
    const { safeOn, getIpcStatsSnapshot } = await import('../ipcRegistry');
    safeOn('test:slow-event', async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    await ipc.listeners.get('test:slow-event')!({});

    expect(getIpcStatsSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'test:slow-event', callCount: 1, slowCount: 1 }),
    ]));
  });

  it('records a slow invoke handler registered through safeHandle', async () => {
    const { safeHandle, getIpcStatsSnapshot } = await import('../ipcRegistry');
    safeHandle('test:slow-invoke', async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });

    await ipc.handlers.get('test:slow-invoke')!({});

    expect(getIpcStatsSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'test:slow-invoke', callCount: 1, slowCount: 1 }),
    ]));
  });
});

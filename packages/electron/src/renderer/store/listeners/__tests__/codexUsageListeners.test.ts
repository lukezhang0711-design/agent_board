// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const settingAtomToken = Symbol('show-codex-usage');
  const usageAtomToken = Symbol('codex-usage');
  const settingListeners = new Set<() => void>();
  const ipcListeners = new Map<string, (...args: unknown[]) => void>();
  const ipcCleanups: Array<ReturnType<typeof vi.fn>> = [];
  return {
    enabled: false,
    sessionProvider: 'openai-codex',
    settingAtomToken,
    usageAtomToken,
    settingListeners,
    ipcListeners,
    ipcCleanups,
    invoke: vi.fn(async () => null),
    set: vi.fn(),
    reset() {
      this.enabled = false;
      this.sessionProvider = 'openai-codex';
      this.settingListeners.clear();
      this.ipcListeners.clear();
      this.ipcCleanups.length = 0;
      this.invoke.mockClear();
      this.set.mockClear();
    },
  };
});

vi.mock('../../index', () => ({
  store: {
    get: (atom: unknown) => {
      if (atom === harness.settingAtomToken) return harness.enabled;
      if (typeof atom === 'object' && atom !== null && 'sessionId' in atom) {
        return { provider: harness.sessionProvider };
      }
      return null;
    },
    set: harness.set,
    sub: (atom: unknown, callback: () => void) => {
      if (atom === harness.settingAtomToken) harness.settingListeners.add(callback);
      return () => harness.settingListeners.delete(callback);
    },
  },
}));

vi.mock('../../atoms/settingAtomFamily', () => ({
  settingAtom: () => harness.settingAtomToken,
}));

vi.mock('../../atoms/codexUsageAtoms', () => ({
  codexUsageAtom: harness.usageAtomToken,
}));

vi.mock('../../atoms/sessions', () => ({
  sessionStoreAtom: (sessionId: string) => ({ sessionId }),
}));

import {
  initCodexUsageListeners,
  recordCodexActivity,
} from '../codexUsageListeners';

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('codexUsageListeners metric gate', () => {
  beforeEach(() => {
    harness.reset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        invoke: harness.invoke,
        on: (channel: string, callback: (...args: unknown[]) => void) => {
          harness.ipcListeners.set(channel, callback);
          const cleanup = vi.fn(() => harness.ipcListeners.delete(channel));
          harness.ipcCleanups.push(cleanup);
          return cleanup;
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips startup scanning while disabled and scans once when enabled', async () => {
    harness.enabled = false;
    const cleanup = initCodexUsageListeners();
    await flushPromises();

    expect(harness.invoke).not.toHaveBeenCalledWith('codex-usage:get');

    harness.enabled = true;
    for (const listener of harness.settingListeners) listener();
    await flushPromises();
    expect(harness.invoke).toHaveBeenCalledTimes(1);
    expect(harness.invoke).toHaveBeenCalledWith('codex-usage:refresh');

    for (const listener of harness.settingListeners) listener();
    await flushPromises();
    expect(harness.invoke).toHaveBeenCalledTimes(1);

    cleanup();
    expect(harness.settingListeners.size).toBe(0);
    expect(harness.ipcCleanups.every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });

  it('fetches once on startup when the metric is enabled', async () => {
    harness.enabled = true;

    const cleanup = initCodexUsageListeners();
    await flushPromises();

    expect(harness.invoke).toHaveBeenCalledTimes(1);
    expect(harness.invoke).toHaveBeenCalledWith('codex-usage:get');
    cleanup();
  });

  it('does not scan for activity or completed turns while disabled', async () => {
    harness.enabled = false;
    const cleanup = initCodexUsageListeners();
    await flushPromises();
    harness.invoke.mockClear();

    harness.ipcListeners.get('ai:streamResponse')?.({
      sessionId: 'codex-session',
      isComplete: true,
    });
    await recordCodexActivity();
    await flushPromises();

    expect(harness.invoke).not.toHaveBeenCalled();
    cleanup();
  });
});

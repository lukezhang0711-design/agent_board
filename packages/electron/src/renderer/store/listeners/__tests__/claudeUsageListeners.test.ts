import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  usageIndicatorEnabled: false,
  set: vi.fn(),
}));

vi.mock('../../index', () => ({
  store: {
    get: () => testState.usageIndicatorEnabled,
    set: testState.set,
  },
}));

vi.mock('../../atoms/settingAtomFamily', () => ({
  settingAtom: () => Symbol.for('ai.showUsageIndicator'),
}));

import { initClaudeUsageListeners } from '../claudeUsageListeners';

describe('initClaudeUsageListeners', () => {
  const invoke = vi.fn();
  const unsubscribe = vi.fn();
  let usageUpdate: ((data: unknown) => void) | undefined;
  const on = vi.fn((_channel: string, handler: (data: unknown) => void) => {
    usageUpdate = handler;
    return unsubscribe;
  });

  beforeEach(() => {
    invoke.mockReset();
    unsubscribe.mockReset();
    on.mockClear();
    testState.set.mockReset();
    testState.usageIndicatorEnabled = false;
    usageUpdate = undefined;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { electronAPI: { invoke, on } },
    });
  });

  it('subscribes to updates without requesting initial usage when the indicator is disabled', () => {
    const cleanup = initClaudeUsageListeners();

    expect(on).toHaveBeenCalledWith('claude-usage:update', expect.any(Function));
    expect(invoke).not.toHaveBeenCalledWith('claude-usage:get');

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('requests initial usage when the indicator is enabled', () => {
    testState.usageIndicatorEnabled = true;
    invoke.mockResolvedValue(null);

    initClaudeUsageListeners();

    expect(invoke).toHaveBeenCalledWith('claude-usage:get');
  });

  it('accepts a null update to clear stale usage data', () => {
    initClaudeUsageListeners();

    usageUpdate?.(null);

    expect(testState.set).toHaveBeenCalledWith(expect.anything(), null);
  });
});

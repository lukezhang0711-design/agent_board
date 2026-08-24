import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  set: vi.fn(),
}));

vi.mock('../../index', () => ({
  store: {
    set: testState.set,
  },
}));

import { initSessionCreationFailureListeners } from '../sessionCreationFailureListeners';

describe('initSessionCreationFailureListeners', () => {
  const unsubscribe = vi.fn();
  let sessionCreateFailed: ((payload: unknown) => void) | undefined;
  const on = vi.fn((channel: string, handler: (payload: unknown) => void) => {
    if (channel === 'sessions:create-failed') {
      sessionCreateFailed = handler;
    }
    return unsubscribe;
  });

  beforeEach(() => {
    unsubscribe.mockReset();
    on.mockClear();
    testState.set.mockReset();
    sessionCreateFailed = undefined;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { electronAPI: { on } },
    });
  });

  it('FB-109 RED: moves the original session-create failure into shared renderer state', () => {
    const cleanup = initSessionCreationFailureListeners();
    const originalError = '已保存的模型“claude-code:fable-1m”不再属于当前目录，请重新选择模型。';

    expect(on).toHaveBeenCalledWith('sessions:create-failed', expect.any(Function));

    sessionCreateFailed?.({
      error: originalError,
      model: 'claude-code:fable-1m',
      provider: 'claude-code',
    });

    expect(testState.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        error: originalError,
        model: 'claude-code:fable-1m',
        provider: 'claude-code',
      }),
    );

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

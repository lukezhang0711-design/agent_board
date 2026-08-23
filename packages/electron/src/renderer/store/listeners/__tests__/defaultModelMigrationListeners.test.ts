import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  current: { defaultModel: '', defaultEffortLevel: 'medium' },
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../index', () => ({
  store: {
    get: testState.get,
    set: testState.set,
  },
}));

import {
  applyPendingDefaultModelMigration,
  initDefaultModelMigrationListeners,
} from '../defaultModelMigrationListeners';

describe('initDefaultModelMigrationListeners', () => {
  const unsubscribe = vi.fn();
  let modelMigrated: ((payload: unknown) => void) | undefined;
  const on = vi.fn((channel: string, handler: (payload: unknown) => void) => {
    if (channel === 'settings:default-ai-model-migrated') {
      modelMigrated = handler;
    }
    return unsubscribe;
  });

  beforeEach(() => {
    unsubscribe.mockReset();
    on.mockClear();
    testState.current = { defaultModel: 'claude-code:fable-1m', defaultEffortLevel: 'medium' };
    testState.get.mockReset().mockImplementation(() => testState.current);
    testState.set.mockReset().mockImplementation((_atom, value) => {
      testState.current = value;
    });
    modelMigrated = undefined;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { electronAPI: { on } },
    });
  });

  it('FB-109 GREEN: upgrades only the renderer default that still matches the proven old ID', () => {
    const cleanup = initDefaultModelMigrationListeners();

    modelMigrated?.({
      from: 'claude-code:fable-1m',
      to: 'claude-code:claude-fable-5-1m',
    });

    expect(testState.set).toHaveBeenCalledWith(expect.anything(), {
      defaultModel: 'claude-code:claude-fable-5-1m',
      defaultEffortLevel: 'medium',
    });
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not overwrite a renderer choice made after the main-process migration started', () => {
    initDefaultModelMigrationListeners();
    testState.current = { defaultModel: 'claude-code:claude-sonnet-4-5', defaultEffortLevel: 'medium' };

    modelMigrated?.({
      from: 'claude-code:fable-1m',
      to: 'claude-code:claude-fable-5-1m',
    });

    expect(testState.set).not.toHaveBeenCalled();
    expect(testState.current.defaultModel).toBe('claude-code:claude-sonnet-4-5');
  });

  it('replays an early startup migration after stale agent-mode hydration completes', () => {
    testState.current = { defaultModel: '', defaultEffortLevel: 'medium' };
    initDefaultModelMigrationListeners();

    modelMigrated?.({
      from: 'claude-code:opus-4-7',
      to: 'claude-code:claude-opus-4-7',
    });
    expect(testState.set).not.toHaveBeenCalled();

    // Simulate an in-flight settings:get-default-ai-model response captured
    // before the main process wrote the canonical value.
    testState.current = { defaultModel: 'claude-code:opus-4-7', defaultEffortLevel: 'medium' };
    applyPendingDefaultModelMigration();

    expect(testState.current.defaultModel).toBe('claude-code:claude-opus-4-7');
  });

  it('ignores malformed migration payloads', () => {
    initDefaultModelMigrationListeners();

    modelMigrated?.({ from: 'claude-code:fable-1m' });
    modelMigrated?.({ to: 'claude-code:claude-fable-5-1m' });
    modelMigrated?.(null);

    expect(testState.set).not.toHaveBeenCalled();
  });
});

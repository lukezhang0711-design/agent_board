// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  set: vi.fn(),
}));

vi.mock('../../index', () => ({
  store: {
    set: testState.set,
  },
}));

import { initWindowFocusListeners } from '../windowFocusListeners';

describe('initWindowFocusListeners', () => {
  const unsubscribe = vi.fn();
  const off = vi.fn();
  const invoke = vi.fn();
  let cleanup: (() => void) | undefined;
  let focusChanged: ((focused: boolean) => void) | undefined;

  const on = vi.fn((channel: string, handler: (focused: boolean) => void) => {
    if (channel === 'window:focus-changed') {
      focusChanged = handler;
    }
    return unsubscribe;
  });

  beforeEach(() => {
    cleanup = undefined;
    focusChanged = undefined;
    unsubscribe.mockReset();
    off.mockReset();
    on.mockClear();
    invoke.mockReset().mockResolvedValue(true);
    testState.set.mockReset();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke, on, off },
    });
  });

  afterEach(() => {
    cleanup?.();
  });

  it('FB-129 GREEN: moves focus off a native select when the window loses focus', () => {
    cleanup = initWindowFocusListeners();
    const select = document.createElement('select');
    select.innerHTML = '<option value="gpt-5">gpt-5</option>';
    document.body.appendChild(select);
    select.focus();

    expect(document.activeElement).toBe(select);

    focusChanged?.(false);

    expect(document.activeElement).not.toBe(select);
  });

  it('FB-129 GREEN: registers the focus listener only once across repeated initialization', () => {
    cleanup = initWindowFocusListeners();
    const duplicateCleanup = initWindowFocusListeners();

    expect(invoke).toHaveBeenCalledOnce();
    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('window:focus-changed', expect.any(Function));

    duplicateCleanup();
  });

  it('FB-129 GREEN: preserves focused input content across window blur and refocus', () => {
    cleanup = initWindowFocusListeners();
    const input = document.createElement('input');
    input.value = 'draft text';
    document.body.appendChild(input);
    input.focus();

    focusChanged?.(false);
    focusChanged?.(true);

    expect(input.value).toBe('draft text');
  });
});

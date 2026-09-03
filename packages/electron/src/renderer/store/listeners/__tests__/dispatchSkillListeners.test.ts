// @vitest-environment jsdom

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import {
  dispatchSkillsVersionAtom,
  dispatchSkillLibraryChangedVersionAtom,
  dispatchSkillLibrarySettingsPayloadAtom,
} from '../../atoms/dispatchSkills';
import { initDispatchSkillListeners } from '../dispatchSkillListeners';

describe('dispatchSkillListeners & SkillLibraryPanel (FB-172)', () => {
  const unsubscribeUpdated = vi.fn();
  const unsubscribeChanged = vi.fn();
  let cleanup: (() => void) | undefined;
  let updatedHandler: (() => void) | undefined;
  let changedHandler: ((payload: unknown) => void) | undefined;

  const on = vi.fn((channel: string, handler: any) => {
    if (channel === 'dispatch-skills:updated') {
      updatedHandler = handler;
      return unsubscribeUpdated;
    }
    if (channel === 'dispatch-skill-library:changed') {
      changedHandler = handler;
      return unsubscribeChanged;
    }
    return vi.fn();
  });

  beforeEach(() => {
    cleanup = undefined;
    updatedHandler = undefined;
    changedHandler = undefined;
    unsubscribeUpdated.mockReset();
    unsubscribeChanged.mockReset();
    on.mockClear();

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { on },
    });
  });

  afterEach(() => {
    cleanup?.();
  });

  it('绿⑥ (Part 1): initDispatchSkillListeners subscribes once and bumps atoms on IPC events', () => {
    const initialSkillVersion = store.get(dispatchSkillsVersionAtom);
    const initialChangedVersion = store.get(dispatchSkillLibraryChangedVersionAtom);

    cleanup = initDispatchSkillListeners();
    expect(on).toHaveBeenCalledWith('dispatch-skills:updated', expect.any(Function));
    expect(on).toHaveBeenCalledWith('dispatch-skill-library:changed', expect.any(Function));

    // Simulate dispatch-skills:updated
    updatedHandler?.();
    expect(store.get(dispatchSkillsVersionAtom)).toBe(initialSkillVersion + 1);

    // Simulate dispatch-skill-library:changed
    const testPayload = { settings: { enabledSkills: ['fixture-skill'] } };
    changedHandler?.(testPayload);
    expect(store.get(dispatchSkillLibraryChangedVersionAtom)).toBe(initialChangedVersion + 1);
    expect(store.get(dispatchSkillLibrarySettingsPayloadAtom)).toEqual(testPayload);

    // Cleanup unsubscribes
    cleanup();
    expect(unsubscribeUpdated).toHaveBeenCalled();
    expect(unsubscribeChanged).toHaveBeenCalled();
  });

  it('绿⑥ (Part 2 - 反向断言): SkillLibraryPanel.tsx contains NO direct electronAPI.on subscription', () => {
    const panelPath = path.resolve(__dirname, '../../../components/Settings/SkillLibraryPanel.tsx');
    const content = fs.readFileSync(panelPath, 'utf8');

    // Asserts no direct electronAPI.on or .on( subscribing to IPC
    expect(content).not.toMatch(/electronAPI\??\.on/);
    expect(content).not.toMatch(/window\.electronAPI\??\.on/);
    // Asserts imports atoms from centralized store
    expect(content).toContain('dispatchSkillsVersionAtom');
    expect(content).toContain('dispatchSkillLibraryChangedVersionAtom');
  });
});

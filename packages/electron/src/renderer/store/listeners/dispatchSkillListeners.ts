/**
 * Central Dispatch Skill Listeners
 *
 * Subscribes to dispatch-skill-related IPC events ONCE:
 * - `dispatch-skills:updated`        -> bumps `dispatchSkillsVersionAtom` so components
 *                                       can re-fetch `dispatch-skills:list` in background
 * - `dispatch-skill-library:changed` -> stores payload in `dispatchSkillLibrarySettingsPayloadAtom`
 *                                       and bumps `dispatchSkillLibraryChangedVersionAtom`
 *
 * Components read from the atoms instead of subscribing to IPC events directly.
 *
 * Call initDispatchSkillListeners() once at app startup.
 */

import { store } from '@nimbalyst/runtime/store';
import {
  dispatchSkillsVersionAtom,
  dispatchSkillLibraryChangedVersionAtom,
  dispatchSkillLibrarySettingsPayloadAtom,
} from '../atoms/dispatchSkills';

let initialized = false;

export function initDispatchSkillListeners(): () => void {
  if (initialized) {
    return () => {};
  }
  initialized = true;

  const unsubscribeUpdated = window.electronAPI?.on?.('dispatch-skills:updated', () => {
    store.set(dispatchSkillsVersionAtom, (v) => v + 1);
  });

  const unsubscribeChanged = window.electronAPI?.on?.(
    'dispatch-skill-library:changed',
    (payload: unknown) => {
      store.set(dispatchSkillLibrarySettingsPayloadAtom, payload);
      store.set(dispatchSkillLibraryChangedVersionAtom, (v) => v + 1);
    },
  );

  return () => {
    initialized = false;
    if (typeof unsubscribeUpdated === 'function') {
      unsubscribeUpdated();
    }
    if (typeof unsubscribeChanged === 'function') {
      unsubscribeChanged();
    }
  };
}

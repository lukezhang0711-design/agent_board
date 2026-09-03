/**
 * Dispatch Skills Atoms
 *
 * State for skill library updates and skill setting changes.
 * Updated by store/listeners/dispatchSkillListeners.ts.
 */

import { atom } from 'jotai';

export const dispatchSkillsVersionAtom = atom(0);
export const dispatchSkillLibraryChangedVersionAtom = atom(0);
export const dispatchSkillLibrarySettingsPayloadAtom = atom<unknown>(null);

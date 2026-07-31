import { describe, expect, it } from 'vitest';
import {
  clearLiveInteractivePrompt,
  countLiveInteractivePrompts,
  noteLiveInteractivePrompt,
} from '../interactivePromptLiveness';

describe('interactive prompt liveness', () => {
  it('counts concurrent waits and clears them on settle', () => {
    noteLiveInteractivePrompt('s1');
    noteLiveInteractivePrompt('s1');
    expect(countLiveInteractivePrompts('s1')).toBe(2);
    clearLiveInteractivePrompt('s1');
    clearLiveInteractivePrompt('s1');
    expect(countLiveInteractivePrompts('s1')).toBe(0);
  });
});

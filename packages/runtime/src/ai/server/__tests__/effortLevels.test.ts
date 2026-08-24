import { describe, it, expect } from 'vitest';
import {
  getEffortLevelLabel,
  resolveDeclaredEffortLevel,
  resolveEffortLevel,
} from '../effortLevels';

describe('resolveEffortLevel', () => {
  it('uses the explicit per-session effort when set', () => {
    expect(resolveEffortLevel('low', 'max')).toBe('low');
    expect(resolveEffortLevel('high', 'max')).toBe('high');
    expect(resolveEffortLevel('ultra', 'max')).toBe('ultra');
  });

  it('falls back to the app default when the session has no effort', () => {
    // The selector displays the app default but never writes it to session
    // metadata; the effective effort must follow that default (GitHub #546).
    expect(resolveEffortLevel(undefined, 'max')).toBe('max');
    expect(resolveEffortLevel(null, 'xhigh')).toBe('xhigh');
    expect(resolveEffortLevel('', 'max')).toBe('max');
  });

  it('returns undefined when neither session nor app default is set', () => {
    expect(resolveEffortLevel(undefined, undefined)).toBeUndefined();
    expect(resolveEffortLevel(null, undefined)).toBeUndefined();
  });

  it('preserves a future engine value instead of coercing it to a product enum', () => {
    expect(resolveEffortLevel('turbo', 'max')).toBe('turbo');
    expect(getEffortLevelLabel('deep')).toBe('deep');
  });

  it('uses only the model declaration for unknown future values and fallback', () => {
    expect(resolveDeclaredEffortLevel('turbo', ['turbo', 'deep'], 'deep')).toMatchObject({
      effortLevel: 'turbo',
      outcome: 'accepted',
    });
    expect(resolveDeclaredEffortLevel('ultra', ['turbo', 'deep'], 'deep')).toMatchObject({
      effortLevel: 'deep',
      outcome: 'fallback',
    });
    expect(resolveDeclaredEffortLevel('low', [], undefined)).toMatchObject({
      effortLevel: undefined,
      outcome: 'dropped',
    });
    expect(resolveDeclaredEffortLevel(undefined, ['turbo', 'deep'], 'deep')).toMatchObject({
      effortLevel: undefined,
      outcome: 'none',
    });
  });
});

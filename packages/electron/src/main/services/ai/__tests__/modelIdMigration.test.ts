import { describe, expect, it } from 'vitest';
import { resolveEquivalentModelIdMigration } from '../modelIdMigration';

describe('equivalent legacy dynamic-model ID migration', () => {
  it('migrates fable-1m only to the unique live row with the same resolved engine ID', () => {
    expect(resolveEquivalentModelIdMigration('claude-code:fable-1m', [
      {
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5[1m]',
      },
    ])).toEqual({
      from: 'claude-code:fable-1m',
      to: 'claude-code:claude-fable-5-1m',
      resolvedModel: 'claude-fable-5[1m]',
    });
  });

  it('migrates fable-1m when the current SDK publishes its verified canonical resolved engine ID', () => {
    expect(resolveEquivalentModelIdMigration('claude-code:fable-1m', [
      {
        id: 'claude-code:claude-fable-5-1m',
        resolvedModel: 'claude-fable-5',
      },
    ])).toEqual({
      from: 'claude-code:fable-1m',
      to: 'claude-code:claude-fable-5-1m',
      resolvedModel: 'claude-fable-5',
    });
  });

  it('migrates a historically pinned Opus variant only through its exact 1M engine ID', () => {
    expect(resolveEquivalentModelIdMigration('claude-code:opus-4-6-1m', [
      {
        id: 'claude-code:claude-opus-4-6-1m',
        resolvedModel: 'claude-opus-4-6[1m]',
      },
    ])).toEqual({
      from: 'claude-code:opus-4-6-1m',
      to: 'claude-code:claude-opus-4-6-1m',
      resolvedModel: 'claude-opus-4-6[1m]',
    });
  });

  it('does not migrate a current ID, a missing identity, an ambiguous identity, or a mutable legacy alias', () => {
    const uniqueCatalog = [{
      id: 'claude-code:claude-fable-5-1m',
      resolvedModel: 'claude-fable-5[1m]',
    }];
    const ambiguousCatalog = [
      ...uniqueCatalog,
      { id: 'claude-code:another-fable-alias', resolvedModel: 'claude-fable-5[1m]' },
    ];

    expect(resolveEquivalentModelIdMigration('claude-code:claude-fable-5-1m', uniqueCatalog)).toBeNull();
    expect(resolveEquivalentModelIdMigration('claude-code:fable-1m', [])).toBeNull();
    expect(resolveEquivalentModelIdMigration('claude-code:fable-1m', ambiguousCatalog)).toBeNull();
    expect(resolveEquivalentModelIdMigration('claude-code:fable', uniqueCatalog)).toBeNull();
  });
});

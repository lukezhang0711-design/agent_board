import { describe, expect, it } from 'vitest';
import {
  LEGACY_CLAUDE_MODEL_ID_MIGRATIONS,
  resolveEquivalentModelIdMigration,
} from '../modelIdMigration';

const OPUS_1M_CATALOG = [
  {
    id: 'claude-code:default',
    resolvedModel: 'claude-opus-5[1m]',
  },
  {
    id: 'claude-code:opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
  },
];

describe('equivalent legacy dynamic-model ID migration', () => {
  it('GREEN ES: maps every product-issued Claude historical ID to its recorded live selectable row, including CLI', () => {
    for (const [legacyVariant, record] of Object.entries(LEGACY_CLAUDE_MODEL_ID_MIGRATIONS)) {
      const engineId = `claude-code:${record.selectableVariant}`;
      const cliEngineId = `claude-code-cli:${record.selectableVariant}`;
      const resolvedModel = record.resolvedModels[0];

      expect(resolveEquivalentModelIdMigration(`claude-code:${legacyVariant}`, [{
        id: engineId,
        resolvedModel,
      }])).toEqual({
        from: `claude-code:${legacyVariant}`,
        to: engineId,
        resolvedModel,
      });

      expect(resolveEquivalentModelIdMigration(`claude-code-cli:${legacyVariant}`, [{
        id: cliEngineId,
        resolvedModel,
      }])).toEqual({
        from: `claude-code-cli:${legacyVariant}`,
        to: cliEngineId,
        resolvedModel,
      });
    }
  });

  it('RED ES: migrates opus-1m despite default and opus[1m] sharing the same resolved engine value', () => {
    expect(resolveEquivalentModelIdMigration('claude-code:opus-1m', OPUS_1M_CATALOG)).toEqual({
      from: 'claude-code:opus-1m',
      to: 'claude-code:opus[1m]',
      resolvedModel: 'claude-opus-5[1m]',
    });
  });

  it('RED ES: migrates the historical Fable catalog spelling to the current engine row', () => {
    expect(resolveEquivalentModelIdMigration('claude-code:claude-fable-5-1m', [{
      id: 'claude-code:claude-fable-5[1m]',
      resolvedModel: 'claude-fable-5[1m]',
    }])).toEqual({
      from: 'claude-code:claude-fable-5-1m',
      to: 'claude-code:claude-fable-5[1m]',
      resolvedModel: 'claude-fable-5[1m]',
    });
  });

  it('uses resolvedModel only as a secondary fallback when the recorded selectable row is absent', () => {
    expect(resolveEquivalentModelIdMigration('claude-code:opus-4-6', [{
      id: 'claude-code:future-opus-4-6-alias',
      resolvedModel: 'claude-opus-4-6',
    }])).toEqual({
      from: 'claude-code:opus-4-6',
      to: 'claude-code:future-opus-4-6-alias',
      resolvedModel: 'claude-opus-4-6',
    });
  });

  it('GREEN ES: refuses unknown or already-live IDs instead of deriving an engine spelling', () => {
    expect(resolveEquivalentModelIdMigration('claude-code:unknown-product-legacy-id', OPUS_1M_CATALOG))
      .toBeNull();
    expect(resolveEquivalentModelIdMigration('claude-code:opus[1m]', OPUS_1M_CATALOG))
      .toBeNull();
  });
});

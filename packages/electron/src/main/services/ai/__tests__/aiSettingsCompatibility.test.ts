import { describe, expect, it, vi } from 'vitest';

import {
  createTolerantAISettingsWriter,
  quarantineUnrecognizedAIProviderSettings,
} from '../aiSettingsCompatibility';

function createStore(initial: Record<string, unknown>) {
  const values = structuredClone(initial) as Record<string, unknown>;
  const set = vi.fn((key: string, value: unknown) => {
    values[key] = structuredClone(value);
  });

  return {
    get<T>(key: string, fallback: T): T {
      return (values[key] === undefined ? fallback : values[key]) as T;
    },
    set,
    snapshot: () => structuredClone(values),
  };
}

describe('AI settings compatibility', () => {
  it('RED: skips an unknown provider slice without poisoning a following legitimate write', () => {
    const persisted = new Map<string, unknown>();
    const warnings: string[] = [];
    const writer = createTolerantAISettingsWriter(
      (key, value) => persisted.set(key, value),
      (message) => warnings.push(message),
    );

    writer.set('ai.provider.antigravity-gemini-agent', {
      enabled: true,
      models: ['must-not-appear-in-the-log'],
    });
    writer.set('ai.provider.claude', { enabled: true });

    expect(persisted).toEqual(new Map([
      ['ai.provider.claude', { enabled: true }],
    ]));
    expect(writer.result).toEqual({
      savedKeys: ['ai.provider.claude'],
      skipped: [{
        key: 'ai.provider.antigravity-gemini-agent',
        reason: 'unknown_key',
      }],
    });
    expect(warnings).toEqual([
      '[ai:saveSettings] skipped key=ai.provider.antigravity-gemini-agent reason=unknown_key',
    ]);
    expect(warnings[0]).not.toContain('must-not-appear-in-the-log');
  });

  it('continues after a known key has an invalid value and reports that skip', () => {
    const persisted = new Map<string, unknown>();
    const warnings: string[] = [];
    const writer = createTolerantAISettingsWriter(
      (key, value) => {
        if (key === 'ai.showToolCalls') {
          throw new Error('schema validation failed');
        }
        persisted.set(key, value);
      },
      (message) => warnings.push(message),
    );

    writer.set('ai.showToolCalls', 'not-a-boolean');
    writer.set('ai.provider.claude', { enabled: true });

    expect(persisted).toEqual(new Map([
      ['ai.provider.claude', { enabled: true }],
    ]));
    expect(writer.result.skipped).toEqual([
      { key: 'ai.showToolCalls', reason: 'invalid_value' },
    ]);
    expect(warnings).toEqual([
      '[ai:saveSettings] skipped key=ai.showToolCalls reason=invalid_value',
    ]);
  });

  it('quarantines legacy provider settings once while preserving known settings and values', () => {
    const legacyValue = {
      enabled: true,
      models: ['antigravity-gemini-agent:gemini-3-flash-agent'],
    };
    const store = createStore({
      providerSettings: {
        claude: { enabled: true, models: ['claude-opus'] },
        'antigravity-gemini-agent': legacyValue,
      },
      _unrecognized: {
        priorTopLevelLegacyValue: { kept: true },
      },
    });

    const firstRun = quarantineUnrecognizedAIProviderSettings(store);

    expect(firstRun).toEqual(['antigravity-gemini-agent']);
    expect(store.snapshot()).toEqual({
      providerSettings: {
        claude: { enabled: true, models: ['claude-opus'] },
      },
      _unrecognized: {
        priorTopLevelLegacyValue: { kept: true },
        providerSettings: {
          'antigravity-gemini-agent': legacyValue,
        },
      },
    });

    const writesAfterFirstRun = store.set.mock.calls.length;
    expect(quarantineUnrecognizedAIProviderSettings(store)).toEqual([]);
    expect(store.set).toHaveBeenCalledTimes(writesAfterFirstRun);
  });
});

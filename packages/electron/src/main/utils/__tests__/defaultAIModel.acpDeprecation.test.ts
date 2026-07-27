import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeValues = new Map<string, unknown>();

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string, fallback?: unknown) {
      return storeValues.has(key) ? storeValues.get(key) : fallback;
    }

    set(key: string, value: unknown) {
      storeValues.set(key, value);
    }
  },
}));
vi.mock('../logger', () => ({
  logger: {
    store: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    main: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  },
}));

import { getDefaultAIModel, setDefaultAIModel } from '../store';

beforeEach(() => storeValues.clear());

describe('default AI model', () => {
  it('moves a legacy ACP default to the main OpenAI Codex provider for new sessions', () => {
    storeValues.set('defaultAIModel', 'openai-codex-acp:gpt-5.5');

    expect(getDefaultAIModel()).toBe('openai-codex:gpt-5.5');
  });

  it('does not persist ACP as a selectable default for a future session', () => {
    setDefaultAIModel('openai-codex-acp:gpt-5.5');

    expect(storeValues.get('defaultAIModel')).toBe('openai-codex:gpt-5.5');
  });
});

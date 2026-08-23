import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertDynamicModelCatalogSelection,
  getDynamicModelCatalogStatuses,
  resolveDynamicModelCatalogSelection,
  setDynamicModelCatalogStatusReader,
  setDynamicModelCatalogSelectionResolver,
  setDynamicModelCatalogValidator,
} from '../modelCatalogValidation';

afterEach(() => {
  setDynamicModelCatalogValidator(null);
  setDynamicModelCatalogSelectionResolver(null);
  setDynamicModelCatalogStatusReader(null);
});

describe('new-session dynamic model catalog bridge', () => {
  it('delegates every Claude/Codex new-session model to the live catalog validator', async () => {
    const validate = vi.fn(async () => {});
    setDynamicModelCatalogValidator(validate);

    await assertDynamicModelCatalogSelection('claude-code', 'claude-code:opus-1m');
    await assertDynamicModelCatalogSelection('openai-codex', 'openai-codex:gpt-5.6-sol');
    await assertDynamicModelCatalogSelection('openai-codex-acp', 'openai-codex-acp:gpt-5.6-sol');

    expect(validate).toHaveBeenNthCalledWith(1, 'claude-code', 'claude-code:opus-1m');
    expect(validate).toHaveBeenNthCalledWith(2, 'openai-codex', 'openai-codex:gpt-5.6-sol');
    expect(validate).toHaveBeenNthCalledWith(3, 'openai-codex-acp', 'openai-codex-acp:gpt-5.6-sol');
  });

  it('fails closed instead of inventing a static model when the catalog service is unavailable', async () => {
    await expect(
      assertDynamicModelCatalogSelection('claude-code', undefined),
    ).rejects.toThrow('模型目录尚未就绪');
  });

  it('resolves an omitted dynamic model only through the live catalog resolver', async () => {
    const resolve = vi.fn(async () => 'claude-code:default');
    setDynamicModelCatalogSelectionResolver(resolve);

    await expect(
      resolveDynamicModelCatalogSelection('claude-code', undefined),
    ).resolves.toBe('claude-code:default');
    expect(resolve).toHaveBeenCalledWith('claude-code', undefined);
  });

  it('never falls back to a package default when a dynamic resolver is absent', async () => {
    await expect(
      resolveDynamicModelCatalogSelection('openai-codex', undefined),
    ).rejects.toThrow('模型目录尚未就绪');
  });

  it('does not alter non-dynamic providers', async () => {
    const validate = vi.fn(async () => {});
    setDynamicModelCatalogValidator(validate);

    await expect(
      assertDynamicModelCatalogSelection('openai', 'openai:gpt-5.5'),
    ).resolves.toBeUndefined();
    expect(validate).not.toHaveBeenCalled();
  });

  it('forwards directory failure state without manufacturing a model list', () => {
    setDynamicModelCatalogStatusReader(() => ({
      'openai-codex': {
        modelSource: 'cache',
        verified: true,
        lastSuccessAt: 1_723_456_789_000,
        lastError: { message: 'codex debug models: command not found' },
      },
    }));

    expect(getDynamicModelCatalogStatuses()).toEqual({
      'openai-codex': {
        modelSource: 'cache',
        verified: true,
        lastSuccessAt: 1_723_456_789_000,
        lastError: { message: 'codex debug models: command not found' },
      },
    });
  });
});

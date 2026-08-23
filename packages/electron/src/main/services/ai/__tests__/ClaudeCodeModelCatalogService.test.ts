import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeModelCatalogService } from '../ClaudeCodeModelCatalogService';

const TEMP_DIRECTORIES: string[] = [];

const SDK_MODELS = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'SDK recommendation',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    description: 'Most capable',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
    description: 'Fast',
    supportsEffort: false,
  },
  {
    // The public SDK declaration promises only this boolean. Its optional
    // runtime `supportedEffortLevels` detail may be absent.
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: 'Routine work',
    supportsEffort: true,
  },
];

function createService(fetchSupportedModels: () => Promise<typeof SDK_MODELS>) {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.claude-model-catalog-test-'));
  TEMP_DIRECTORIES.push(directory);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new ClaudeCodeModelCatalogService({
    cachePath: path.join(directory, 'models.json'),
    retryDelaysMs: [],
    fetchSupportedModels,
    logger: log,
  });
  return { directory, log, service };
}

afterEach(() => {
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ClaudeCodeModelCatalogService', () => {
  it('uses supportedModels as the source, turns [1m] into -1m, and preserves resolved aliases and effort support', async () => {
    const fetchSupportedModels = vi.fn().mockResolvedValue(SDK_MODELS);
    const { service } = createService(fetchSupportedModels);

    await service.start();

    expect(fetchSupportedModels).toHaveBeenCalledTimes(1);
    expect(service.getModels()).toEqual([
      expect.objectContaining({
        id: 'claude-code:default',
        isEngineDefault: true,
        resolvedModel: 'claude-opus-5[1m]',
      }),
      expect.objectContaining({
        id: 'claude-code:opus-1m',
        name: 'Claude Agent · Opus (1M context)',
        resolvedModel: 'claude-opus-5[1m]',
        description: 'Most capable',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        contextWindow: 1_000_000,
      }),
      expect.objectContaining({
        id: 'claude-code:haiku',
        supportsEffort: false,
        supportedEffortLevels: [],
        contextWindow: 200_000,
      }),
      expect.objectContaining({
        id: 'claude-code:sonnet',
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      }),
    ]);
  });

  it('does not use a static catalog after supportedModels fails, but keeps a timestamped successful cache', async () => {
    const first = createService(vi.fn().mockResolvedValue(SDK_MODELS));
    await first.service.start();
    const firstStatus = first.service.getStatus();

    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const next = new ClaudeCodeModelCatalogService({
      cachePath: path.join(first.directory, 'models.json'),
      retryDelaysMs: [],
      fetchSupportedModels: vi.fn().mockRejectedValue(new Error('Claude SDK control session timed out')),
      logger: log,
    });
    await next.start();

    expect(next.getStatus()).toMatchObject({
      modelSource: 'cache',
      verified: true,
      lastSuccessAt: firstStatus.lastSuccessAt,
      lastError: { message: 'Claude SDK control session timed out' },
    });
    expect(next.getModels()).toEqual([
      expect.objectContaining({ id: 'claude-code:default', isEngineDefault: true }),
      expect.objectContaining({ id: 'claude-code:opus-1m' }),
      expect.anything(),
      expect.objectContaining({ id: 'claude-code:sonnet', supportsEffort: true }),
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'Claude SDK control session timed out' }),
    );
  });

  it('clears the initial unverified placeholder after the first failed discovery and logs the original error', async () => {
    const { log, service } = createService(vi.fn().mockRejectedValue(new Error('supportedModels unavailable')));
    await service.start();

    expect(service.getModels()).toEqual([]);
    expect(service.getStatus()).toMatchObject({
      phase: 'stopped',
      modelSource: 'none',
      verified: false,
      lastError: { message: 'supportedModels unavailable' },
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'supportedModels unavailable' }),
    );
  });

  it('aborts a hanging SDK fetch when the catalog watchdog times out', async () => {
    let observedSignal: AbortSignal | undefined;
    let controlClosed = false;
    const fetchSupportedModels = vi.fn((signal?: AbortSignal) => {
      observedSignal = signal;
      return new Promise<readonly (typeof SDK_MODELS)[number][]>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          controlClosed = true;
          reject(new Error('control session closed'));
        }, { once: true });
      });
    });
    const directory = fs.mkdtempSync(path.join(process.cwd(), '.claude-model-catalog-test-'));
    TEMP_DIRECTORIES.push(directory);
    const service = new ClaudeCodeModelCatalogService({
      cachePath: path.join(directory, 'models.json'),
      retryDelaysMs: [],
      requestTimeoutMs: 1,
      fetchSupportedModels,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await service.start();

    expect(fetchSupportedModels).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted).toBe(true);
    expect(controlClosed).toBe(true);
    expect(service.getStatus().lastError).toMatchObject({
      category: 'timeout',
      message: 'Claude SDK supportedModels timed out after 1ms',
    });
  });

  it('passes an API key to discovery only when the host explicitly configured it', async () => {
    const directory = fs.mkdtempSync(path.join(process.cwd(), '.claude-model-catalog-test-'));
    TEMP_DIRECTORIES.push(directory);
    const fetchSupportedModels = vi.fn(async (
      _signal?: AbortSignal,
      explicitAuthEnv?: NodeJS.ProcessEnv,
    ) => {
      expect(explicitAuthEnv).toEqual({ ANTHROPIC_API_KEY: 'configured-test-key' });
      return SDK_MODELS;
    });
    const service = new ClaudeCodeModelCatalogService({
      cachePath: path.join(directory, 'models.json'),
      retryDelaysMs: [],
      getExplicitAuthEnv: () => ({ ANTHROPIC_API_KEY: 'configured-test-key' }),
      fetchSupportedModels,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await service.start();

    expect(fetchSupportedModels).toHaveBeenCalledTimes(1);
  });
});

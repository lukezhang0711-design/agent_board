import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexModelRefreshService } from '../CodexModelRefreshService';

const TEMP_DIRECTORIES: string[] = [];

function catalogResult() {
  return {
    data: [
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        description: 'Frontier coding model',
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'turbo', description: 'New engine tier' },
          { reasoningEffort: 'ultra', description: 'Maximum reasoning' },
        ],
        hidden: false,
        isDefault: true,
      },
      {
        id: 'gpt-reserve',
        displayName: 'Reserve',
        hidden: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }],
      },
    ],
  };
}

function createHarness(fetchCatalog: () => Promise<unknown>) {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.codex-model-catalog-test-'));
  TEMP_DIRECTORIES.push(directory);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new CodexModelRefreshService({
    catalogPath: path.join(directory, 'models.json'),
    retryDelaysMs: [],
    fetchCatalog,
    logger: log,
  });
  return { directory, log, service };
}

afterEach(() => {
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('CodexModelRefreshService', () => {
  it('uses current app-server `data`/`hidden` rows only and preserves unknown engine tiers', async () => {
    const fetchCatalog = vi.fn().mockResolvedValue(catalogResult());
    const { service } = createHarness(fetchCatalog);

    await service.start();

    expect(fetchCatalog).toHaveBeenCalledWith();
    expect(service.getModels()).toEqual([
      expect.objectContaining({
        id: 'openai-codex:gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        description: 'Frontier coding model',
        defaultEffortLevel: 'low',
        supportedEffortLevels: ['low', 'turbo', 'ultra'],
        isEngineDefault: true,
      }),
    ]);
    expect(service.getStatus()).toMatchObject({
      modelSource: 'runtime',
      verified: true,
      lastError: null,
    });
  });

  it('does not infer a Codex default when the live lowest priority is tied', async () => {
    const { service } = createHarness(vi.fn().mockResolvedValue({
        models: [
          { slug: 'gpt-a', display_name: 'A', visibility: 'list', priority: 1 },
          { slug: 'gpt-b', display_name: 'B', visibility: 'list', priority: 1 },
        ],
    }));

    await service.start();

    expect(service.getModels().map((model) => model.id)).toEqual([
      'openai-codex:gpt-a',
      'openai-codex:gpt-b',
    ]);
    expect(service.getModels().some((model) => model.isEngineDefault === true)).toBe(false);
  });

  it('keeps only a timestamped last-success cache when a later discovery fails', async () => {
    const first = createHarness(vi.fn().mockResolvedValue(catalogResult()));
    await first.service.start();
    const firstStatus = first.service.getStatus();

    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const next = new CodexModelRefreshService({
      catalogPath: path.join(first.directory, 'models.json'),
      retryDelaysMs: [],
      fetchCatalog: vi.fn().mockRejectedValue(new Error('app-server transport ENOENT')),
      logger: log,
    });
    await next.start();

    expect(next.getModels()).toEqual([
      expect.objectContaining({ id: 'openai-codex:gpt-5.6-sol' }),
    ]);
    expect(next.getStatus()).toMatchObject({
      modelSource: 'cache',
      verified: true,
      lastSuccessAt: firstStatus.lastSuccessAt,
      lastError: { message: 'app-server transport ENOENT' },
    });
    // Cache remains picker evidence only; the app-server protocol has its own
    // inverse assertion that no host catalog file is ever injected.
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'app-server transport ENOENT' }),
    );
  });

  it('does not silently fall back to a static catalog after the first discovery fails', async () => {
    const { log, service } = createHarness(
      vi.fn().mockRejectedValue(new Error('app-server transport unavailable')),
    );

    await service.start();

    expect(service.getModels()).toEqual([]);
    expect(service.getStatus()).toMatchObject({
      phase: 'stopped',
      modelSource: 'none',
      verified: false,
      lastSuccessAt: null,
      lastError: { message: 'app-server transport unavailable' },
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'app-server transport unavailable' }),
    );
  });

  it('turns an app-server timeout into a logged red state without exposing a static fallback', async () => {
    const { log, service } = createHarness(
      vi.fn().mockRejectedValue(new Error('codex app-server model/list timed out after 20ms')),
    );

    await service.start();

    expect(service.getModels()).toEqual([]);
    expect(service.getStatus()).toMatchObject({
      phase: 'stopped',
      modelSource: 'none',
      verified: false,
      lastError: { message: 'codex app-server model/list timed out after 20ms' },
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'codex app-server model/list timed out after 20ms' }),
    );
  });

});

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexModelRefreshService } from '../CodexModelRefreshService';

const TEMP_DIRECTORIES: string[] = [];

function catalogResult() {
  return JSON.stringify({
    models: [
      {
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6 Sol',
        description: 'Frontier coding model',
        default_reasoning_level: 'low',
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast' },
          { effort: 'ultra', description: 'Maximum reasoning' },
        ],
        visibility: 'list',
      },
      {
        slug: 'gpt-reserve',
        display_name: 'Reserve',
        visibility: 'hide',
        supported_reasoning_levels: [{ effort: 'ultra' }],
      },
    ],
  });
}

function createHarness(commandRunner: (command: string, args: string[]) => Promise<{ stdout: string; stderr?: string }>) {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.codex-model-catalog-test-'));
  TEMP_DIRECTORIES.push(directory);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new CodexModelRefreshService({
    catalogPath: path.join(directory, 'models.json'),
    retryDelaysMs: [],
    commandRunner,
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
  it('uses only `codex debug models`, lists only visibility=list models, and preserves ultra', async () => {
    const commandRunner = vi.fn().mockResolvedValue({ stdout: catalogResult() });
    const { service } = createHarness(commandRunner);

    await service.start();

    expect(commandRunner).toHaveBeenCalledWith(
      expect.any(String),
      ['debug', 'models'],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(service.getModels()).toEqual([
      expect.objectContaining({
        id: 'openai-codex:gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        description: 'Frontier coding model',
        defaultEffortLevel: 'low',
        supportedEffortLevels: ['low', 'ultra'],
      }),
    ]);
    expect(service.getStatus()).toMatchObject({
      modelSource: 'runtime',
      verified: true,
      lastError: null,
    });
  });

  it('keeps only a timestamped last-success cache when a later discovery fails', async () => {
    const first = createHarness(vi.fn().mockResolvedValue({ stdout: catalogResult() }));
    await first.service.start();
    const firstStatus = first.service.getStatus();

    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const next = new CodexModelRefreshService({
      catalogPath: path.join(first.directory, 'models.json'),
      retryDelaysMs: [],
      commandRunner: vi.fn().mockRejectedValue(new Error('spawn codex ENOENT')),
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
      lastError: { message: 'spawn codex ENOENT' },
    });
    // Cache remains UI evidence only; it must never be injected into a new
    // app-server child while the live refresh is red.
    expect(next.getCatalogPath()).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'spawn codex ENOENT' }),
    );
  });

  it('does not silently fall back to a static catalog after the first discovery fails', async () => {
    const { log, service } = createHarness(
      vi.fn().mockRejectedValue(new Error('codex executable not found')),
    );

    await service.start();

    expect(service.getModels()).toEqual([]);
    expect(service.getStatus()).toMatchObject({
      phase: 'stopped',
      modelSource: 'none',
      verified: false,
      lastSuccessAt: null,
      lastError: { message: 'codex executable not found' },
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'codex executable not found' }),
    );
    expect(service.getCatalogPath()).toBeUndefined();
  });

  it('turns a command timeout into a logged red state without exposing a static fallback', async () => {
    const { log, service } = createHarness(
      vi.fn().mockRejectedValue(new Error('codex debug models timed out after 20ms')),
    );

    await service.start();

    expect(service.getModels()).toEqual([]);
    expect(service.getStatus()).toMatchObject({
      phase: 'stopped',
      modelSource: 'none',
      verified: false,
      lastError: { message: 'codex debug models timed out after 20ms' },
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh attempt'),
      expect.objectContaining({ error: 'codex debug models timed out after 20ms' }),
    );
  });

  it('exposes a catalog path only for a fresh successful discovery', async () => {
    const { service } = createHarness(
      vi.fn().mockResolvedValue({ stdout: catalogResult() }),
    );

    await service.start();

    expect(service.getCatalogPath()).toMatch(/models\.json$/);
  });
});

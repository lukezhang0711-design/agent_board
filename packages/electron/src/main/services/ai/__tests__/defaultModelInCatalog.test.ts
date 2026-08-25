import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODELS } from '@nimbalyst/runtime/ai/modelConstants';
import { ClaudeCodeDeps } from '@nimbalyst/runtime/ai/server/providers/claudeCode/dependencyInjection';
import { ClaudeCodeModelCatalogService } from '../ClaudeCodeModelCatalogService';

vi.mock('@nimbalyst/runtime/electron/claudeCodeEnvironment', () => ({
  resolveClaudeCodeExecutablePath: () => '/packaged/unpacked/claude-native-binary',
}));

const TEMP_DIRECTORIES: string[] = [];

/**
 * The exact shape `Query.supportedModels()` returns on this machine. It is a
 * verbatim engine response, not a product inventory: the assertions below must
 * keep passing when the engine adds, renames, or drops rows, which is why they
 * only require that the built-in defaults are spelled the way the engine
 * spells them.
 */
const LIVE_SDK_MODELS = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'claude-fable-5[1m]',
    resolvedModel: 'claude-fable-5',
    displayName: 'Fable',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
];

async function liveCatalogIds(): Promise<string[]> {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.default-model-catalog-test-'));
  TEMP_DIRECTORIES.push(directory);
  const service = new ClaudeCodeModelCatalogService({
    cachePath: path.join(directory, 'models.json'),
    retryDelaysMs: [],
    fetchSupportedModels: vi.fn().mockResolvedValue(LIVE_SDK_MODELS),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  await service.start();
  return service.getModels().map((model) => model.id);
}

afterEach(() => {
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('built-in Claude defaults', () => {
  // FB-120: the previous build shipped `claude-code:opus-1m` as the built-in
  // default while the catalog published `claude-code:opus[1m]`. The engine
  // rejected it outright ("Model \"opus-1m\" is not a recognized model id"),
  // and every session created from that default lost its effort control.
  it('GREEN ES: every built-in Claude default exists in the engine-reported catalog', async () => {
    const ids = await liveCatalogIds();

    expect(ids).toContain(DEFAULT_MODELS['claude-code']);
    expect(ids).toContain(ClaudeCodeDeps.DEFAULT_MODEL);
    // The CLI channel shares the engine's selectable values under its own
    // namespace, so compare the variant rather than the host prefix.
    expect(ids).toContain(
      DEFAULT_MODELS['claude-code-cli'].replace(/^claude-code-cli:/, 'claude-code:'),
    );
  });

  it('GREEN ES: a built-in default is never a product-minted spelling', async () => {
    const ids = await liveCatalogIds();
    const defaults = [
      DEFAULT_MODELS['claude-code'],
      DEFAULT_MODELS['claude-code-cli'].replace(/^claude-code-cli:/, 'claude-code:'),
      ClaudeCodeDeps.DEFAULT_MODEL,
    ];

    for (const value of defaults) {
      // A `-1m` suffix is the product's own historical spelling; the engine
      // publishes context variants as `[1m]`. Minting one here is exactly the
      // FB-120 defect, and it must not be reintroduced silently.
      expect(value).not.toMatch(/-1m$/);
      expect(ids).toContain(value);
    }
  });
});

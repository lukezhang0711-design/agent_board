/**
 * agy model discovery shared by the backend request path and the dynamic
 * provider-model list. The static entries are deliberately kept as the
 * offline fallback for machines where `agy models` is unavailable.
 */

export interface AgyModelDescriptor {
  /** Stable extension-facing key, without the provider prefix. */
  key: string;
  /** Exact id passed to `agy --model`. */
  agyModel: string;
  /** Human-readable label shown by the host model picker. */
  displayName: string;
  default?: boolean;
}

export const AGY_MODEL_MAP: Readonly<Record<string, string>> = Object.freeze({
  'gemini-3-flash-agent': 'gemini-3.6-flash-high',
  'gemini-3.5-flash-low': 'gemini-3.6-flash-medium',
  'gemini-3.5-flash-extra-low': 'gemini-3.6-flash-low',
});

export const STATIC_AGY_MODELS: readonly AgyModelDescriptor[] = Object.freeze([
  {
    key: 'gemini-3-flash-agent',
    agyModel: 'gemini-3.6-flash-high',
    displayName: 'Gemini 3.5 Flash (High)',
    default: true,
  },
  {
    key: 'gemini-3.5-flash-low',
    agyModel: 'gemini-3.6-flash-medium',
    displayName: 'Gemini 3.5 Flash (Medium)',
  },
  {
    key: 'gemini-3.5-flash-extra-low',
    agyModel: 'gemini-3.6-flash-low',
    displayName: 'Gemini 3.5 Flash (Low)',
  },
]);

const MODEL_ID_PATTERN = /\bgemini-[a-z0-9][a-z0-9._-]*\b/gi;

function normalizeModelId(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/^[\[({"']+/, '')
    .replace(/[\],;:)"'}]+$/, '')
    .toLowerCase();
  return normalized.startsWith('gemini-') && normalized.length > 'gemini-'.length
    ? normalized
    : undefined;
}

function collectJsonModelIds(value: unknown, output: Set<string>, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    for (const match of value.matchAll(MODEL_ID_PATTERN)) {
      const normalized = normalizeModelId(match[0]);
      if (normalized) output.add(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonModelIds(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectJsonModelIds(child, output, depth + 1);
  }
}

/** Parse both human-readable and JSON-shaped `agy models` output. */
export function parseAgyModelsOutput(output: string): string[] {
  const modelIds = new Set<string>();
  const trimmed = output.trim();

  if (trimmed) {
    try {
      collectJsonModelIds(JSON.parse(trimmed) as unknown, modelIds);
    } catch {
      // Human-readable table output is the normal CLI shape.
    }
    for (const match of trimmed.matchAll(MODEL_ID_PATTERN)) {
      const normalized = normalizeModelId(match[0]);
      if (normalized) modelIds.add(normalized);
    }
  }

  return [...modelIds];
}

function humanizeModelId(modelId: string): string {
  return modelId
    .split('-')
    .map((part) => part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ');
}

/** Convert the ids printed by agy into stable extension model descriptors. */
export function buildAgyModelCatalog(modelIds: readonly string[]): AgyModelDescriptor[] {
  const staticById = new Map<string, AgyModelDescriptor>();
  for (const model of STATIC_AGY_MODELS) {
    staticById.set(model.key, model);
    staticById.set(model.agyModel, model);
  }

  const catalog: AgyModelDescriptor[] = [];
  const seenKeys = new Set<string>();
  for (const rawId of modelIds) {
    const modelId = normalizeModelId(rawId);
    if (!modelId) continue;
    const known = staticById.get(modelId);
    const descriptor = known ?? {
      key: modelId,
      agyModel: modelId,
      displayName: humanizeModelId(modelId),
    };
    if (seenKeys.has(descriptor.key)) continue;
    seenKeys.add(descriptor.key);
    catalog.push({ ...descriptor });
  }

  if (catalog.length > 0 && !catalog.some((model) => model.default)) {
    catalog[0] = { ...catalog[0], default: true };
  }
  return catalog;
}

import fs from 'node:fs';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import type { AIModel, AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import type { EffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';

/** The state is deliberately separate from channel health's existing verdicts. */
export type CodexModelRefreshPhase = 'normal' | 'retrying' | 'stopped';
export type CodexModelSource = 'runtime' | 'cache' | 'none';
export type CodexModelRefreshErrorCategory = 'network' | 'child_process' | 'upstream_rejected';

export interface CodexModelRefreshError {
  category: CodexModelRefreshErrorCategory;
  /** Original command / engine message. This is rendered verbatim in the UI. */
  message: string;
  at: number;
}

export interface CodexModelRefreshState {
  phase: CodexModelRefreshPhase;
  /** runtime/cache are verified; placeholder is first-install only. */
  modelSource: CodexModelSource;
  verified: boolean;
  attempt: number;
  maxAttempts: number;
  inFlight: boolean;
  nextRetryAt: number | null;
  lastError: CodexModelRefreshError | null;
  lastSuccessAt: number | null;
}

interface CatalogReasoningLevel {
  effort?: unknown;
  reasoningEffort?: unknown;
  level?: unknown;
  description?: unknown;
}

interface CatalogModel {
  id?: unknown;
  slug?: unknown;
  model?: unknown;
  name?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  description?: unknown;
  priority?: unknown;
  isDefault?: unknown;
  default?: unknown;
  defaultReasoningEffort?: unknown;
  default_reasoning_level?: unknown;
  supportedReasoningEfforts?: unknown;
  supported_reasoning_levels?: unknown;
  visibility?: unknown;
  hidden?: unknown;
  context_window?: unknown;
  max_context_window?: unknown;
}

interface ModelsCatalog {
  models: CatalogModel[];
  [key: string]: unknown;
}

interface CacheMetadata {
  source: 'codex app-server model/list';
  lastSuccessAt: number;
}

/** Raw response from app-server `model/list`, retained without a CLI fallback. */
export type CodexModelListFetcher = () => Promise<unknown>;

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type IpcRegister = (channel: string, handler: IpcHandler) => void;

interface RefreshLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface CodexModelRefreshServiceOptions {
  /** Raw app-server `model/list` response. */
  catalogPath: string;
  fetchCatalog: CodexModelListFetcher;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  manualRetryDedupeMs?: number;
  logger?: RefreshLogger;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MANUAL_RETRY_DEDUPE_MS = 2_000;
const CACHE_SOURCE = 'codex app-server model/list' as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}


function parseCatalog(value: unknown): ModelsCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { models?: unknown; data?: unknown; items?: unknown; result?: unknown };
  const nested = record.result && typeof record.result === 'object'
    ? record.result as { models?: unknown; data?: unknown; items?: unknown }
    : undefined;
  const models = record.models ?? record.data ?? record.items
    ?? nested?.models ?? nested?.data ?? nested?.items;
  if (!Array.isArray(models) || models.length === 0 || models.some((model) => !model || typeof model !== 'object')) {
    return null;
  }
  // Preserve raw app-server rows exactly; mapping below reads only display and
  // capability fields without manufacturing names or effort tiers.
  return { models: models as CatalogModel[] };
}

function parseCacheMetadata(value: unknown): CacheMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const source = (value as { source?: unknown }).source;
  const lastSuccessAt = (value as { lastSuccessAt?: unknown }).lastSuccessAt;
  if (source !== CACHE_SOURCE || typeof lastSuccessAt !== 'number' || !Number.isFinite(lastSuccessAt)) return null;
  return { source: CACHE_SOURCE, lastSuccessAt };
}

function toProviderModelId(rawId: string): string {
  return rawId.startsWith('openai-codex:') ? rawId : `openai-codex:${rawId}`;
}

function rawString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && value.trim().length > 0;
}

function modelEffortLevels(model: CatalogModel): EffortLevel[] {
  const declared = model.supportedReasoningEfforts ?? model.supported_reasoning_levels;
  if (!Array.isArray(declared)) return [];
  const levels: EffortLevel[] = [];
  for (const entry of declared) {
    const effort = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object'
        ? (entry as CatalogReasoningLevel).effort
          ?? (entry as CatalogReasoningLevel).reasoningEffort
          ?? (entry as CatalogReasoningLevel).level
        : undefined;
    // Values are opaque engine vocabulary. We only discard whitespace-only
    // records; no provider-wide normalization or synthetic tier is applied.
    const raw = isEffortLevel(effort) ? effort : undefined;
    if (raw && !levels.includes(raw)) levels.push(raw);
  }
  return levels;
}

function mapCatalogModels(catalog: ModelsCatalog): AIModel[] {
  const mapped = new Map<string, { model: AIModel; priority?: number }>();
  for (const model of catalog.models) {
    // Current app-server rows use `hidden: false`; older app-server releases
    // use `visibility: 'list'`. Do not guess when neither native marker is
    // present, and let an explicit legacy visibility marker take precedence.
    const isVisible = model.visibility !== undefined
      ? model.visibility === 'list'
      : model.hidden === false;
    if (!isVisible) continue;
    const rawId = rawString(model.id) ?? rawString(model.slug) ?? rawString(model.model);
    if (!rawId) continue;
    const levels = modelEffortLevels(model);
    const declaredDefaultEffort = rawString(model.defaultReasoningEffort)
      ?? rawString(model.default_reasoning_level);
    const defaultEffortLevel = declaredDefaultEffort && levels.includes(declaredDefaultEffort)
      ? declaredDefaultEffort
      : undefined;
    const id = toProviderModelId(rawId);
    if (mapped.has(id)) continue;
    mapped.set(id, {
      model: {
        id,
        name: rawString(model.displayName) ?? rawString(model.display_name) ?? rawString(model.name) ?? rawId,
        provider: 'openai-codex' as AIProviderType,
        ...(typeof model.description === 'string' && model.description.trim()
          ? { description: model.description }
          : {}),
        ...(typeof model.max_context_window === 'number'
          ? { contextWindow: model.max_context_window }
          : typeof model.context_window === 'number'
            ? { contextWindow: model.context_window }
            : {}),
        supportsEffort: levels.length > 0,
        supportedEffortLevels: levels,
        ...(defaultEffortLevel ? { defaultEffortLevel } : {}),
      },
      priority: model.isDefault === true || model.default === true
        ? Number.NEGATIVE_INFINITY
        : typeof model.priority === 'number' && Number.isFinite(model.priority)
        ? model.priority
        : undefined,
    });
  }

  const entries = Array.from(mapped.values());
  const rankedEntries = entries.filter((entry): entry is { model: AIModel; priority: number } => entry.priority !== undefined);
  const lowestPriority = rankedEntries.length > 0
    ? Math.min(...rankedEntries.map((entry) => entry.priority))
    : undefined;
  const engineDefault = lowestPriority === undefined
    ? undefined
    : rankedEntries.filter((entry) => entry.priority === lowestPriority).length === 1
      ? rankedEntries.find((entry) => entry.priority === lowestPriority)?.model.id
      : undefined;

  // Codex's live catalog publishes an upstream ranking, not a static default
  // ID. Only its unique lowest-priority selectable row can be used for the
  // first-session recommendation; absent or tied ranking intentionally leaves
  // the caller on the existing explicit-reselection red path.
  return entries.map(({ model }) => (
    model.id === engineDefault ? { ...model, isEngineDefault: true } : model
  ));
}

function categoryFor(error: unknown): CodexModelRefreshErrorCategory {
  const message = errorMessage(error);
  if (/spawn|ENOENT|EACCES|executable|command not found/i.test(message)) return 'child_process';
  if (/\b(?:401|403|409|429)\b|unauthori[sz]ed|forbidden|rate.?limit|rejected|denied/i.test(message)) return 'upstream_rejected';
  return 'network';
}

export class CodexModelRefreshService {
  private readonly catalogPath: string;
  private readonly metadataPath: string;
  private readonly retryDelaysMs: number[];
  private readonly requestTimeoutMs: number;
  private readonly manualRetryDedupeMs: number;
  private readonly fetchCatalogFromAppServer: CodexModelListFetcher;
  private readonly log: RefreshLogger;
  private state: CodexModelRefreshState;
  private models: AIModel[] = [];
  private started = false;
  private shuttingDown = false;
  private cycle = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<CodexModelRefreshState> | null = null;
  private manualRetryInFlight: Promise<CodexModelRefreshState> | null = null;
  private manualRetryCooldownUntil = 0;

  constructor(options: CodexModelRefreshServiceOptions) {
    this.catalogPath = options.catalogPath;
    this.metadataPath = `${options.catalogPath}.status.json`;
    this.retryDelaysMs = [...(options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS)];
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.manualRetryDedupeMs = Math.max(0, options.manualRetryDedupeMs ?? DEFAULT_MANUAL_RETRY_DEDUPE_MS);
    this.fetchCatalogFromAppServer = options.fetchCatalog;
    this.log = options.logger ?? logger.main;

    const cached = this.readVerifiedCache();
    this.models = cached?.models ?? [];
    this.state = {
      phase: 'normal',
      modelSource: cached ? 'cache' : 'none',
      verified: !!cached,
      attempt: 0,
      maxAttempts: this.retryDelaysMs.length + 1,
      inFlight: false,
      nextRetryAt: null,
      lastError: null,
      lastSuccessAt: cached?.lastSuccessAt ?? null,
    };
  }

  getStatus(): CodexModelRefreshState {
    return { ...this.state, lastError: this.state.lastError ? { ...this.state.lastError } : null };
  }

  getModels(): AIModel[] {
    return this.models.map((model) => ({ ...model, supportedEffortLevels: model.supportedEffortLevels && [...model.supportedEffortLevels] }));
  }

  start(): Promise<CodexModelRefreshState> {
    if (this.started) return this.inFlight ?? Promise.resolve(this.getStatus());
    this.started = true;
    this.shuttingDown = false;
    this.attempt = 0;
    return this.launchAttempt(++this.cycle);
  }

  manualRetry(): Promise<CodexModelRefreshState> {
    if (this.manualRetryInFlight) return this.manualRetryInFlight;
    if (Date.now() < this.manualRetryCooldownUntil) return Promise.resolve(this.getStatus());
    this.started = true;
    this.shuttingDown = false;
    this.clearRetryTimer();
    this.attempt = 0;
    const cycle = ++this.cycle;
    const run = (this.inFlight ? this.inFlight.then(() => this.launchAttempt(cycle)) : this.launchAttempt(cycle));
    const tracked = run.finally(() => {
      if (this.manualRetryInFlight === tracked) this.manualRetryInFlight = null;
      this.manualRetryCooldownUntil = Date.now() + this.manualRetryDedupeMs;
    });
    this.manualRetryInFlight = tracked;
    return tracked;
  }

  registerIpcHandlers(register: IpcRegister = safeHandle as IpcRegister): void {
    register('ai:getModelRefreshStatus', async () => ({ success: true, status: this.getStatus() }));
    register('ai:retryModelRefresh', async () => {
      const status = await this.manualRetry();
      return {
        success: status.verified && !status.lastError,
        status,
        ...(status.lastError ? { error: status.lastError.message } : {}),
      };
    });
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.started = false;
    ++this.cycle;
    this.clearRetryTimer();
  }

  private launchAttempt(cycle: number): Promise<CodexModelRefreshState> {
    if (this.inFlight) return this.inFlight;
    const tracked = this.runAttempt(cycle).finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
    });
    this.inFlight = tracked;
    return tracked;
  }

  private async runAttempt(cycle: number): Promise<CodexModelRefreshState> {
    if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
    this.attempt += 1;
    this.state = { ...this.state, phase: 'retrying', attempt: this.attempt, inFlight: true, nextRetryAt: null };
    try {
      const catalog = await this.fetchCatalog();
      const models = mapCatalogModels(catalog);
      if (models.length === 0) throw new Error('codex app-server model/list returned no visible models');
      if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
      const lastSuccessAt = Date.now();
      this.writeJsonAtomically(this.catalogPath, catalog);
      this.writeJsonAtomically(this.metadataPath, { source: CACHE_SOURCE, lastSuccessAt } satisfies CacheMetadata);
      this.models = models;
      this.attempt = 0;
      this.state = {
        ...this.state,
        phase: 'normal',
        modelSource: 'runtime',
        verified: true,
        attempt: 0,
        inFlight: false,
        nextRetryAt: null,
        lastError: null,
        lastSuccessAt,
      };
      this.log.info('[CodexModelRefresh] app-server model/list succeeded', { modelCount: models.length, lastSuccessAt });
      return this.getStatus();
    } catch (error) {
      if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
      const message = errorMessage(error);
      const lastError: CodexModelRefreshError = { category: categoryFor(error), message, at: Date.now() };
      const hasRetry = this.attempt <= this.retryDelaysMs.length;
      const delayMs = hasRetry ? this.retryDelaysMs[this.attempt - 1] : undefined;
      const nextRetryAt = delayMs === undefined ? null : Date.now() + delayMs;
      const keepCache = this.state.verified && this.models.length > 0;
      this.models = keepCache ? this.models : [];
      this.state = {
        ...this.state,
        phase: hasRetry ? 'retrying' : 'stopped',
        modelSource: keepCache ? 'cache' : 'none',
        verified: keepCache,
        attempt: this.attempt,
        inFlight: false,
        nextRetryAt,
        lastError,
      };
      this.log.warn(`[CodexModelRefresh][${lastError.category}] refresh attempt ${this.attempt}/${this.state.maxAttempts} failed`, {
        error: message,
        nextRetryAt,
        cacheRetained: keepCache,
      });
      if (delayMs !== undefined) this.scheduleRetry(cycle, delayMs);
      return this.getStatus();
    }
  }

  private async fetchCatalog(): Promise<ModelsCatalog> {
    const response = await withTimeout(
      this.fetchCatalogFromAppServer(),
      this.requestTimeoutMs,
      'codex app-server model/list',
    );
    const catalog = parseCatalog(response);
    if (!catalog) throw new Error('codex app-server model/list returned no models array');
    return catalog;
  }

  private scheduleRetry(cycle: number, delayMs: number): void {
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (cycle !== this.cycle || this.shuttingDown) return;
      void this.launchAttempt(cycle);
    }, delayMs);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private readVerifiedCache(): { models: AIModel[]; lastSuccessAt: number } | null {
    try {
      const catalog = parseCatalog(JSON.parse(fs.readFileSync(this.catalogPath, 'utf8')));
      const metadata = parseCacheMetadata(JSON.parse(fs.readFileSync(this.metadataPath, 'utf8')));
      if (!catalog || !metadata) return null;
      const models = mapCatalogModels(catalog);
      return models.length > 0 ? { models, lastSuccessAt: metadata.lastSuccessAt } : null;
    } catch {
      return null;
    }
  }

  private writeJsonAtomically(targetPath: string, value: unknown): void {
    const directory = path.dirname(targetPath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, targetPath);
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* no temporary file left */ }
    }
  }
}

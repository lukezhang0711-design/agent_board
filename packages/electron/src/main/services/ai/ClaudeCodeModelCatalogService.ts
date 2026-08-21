import fs from 'node:fs';
import path from 'node:path';
import { query, type ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import type { AIModel, AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import { EFFORT_LEVELS, type EffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';
import { logger } from '../../utils/logger';

export type ClaudeCodeModelCatalogPhase = 'normal' | 'retrying' | 'stopped';
export type ClaudeCodeModelCatalogSource = 'runtime' | 'cache' | 'placeholder' | 'none';
export type ClaudeCodeModelCatalogErrorCategory = 'sdk' | 'timeout' | 'upstream_rejected';

export interface ClaudeCodeModelCatalogError {
  category: ClaudeCodeModelCatalogErrorCategory;
  /** The source error is intentionally preserved for a user-visible red light. */
  message: string;
  at: number;
}

export interface ClaudeCodeModelCatalogState {
  phase: ClaudeCodeModelCatalogPhase;
  modelSource: ClaudeCodeModelCatalogSource;
  verified: boolean;
  attempt: number;
  maxAttempts: number;
  inFlight: boolean;
  nextRetryAt: number | null;
  lastError: ClaudeCodeModelCatalogError | null;
  lastSuccessAt: number | null;
}

export interface ClaudeSupportedModel {
  value: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: readonly string[];
}

/**
 * The abort signal is fired when the catalog watchdog expires. SDK-backed
 * fetchers must use it to tear down their control session; injected fetchers
 * may safely ignore it in tests.
 */
export type ClaudeSupportedModelsFetcher = (
  signal?: AbortSignal,
  explicitAuthEnv?: NodeJS.ProcessEnv,
) => Promise<readonly ClaudeSupportedModel[]>;

interface CatalogLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface ClaudeCodeModelCatalogServiceOptions {
  cachePath: string;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  manualRetryDedupeMs?: number;
  /**
   * Only explicitly configured Claude Code API-key auth is forwarded to the
   * SDK probe. Login-based sessions intentionally receive no ambient key.
   */
  getExplicitAuthEnv?: () => NodeJS.ProcessEnv;
  fetchSupportedModels?: ClaudeSupportedModelsFetcher;
  logger?: CatalogLogger;
}

interface PersistedClaudeCatalog {
  source: 'claude-agent-sdk:supportedModels';
  lastSuccessAt: number;
  models: ClaudeSupportedModel[];
}

const CACHE_SOURCE = 'claude-agent-sdk:supportedModels' as const;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MANUAL_RETRY_DEDUPE_MS = 2_000;
const DEFAULT_SDK_EFFORT_LEVELS = EFFORT_LEVELS.map(({ key }) => key);

/** First-install UI-only placeholder. It disappears after any failed discovery. */
const INITIAL_UNVERIFIED_PLACEHOLDER: AIModel[] = [{
  id: 'claude-code:opus-1m',
  name: 'Claude Agent · Opus (unverified)',
  provider: 'claude-code' as AIProviderType,
  unverifiedPlaceholder: true,
}];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max'
    || value === 'ultra';
}

/** Converts the SDK's `opus[1m]` contract into Nimbalyst's persisted `opus-1m`. */
export function toClaudeCodeCatalogVariant(value: string): string {
  return value.trim().toLowerCase().replace(/\[1m\]$/i, '-1m');
}

function mapSupportedModels(models: readonly ClaudeSupportedModel[]): AIModel[] {
  const result = new Map<string, AIModel>();
  for (const model of models) {
    if (!model || typeof model.value !== 'string' || !model.value.trim()) continue;
    const variant = toClaudeCodeCatalogVariant(model.value);
    if (!variant) continue;
    const id = `claude-code:${variant}`;
    if (result.has(id)) continue;
    const supportsEffort = model.supportsEffort === true;
    const advertisedEffortLevels = (model.supportedEffortLevels ?? []).filter(isEffortLevel);
    // `supportsEffort` is the documented SDK contract. Newer SDK runtimes may
    // additionally advertise an exact list; use that when present. If they do
    // not, the documented boolean must still enable the existing effort
    // selector instead of making a capable model look unsupported. This is a
    // UI control vocabulary, not a static model-catalog fallback.
    const effortLevels = supportsEffort
      ? (advertisedEffortLevels.length > 0 ? advertisedEffortLevels : [...DEFAULT_SDK_EFFORT_LEVELS])
      : [];
    result.set(id, {
      id,
      name: `Claude Agent · ${model.displayName?.trim() || model.value.trim()}`,
      provider: 'claude-code' as AIProviderType,
      contextWindow: variant.endsWith('-1m') ? 1_000_000 : 200_000,
      ...(model.description?.trim() ? { description: model.description } : {}),
      ...(model.resolvedModel?.trim() ? { resolvedModel: model.resolvedModel } : {}),
      supportsEffort,
      supportedEffortLevels: effortLevels,
      // `default` is an SDK-supplied selectable value (shown by the engine as
      // "Default (recommended)"), not a Nimbalyst model preset.
      isEngineDefault: model.value.trim().toLowerCase() === 'default',
    });
  }
  return Array.from(result.values());
}

function mapCliModels(models: AIModel[]): AIModel[] {
  return models.map((model) => ({
    ...model,
    id: `claude-code-cli:${model.id.slice('claude-code:'.length)}`,
    provider: 'claude-code-cli' as AIProviderType,
    name: model.name.replace(/^Claude Agent · /, 'Claude Code CLI · '),
  }));
}

function categoryFor(error: unknown): ClaudeCodeModelCatalogErrorCategory {
  const message = errorMessage(error);
  if (/timed out/i.test(message)) return 'timeout';
  if (/\b(?:401|403|429)\b|unauthori[sz]ed|forbidden|rejected|denied/i.test(message)) return 'upstream_rejected';
  return 'sdk';
}

async function* idleControlPrompt(): AsyncGenerator<never, void, unknown> {
  await new Promise<void>(() => {});
}

/**
 * Opens an SDK control session without providing a user message. `supportedModels`
 * is a control-plane request; closing immediately afterwards guarantees no model
 * turn is started or billed merely to populate the picker.
 */
async function fetchSupportedModelsFromSdk(
  signal?: AbortSignal,
  explicitAuthEnv?: NodeJS.ProcessEnv,
): Promise<readonly ClaudeSupportedModel[]> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;
  // The application strips ambient API keys at bootstrap. Re-add one only
  // when the user explicitly selected Claude Code API-key auth in settings,
  // matching the actual provider session path without reintroducing implicit
  // environment billing.
  const explicitApiKey = explicitAuthEnv?.ANTHROPIC_API_KEY?.trim();
  if (explicitApiKey) {
    env.ANTHROPIC_API_KEY = explicitApiKey;
  }
  const control = query({
    prompt: idleControlPrompt(),
    options: {
      tools: [],
      permissionMode: 'dontAsk',
      persistSession: false,
      includePartialMessages: false,
      env,
    },
  });
  // `supportedModels()` may wait for the control process indefinitely. The
  // service watchdog must be able to close that process immediately instead
  // of merely rejecting its outer promise and leaving an idle SDK session.
  const closeControl = () => {
    try {
      control.close();
    } catch {
      // A concurrent normal completion may already have closed the session.
    }
  };
  const abortControl = () => closeControl();
  signal?.addEventListener('abort', abortControl, { once: true });
  try {
    if (signal?.aborted) {
      throw new Error('Claude SDK supportedModels aborted');
    }
    return await control.supportedModels() as ModelInfo[];
  } finally {
    signal?.removeEventListener('abort', abortControl);
    closeControl();
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class ClaudeCodeModelCatalogService {
  private readonly cachePath: string;
  private readonly retryDelaysMs: number[];
  private readonly requestTimeoutMs: number;
  private readonly manualRetryDedupeMs: number;
  private readonly getExplicitAuthEnv: () => NodeJS.ProcessEnv;
  private readonly fetchSupportedModels: ClaudeSupportedModelsFetcher;
  private readonly log: CatalogLogger;
  private state: ClaudeCodeModelCatalogState;
  private models: AIModel[];
  private started = false;
  private shuttingDown = false;
  private cycle = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<ClaudeCodeModelCatalogState> | null = null;
  private manualRetryInFlight: Promise<ClaudeCodeModelCatalogState> | null = null;
  private manualRetryCooldownUntil = 0;

  constructor(options: ClaudeCodeModelCatalogServiceOptions) {
    this.cachePath = options.cachePath;
    this.retryDelaysMs = [...(options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS)];
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.manualRetryDedupeMs = Math.max(0, options.manualRetryDedupeMs ?? DEFAULT_MANUAL_RETRY_DEDUPE_MS);
    this.getExplicitAuthEnv = options.getExplicitAuthEnv ?? (() => ({}));
    this.fetchSupportedModels = options.fetchSupportedModels ?? fetchSupportedModelsFromSdk;
    this.log = options.logger ?? logger.main;

    const cached = this.readVerifiedCache();
    this.models = cached?.models ?? INITIAL_UNVERIFIED_PLACEHOLDER.map((model) => ({ ...model }));
    this.state = {
      phase: 'normal',
      modelSource: cached ? 'cache' : 'placeholder',
      verified: !!cached,
      attempt: 0,
      maxAttempts: this.retryDelaysMs.length + 1,
      inFlight: false,
      nextRetryAt: null,
      lastError: null,
      lastSuccessAt: cached?.lastSuccessAt ?? null,
    };
  }

  getStatus(): ClaudeCodeModelCatalogState {
    return { ...this.state, lastError: this.state.lastError ? { ...this.state.lastError } : null };
  }

  getModels(): AIModel[] {
    return this.models.map((model) => ({ ...model, supportedEffortLevels: model.supportedEffortLevels && [...model.supportedEffortLevels] }));
  }

  getCliModels(): AIModel[] {
    return mapCliModels(this.getModels());
  }

  start(): Promise<ClaudeCodeModelCatalogState> {
    if (this.started) return this.inFlight ?? Promise.resolve(this.getStatus());
    this.started = true;
    this.shuttingDown = false;
    this.attempt = 0;
    return this.launchAttempt(++this.cycle);
  }

  manualRetry(): Promise<ClaudeCodeModelCatalogState> {
    if (this.manualRetryInFlight) return this.manualRetryInFlight;
    if (Date.now() < this.manualRetryCooldownUntil) return Promise.resolve(this.getStatus());
    this.started = true;
    this.shuttingDown = false;
    this.clearRetryTimer();
    this.attempt = 0;
    const cycle = ++this.cycle;
    const run = this.inFlight ? this.inFlight.then(() => this.launchAttempt(cycle)) : this.launchAttempt(cycle);
    const tracked = run.finally(() => {
      if (this.manualRetryInFlight === tracked) this.manualRetryInFlight = null;
      this.manualRetryCooldownUntil = Date.now() + this.manualRetryDedupeMs;
    });
    this.manualRetryInFlight = tracked;
    return tracked;
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.started = false;
    ++this.cycle;
    this.clearRetryTimer();
  }

  private launchAttempt(cycle: number): Promise<ClaudeCodeModelCatalogState> {
    if (this.inFlight) return this.inFlight;
    const tracked = this.runAttempt(cycle).finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
    });
    this.inFlight = tracked;
    return tracked;
  }

  private async runAttempt(cycle: number): Promise<ClaudeCodeModelCatalogState> {
    if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
    this.attempt += 1;
    this.state = { ...this.state, phase: 'retrying', attempt: this.attempt, inFlight: true, nextRetryAt: null };
    try {
      const abortController = new AbortController();
      const sourceModels = await withTimeout(
        Promise.resolve(this.fetchSupportedModels(abortController.signal, this.getExplicitAuthEnv())),
        this.requestTimeoutMs,
        'Claude SDK supportedModels',
        () => abortController.abort(),
      );
      const models = mapSupportedModels(sourceModels);
      if (models.length === 0) throw new Error('Claude SDK supportedModels returned no models');
      if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
      const lastSuccessAt = Date.now();
      this.writeCache({ source: CACHE_SOURCE, lastSuccessAt, models: sourceModels.map((model) => ({ ...model, supportedEffortLevels: model.supportedEffortLevels && [...model.supportedEffortLevels] })) });
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
      this.log.info('[ClaudeCodeModelCatalog] supportedModels succeeded', { modelCount: models.length, lastSuccessAt });
      return this.getStatus();
    } catch (error) {
      if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
      const message = errorMessage(error);
      const lastError: ClaudeCodeModelCatalogError = { category: categoryFor(error), message, at: Date.now() };
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
      this.log.warn(`[ClaudeCodeModelCatalog][${lastError.category}] refresh attempt ${this.attempt}/${this.state.maxAttempts} failed`, {
        error: message,
        nextRetryAt,
        cacheRetained: keepCache,
      });
      if (delayMs !== undefined) this.scheduleRetry(cycle, delayMs);
      return this.getStatus();
    }
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
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8')) as Partial<PersistedClaudeCatalog>;
      if (parsed.source !== CACHE_SOURCE || typeof parsed.lastSuccessAt !== 'number' || !Array.isArray(parsed.models)) return null;
      const models = mapSupportedModels(parsed.models as ClaudeSupportedModel[]);
      return models.length > 0 ? { models, lastSuccessAt: parsed.lastSuccessAt } : null;
    } catch {
      return null;
    }
  }

  private writeCache(value: PersistedClaudeCatalog): void {
    const directory = path.dirname(this.cachePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.cachePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.cachePath);
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* no temporary file left */ }
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { IpcMainInvokeEvent } from 'electron';
import type { AIModel, AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import type { EffortLevel } from '@nimbalyst/runtime/ai/server/effortLevels';
import {
  getCodexVendorPathEntries,
  resolveCodexBinaryPath,
} from '@nimbalyst/runtime/ai/server/protocols/codexAppServer/codexAppServerBinary';
import { resolvePackagedCodexBinaryPath } from '@nimbalyst/runtime/ai/server/providers/codex/codexBinaryPath';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { getEnhancedPath } from './CLIManager';

/** The state is deliberately separate from channel health's existing verdicts. */
export type CodexModelRefreshPhase = 'normal' | 'retrying' | 'stopped';
export type CodexModelSource = 'runtime' | 'cache' | 'placeholder' | 'none';
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
  description?: unknown;
}

interface CatalogModel {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
  visibility?: unknown;
  context_window?: unknown;
  max_context_window?: unknown;
}

interface ModelsCatalog {
  models: CatalogModel[];
  [key: string]: unknown;
}

interface CacheMetadata {
  source: 'codex debug models';
  lastSuccessAt: number;
}

export type CodexModelsCommandRunner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<{ stdout: string; stderr?: string }>;

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type IpcRegister = (channel: string, handler: IpcHandler) => void;

interface RefreshLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface CodexModelRefreshServiceOptions {
  /** Raw `codex debug models` JSON, supplied unchanged to app-server children. */
  catalogPath: string;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  manualRetryDedupeMs?: number;
  resolveBinaryPath?: () => string;
  buildEnv?: (binaryPath: string) => NodeJS.ProcessEnv;
  commandRunner?: CodexModelsCommandRunner;
  logger?: RefreshLogger;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MANUAL_RETRY_DEDUPE_MS = 2_000;
const CACHE_SOURCE = 'codex debug models' as const;

/**
 * The sole permitted static inventory. It is visible only before the very
 * first discovery attempt and carries `unverifiedPlaceholder`; a failure
 * clears it instead of exposing it as an implicit fallback.
 */
const INITIAL_UNVERIFIED_PLACEHOLDER: AIModel[] = [{
  id: 'openai-codex:gpt-5.5',
  name: 'GPT-5.5',
  provider: 'openai-codex' as AIProviderType,
  unverifiedPlaceholder: true,
}];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultBuildEnv(binaryPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathEntries = [
    ...getCodexVendorPathEntries(binaryPath),
    ...getEnhancedPath().split(path.delimiter),
    ...(env.PATH ?? env.Path ?? '').split(path.delimiter),
  ].filter(Boolean);
  env.PATH = Array.from(new Set(pathEntries)).join(path.delimiter);
  delete env.Path;
  // `codex debug models` must authenticate exactly like the installed CLI.
  // Environment API keys would turn this probe into a different product path.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

const defaultCommandRunner: CodexModelsCommandRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;
  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    callback();
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    try { child.kill('SIGTERM'); } catch { /* best-effort cleanup */ }
    // Do not wait for a misbehaving child to emit `close`: callers must
    // receive the original timeout and turn the catalog health indicator red.
    settle(() => reject(new Error(`codex debug models timed out after ${options.timeoutMs}ms`)));
  }, options.timeoutMs);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.once('error', (error) => settle(() => reject(error)));
  child.once('close', (code, signal) => settle(() => {
    if (timedOut) {
      reject(new Error(`codex debug models timed out after ${options.timeoutMs}ms`));
      return;
    }
    if (code !== 0) {
      reject(new Error(stderr.trim() || `codex debug models exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`));
      return;
    }
    resolve({ stdout, stderr });
  }));
});

function parseCatalog(value: unknown): ModelsCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models) || models.length === 0 || models.some((model) => !model || typeof model !== 'object')) {
    return null;
  }
  // Keep the exact CLI payload shape for the persisted catalog consumed by
  // app-server children; mapping below reads only the documented fields.
  return value as ModelsCatalog;
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

function isEffortLevel(value: unknown): value is EffortLevel {
  return value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max'
    || value === 'ultra';
}

function modelEffortLevels(model: CatalogModel): EffortLevel[] {
  if (!Array.isArray(model.supported_reasoning_levels)) return [];
  const levels: EffortLevel[] = [];
  for (const entry of model.supported_reasoning_levels) {
    const effort = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object'
        ? (entry as CatalogReasoningLevel).effort
        : undefined;
    if (isEffortLevel(effort) && !levels.includes(effort)) levels.push(effort);
  }
  return levels;
}

function mapCatalogModels(catalog: ModelsCatalog): AIModel[] {
  const mapped = new Map<string, AIModel>();
  for (const model of catalog.models) {
    // `list` is intentional. `hide` AND every unknown visibility must stay out.
    if (model.visibility !== 'list' || typeof model.slug !== 'string' || !model.slug.trim()) continue;
    const levels = modelEffortLevels(model);
    const defaultEffortLevel = isEffortLevel(model.default_reasoning_level)
      ? model.default_reasoning_level
      : undefined;
    const id = toProviderModelId(model.slug);
    if (mapped.has(id)) continue;
    mapped.set(id, {
      id,
      name: typeof model.display_name === 'string' && model.display_name.trim()
        ? model.display_name
        : model.slug,
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
    });
  }
  return Array.from(mapped.values());
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
  private readonly resolveBinaryPath: () => string;
  private readonly buildEnv: (binaryPath: string) => NodeJS.ProcessEnv;
  private readonly commandRunner: CodexModelsCommandRunner;
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
    this.resolveBinaryPath = options.resolveBinaryPath
      ?? (() => resolveCodexBinaryPath(() => resolvePackagedCodexBinaryPath(), getEnhancedPath()));
    this.buildEnv = options.buildEnv ?? defaultBuildEnv;
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
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

  getStatus(): CodexModelRefreshState {
    return { ...this.state, lastError: this.state.lastError ? { ...this.state.lastError } : null };
  }

  getModels(): AIModel[] {
    return this.models.map((model) => ({ ...model, supportedEffortLevels: model.supportedEffortLevels && [...model.supportedEffortLevels] }));
  }

  /**
   * App-server children may receive only a fresh successful discovery. A cache
   * remains UI evidence after a failed refresh, but must never become runtime
   * execution input while its red-light error is active.
   */
  getCatalogPath(): string | undefined {
    return this.state.modelSource === 'runtime'
      && this.state.verified
      && !this.state.lastError
      ? this.catalogPath
      : undefined;
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
      if (models.length === 0) throw new Error('codex debug models returned no visibility=list models');
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
      this.log.info('[CodexModelRefresh] `codex debug models` succeeded', { modelCount: models.length, lastSuccessAt });
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
    const binaryPath = this.resolveBinaryPath();
    const result = await this.commandRunner(binaryPath, ['debug', 'models'], {
      env: this.buildEnv(binaryPath),
      timeoutMs: this.requestTimeoutMs,
    });
    try {
      const catalog = parseCatalog(JSON.parse(result.stdout));
      if (!catalog) throw new Error('response has no models array');
      return catalog;
    } catch (error) {
      const stderr = result.stderr?.trim();
      throw new Error(`codex debug models returned invalid JSON: ${errorMessage(error)}${stderr ? `; stderr: ${stderr}` : ''}`);
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

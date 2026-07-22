import fs from 'node:fs';
import path from 'node:path';
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import type { IpcMainInvokeEvent } from 'electron';
import type { AIModel, AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import { JsonRpcClient } from '@nimbalyst/runtime/ai/server/protocols/codexAppServer/jsonRpcClient';
import {
  getCodexVendorPathEntries,
  resolveCodexBinaryPath,
} from '@nimbalyst/runtime/ai/server/protocols/codexAppServer/codexAppServerBinary';
import { resolvePackagedCodexBinaryPath } from '@nimbalyst/runtime/ai/server/providers/codex/codexBinaryPath';
import type { InitializeResponse } from '@nimbalyst/runtime/ai/server/protocols/codexAppServer/types';
import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import { getEnhancedPath } from './CLIManager';

export type CodexModelRefreshPhase = 'normal' | 'retrying' | 'stopped';
export type CodexModelRefreshErrorCategory =
  | 'network'
  | 'child_process'
  | 'upstream_rejected';

export interface CodexModelRefreshError {
  category: CodexModelRefreshErrorCategory;
  message: string;
  at: number;
}

export interface CodexModelRefreshState {
  phase: CodexModelRefreshPhase;
  attempt: number;
  maxAttempts: number;
  inFlight: boolean;
  nextRetryAt: number | null;
  lastError: CodexModelRefreshError | null;
  lastSuccessAt: number | null;
}

interface ModelListPreset {
  id?: string;
  model?: string;
  displayName?: string;
  display_name?: string;
  showInPicker?: boolean;
}

interface ModelListResponse {
  data?: ModelListPreset[];
  nextCursor?: string | null;
}

interface CatalogModel {
  slug?: string;
  display_name?: string;
  visibility?: string;
}

interface ModelsCatalog {
  models: CatalogModel[];
}

type SpawnProcess = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => ChildProcessWithoutNullStreams;

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type IpcRegister = (channel: string, handler: IpcHandler) => void;

interface RefreshLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface CodexModelRefreshServiceOptions {
  catalogPath: string;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  terminationGraceMs?: number;
  manualRetryDedupeMs?: number;
  resolveBinaryPath?: () => string;
  buildEnv?: (binaryPath: string) => NodeJS.ProcessEnv;
  loadApiKey?: () => string | undefined;
  spawnProcess?: SpawnProcess;
  logger?: RefreshLogger;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_MANUAL_RETRY_DEDUPE_MS = 2_000;
const MAX_MODEL_LIST_PAGES = 20;
const SENTINEL_SLUG = '__nimbalyst_offline_catalog__';

// The sentinel is deliberately not a real selectable model. Its only job is
// to make Codex construct StaticModelsManager from the first process start.
// Explicitly selected real models miss this slug and therefore use Codex's
// own built-in fallback metadata and base instructions until a full cache has
// been promoted by the dedicated refresher.
const SENTINEL_CATALOG: ModelsCatalog = {
  models: [{
    slug: SENTINEL_SLUG,
    display_name: 'Nimbalyst offline model catalog',
    description: null,
    default_reasoning_level: null,
    supported_reasoning_levels: [],
    shell_type: 'default',
    visibility: 'hide',
    supported_in_api: false,
    priority: 2_147_483_647,
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,
    base_instructions: '',
    model_messages: null,
    supports_reasoning_summaries: false,
    default_reasoning_summary: 'auto',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    web_search_tool_type: 'text',
    truncation_policy: { mode: 'bytes', limit: 10_000 },
    supports_parallel_tool_calls: false,
    supports_image_detail_original: false,
    context_window: null,
    max_context_window: null,
    auto_compact_token_limit: null,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ['text', 'image'],
    supports_search_tool: false,
    tool_mode: null,
  } as CatalogModel],
};

class CategorizedRefreshError extends Error {
  constructor(
    readonly category: CodexModelRefreshErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = 'CategorizedRefreshError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function defaultBuildEnv(binaryPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const helperPathEntries = getCodexVendorPathEntries(binaryPath);
  const enhancedPathEntries = getEnhancedPath().split(path.delimiter).filter(Boolean);
  const existingPath = env.PATH ?? env.Path ?? '';
  env.PATH = Array.from(new Set([
    ...helperPathEntries,
    ...enhancedPathEntries,
    ...existingPath.split(path.delimiter).filter(Boolean),
  ])).join(path.delimiter);
  delete env.Path;
  return env;
}

function parseCatalog(value: unknown): ModelsCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models) || models.length === 0) return null;
  if (!models.every((model) => !!model && typeof model === 'object')) return null;
  return { models: models as CatalogModel[] };
}

function toProviderModelId(rawId: string): string {
  return rawId.startsWith('openai-codex:') ? rawId : `openai-codex:${rawId}`;
}

function mapCatalogModels(catalog: ModelsCatalog): AIModel[] {
  return catalog.models
    .filter((model) => (
      typeof model.slug === 'string'
      && model.slug !== SENTINEL_SLUG
      && model.visibility !== 'hide'
    ))
    .map((model) => ({
      id: toProviderModelId(model.slug!),
      name: model.display_name || model.slug!,
      provider: 'openai-codex' as AIProviderType,
    }));
}

function mapModelPresets(presets: ModelListPreset[]): AIModel[] {
  const byId = new Map<string, AIModel>();
  for (const preset of presets) {
    if (preset.showInPicker === false) continue;
    const rawId = preset.model || preset.id;
    if (!rawId) continue;
    const id = toProviderModelId(rawId);
    byId.set(id, {
      id,
      name: preset.displayName || preset.display_name || rawId,
      provider: 'openai-codex' as AIProviderType,
    });
  }
  return Array.from(byId.values());
}

function extractRefreshFailure(stderr: string): string | null {
  const match = stderr.match(/failed to refresh available models:\s*([^\r\n]+)/i);
  return match?.[1]?.trim() || null;
}

function categoryForUpstreamMessage(message: string): CodexModelRefreshErrorCategory {
  if (/\bchild process\b|\bprocess (?:failed to )?exit\b|\bspawn(?:ed|ing)?\b|\bSIG(?:TERM|KILL)\b/i.test(message)) {
    return 'child_process';
  }
  if (/\b(?:401|403|409|429)\b|unauthori[sz]ed|forbidden|rate.?limit|rejected|denied/i.test(message)) {
    return 'upstream_rejected';
  }
  return 'network';
}

export class CodexModelRefreshService {
  private readonly catalogPath: string;
  private readonly retryDelaysMs: number[];
  private readonly requestTimeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly manualRetryDedupeMs: number;
  private readonly resolveBinaryPath: () => string;
  private readonly buildEnv: (binaryPath: string) => NodeJS.ProcessEnv;
  private readonly loadApiKey: () => string | undefined;
  private readonly spawnProcess: SpawnProcess;
  private readonly log: RefreshLogger;

  private state: CodexModelRefreshState;
  private models: AIModel[] = [];
  private catalogReady = false;
  private started = false;
  private shuttingDown = false;
  private cycle = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<CodexModelRefreshState> | null = null;
  private manualRetryInFlight: Promise<CodexModelRefreshState> | null = null;
  private manualRetryCooldownUntil = 0;
  private activeChild: ChildProcessWithoutNullStreams | null = null;
  private activeClient: JsonRpcClient | null = null;

  constructor(options: CodexModelRefreshServiceOptions) {
    this.catalogPath = options.catalogPath;
    this.retryDelaysMs = [...(options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS)];
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    this.manualRetryDedupeMs = Math.max(
      0,
      options.manualRetryDedupeMs ?? DEFAULT_MANUAL_RETRY_DEDUPE_MS,
    );
    this.resolveBinaryPath = options.resolveBinaryPath
      ?? (() => resolveCodexBinaryPath(() => resolvePackagedCodexBinaryPath()));
    this.buildEnv = options.buildEnv ?? defaultBuildEnv;
    this.loadApiKey = options.loadApiKey ?? (() => undefined);
    this.spawnProcess = options.spawnProcess
      ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.log = options.logger ?? logger.main;
    this.state = {
      phase: 'normal',
      attempt: 0,
      maxAttempts: this.retryDelaysMs.length + 1,
      inFlight: false,
      nextRetryAt: null,
      lastError: null,
      lastSuccessAt: null,
    };

    try {
      const catalog = this.ensureBootCatalog();
      this.catalogReady = true;
      this.models = mapCatalogModels(catalog);
    } catch (error) {
      const message = `failed to initialize local model catalog: ${errorMessage(error)}`;
      this.state = {
        ...this.state,
        phase: 'stopped',
        lastError: { category: 'child_process', message, at: Date.now() },
      };
      this.log.error('[CodexModelRefresh][child_process] local catalog initialization failed', {
        error: message,
      });
    }
  }

  getStatus(): CodexModelRefreshState {
    return {
      ...this.state,
      lastError: this.state.lastError ? { ...this.state.lastError } : null,
    };
  }

  getModels(): AIModel[] {
    return this.models.map((model) => ({ ...model }));
  }

  getCatalogPath(): string | undefined {
    return this.catalogReady ? this.catalogPath : undefined;
  }

  start(): Promise<CodexModelRefreshState> {
    if (this.started) {
      return this.inFlight ?? Promise.resolve(this.getStatus());
    }
    this.started = true;
    this.shuttingDown = false;
    this.attempt = 0;
    const cycle = ++this.cycle;
    return this.launchAttempt(cycle);
  }

  manualRetry(): Promise<CodexModelRefreshState> {
    if (this.manualRetryInFlight) return this.manualRetryInFlight;
    if (Date.now() < this.manualRetryCooldownUntil) {
      return Promise.resolve(this.getStatus());
    }

    this.started = true;
    this.shuttingDown = false;
    this.clearRetryTimer();
    this.attempt = 0;
    const cycle = ++this.cycle;
    const active = this.inFlight;
    const run = active
      ? active.then(() => (
        cycle === this.cycle && !this.shuttingDown
          ? this.launchAttempt(cycle)
          : this.getStatus()
      ))
      : this.launchAttempt(cycle);
    const tracked = run.finally(() => {
      if (this.manualRetryInFlight !== tracked) return;
      this.manualRetryInFlight = null;
      if (!this.shuttingDown) {
        this.manualRetryCooldownUntil = Date.now() + this.manualRetryDedupeMs;
      }
    });
    this.manualRetryInFlight = tracked;
    return tracked;
  }

  registerIpcHandlers(register: IpcRegister = safeHandle as IpcRegister): void {
    register('ai:getModelRefreshStatus', async () => ({
      success: true,
      status: this.getStatus(),
    }));
    register('ai:retryModelRefresh', async () => {
      const status = await this.manualRetry();
      return {
        success: status.phase === 'normal',
        status,
        ...(status.phase === 'normal'
          ? {}
          : { error: status.lastError?.message ?? 'Codex model refresh failed' }),
      };
    });
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.started = false;
    this.manualRetryInFlight = null;
    this.manualRetryCooldownUntil = 0;
    ++this.cycle;
    this.clearRetryTimer();
    try { this.activeClient?.close('model refresh shutdown'); } catch { /* noop */ }
    const child = this.activeChild;
    const client = this.activeClient;
    if (child) {
      void this.terminateChild(child, client).catch((error) => {
        this.log.error('[CodexModelRefresh][child_process] shutdown cleanup failed', {
          error: errorMessage(error),
        });
      });
    }
  }

  private launchAttempt(cycle: number): Promise<CodexModelRefreshState> {
    if (this.inFlight) return this.inFlight;
    const run = this.runAttempt(cycle);
    const tracked = run.finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
    });
    this.inFlight = tracked;
    return tracked;
  }

  private async runAttempt(cycle: number): Promise<CodexModelRefreshState> {
    if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
    this.attempt += 1;
    this.state = {
      ...this.state,
      phase: 'retrying',
      attempt: this.attempt,
      inFlight: true,
      nextRetryAt: null,
    };

    try {
      const models = await this.refreshOnce();
      if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
      this.models = models;
      this.attempt = 0;
      this.state = {
        ...this.state,
        phase: 'normal',
        attempt: 0,
        inFlight: false,
        nextRetryAt: null,
        lastSuccessAt: Date.now(),
      };
      this.log.info('[CodexModelRefresh] refresh succeeded', {
        modelCount: models.length,
        lastSuccessAt: this.state.lastSuccessAt,
      });
      return this.getStatus();
    } catch (error) {
      if (cycle !== this.cycle || this.shuttingDown) return this.getStatus();
      const categorized = error instanceof CategorizedRefreshError
        ? error
        : new CategorizedRefreshError('child_process', errorMessage(error));
      const lastError: CodexModelRefreshError = {
        category: categorized.category,
        message: categorized.message,
        at: Date.now(),
      };
      const hasRetry = this.attempt <= this.retryDelaysMs.length;
      const delayMs = hasRetry ? this.retryDelaysMs[this.attempt - 1] : undefined;
      const nextRetryAt = delayMs === undefined ? null : Date.now() + delayMs;
      this.state = {
        ...this.state,
        phase: hasRetry ? 'retrying' : 'stopped',
        attempt: this.attempt,
        inFlight: false,
        nextRetryAt,
        lastError,
      };
      this.log.warn(
        `[CodexModelRefresh][${categorized.category}] refresh attempt ${this.attempt}/${this.state.maxAttempts} failed`,
        {
          error: categorized.message,
          nextRetryAt,
        },
      );
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

  private async refreshOnce(): Promise<AIModel[]> {
    let stage: 'spawn' | 'initialize' | 'model/list' = 'spawn';
    let child: ChildProcessWithoutNullStreams | null = null;
    let client: JsonRpcClient | null = null;
    let stderr = '';

    try {
      const binaryPath = this.resolveBinaryPath();
      const env = this.buildEnv(binaryPath);
      // Match the provider security contract: shell keys are never implicit
      // auth sources. Only the key explicitly saved in Nimbalyst settings is
      // injected into the isolated refresh child.
      delete env.OPENAI_API_KEY;
      delete env.CODEX_API_KEY;
      const configuredApiKey = this.loadApiKey()?.trim();
      if (configuredApiKey) env.CODEX_API_KEY = configuredApiKey;
      child = this.spawnProcess(binaryPath, ['app-server', '--listen', 'stdio://'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.activeChild = child;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string | Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-32 * 1024);
      });
      const childError = new Promise<never>((_resolve, reject) => {
        child!.once('error', (error) => reject(new CategorizedRefreshError(
          'child_process',
          `failed to spawn Codex model refresher: ${errorMessage(error)}`,
        )));
      });
      client = new JsonRpcClient(child, {
        defaultTimeoutMs: this.requestTimeoutMs,
        logger: {
          log: (message, ...args) => this.log.debug('[CodexModelRefresh]', message, ...args),
          warn: (message, ...args) => this.log.warn('[CodexModelRefresh]', message, ...args),
        },
      });
      this.activeClient = client;

      stage = 'initialize';
      const initialized = await Promise.race([
        client.request<InitializeResponse>('initialize', {
          clientInfo: {
            name: 'nimbalyst-model-refresh',
            version: process.env.NIMBALYST_VERSION ?? '0.0.0',
          },
          capabilities: { experimentalApi: true },
        }, this.requestTimeoutMs),
        childError,
      ]);
      client.notify('initialized', {});

      stage = 'model/list';
      const presets: ModelListPreset[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
        const response: ModelListResponse = await Promise.race([
          client.request<ModelListResponse>('model/list', {
            cursor,
            includeHidden: false,
            limit: 100,
          }, this.requestTimeoutMs),
          childError,
        ]);
        if (!Array.isArray(response?.data)) {
          throw new CategorizedRefreshError(
            'upstream_rejected',
            'Codex model/list returned an invalid response',
          );
        }
        presets.push(...response.data);
        cursor = typeof response.nextCursor === 'string' && response.nextCursor.length > 0
          ? response.nextCursor
          : null;
        if (!cursor) break;
        if (page === MAX_MODEL_LIST_PAGES - 1) {
          throw new CategorizedRefreshError(
            'upstream_rejected',
            `Codex model/list exceeded ${MAX_MODEL_LIST_PAGES} pages`,
          );
        }
      }

      this.promoteCodexCache(initialized.codexHome);
      const upstreamRefreshFailure = extractRefreshFailure(stderr);
      if (upstreamRefreshFailure) {
        throw new CategorizedRefreshError(
          categoryForUpstreamMessage(upstreamRefreshFailure),
          upstreamRefreshFailure,
        );
      }
      if (presets.length === 0) {
        throw new CategorizedRefreshError(
          'upstream_rejected',
          'Codex model/list returned no available models',
        );
      }
      return mapModelPresets(presets);
    } catch (error) {
      if (error instanceof CategorizedRefreshError) throw error;
      const message = errorMessage(error);
      if (stage === 'spawn' || stage === 'initialize' || /child process exited|spawn/i.test(message)) {
        throw new CategorizedRefreshError('child_process', message);
      }
      if (/\b(?:401|403|409|429)\b|unauthori[sz]ed|forbidden|rate.?limit|rejected|denied/i.test(message)) {
        throw new CategorizedRefreshError('upstream_rejected', message);
      }
      if (/RPC error/i.test(message) && !/timeout/i.test(message)) {
        throw new CategorizedRefreshError('upstream_rejected', message);
      }
      throw new CategorizedRefreshError('network', message);
    } finally {
      if (child) await this.terminateChild(child, client);
      if (this.activeChild === child) this.activeChild = null;
      if (this.activeClient === client) this.activeClient = null;
    }
  }

  private async terminateChild(
    child: ChildProcessWithoutNullStreams,
    client: JsonRpcClient | null,
  ): Promise<void> {
    try { client?.close('model refresh attempt complete'); } catch { /* noop */ }
    try { child.stdin?.end(); } catch { /* noop */ }
    if (isExited(child)) return;

    try { child.kill('SIGTERM'); } catch (error) {
      throw new CategorizedRefreshError(
        'child_process',
        `failed to terminate Codex model refresher: ${errorMessage(error)}`,
      );
    }
    if (await this.waitForExit(child, this.terminationGraceMs)) return;

    try { child.kill('SIGKILL'); } catch (error) {
      throw new CategorizedRefreshError(
        'child_process',
        `failed to kill Codex model refresher: ${errorMessage(error)}`,
      );
    }
    if (await this.waitForExit(child, this.terminationGraceMs)) return;
    throw new CategorizedRefreshError(
      'child_process',
      'Codex model refresher did not exit after SIGKILL',
    );
  }

  private waitForExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<boolean> {
    if (isExited(child)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('exit', onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(isExited(child)), timeoutMs);
      child.once('exit', onExit);
      if (isExited(child)) finish(true);
    });
  }

  private ensureBootCatalog(): ModelsCatalog {
    try {
      const existing = parseCatalog(JSON.parse(fs.readFileSync(this.catalogPath, 'utf8')));
      if (existing) return existing;
    } catch {
      // Missing or invalid files are replaced atomically with the safe sentinel.
    }
    this.writeCatalogAtomically(SENTINEL_CATALOG);
    return SENTINEL_CATALOG;
  }

  private promoteCodexCache(codexHome: string): void {
    try {
      const cachePath = path.join(codexHome, 'models_cache.json');
      const cache = parseCatalog(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
      if (!cache) {
        this.log.debug('[CodexModelRefresh] models cache was absent or invalid; retaining local catalog', {
          cachePath,
        });
        return;
      }
      this.writeCatalogAtomically(cache);
      this.catalogReady = true;
    } catch (error) {
      this.log.debug('[CodexModelRefresh] unable to promote Codex models cache; retaining local catalog', {
        error: errorMessage(error),
      });
    }
  }

  private writeCatalogAtomically(catalog: ModelsCatalog): void {
    const directory = path.dirname(this.catalogPath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.catalogPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(catalog)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, this.catalogPath);
    } finally {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* noop */ }
    }
  }
}

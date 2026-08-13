/**
 * AntigravityServerManager (backend module).
 *
 * Direct adaptation of packages/runtime/src/ai/server/providers/antigravity/
 * AntigravityServerManager.ts. The difference: this version is owned by the
 * extension's backend module (not the runtime), and it accepts injected
 * configuration from the host (OVERRIDE_IDE_VERSION, SPAWN_PORT_CANDIDATES)
 * via configure() rather than reading hardcoded constants. This lets the host
 * push fresh values from manifest/user settings without requiring an
 * extension rebuild when Antigravity bumps its supported-build floor.
 *
 * Engine selection:
 *   A. Prefer the desktop language server (attach/spawn through the existing
 *      HTTPS JSON/Connect-RPC implementation).
 *   B. Fall back to the installed `agy -p` command-line engine. Its buffered
 *      JSON result carries the conversation id used for later turns.
 *
 * Desktop auth remains the user's existing ~/.gemini OAuth credential. CLI
 * auth remains agy's own OAuth/keyring flow; this module only performs a
 * read-only credential probe and launches agy without passing secrets.
 *
 * Singleton-per-process: use AntigravityServerManager.shared(). The backend
 * module's activate() calls .configure() on the shared instance once at
 * activation time.
 */
import { spawn, ChildProcess, execFile, type SpawnOptions } from 'child_process';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { acquireSpawnLock, releaseSpawnLock } from './spawnLock';
import {
  AGY_MODEL_MAP,
  STATIC_AGY_MODELS,
  buildAgyModelCatalog,
  parseAgyModelsOutput,
  type AgyModelDescriptor,
} from './agyModelCatalog';

export {
  AGY_MODEL_MAP,
  STATIC_AGY_MODELS,
  buildAgyModelCatalog,
  parseAgyModelsOutput,
};
export type { AgyModelDescriptor } from './agyModelCatalog';

const SERVICE = 'exa.language_server_pb.LanguageServerService';

// Fallback defaults if the host doesn't supply config (e.g. dev harness, tests).
// Keep these in sync with the canonical runtime values. The host SHOULD always
// inject a value via configure(), so divergence here is not load-bearing.
const DEFAULT_OVERRIDE_IDE_VERSION = '2.1.4';
const DEFAULT_SPAWN_PORT_CANDIDATES: readonly number[] = [
  51717, 8765, 13456, 21345, 31987, 41234,
];

export interface AntigravityEndpoint {
  httpsPort: number;
  csrf: string;
  /** true when we spawned this server ourselves (mode B); false when attached (mode A). */
  owned: boolean;
}

export interface AntigravityModelInfo {
  /** Stable key, e.g. "gemini-3-flash-agent". */
  key: string;
  /** Server-assigned enum, e.g. "MODEL_PLACEHOLDER_M133". NOT stable across builds. */
  enum: string;
  /** Human label, e.g. "Gemini 3.5 Flash (High)". */
  displayName: string;
  apiProvider?: string;
  maxTokens?: number;
}

export interface AntigravityServerConfig {
  overrideIdeVersion?: string;
  spawnPortCandidates?: readonly number[];
}

export class AntigravityVersionGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityVersionGateError';
  }
}

export class AntigravityAgyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityAgyError';
  }
}

export class AntigravityAgyModelError extends AntigravityAgyError {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityAgyModelError';
  }
}

export class AntigravityAgyNotInstalledError extends AntigravityAgyError {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityAgyNotInstalledError';
  }
}

export class AntigravityAgyNotLoggedInError extends AntigravityAgyError {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityAgyNotLoggedInError';
  }
}

export class AntigravityAgyTimeoutError extends AntigravityAgyError {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityAgyTimeoutError';
  }
}

export class AntigravityAgyProtocolError extends AntigravityAgyError {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityAgyProtocolError';
  }
}

/** Resolve an extension model key to a real agy model id. */
export function mapAgyModel(modelKey: string): string {
  const key = extractAgyModelKey(modelKey);
  const mapped = AGY_MODEL_MAP[key];
  if (!mapped) {
    throw new AntigravityAgyModelError(
      `agy model ${key} is not mapped; supported extension models: ` +
      `${Object.keys(AGY_MODEL_MAP).join(', ')}`,
    );
  }
  return mapped;
}

interface ResolvedEngine {
  kind: 'desktop' | 'agy';
  binary: string;
}

class AgyProcessFailure extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'AgyProcessFailure';
  }
}

export interface AgyParsedResponse {
  text: string;
  conversationId?: string;
}

export class AntigravityServerManager {
  private static instance: AntigravityServerManager | null = null;

  constructor(private readonly agySpawn: typeof spawn = spawn) {}

  // Cross-process lock so sibling backend module processes (one per workspace/
  // worktree) share ONE language server instead of each spawning their own and
  // contending on --app_data_dir + the ~/.gemini OAuth (which hangs
  // GetModelResponse). See spawnLock.ts.
  private static readonly SPAWN_LOCK_PATH =
    path.join(os.tmpdir(), 'nimbalyst-antigravity-spawn.lock');
  // How long a waiting process polls for a sibling's server before giving up.
  private static readonly SPAWN_WAIT_MS = 75_000;

  private endpoint: AntigravityEndpoint | null = null;
  private child: ChildProcess | null = null;
  private startPromise: Promise<AntigravityEndpoint> | null = null;
  /** Cache of key -> enum, valid for the current endpoint only. */
  private enumCache = new Map<string, string>();
  /** Session key -> agy conversation id, owned only by this backend process. */
  private agyConversationIds = new Map<string, string>();
  /** First-use model discovery cache; a failed probe resolves to the static list. */
  private agyModelCatalogPromise: Promise<readonly AgyModelDescriptor[]> | null = null;
  private agyModelCatalog: readonly AgyModelDescriptor[] | null = null;

  // Injected configuration. Falls back to the hardcoded defaults when the
  // host hasn't called configure() (dev harness, unit tests).
  private overrideIdeVersion: string = DEFAULT_OVERRIDE_IDE_VERSION;
  private spawnPortCandidates: readonly number[] = DEFAULT_SPAWN_PORT_CANDIDATES;

  static shared(): AntigravityServerManager {
    if (!this.instance) this.instance = new AntigravityServerManager();
    return this.instance;
  }

  /**
   * Apply host-provided configuration. Idempotent. Safe to call before or
   * after the first ensureRunning(); applies to subsequent spawns/RPC error
   * messages. Existing running server is NOT restarted automatically -- the
   * caller can call stop() first if they want a clean cycle on a version
   * bump.
   */
  configure(cfg: AntigravityServerConfig): void {
    if (typeof cfg.overrideIdeVersion === 'string' && cfg.overrideIdeVersion.length > 0) {
      this.overrideIdeVersion = cfg.overrideIdeVersion;
    }
    if (Array.isArray(cfg.spawnPortCandidates) && cfg.spawnPortCandidates.length > 0) {
      // Defensive copy so the caller can't mutate our array after handoff.
      this.spawnPortCandidates = [...cfg.spawnPortCandidates];
    }
  }

  /** Resolve the existing desktop language_server path for the current platform. */
  static desktopBinaryPath(): string {
    if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA
        || path.join(os.homedir(), 'AppData', 'Local');
      return path.join(local, 'Programs', 'Antigravity', 'resources', 'bin',
        'language_server.exe');
    }
    if (process.platform === 'darwin') {
      return '/Applications/Antigravity.app/Contents/Resources/bin/language_server';
    }
    return path.join(os.homedir(), '.local', 'share', 'antigravity', 'bin',
      'language_server');
  }

  /** Candidate agy paths: the documented per-user install first, then PATH. */
  static agyPathCandidates(): string[] {
    const preferred = path.join(os.homedir(), '.local', 'bin', 'agy');
    const pathCandidates = (process.env.PATH ?? '')
      .split(path.delimiter)
      .filter((entry) => entry.length > 0)
      .map((entry) => path.join(entry, 'agy'));
    return [...new Set([preferred, ...pathCandidates])];
  }

  /** All supported engine binaries in priority order. */
  static binaryCandidates(): string[] {
    return [this.desktopBinaryPath(), ...this.agyPathCandidates()];
  }

  /** Resolve the first installed desktop/CLI binary, preserving desktop priority. */
  static binaryPath(): string {
    const found = this.binaryCandidates().find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
    return found ?? this.desktopBinaryPath();
  }

  /** True if either the desktop language server or agy CLI is present. */
  static isInstalled(): boolean {
    return this.binaryCandidates().some((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
  }

  /** True if ~/.gemini has an OAuth credential with a refresh token. */
  static hasGeminiAuth(): boolean {
    try {
      const p = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
      if (!fs.existsSync(p)) return false;
      const creds = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Boolean(creds && creds.refresh_token);
    } catch {
      return false;
    }
  }

  /**
   * Read-only agy OAuth probe. This is deliberately advisory: the command is
   * still launched and its actual auth result remains authoritative because
   * agy can refresh an expired credential itself.
   */
  static hasAgyAuth(): boolean {
    try {
      const tokenPath = path.join(
        os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token',
      );
      if (!fs.existsSync(tokenPath)) return false;
      const raw = fs.readFileSync(tokenPath, 'utf8').trim();
      if (!raw) return false;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        // An opaque, non-empty token file is still a present credential. agy
        // remains the authority on whether it is usable.
        return true;
      }

      const root = asRecord(parsed);
      const token = asRecord(root?.token) ?? root;
      const accessToken = firstString(token, ['access_token', 'accessToken', 'token']);
      const refreshToken = firstString(token, ['refresh_token', 'refreshToken']);
      if (!accessToken && !refreshToken) return false;

      const expiry = firstString(token, ['expiry', 'expires_at', 'expiresAt', 'expiry_date']);
      if (expiry) {
        const expiryMs = Date.parse(expiry) || Number(expiry);
        if (Number.isFinite(expiryMs)) {
          const normalizedMs = expiryMs < 1_000_000_000_000 ? expiryMs * 1000 : expiryMs;
          if (normalizedMs <= Date.now() && !refreshToken) return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a usable server endpoint exists. Attaches to a running hub if
   * present, otherwise spawns our own. Idempotent and concurrency-safe.
   */
  async ensureRunning(): Promise<AntigravityEndpoint> {
    if (this.endpoint && (await this.isHealthy(this.endpoint))) {
      return this.endpoint;
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      this.endpoint = null;
      this.enumCache.clear();

      const attached = await this.discoverRunningHub();
      if (attached) {
        this.endpoint = attached;
        return attached;
      }

      const spawned = await this.spawnStandaloneSerialized();
      this.endpoint = spawned;
      return spawned;
    })();

    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Return the live endpoint if the server is already running, else null.
   *
   * Read-only: this MUST NOT spawn the server or trigger discovery. It only
   * reflects whatever endpoint ensureRunning() previously established. Used by
   * the host's usage poller so opening the usage chip never fires up the
   * language server.
   */
  currentEndpoint(): AntigravityEndpoint | null {
    return this.endpoint;
  }

  /** Stop the server if we own it. No-op when attached to the IDE's hub. */
  stop(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        /* best effort */
      }
    }
    this.child = null;
    this.endpoint = null;
    this.enumCache.clear();
    this.agyConversationIds.clear();
    this.agyModelCatalogPromise = null;
    this.agyModelCatalog = null;
  }

  /**
   * Read the current agy model catalog once per backend lifetime.
   *
   * This is intentionally CLI-only. Desktop mode has its own RPC model catalog,
   * while `agy models` is the source of truth for model ids accepted by the
   * fallback engine. Any missing binary, non-zero exit, timeout, or unparseable
   * output falls back to the existing static entries without breaking startup.
   */
  async getAvailableAgyModels(
    timeoutMs = 10_000,
    workspacePath?: string,
  ): Promise<readonly AgyModelDescriptor[]> {
    if (!this.agyModelCatalogPromise) {
      this.agyModelCatalogPromise = this.loadAgyModelCatalog(timeoutMs, workspacePath)
        .catch(() => STATIC_AGY_MODELS)
        .then((catalog) => {
          this.agyModelCatalog = catalog;
          return catalog;
        });
    }
    return this.agyModelCatalogPromise;
  }

  private async loadAgyModelCatalog(
    timeoutMs: number,
    workspacePath?: string,
  ): Promise<readonly AgyModelDescriptor[]> {
    const engine = this.resolveEngine();
    if (engine.kind !== 'agy') return STATIC_AGY_MODELS;

    const output = await this.runAgy(engine.binary, ['models'], timeoutMs, workspacePath);
    const modelIds = parseAgyModelsOutput(output);
    const catalog = buildAgyModelCatalog(modelIds);
    return catalog.length > 0 ? catalog : STATIC_AGY_MODELS;
  }

  /** Drop a CLI conversation id when the host creates or cleans up a session. */
  resetConversation(conversationKey = 'default'): void {
    this.agyConversationIds.delete(conversationKey);
  }

  // ---- RPC ---------------------------------------------------------------

  /** Low-level Connect-RPC POST returning parsed JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rpc<T = any>(method: string, body: unknown, ep: AntigravityEndpoint,
    timeoutMs = 120_000): Promise<T> {
    const payload = Buffer.from(JSON.stringify(body));
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      // Self-diagnosing timeout: include elapsed wall-clock, the endpoint port,
      // and the prompt size so a timeout in main.log distinguishes a runaway
      // prompt (large KB) from a slow/wedged server (small KB, full elapsed).
      const startedAt = Date.now();
      const promptLen =
        body && typeof body === 'object' && typeof (body as { prompt?: unknown }).prompt === 'string'
          ? (body as { prompt: string }).prompt.length
          : payload.length;
      const timeoutMessage = (): string =>
        `Antigravity ${method} timed out after ${Math.round((Date.now() - startedAt) / 1000)}s ` +
        `(port ${ep.httpsPort}, prompt ${Math.round(promptLen / 1000)}KB, limit ${Math.round(timeoutMs / 1000)}s)`;
      const finish = (err: Error | null, value?: T): void => {
        if (settled) return;
        settled = true;
        if (hardTimer) clearTimeout(hardTimer);
        if (err) reject(err);
        else resolve(value as T);
      };
      const req = https.request(
        {
          host: '127.0.0.1',
          port: ep.httpsPort,
          path: `/${SERVICE}/${method}`,
          method: 'POST',
          // The server uses a self-signed cert on localhost.
          rejectUnauthorized: false,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
            'x-codeium-csrf-token': ep.csrf,
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c as Buffer));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 0) >= 400) {
              finish(new Error(
                `Antigravity ${method} HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
              return;
            }
            try {
              finish(null, JSON.parse(text) as T);
            } catch {
              finish(new Error(`Antigravity ${method} bad JSON: ${text.slice(0, 200)}`));
            }
          });
          res.on('error', (e) =>
            finish(e instanceof Error ? e : new Error(String(e))));
        },
      );
      // Hard wall-clock cap. The `timeout` option / 'timeout' event below only
      // fire on socket INACTIVITY, which a server that accepts the POST and then
      // holds the connection open during a slow or wedged inference never trips.
      // Without this an in-flight GetModelResponse can hang indefinitely and the
      // agent turn stays on "Thinking..." forever. This timer fires on elapsed
      // wall-clock regardless of socket activity.
      hardTimer = setTimeout(() => {
        req.destroy(new Error(timeoutMessage()));
      }, timeoutMs);
      req.on('timeout', () => req.destroy(new Error(timeoutMessage())));
      req.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
      req.write(payload);
      req.end();
    });
  }

  /**
   * Send a prompt to a model identified by its stable KEY (preferred) or enum.
   * Desktop mode returns the language-server response; CLI mode returns agy's
   * buffered print-mode response and keeps its conversation id per session.
   *
   * Desktop GetModelResponse RPC is retried ONCE on a transport TIMEOUT only. The
   * observed timeout cause is an intermittent RUNAWAY generation: the model
   * emits its answer then keeps generating a hallucinated tail past the limit
   * (GetModelResponse is buffered, so a runaway is only visible as the whole
   * call exceeding the timeout - it cannot be stopped client-side). A fresh
   * generation usually does not run away, so we re-issue the call, dropping
   * this.endpoint first so a genuinely crashed server is respawned. We do NOT
   * retry an AntigravityVersionGateError (permanent: wrong --override_ide_version,
   * a respawn re-creates the same gate) or an HTTP 4xx (client/auth error). Worst
   * case latency is ~2x timeoutMs plus one backoff and one respawn cycle.
   */
  async getModelResponse(prompt: string, modelKeyOrEnum: string,
    timeoutMs = 120_000, conversationKey = 'default', workspacePath?: string): Promise<string> {
    // MODEL_* is an explicit language-server enum, so keep the legacy desktop
    // path for callers that already resolved a server enum (and for old tests).
    if (modelKeyOrEnum.startsWith('MODEL_')) {
      return this.getDesktopModelResponse(prompt, modelKeyOrEnum, timeoutMs);
    }

    const engine = this.resolveEngine();
    if (engine.kind === 'agy') {
      return this.getAgyModelResponse(
        prompt,
        modelKeyOrEnum,
        timeoutMs,
        conversationKey,
        workspacePath,
        engine.binary,
      );
    }
    return this.getDesktopModelResponse(prompt, modelKeyOrEnum, timeoutMs);
  }

  private async getDesktopModelResponse(prompt: string, modelKeyOrEnum: string,
    timeoutMs = 120_000): Promise<string> {
    const MAX_ATTEMPTS = 2;
    const RETRY_BACKOFF_MS = 1_000;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        // Re-discover before the retry: a crashed server is respawned, an alive
        // one re-found. We DO retry against the same alive endpoint -- the common
        // timeout cause is an intermittent runaway generation, and a fresh
        // generation usually does not run away. A truly wedged server is rare and
        // costs one extra timeout; recovering the common case is worth it.
        this.endpoint = null;
        await delay(RETRY_BACKOFF_MS);
      }
      const ep = await this.ensureRunning();
      const enumName = modelKeyOrEnum.startsWith('MODEL_')
        ? modelKeyOrEnum
        : await this.resolveModelEnum(modelKeyOrEnum, ep);
      try {
        const res = await this.rpc<{ response?: string }>(
          'GetModelResponse', { prompt, model: enumName }, ep, timeoutMs);
        const text = res.response ?? '';
        if (typeof text === 'string' && text.includes('no longer supported')) {
          throw new AntigravityVersionGateError(
            `Antigravity backend rejected the build (version gate). Server must run with ` +
            `--override_ide_version ${this.overrideIdeVersion}. Got: ${text}`);
        }
        return text;
      } catch (err) {
        lastErr = err;
        // Permanent failures: never retry.
        if (err instanceof AntigravityVersionGateError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout = msg.includes('timed out');
        const isHttp4xx = /HTTP 4\d\d/.test(msg);
        if (!isTimeout || isHttp4xx || attempt >= MAX_ATTEMPTS) throw err;
        // Timeout (likely an intermittent runaway): fall through and retry.
      }
    }
    // Unreachable: the loop either returns or throws on every path.
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private resolveEngine(): ResolvedEngine {
    const desktop = AntigravityServerManager.desktopBinaryPath();
    if (safeExists(desktop)) return { kind: 'desktop', binary: desktop };

    const agy = AntigravityServerManager.agyPathCandidates().find(safeExists);
    if (agy) return { kind: 'agy', binary: agy };

    throw new AntigravityAgyNotInstalledError(
      `Antigravity CLI agy not installed（未安装）；已检查 ` +
      `${AntigravityServerManager.agyPathCandidates().join(', ')}。` +
      `请安装 agy 命令行后重试。`,
    );
  }

  private async getAgyModelResponse(
    prompt: string,
    modelKey: string,
    timeoutMs: number,
    conversationKey: string,
    workspacePath: string | undefined,
    binary: string,
  ): Promise<string> {
    const key = conversationKey || 'default';
    const conversationId = this.agyConversationIds.get(key);
    const args = ['-p', prompt];
    if (conversationId) {
      args.push('--conversation', conversationId);
    } else {
      const resolvedAgyModel = this.resolveAgyModel(modelKey, timeoutMs, workspacePath);
      const agyModel = resolvedAgyModel instanceof Promise
        ? await resolvedAgyModel
        : resolvedAgyModel;
      args.push('--model', agyModel);
    }
    // JSON output keeps the response one-shot while also carrying the
    // conversation id needed for the next turn. No token or auth env is passed.
    args.push(
      '--output-format', 'json',
      '--print-timeout', formatAgyTimeout(timeoutMs),
    );

    try {
      const stdout = await this.runAgy(binary, args, timeoutMs, workspacePath);
      const parsed = parseAgyOutput(stdout);
      if (!parsed.text) {
        throw new AntigravityAgyProtocolError(
          `agy returned no response text. Raw output: ${truncate(stdout)}`,
        );
      }
      if (!conversationId) {
        if (!parsed.conversationId) {
          throw new AntigravityAgyProtocolError(
            `agy returned a response without a conversation id; cannot continue the session. ` +
            `Raw output: ${truncate(stdout)}`,
          );
        }
        this.agyConversationIds.set(key, parsed.conversationId);
      }
      return parsed.text;
    } catch (err) {
      throw this.normalizeAgyError(err);
    }
  }

  private resolveAgyModel(
    modelKey: string,
    timeoutMs: number,
    workspacePath?: string,
  ): string | Promise<string> {
    const key = extractAgyModelKey(modelKey);
    const staticModel = AGY_MODEL_MAP[key];
    if (staticModel) return staticModel;

    // Preserve the old no-spawn failure for malformed keys while allowing
    // versioned Gemini ids (e.g. gemini-3.1-*) to come from agy discovery.
    if (!/^gemini-\d/.test(key)) {
      return mapAgyModel(modelKey);
    }

    const resolveFromCatalog = (catalog: readonly AgyModelDescriptor[]): string => {
      const discovered = catalog.find((model) => model.key === key || model.agyModel === key);
      if (discovered) return discovered.agyModel;

      throw new AntigravityAgyModelError(
        `agy model ${key} is not mapped; supported extension models: ` +
        `${catalog.map((model) => model.key).join(', ')}`,
      );
    };

    if (this.agyModelCatalog) return resolveFromCatalog(this.agyModelCatalog);
    return this.getAvailableAgyModels(timeoutMs, workspacePath).then(resolveFromCatalog);
  }

  private runAgy(
    binary: string,
    args: string[],
    timeoutMs: number,
    workspacePath?: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const startedAt = Date.now();
      const outputCap = 256 * 1024;
      const append = (current: string, chunk: Buffer): string =>
        current.length >= outputCap
          ? current
          : current + chunk.toString('utf8').slice(0, outputCap - current.length);
      const finish = (err: Error | null, value?: string): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve(value ?? '');
      };

      try {
        const spawnOptions: SpawnOptions = {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: true,
          env: sanitizedAgyEnvironment(),
          ...(workspacePath && safeExists(workspacePath) ? { cwd: workspacePath } : {}),
        };
        const child = this.agySpawn(binary, args, spawnOptions);
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout = append(stdout, chunk);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr = append(stderr, chunk);
        });
        child.on('error', (err) => {
          finish(new AgyProcessFailure(
            `agy spawn failed: ${err instanceof Error ? err.message : String(err)}`,
            stdout,
            stderr,
            null,
          ));
        });
        child.on('close', (code) => {
          if (code === 0) {
            finish(null, stdout);
            return;
          }
          const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
          finish(new AgyProcessFailure(
            `agy exited with code ${code ?? 'unknown'}${details ? `: ${details}` : ''}`,
            stdout,
            stderr,
            code,
          ));
        });
        timer = setTimeout(() => {
          try {
            child.kill('SIGTERM');
          } catch {
            /* best effort; the timeout is already terminal */
          }
          const elapsedMs = Date.now() - startedAt;
          finish(new AntigravityAgyTimeoutError(
            `agy print mode timed out after ${Math.ceil(elapsedMs / 1000)}s ` +
              `(${elapsedMs}ms elapsed; limit ${Math.ceil(timeoutMs / 1000)}s)`,
          ));
        }, Math.max(1, timeoutMs));
      } catch (err) {
        finish(new AgyProcessFailure(
          `agy spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          stdout,
          stderr,
          null,
        ));
      }
    });
  }

  private normalizeAgyError(err: unknown): Error {
    if (err instanceof AntigravityAgyError) return err;
    if (err instanceof AgyProcessFailure) {
      const raw = [err.message, err.stderr.trim(), err.stdout.trim()]
        .filter(Boolean)
        .join('\n');
      if (/invalid --model|model .*not recognized|available models/i.test(raw)) {
        return new AntigravityAgyModelError(
          `agy rejected the model. The model list is not a response. Raw output: ${truncate(raw)}`,
        );
      }
      if (/not.?logged.?in|not authenticated|unauthenticated|oauth|login|401/i.test(raw)) {
        const credentialState = AntigravityServerManager.hasAgyAuth()
          ? 'agy rejected the existing OAuth credential'
          : 'no usable agy OAuth credential was found';
        return new AntigravityAgyNotLoggedInError(
          `Antigravity CLI not logged in (${credentialState}); ` +
          `请在终端登录 antigravity 命令行后重试。Raw output: ${truncate(raw)}`,
        );
      }
      if (/timed out|timeout/i.test(raw)) {
        return new AntigravityAgyTimeoutError(`agy timed out: ${truncate(raw)}`);
      }
      if (/enoent|not found|command not found|executable/i.test(raw)) {
        return new AntigravityAgyNotInstalledError(
          `Antigravity CLI agy 未安装或不可执行。Raw output: ${truncate(raw)}`,
        );
      }
      return new AntigravityAgyError(`agy failed: ${truncate(raw)}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  /** Full model catalog as {key -> info}. */
  async getAvailableModels(ep?: AntigravityEndpoint): Promise<Map<string, AntigravityModelInfo>> {
    const endpoint = ep ?? (await this.ensureRunning());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await this.rpc<{ response?: { models?: Record<string, any> } }>(
      'GetAvailableModels', {}, endpoint, 30_000);
    const models = data.response?.models ?? {};
    const out = new Map<string, AntigravityModelInfo>();
    for (const [key, v] of Object.entries(models)) {
      out.set(key, {
        key,
        enum: v.model,
        displayName: v.displayName ?? v.label ?? '',
        apiProvider: v.apiProvider,
        maxTokens: v.maxTokens,
      });
    }
    return out;
  }

  /**
   * Resolve a stable model KEY (or displayName) to the server's current enum.
   * Cached per endpoint. Throws if not found.
   */
  async resolveModelEnum(keyOrDisplayName: string, ep?: AntigravityEndpoint): Promise<string> {
    const cached = this.enumCache.get(keyOrDisplayName);
    if (cached) return cached;
    const endpoint = ep ?? (await this.ensureRunning());
    const catalog = await this.getAvailableModels(endpoint);

    const byKey = catalog.get(keyOrDisplayName);
    if (byKey?.enum) {
      this.enumCache.set(keyOrDisplayName, byKey.enum);
      return byKey.enum;
    }
    for (const info of catalog.values()) {
      if (info.displayName.toLowerCase() === keyOrDisplayName.toLowerCase() && info.enum) {
        this.enumCache.set(keyOrDisplayName, info.enum);
        return info.enum;
      }
    }
    throw new Error(
      `Antigravity model ${keyOrDisplayName} not found; available keys: ` +
      `${[...catalog.keys()].join(', ')}`);
  }

  /** Raw GetUserStatus (used by the usage meter). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getUserStatus(ep?: AntigravityEndpoint): Promise<any> {
    const endpoint = ep ?? (await this.ensureRunning());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await this.rpc<{ userStatus?: any }>('GetUserStatus', {}, endpoint, 15_000);
    return data.userStatus ?? {};
  }

  // ---- mode A: discover a running hub ------------------------------------

  private async discoverRunningHub(): Promise<AntigravityEndpoint | null> {
    if (process.platform !== 'win32') return null;
    const ps =
      `$p = Get-CimInstance Win32_Process -Filter 'Name="language_server.exe"' | ` +
      `Where-Object { $_.CommandLine -match '--subclient_type hub' } | Select-Object -First 1; ` +
      `if (-not $p) { Write-Output 'NONE'; exit } ` +
      `$csrf = if ($p.CommandLine -match '--csrf_token (\\S+)') { $matches[1] } else { '' }; ` +
      `$ports = Get-NetTCPConnection -State Listen -OwningProcess $p.ProcessId -ErrorAction SilentlyContinue | ` +
      `Select-Object -ExpandProperty LocalPort | Sort-Object; ` +
      `Write-Output ($csrf + '|' + ($ports -join ','))`;
    const out = await this.runPowerShell(ps).catch(() => '');
    const line = out.trim();
    if (!line || line === 'NONE') return null;
    const [csrf, ports] = line.split('|');
    const portList = (ports || '').split(',').map((x) => parseInt(x, 10)).filter(Boolean);
    if (!csrf || portList.length === 0) return null;
    // Lower port = HTTPS, higher = HTTP.
    const httpsPort = Math.min(...portList);
    const ep: AntigravityEndpoint = { httpsPort, csrf, owned: false };
    return (await this.isHealthy(ep)) ? ep : null;
  }

  // ---- mode B: spawn our own --------------------------------------------

  private async spawnStandalone(): Promise<AntigravityEndpoint> {
    // This method is the preserved desktop language-server implementation.
    // agy is a one-shot CLI and must never be started with these server flags.
    const binary = AntigravityServerManager.desktopBinaryPath();
    if (!fs.existsSync(binary)) {
      throw new Error(
        `Antigravity desktop language server not found at ${binary}. ` +
        `Install Antigravity or open the Antigravity IDE.`);
    }
    if (!AntigravityServerManager.hasGeminiAuth()) {
      throw new Error(
        `No Antigravity/Gemini login found in ~/.gemini. Sign in via the Antigravity ` +
        `IDE first (nimbalyst does not perform the OAuth browser flow).`);
    }

    const csrf = `nimbalyst-${randomUUID()}`;

    const bindErrors: Array<{ port: number; reason: string }> = [];
    for (const port of this.spawnPortCandidates) {
      const args = [
        '--standalone',
        '--subclient_type', 'hub',
        '--override_ide_name', 'antigravity',
        '--override_ide_version', this.overrideIdeVersion,
        '--override_user_agent_name', 'antigravity',
        '--api_server_url', 'https://generativelanguage.googleapis.com',
        '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
        '--csrf_token', csrf,
        '--https_server_port', String(port),
        '--app_data_dir', 'antigravity',
        '--enable_sidecars',
      ];
      const child = spawn(binary, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
        windowsHide: true,
      });

      let stderrBuf = '';
      const STDERR_CAP = 16 * 1024;
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBuf.length < STDERR_CAP) {
          stderrBuf += chunk.toString('utf8').slice(0, STDERR_CAP - stderrBuf.length);
        }
      });

      this.child = child;
      child.on('exit', () => {
        if (this.child === child) {
          this.child = null;
          this.endpoint = null;
          this.enumCache.clear();
        }
      });

      const ep: AntigravityEndpoint = { httpsPort: port, csrf, owned: true };
      const deadline = Date.now() + 60_000;
      let bindFailed = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) {
          const reason = stderrBuf.trim() || `exit code ${child.exitCode}`;
          bindErrors.push({ port, reason: reason.slice(0, 500) });
          bindFailed = /bind|access permissions|address already in use|EADDRINUSE/i.test(stderrBuf);
          break;
        }
        if (await this.isHealthy(ep)) return ep;
        await delay(500);
      }

      if (!bindFailed && child.exitCode === null) {
        this.stop();
        throw new Error(
          `Antigravity language server did not become healthy on port ${port} within 60s`,
        );
      }
    }

    this.stop();
    const tried = bindErrors.map((e) => `${e.port}: ${e.reason.split('\n')[0]}`).join('; ');
    throw new Error(
      `Antigravity server exited early on all candidate ports. Tried: ${tried}`,
    );
  }


  /**
   * Spawn the standalone server under a cross-process lock so that, when
   * several backend module processes start together (the meta-agent spawns each
   * child session in its own worktree, and each workspace gets its own backend
   * module process), exactly ONE of them spawns the language server and the
   * rest discover and attach to it. Without this, two processes both miss
   * discovery during the spawn window and each launch a server; the pair share
   * --app_data_dir and the ~/.gemini OAuth and contend until GetModelResponse
   * times out.
   */
  private async spawnStandaloneSerialized(): Promise<AntigravityEndpoint> {
    const lockPath = AntigravityServerManager.SPAWN_LOCK_PATH;
    let holding = await acquireSpawnLock(lockPath);
    if (!holding) {
      // A live sibling is spawning. Wait for its server, then attach.
      const sibling = await this.waitForHub(AntigravityServerManager.SPAWN_WAIT_MS);
      if (sibling) return sibling;
      // Sibling stalled past the wait window: steal the lock and spawn
      // ourselves rather than deadlock this session.
      await releaseSpawnLock(lockPath);
      holding = await acquireSpawnLock(lockPath);
      if (!holding) {
        const late = await this.waitForHub(AntigravityServerManager.SPAWN_WAIT_MS);
        if (late) return late;
        // Last resort: spawn without the lock so the user is never stuck.
        return this.spawnStandalone();
      }
    }
    try {
      // A sibling may have finished spawning between our discovery miss and
      // taking the lock -- re-check before spawning a duplicate.
      const late = await this.discoverRunningHub();
      if (late) return late;
      return await this.spawnStandalone();
    } finally {
      await releaseSpawnLock(lockPath);
    }
  }

  /** Poll for a running hub (IDE or a sibling backend's server) until timeout. */
  private async waitForHub(timeoutMs: number): Promise<AntigravityEndpoint | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ep = await this.discoverRunningHub();
      if (ep) return ep;
      await delay(1_000);
    }
    return null;
  }

  // ---- helpers -----------------------------------------------------------

  private async isHealthy(ep: AntigravityEndpoint): Promise<boolean> {
    try {
      await this.rpc('Heartbeat', {}, ep, 4_000);
      return true;
    } catch {
      return false;
    }
  }

  private runPowerShell(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell',
        ['-NoProfile', '-Command', script],
        { timeout: 30_000, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
  }
}

export function parseAgyOutput(raw: string): AgyParsedResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AntigravityAgyProtocolError('agy returned empty output');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    // Keep the parser tolerant of a CLI that prefixes one JSON object per line.
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        parsed = JSON.parse(line) as unknown;
        break;
      } catch {
        /* inspect the next line */
      }
    }
  }

  if (parsed === undefined) {
    if (/available models:/i.test(trimmed)) {
      throw new AntigravityAgyModelError(
        `agy returned a model list instead of a response. Raw output: ${truncate(trimmed)}`,
      );
    }
    // Text output is still useful for a one-shot response. A missing
    // conversation id is rejected by getAgyModelResponse before a follow-up.
    return { text: trimmed };
  }

  const errorText = findDeepString(parsed, [
    'error', 'error_message', 'errorMessage', 'failure',
  ]);
  const isError = findDeepBoolean(parsed, ['is_error', 'isError', 'failed']);
  if (errorText || isError) {
    const message = errorText ?? 'agy reported an unsuccessful response';
    if (/invalid --model|model .*not recognized|available models/i.test(message + trimmed)) {
      throw new AntigravityAgyModelError(
        `agy rejected the model. The model list is not a response. Raw output: ${truncate(trimmed)}`,
      );
    }
    throw new AntigravityAgyProtocolError(
      `agy returned an error response: ${truncate(message)}`,
    );
  }

  const text = findResponseText(parsed);
  if (!text && /available models:/i.test(trimmed)) {
    throw new AntigravityAgyModelError(
      `agy returned a model list instead of a response. Raw output: ${truncate(trimmed)}`,
    );
  }
  return {
    text: text ?? '',
    conversationId: findDeepString(parsed, [
      'conversation_id', 'conversationId', 'conversationID',
      'session_id', 'sessionId',
    ]),
  };
}

function findResponseText(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findResponseText(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of [
    'result', 'response', 'response_text', 'responseText',
    'text', 'content', 'output', 'answer', 'message',
  ]) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    const nested = findResponseText(candidate, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function findDeepString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepString(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const child of Object.values(record)) {
    const found = findDeepString(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function findDeepBoolean(value: unknown, keys: string[], depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => findDeepBoolean(item, keys, depth + 1));
  const record = asRecord(value);
  if (!record) return false;
  if (keys.some((key) => record[key] === true)) return true;
  return Object.values(record).some((child) => findDeepBoolean(child, keys, depth + 1));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractAgyModelKey(raw: string): string {
  return raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
}

function safeExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function formatAgyTimeout(timeoutMs: number): string {
  return `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`;
}

function sanitizedAgyEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|private[_-]?key|credential)/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

function truncate(value: string, max = 4_000): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

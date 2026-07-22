/**
 * ClaudeUsageService - Tracks Claude Code API usage limits.
 *
 * Claude CLI auth is the authority for login state. OAuth credentials are read
 * only to call the separate Usage API and a Usage 401 never mutates login state.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import { getEnhancedPath } from './CLIManager';
import {
  buildClaudeCliCommand,
  claudeAuthStateService,
  type ClaudeAuthState,
} from './ClaudeAuthStateService';
import {
  makeUsagePoolKey,
  markUsagePoolsStale,
  mergeUsagePoolSnapshot,
  type ClaudeUsageData,
  type UsagePoolMap,
} from '../../shared/usage';

export type { ClaudeUsageData } from '../../shared/usage';

interface ClaudeUsageWindowResponse {
  utilization?: number;
  resets_at?: string | null;
}

export interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindowResponse | null;
  seven_day?: ClaudeUsageWindowResponse | null;
  seven_day_opus?: ClaudeUsageWindowResponse | null;
}

interface KeychainCredentials {
  claudeAiOauth?: {
    accessToken?: string;
  };
}

interface CredentialCandidate {
  accessToken: string;
  source: string;
}

type ExecFileError = Error & {
  code?: string | number | null;
  killed?: boolean;
  signal?: string | null;
  stderr?: string;
};

type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: {
    encoding: 'utf8';
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
    env?: NodeJS.ProcessEnv;
  },
  callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
) => unknown;

interface ClaudeAuthStateReader {
  getState(options?: { forceRefresh?: boolean }): Promise<ClaudeAuthState>;
}

export interface ClaudeUsageServiceOptions {
  platform?: NodeJS.Platform;
  fetchFn?: typeof fetch;
  execFileFn?: ExecFileFn;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  authStateService?: ClaudeAuthStateReader;
  requestTimeoutMs?: number;
  networkMaxRetries?: number;
  networkRetryDelayMs?: number;
  keychainMaxRetries?: number;
  keychainRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  claudeExecutable?: string;
  cliBaseEnv?: NodeJS.ProcessEnv;
}

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const KEYCHAIN_SERVICES = ['Claude Code-credentials', 'Claude Code'] as const;
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const KEYCHAIN_RETRY_DELAY_MS = 2000;
const KEYCHAIN_MAX_RETRIES = 3;
const NETWORK_RETRY_DELAY_MS = 3000;
const NETWORK_MAX_RETRIES = 3;
const NETWORK_REQUEST_TIMEOUT_MS = 15_000;
const CLAUDE_CREDENTIAL_REFRESH_TIMEOUT_MS = 30_000;
const USAGE_ERROR_BODY_MAX_CHARS = 600;
const CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDECODE',
] as const;

class UsageHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UsageHttpError';
  }
}

class UsageRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Claude usage request timed out after ${timeoutMs}ms.`);
    this.name = 'UsageRequestTimeoutError';
  }
}

export class ClaudeUsageServiceImpl {
  private cachedUsage: ClaudeUsageData | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastActivityTime = 0;
  private isPolling = false;
  private isSleeping = true;
  private inflightRefresh: Promise<ClaudeUsageData> | null = null;
  private cacheGeneration = 0;
  private claudeCodeVersion: string | null = null;

  private readonly platform: NodeJS.Platform;
  private readonly fetchFn: typeof fetch;
  private readonly execFileFn: ExecFileFn;
  private readonly readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  private readonly authStateService: ClaudeAuthStateReader;
  private readonly requestTimeoutMs: number;
  private readonly networkMaxRetries: number;
  private readonly networkRetryDelayMs: number;
  private readonly keychainMaxRetries: number;
  private readonly keychainRetryDelayMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly claudeExecutable?: string;
  private readonly cliBaseEnv?: NodeJS.ProcessEnv;

  constructor(options: ClaudeUsageServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.execFileFn = options.execFileFn ?? ((file, args, execOptions, callback) => (
      execFile(file, [...args], execOptions, callback)
    ));
    this.readFile = options.readFile ?? ((filePath, encoding) => fs.promises.readFile(filePath, encoding));
    this.authStateService = options.authStateService ?? claudeAuthStateService;
    this.requestTimeoutMs = options.requestTimeoutMs ?? NETWORK_REQUEST_TIMEOUT_MS;
    this.networkMaxRetries = options.networkMaxRetries ?? NETWORK_MAX_RETRIES;
    this.networkRetryDelayMs = options.networkRetryDelayMs ?? NETWORK_RETRY_DELAY_MS;
    this.keychainMaxRetries = options.keychainMaxRetries ?? KEYCHAIN_MAX_RETRIES;
    this.keychainRetryDelayMs = options.keychainRetryDelayMs ?? KEYCHAIN_RETRY_DELAY_MS;
    this.sleepFn = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.claudeExecutable = options.claudeExecutable;
    this.cliBaseEnv = options.cliBaseEnv;
  }

  initialize(): void {
    logger.main.info('[ClaudeUsageService] Initialized (sleeping until activity detected)');
  }

  async recordActivity(): Promise<void> {
    this.lastActivityTime = this.now();

    if (this.isSleeping) {
      this.isSleeping = false;
      this.startPolling();
      await this.refresh();
    }
  }

  getCachedUsage(): ClaudeUsageData | null {
    return this.cachedUsage;
  }

  /**
   * Clear both completed and in-flight cache state. A generation guard prevents
   * an older request from repopulating the cache after login/logout invalidation.
   */
  invalidateCache(): void {
    this.cacheGeneration += 1;
    this.cachedUsage = null;
    this.inflightRefresh = null;
    this.broadcastUpdate(null);
  }

  async refresh(): Promise<ClaudeUsageData> {
    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    const generation = this.cacheGeneration;
    const work = this.doRefresh(generation);
    let refresh: Promise<ClaudeUsageData>;
    refresh = work.then((usage) => {
      if (generation !== this.cacheGeneration) {
        if (this.inflightRefresh && this.inflightRefresh !== refresh) {
          return this.inflightRefresh;
        }
        if (this.cachedUsage) {
          return this.cachedUsage;
        }
        return this.buildUnavailableUsage(
          'Claude usage refresh was invalidated after an authentication change. Retry after the authentication action completes.',
        );
      }
      return usage;
    }).finally(() => {
      if (this.inflightRefresh === refresh) {
        this.inflightRefresh = null;
      }
    });
    this.inflightRefresh = refresh;
    return refresh;
  }

  private async doRefresh(generation: number): Promise<ClaudeUsageData> {
    try {
      const candidates = await this.readCredentialCandidates();
      if (candidates.length === 0) {
        const authState = await this.safeGetAuthState();
        return this.commitUsage(
          this.buildUnavailableUsage(this.missingCredentialsMessage(authState)),
          generation,
        );
      }

      let usageData: ClaudeUsageData;
      try {
        usageData = await this.fetchUsageData(candidates[0].accessToken);
      } catch (error) {
        if (!(error instanceof UsageHttpError) || error.status !== 401) {
          throw error;
        }
        usageData = await this.recoverFromUnauthorized(candidates);
      }

      if (Object.keys(usageData.pools).length === 0) {
        return this.commitUsage(
          this.buildUnavailableUsage('Claude usage response did not contain any quota pools.'),
          generation,
        );
      }

      if (this.cachedUsage) {
        const mergedPools = markUsagePoolsStale(this.cachedUsage.pools);
        for (const [key, candidate] of Object.entries(usageData.pools)) {
          mergedPools[key] = mergeUsagePoolSnapshot(mergedPools[key], candidate);
        }
        usageData.pools = mergedPools;
        usageData.lastUpdated = Math.max(...Object.values(mergedPools).map((pool) => pool.updatedAt));
      }
      return this.commitUsage(usageData, generation);
    } catch (error) {
      logger.main.error('[ClaudeUsageService] Error refreshing usage:', error);
      return this.commitUsage(
        this.buildUnavailableUsage(
          error instanceof Error ? error.message : 'Unknown error fetching Claude usage.',
        ),
        generation,
      );
    }
  }

  private async recoverFromUnauthorized(
    initialCredentials: CredentialCandidate[],
  ): Promise<ClaudeUsageData> {
    const failedCredential = initialCredentials[0];
    logger.main.warn(
      `[ClaudeUsageService] Usage API rejected credentials from ${failedCredential.source}; `
      + 're-reading every credential source before deciding login state.',
    );

    const [rereadCandidates, authState] = await Promise.all([
      this.readCredentialCandidates(),
      this.safeGetAuthState(true),
    ]);

    const initialTokens = new Set(initialCredentials.map((candidate) => candidate.accessToken));
    const attemptedTokens = new Set<string>([failedCredential.accessToken]);
    const credentialsChanged = rereadCandidates.some(
      (candidate) => !initialTokens.has(candidate.accessToken),
    );
    for (const candidate of rereadCandidates) {
      if (attemptedTokens.has(candidate.accessToken)) {
        continue;
      }
      attemptedTokens.add(candidate.accessToken);
      try {
        return await this.fetchUsageData(candidate.accessToken);
      } catch (error) {
        if (!(error instanceof UsageHttpError) || error.status !== 401) {
          throw error;
        }
      }
    }

    if (authState.status === 'logged-in' && !credentialsChanged) {
      try {
        await this.refreshCliCredentials();
      } catch (error) {
        logger.main.warn('[ClaudeUsageService] Claude CLI credential refresh failed:', error);
      }

      const refreshedCandidates = await this.readCredentialCandidates();
      const retryCredential = refreshedCandidates.find(
        (candidate) => !attemptedTokens.has(candidate.accessToken),
      ) ?? refreshedCandidates[0] ?? rereadCandidates[0] ?? failedCredential;
      try {
        return await this.fetchUsageData(retryCredential.accessToken);
      } catch (error) {
        if (!(error instanceof UsageHttpError) || error.status !== 401) {
          throw error;
        }
      }
    }

    throw new Error(this.authorizationFailureMessage(authState));
  }

  /**
   * Ask the official CLI to run its local, zero-cost `/usage` command. Claude
   * owns the private OAuth refresh protocol; after this exits we re-read every
   * persisted credential source before the single final Usage retry.
   */
  private async refreshCliCredentials(): Promise<void> {
    const enhancedPath = this.cliBaseEnv?.PATH ?? getEnhancedPath();
    const command = buildClaudeCliCommand([
      '--safe-mode',
      '--tools',
      '',
      '--no-session-persistence',
      '--output-format',
      'json',
      '-p',
      '/usage',
    ], {
      platform: this.platform,
      enhancedPath,
      appData: this.cliBaseEnv?.APPDATA,
      comSpec: this.cliBaseEnv?.ComSpec,
      preferredExecutable: this.claudeExecutable,
    });
    const env: NodeJS.ProcessEnv = {
      ...(this.cliBaseEnv ?? process.env),
      PATH: enhancedPath,
      TERM: 'dumb',
      CI: 'true',
    };
    for (const key of CREDENTIAL_ENV_KEYS) {
      delete env[key];
    }

    await new Promise<void>((resolve, reject) => {
      this.execFileFn(
        command.file,
        command.args,
        {
          encoding: 'utf8',
          env,
          timeout: CLAUDE_CREDENTIAL_REFRESH_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
        (error) => {
          if (error) {
            reject(new Error(`Claude Code could not refresh its credentials: ${error.message}`));
            return;
          }
          resolve();
        },
      );
    });
  }

  stop(): void {
    this.stopPolling();
    logger.main.info('[ClaudeUsageService] Stopped');
  }

  private startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;
    this.pollTimer = setInterval(() => {
      void this.pollTick();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  private async pollTick(): Promise<void> {
    const timeSinceActivity = this.now() - this.lastActivityTime;
    if (timeSinceActivity > IDLE_TIMEOUT_MS) {
      logger.main.info('[ClaudeUsageService] Going to sleep due to inactivity');
      this.isSleeping = true;
      this.stopPolling();
      return;
    }
    await this.refresh();
  }

  private async readCredentialCandidates(): Promise<CredentialCandidate[]> {
    const candidates = this.platform === 'darwin'
      ? await this.readKeychainCandidates()
      : await this.readCredentialsFileCandidate();
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.accessToken)) return false;
      seen.add(candidate.accessToken);
      return true;
    });
  }

  private async readKeychainCandidates(): Promise<CredentialCandidate[]> {
    const candidates: CredentialCandidate[] = [];
    for (const serviceName of KEYCHAIN_SERVICES) {
      const candidate = await this.readKeychainCandidate(serviceName);
      if (candidate) candidates.push(candidate);
    }
    if (candidates.length === 0) {
      logger.main.debug('[ClaudeUsageService] Claude Code credentials not found in any keychain entry');
    }
    return candidates;
  }

  private async readKeychainCandidate(serviceName: string): Promise<CredentialCandidate | null> {
    for (let attempt = 1; attempt <= this.keychainMaxRetries; attempt += 1) {
      try {
        const result = await this.execFile(
          'security',
          ['find-generic-password', '-s', serviceName, '-w'],
        );
        return this.parseCredential(result, `macOS Keychain:${serviceName}`);
      } catch (error) {
        if (this.isKeychainItemMissing(error)) return null;
        if (attempt === this.keychainMaxRetries) {
          logger.main.warn(
            `[ClaudeUsageService] Failed to read keychain entry ${serviceName} after ${attempt} attempts:`,
            error,
          );
          return null;
        }
        await this.sleepFn(this.keychainRetryDelayMs);
      }
    }
    return null;
  }

  private async readCredentialsFileCandidate(): Promise<CredentialCandidate[]> {
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    try {
      const fileContent = await this.readFile(credentialsPath, 'utf8');
      const candidate = this.parseCredential(fileContent, credentialsPath);
      return candidate ? [candidate] : [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        logger.main.warn('[ClaudeUsageService] Error reading credentials file:', error);
      }
      return [];
    }
  }

  private parseCredential(raw: string, source: string): CredentialCandidate | null {
    try {
      const credentials = JSON.parse(raw.trim()) as KeychainCredentials;
      const accessToken = credentials.claudeAiOauth?.accessToken;
      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        logger.main.debug(`[ClaudeUsageService] No access token in ${source}`);
        return null;
      }
      return { accessToken, source };
    } catch (error) {
      logger.main.warn(`[ClaudeUsageService] Invalid Claude credentials in ${source}:`, error);
      return null;
    }
  }

  private execFile(file: string, args: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.execFileFn(
        file,
        args,
        {
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            error.stderr = stderr;
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  private isKeychainItemMissing(error: unknown): boolean {
    const candidate = error as ExecFileError;
    return Boolean(candidate?.code === 44
      || candidate?.message?.includes('could not be found')
      || candidate?.stderr?.includes('could not be found'));
  }

  private async fetchUsageData(accessToken: string): Promise<ClaudeUsageData> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.networkMaxRetries; attempt += 1) {
      try {
        return await this.fetchUsageAttempt(accessToken);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (
          lastError instanceof UsageRequestTimeoutError
          || (lastError instanceof UsageHttpError && [401, 403, 429].includes(lastError.status))
        ) {
          throw lastError;
        }
        if (attempt < this.networkMaxRetries - 1) {
          logger.main.warn(
            `[ClaudeUsageService] Fetch attempt ${attempt + 1} failed (${lastError.message}). `
            + `Retrying in ${this.networkRetryDelayMs}ms...`,
          );
          await this.sleepFn(this.networkRetryDelayMs);
        }
      }
    }

    throw lastError ?? new Error('Failed to fetch Claude usage after retries.');
  }

  private async fetchUsageAttempt(accessToken: string): Promise<ClaudeUsageData> {
    const abortController = new AbortController();
    let timeout: NodeJS.Timeout | null = null;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abortController.abort();
        reject(new UsageRequestTimeoutError(this.requestTimeoutMs));
      }, this.requestTimeoutMs);
    });

    const request = (async () => {
      const response = await this.fetchFn(USAGE_API_URL, {
        method: 'GET',
        signal: abortController.signal,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': `claude-code/${this.getClaudeCodeVersion()}`,
        },
      });

      if (!response.ok) {
        const errorBody = await this.readErrorBody(response);
        const detail = errorBody ? ` Response body: ${errorBody}` : '';
        if (response.status === 401) {
          logger.main.warn(`[ClaudeUsageService] Usage API returned 401 (unauthorized).${detail}`);
          throw new UsageHttpError(401, 'Claude Usage API rejected the OAuth credential.');
        }
        if (response.status === 403) {
          throw new UsageHttpError(
            403,
            'Usage authorization failed (403). Claude is authenticated, but this account cannot access quota information.',
          );
        }
        if (response.status === 429) {
          throw new UsageHttpError(429, 'Claude usage is rate limited (429). Please retry later.');
        }
        throw new UsageHttpError(
          response.status,
          `Claude Usage API error: ${response.status} ${response.statusText}.${detail}`,
        );
      }

      const data = await response.json() as ClaudeUsageResponse;
      return mapClaudeUsageResponse(data, this.now());
    })();

    try {
      return await Promise.race([request, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private getClaudeCodeVersion(): string {
    if (this.claudeCodeVersion) return this.claudeCodeVersion;
    try {
      const sdkDir = path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk'));
      const manifest = JSON.parse(fs.readFileSync(path.join(sdkDir, 'manifest.json'), 'utf-8'));
      this.claudeCodeVersion = manifest.version || 'unknown';
    } catch {
      this.claudeCodeVersion = 'unknown';
    }
    return this.claudeCodeVersion!;
  }

  private async safeGetAuthState(forceRefresh = false): Promise<ClaudeAuthState> {
    try {
      return await this.authStateService.getState({ forceRefresh });
    } catch (error) {
      return {
        status: 'check-failed',
        source: 'claude-cli-auth-status',
        checkedAt: this.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private authorizationFailureMessage(authState: ClaudeAuthState): string {
    if (authState.status === 'logged-out') {
      return 'Claude Code login has expired. Please log in again before checking quota information.';
    }
    if (authState.status === 'logged-in') {
      return 'Usage authorization failed. Claude Code is logged in, but the quota API rejected the current credentials.';
    }
    if (authState.status === 'check-failed') {
      return 'Usage authorization failed. Claude login status could not be verified because the status check failed.';
    }
    return 'Usage authorization failed. Claude login status is currently unknown.';
  }

  private missingCredentialsMessage(authState: ClaudeAuthState): string {
    if (authState.status === 'logged-out') {
      return 'Claude Code login has expired. Please log in again before checking quota information.';
    }
    if (authState.status === 'logged-in') {
      return 'Usage authorization failed. Claude Code is logged in, but no quota credential was found.';
    }
    if (authState.status === 'check-failed') {
      return 'Claude quota information is unavailable because login status could not be checked.';
    }
    return 'Claude quota information is unavailable while login status is unknown.';
  }

  private async readErrorBody(response: Response): Promise<string> {
    try {
      const bodyText = (await response.text()).trim();
      if (!bodyText) return '';
      let normalized = bodyText;
      try {
        normalized = JSON.stringify(JSON.parse(bodyText));
      } catch {
        // Keep non-JSON response text.
      }
      return normalized.length > USAGE_ERROR_BODY_MAX_CHARS
        ? `${normalized.slice(0, USAGE_ERROR_BODY_MAX_CHARS)}...`
        : normalized;
    } catch {
      return '';
    }
  }

  private buildUnavailableUsage(error: string): ClaudeUsageData {
    if (this.cachedUsage) {
      return {
        ...this.cachedUsage,
        pools: markUsagePoolsStale(this.cachedUsage.pools),
        error,
      };
    }
    return {
      provider: 'claude-code',
      pools: {},
      lastUpdated: null,
      error,
    };
  }

  private commitUsage(usage: ClaudeUsageData, generation: number): ClaudeUsageData {
    if (generation === this.cacheGeneration) {
      this.cachedUsage = usage;
      this.broadcastUpdate(usage);
    }
    return usage;
  }

  private broadcastUpdate(usage: ClaudeUsageData | null): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('claude-usage:update', usage);
      }
    }
  }
}

export const claudeUsageService = new ClaudeUsageServiceImpl();

export function mapClaudeUsageResponse(
  response: ClaudeUsageResponse,
  updatedAt: number,
): ClaudeUsageData {
  const pools: UsagePoolMap = {};
  const addPool = (
    limitId: 'five_hour' | 'seven_day' | 'seven_day_opus',
    name: string,
    windowMinutes: number,
    window: ClaudeUsageWindowResponse | null | undefined,
  ): void => {
    if (typeof window?.utilization !== 'number' || !Number.isFinite(window.utilization)) return;
    const key = makeUsagePoolKey('claude-code', limitId);
    pools[key] = {
      key,
      provider: 'claude-code',
      limitId,
      name,
      utilization: window.utilization,
      resetsAt: typeof window.resets_at === 'string' ? window.resets_at : null,
      windowMinutes,
      updatedAt,
      stale: false,
    };
  };

  addPool('five_hour', '5-hour', 5 * 60, response.five_hour);
  addPool('seven_day', 'Weekly', 7 * 24 * 60, response.seven_day);
  addPool('seven_day_opus', 'Opus weekly', 7 * 24 * 60, response.seven_day_opus);

  return {
    provider: 'claude-code',
    pools,
    lastUpdated: Object.keys(pools).length > 0 ? updatedAt : null,
  };
}

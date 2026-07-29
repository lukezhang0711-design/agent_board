/**
 * ClaudeUsageService - Tracks Claude Code API usage limits.
 *
 * Claude CLI auth is the authority for login state. OAuth credentials are read
 * only to call the separate Usage API and a Usage 401 never mutates login state.
 */

import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import { getEnhancedPath } from './CLIManager';
import {
  buildSystemClaudeCliCommand,
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
    accessToken?: unknown;
  };
  accessToken?: unknown;
  oauthToken?: unknown;
}

interface CredentialCandidate {
  accessToken: string;
  source: string;
  fingerprint: string;
}

interface ClaudeUsageRefreshOptions {
  manual?: boolean;
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
  getState(options?: { forceRefresh?: boolean; trigger?: 'usage-401-recovery' | 'usage-refresh' }): Promise<ClaudeAuthState>;
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
const AUTHORIZATION_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const RATE_LIMIT_DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const AUTHORIZATION_COOLDOWN_MESSAGE = '额度授权失败,已暂停自动重试;修复登录后点 Refresh 立即重试';
const ACCESS_TOKEN_PATHS = [
  ['claudeAiOauth', 'accessToken'],
  ['accessToken'],
  ['oauthToken'],
] as const;
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
    readonly retryAfterMs?: number,
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
  private inflightRefreshIsManual = false;
  private cacheGeneration = 0;
  private claudeCodeVersion: string | null = null;
  private readonly unauthorizedFailureCounts = new Map<string, number>();
  private readonly authorizationCooldowns = new Map<string, number>();
  private readonly cliRefreshDisabledFingerprints = new Set<string>();
  private rateLimitCooldownUntil: number | null = null;

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
      await this.refresh({ manual: false });
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
    this.inflightRefreshIsManual = false;
    this.broadcastUpdate(null);
  }

  async refresh(options: ClaudeUsageRefreshOptions = {}): Promise<ClaudeUsageData> {
    const manual = options.manual ?? true;
    if (manual) {
      this.resetCooldownsForManualRefresh();
    }

    if (this.inflightRefresh) {
      if (manual && !this.inflightRefreshIsManual) {
        return this.inflightRefresh.then(() => this.refresh({ manual: true }));
      }
      return this.inflightRefresh;
    }

    const generation = this.cacheGeneration;
    const work = this.doRefresh(generation, manual);
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
        this.inflightRefreshIsManual = false;
      }
    });
    this.inflightRefresh = refresh;
    this.inflightRefreshIsManual = manual;
    return refresh;
  }

  private async doRefresh(generation: number, manual: boolean): Promise<ClaudeUsageData> {
    try {
      if (!manual) {
        const rateLimitCooldownMessage = this.getRateLimitCooldownMessage();
        if (rateLimitCooldownMessage) {
          logger.main.info('[ClaudeUsageService] Usage auth event=rate-limit-cooldown result=skipped');
          return this.commitUsage(this.buildUnavailableUsage(rateLimitCooldownMessage), generation);
        }
      }

      const candidates = await this.readCredentialCandidates();
      this.pruneCredentialRetryState(candidates);
      if (candidates.length === 0) {
        const authState = await this.safeGetAuthState();
        return this.commitUsage(
          this.buildUnavailableUsage(this.missingCredentialsMessage(authState)),
          generation,
        );
      }

      const requestCandidates = this.filterCandidatesForRefresh(candidates, manual);
      if (requestCandidates.length === 0) {
        const cooldownCandidate = candidates.find((candidate) => this.hasAuthorizationCooldown(candidate));
        if (cooldownCandidate) {
          this.logCredentialEvent('authorization-cooldown', cooldownCandidate, 'skipped');
        }
        return this.commitUsage(
          this.buildUnavailableUsage(
            this.getAuthorizationCooldownMessage(candidates) ?? AUTHORIZATION_COOLDOWN_MESSAGE,
          ),
          generation,
        );
      }

      let usageData: ClaudeUsageData;
      try {
        usageData = await this.fetchUsageForCandidate(requestCandidates[0]);
      } catch (error) {
        if (error instanceof UsageHttpError && error.status === 429) {
          return this.commitUsage(
            this.buildUnavailableUsage(this.startRateLimitCooldown(error)),
            generation,
          );
        }
        if (!(error instanceof UsageHttpError) || error.status !== 401) {
          throw error;
        }
        try {
          usageData = await this.recoverFromUnauthorized(requestCandidates, manual);
        } catch (recoveryError) {
          if (recoveryError instanceof UsageHttpError && recoveryError.status === 429) {
            return this.commitUsage(
              this.buildUnavailableUsage(this.startRateLimitCooldown(recoveryError)),
              generation,
            );
          }
          const authorizationCooldownMessage = this.getAuthorizationCooldownMessage(candidates);
          if (authorizationCooldownMessage) {
            return this.commitUsage(
              this.buildUnavailableUsage(authorizationCooldownMessage),
              generation,
            );
          }
          throw recoveryError;
        }
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
    manual: boolean,
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
    this.pruneCredentialRetryState(rereadCandidates);

    const initialFingerprints = new Set(initialCredentials.map((candidate) => candidate.fingerprint));
    const attemptedFingerprints = new Set<string>([failedCredential.fingerprint]);
    const credentialsChanged = rereadCandidates.some(
      (candidate) => !initialFingerprints.has(candidate.fingerprint),
    );
    for (const candidate of this.filterCandidatesForRefresh(rereadCandidates, manual)) {
      if (attemptedFingerprints.has(candidate.fingerprint)) {
        continue;
      }
      attemptedFingerprints.add(candidate.fingerprint);
      try {
        return await this.fetchUsageForCandidate(candidate);
      } catch (error) {
        if (!(error instanceof UsageHttpError) || error.status !== 401) {
          throw error;
        }
      }
    }

    if (
      authState.status === 'logged-in'
      && !credentialsChanged
      && !this.hasAuthorizationCooldown(failedCredential)
      && await this.refreshCliCredentials(failedCredential)
    ) {
      const refreshedCandidates = await this.readCredentialCandidates();
      this.pruneCredentialRetryState(refreshedCandidates);
      const refreshCandidates = this.filterCandidatesForRefresh(refreshedCandidates, manual);
      const retryCredential = refreshCandidates.find(
        (candidate) => !attemptedFingerprints.has(candidate.fingerprint),
      ) ?? refreshCandidates[0];
      if (retryCredential) {
        try {
          return await this.fetchUsageForCandidate(retryCredential);
        } catch (error) {
          if (!(error instanceof UsageHttpError) || error.status !== 401) {
            throw error;
          }
        }
      }
    }

    throw new Error(this.authorizationFailureMessage(authState));
  }

  /**
   * Ask a user-installed, full Claude CLI to run its local, zero-cost `/usage`
   * command. The bundled Agent SDK binary does not support this command, so it
   * is explicitly excluded and failed automatic attempts are paused per credential.
   */
  private async refreshCliCredentials(failedCredential: CredentialCandidate): Promise<boolean> {
    if (this.cliRefreshDisabledFingerprints.has(failedCredential.fingerprint)) {
      this.logCredentialEvent('cli-refresh', failedCredential, 'skipped-disabled');
      return false;
    }

    const enhancedPath = this.cliBaseEnv?.PATH ?? getEnhancedPath();
    const command = buildSystemClaudeCliCommand([
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
    if (!command) {
      this.cliRefreshDisabledFingerprints.add(failedCredential.fingerprint);
      this.logCredentialEvent('cli-refresh', failedCredential, 'unavailable');
      logger.main.info(
        '[ClaudeUsageService] No system Claude CLI is available for credential refresh; '
        + 'the bundled SDK fallback is disabled for this credential.',
      );
      return false;
    }

    const env: NodeJS.ProcessEnv = {
      ...(this.cliBaseEnv ?? process.env),
      PATH: enhancedPath,
      TERM: 'dumb',
      CI: 'true',
    };
    for (const key of CREDENTIAL_ENV_KEYS) {
      delete env[key];
    }

    try {
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
              reject(new Error('Claude Code credential refresh command failed.'));
              return;
            }
            resolve();
          },
        );
      });
      this.logCredentialEvent('cli-refresh', failedCredential, 'succeeded');
      return true;
    } catch {
      this.cliRefreshDisabledFingerprints.add(failedCredential.fingerprint);
      this.logCredentialEvent('cli-refresh', failedCredential, 'failed');
      logger.main.warn(
        '[ClaudeUsageService] System Claude CLI credential refresh failed; '
        + 'the fallback is paused until credentials change or the next manual refresh.',
      );
      return false;
    }
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
    await this.refresh({ manual: false });
  }

  private async readCredentialCandidates(): Promise<CredentialCandidate[]> {
    const candidates = this.platform === 'darwin'
      ? await this.readKeychainCandidates()
      : await this.readCredentialsFileCandidate();
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.fingerprint)) return false;
      seen.add(candidate.fingerprint);
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
            `[ClaudeUsageService] Failed to read keychain entry ${serviceName} after ${attempt} attempts.`,
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
      const accessToken = this.findCredentialAccessToken(credentials);
      if (!accessToken) {
        logger.main.debug(`[ClaudeUsageService] No access token in ${source}`);
        return null;
      }
      return {
        accessToken,
        source,
        fingerprint: createHash('sha256').update(accessToken).digest('hex'),
      };
    } catch {
      logger.main.warn(`[ClaudeUsageService] Invalid Claude credentials in ${source}.`);
      return null;
    }
  }

  private findCredentialAccessToken(credentials: KeychainCredentials): string | null {
    for (const fieldPath of ACCESS_TOKEN_PATHS) {
      let current: unknown = credentials;
      for (const fieldName of fieldPath) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          current = undefined;
          break;
        }
        current = (current as Record<string, unknown>)[fieldName];
      }
      if (typeof current === 'string' && current.trim().length > 0) {
        return current.trim();
      }
    }
    return null;
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

  private resetCooldownsForManualRefresh(): void {
    this.unauthorizedFailureCounts.clear();
    this.authorizationCooldowns.clear();
    this.cliRefreshDisabledFingerprints.clear();
    this.rateLimitCooldownUntil = null;
  }

  private pruneCredentialRetryState(candidates: CredentialCandidate[]): void {
    const now = this.now();
    const currentFingerprints = new Set(candidates.map((candidate) => candidate.fingerprint));
    // An empty read can be a transient Keychain/filesystem failure, not proof that
    // the credential changed. Keep its retry state until a non-empty read proves
    // that the old fingerprint has actually disappeared.
    const canConfirmCredentialChange = candidates.length > 0;
    for (const [fingerprint, cooldownUntil] of this.authorizationCooldowns) {
      if (cooldownUntil <= now || (canConfirmCredentialChange && !currentFingerprints.has(fingerprint))) {
        this.authorizationCooldowns.delete(fingerprint);
        this.unauthorizedFailureCounts.delete(fingerprint);
      }
    }
    for (const fingerprint of this.unauthorizedFailureCounts.keys()) {
      if (canConfirmCredentialChange && !currentFingerprints.has(fingerprint)) {
        this.unauthorizedFailureCounts.delete(fingerprint);
      }
    }
    for (const fingerprint of this.cliRefreshDisabledFingerprints) {
      if (canConfirmCredentialChange && !currentFingerprints.has(fingerprint)) {
        this.cliRefreshDisabledFingerprints.delete(fingerprint);
      }
    }
  }

  private filterCandidatesForRefresh(
    candidates: CredentialCandidate[],
    manual: boolean,
  ): CredentialCandidate[] {
    return manual
      ? candidates
      : candidates.filter((candidate) => !this.hasAuthorizationCooldown(candidate));
  }

  private hasAuthorizationCooldown(candidate: CredentialCandidate): boolean {
    const cooldownUntil = this.authorizationCooldowns.get(candidate.fingerprint);
    if (!cooldownUntil) return false;
    if (cooldownUntil <= this.now()) {
      this.authorizationCooldowns.delete(candidate.fingerprint);
      this.unauthorizedFailureCounts.delete(candidate.fingerprint);
      return false;
    }
    return true;
  }

  private logCredentialEvent(event: string, candidate: CredentialCandidate, result: string): void {
    logger.main.info(
      `[ClaudeUsageService] Usage auth event=${event} fingerprint=${candidate.fingerprint.slice(0, 8)} result=${result}`,
    );
  }

  private getAuthorizationCooldownMessage(candidates: CredentialCandidate[]): string | null {
    return candidates.some((candidate) => this.hasAuthorizationCooldown(candidate))
      ? AUTHORIZATION_COOLDOWN_MESSAGE
      : null;
  }

  private getRateLimitCooldownMessage(): string | null {
    if (this.rateLimitCooldownUntil === null) return null;
    const remainingMs = this.rateLimitCooldownUntil - this.now();
    if (remainingMs <= 0) {
      this.rateLimitCooldownUntil = null;
      return null;
    }
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return `接口限流,${remainingMinutes} 分钟后自动恢复`;
  }

  private startRateLimitCooldown(error: UsageHttpError): string {
    const cooldownMs = error.retryAfterMs ?? RATE_LIMIT_DEFAULT_COOLDOWN_MS;
    this.rateLimitCooldownUntil = this.now() + cooldownMs;
    logger.main.info('[ClaudeUsageService] Usage auth event=rate-limit-cooldown result=started');
    return this.getRateLimitCooldownMessage() ?? '接口限流,0 分钟后自动恢复';
  }

  private async fetchUsageForCandidate(candidate: CredentialCandidate): Promise<ClaudeUsageData> {
    try {
      const usage = await this.fetchUsageData(candidate.accessToken);
      this.unauthorizedFailureCounts.delete(candidate.fingerprint);
      this.authorizationCooldowns.delete(candidate.fingerprint);
      return usage;
    } catch (error) {
      if (error instanceof UsageHttpError && error.status === 401) {
        this.logCredentialEvent('401', candidate, 'detected');
        const failures = (this.unauthorizedFailureCounts.get(candidate.fingerprint) ?? 0) + 1;
        this.unauthorizedFailureCounts.set(candidate.fingerprint, failures);
        if (failures >= 2) {
          this.authorizationCooldowns.set(
            candidate.fingerprint,
            this.now() + AUTHORIZATION_FAILURE_COOLDOWN_MS,
          );
        }
      }
      throw error;
    }
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
        if (response.status === 401) {
          logger.main.warn('[ClaudeUsageService] Usage API returned 401 (unauthorized).');
          throw new UsageHttpError(401, 'Claude Usage API rejected the OAuth credential.');
        }
        if (response.status === 429) {
          throw new UsageHttpError(
            429,
            'Claude usage is rate limited (429). Please retry later.',
            this.readRetryAfterMs(response),
          );
        }
        const errorBody = await this.readErrorBody(response);
        const detail = errorBody ? ` Response body: ${errorBody}` : '';
        if (response.status === 403) {
          throw new UsageHttpError(
            403,
            'Usage authorization failed (403). Claude is authenticated, but this account cannot access quota information.',
          );
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

  private readRetryAfterMs(response: Response): number | undefined {
    const retryAfter = response.headers?.get('Retry-After')?.trim();
    if (!retryAfter) return undefined;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1000);
    }
    const retryAt = Date.parse(retryAfter);
    if (!Number.isFinite(retryAt)) return undefined;
    return Math.max(0, retryAt - this.now());
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
      return await this.authStateService.getState({
        forceRefresh,
        trigger: forceRefresh ? 'usage-401-recovery' : 'usage-refresh',
      });
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
      const summary: Record<string, unknown> = { length: bodyText.length };
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          summary.fields = Object.keys(parsed).sort();
        } else {
          summary.shape = Array.isArray(parsed) ? 'array' : typeof parsed;
        }
      } catch {
        summary.shape = 'non-json';
      }
      return JSON.stringify(summary).slice(0, USAGE_ERROR_BODY_MAX_CHARS);
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

/**
 * CodexUsageService - Tracks OpenAI Codex usage limits.
 *
 * Codex writes subscription usage snapshots to token_count events under
 * ~/.codex/sessions. A rate_limits block is identified by its original
 * limit_id; primary/secondary are fields inside that pool, not global slots.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import {
  makeUsagePoolKey,
  markUsagePoolsStale,
  mergeUsagePoolSnapshot,
  type CodexUsageData,
  type UsagePool,
  type UsagePoolMap,
} from '../../shared/usage';

export type { CodexUsageData } from '../../shared/usage';

interface CodexRateLimitWindow {
  used_percent: number;
  window_minutes: number;
  resets_at: number;
}

interface CodexRateLimits {
  limit_id?: string;
  limit_name?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
  credits?: {
    has_credits: boolean;
    unlimited: boolean;
    balance: number | null;
  } | null;
}

interface CodexTokenUsage {
  totalTokens: number;
  lastTokens: number | null;
}

interface CodexCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: number | null;
}

interface TimedValue<T> {
  value: T;
  updatedAt: number;
}

interface CodexUsageSnapshot {
  pools: UsagePoolMap;
  tokenUsage: TimedValue<CodexTokenUsage> | null;
  credits: TimedValue<CodexCredits> | null;
}

interface SessionFileInfo {
  path: string;
  mtime: number;
}

export interface CodexUsageServiceOptions {
  sessionsDir?: string;
  turnRefreshDelayMs?: number;
}

const DEFAULT_CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const TURN_REFRESH_DELAY_MS = 1_000;

export class CodexUsageService {
  private cachedUsage: CodexUsageData | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private turnRefreshTimer: NodeJS.Timeout | null = null;
  private turnRefreshPromise: Promise<CodexUsageData | null> | null = null;
  private resolveTurnRefreshDelay: (() => void) | null = null;
  private turnRefreshQueued = false;
  private turnRefreshCancelled = false;
  private lastActivityTime = 0;
  private isPolling = false;
  private isSleeping = true;
  private readonly sessionsDir: string;
  private readonly turnRefreshDelayMs: number;

  constructor(options: CodexUsageServiceOptions = {}) {
    this.sessionsDir = options.sessionsDir ?? DEFAULT_CODEX_SESSIONS_DIR;
    this.turnRefreshDelayMs = options.turnRefreshDelayMs ?? TURN_REFRESH_DELAY_MS;
  }

  initialize(): void {
    logger.main.info('[CodexUsageService] Initialized (sleeping until activity detected)');
  }

  async recordActivity(): Promise<void> {
    this.lastActivityTime = Date.now();

    if (this.isSleeping) {
      this.isSleeping = false;
      this.startPolling();
      await this.refresh();
    }
  }

  getCachedUsage(): CodexUsageData | null {
    return this.cachedUsage;
  }

  recordTurnCompleted(): Promise<CodexUsageData | null> {
    this.lastActivityTime = Date.now();
    this.turnRefreshQueued = true;
    if (this.turnRefreshPromise) return this.turnRefreshPromise;

    if (this.isSleeping) {
      this.isSleeping = false;
      this.startPolling();
    }
    this.turnRefreshCancelled = false;
    this.turnRefreshPromise = this.drainTurnRefreshQueue().finally(() => {
      this.turnRefreshPromise = null;
      this.turnRefreshCancelled = false;
      this.resolveTurnRefreshDelay = null;
    });
    return this.turnRefreshPromise;
  }

  async refresh(): Promise<CodexUsageData> {
    try {
      const snapshot = await this.findLatestUsageSnapshot();
      const poolCount = Object.keys(snapshot.pools).length;
      logger.main.debug('[CodexUsageService] Usage snapshot result:', {
        poolCount,
        hasTokenUsage: Boolean(snapshot.tokenUsage),
      });

      if (poolCount === 0 && !snapshot.tokenUsage) {
        const noData = this.buildUnavailableUsage(
          'No Codex usage data found. Use Codex CLI with a ChatGPT subscription to see usage.',
        );
        this.cachedUsage = noData;
        this.broadcastUpdate();
        return noData;
      }

      if (this.cachedUsage) {
        const mergedPools = markUsagePoolsStale(this.cachedUsage.pools);
        for (const [key, candidate] of Object.entries(snapshot.pools)) {
          mergedPools[key] = mergeUsagePoolSnapshot(mergedPools[key], candidate);
        }
        snapshot.pools = mergedPools;
      }

      const poolUpdatedTimes = Object.values(snapshot.pools).map((pool) => pool.updatedAt);
      const usageData: CodexUsageData = {
        provider: 'openai-codex',
        pools: snapshot.pools,
        lastUpdated: Math.max(
          0,
          ...poolUpdatedTimes,
          snapshot.tokenUsage?.updatedAt ?? 0,
          snapshot.credits?.updatedAt ?? 0,
        ) || null,
      };

      if (snapshot.tokenUsage) usageData.tokenUsage = snapshot.tokenUsage.value;
      if (snapshot.credits) usageData.credits = snapshot.credits.value;

      this.cachedUsage = usageData;
      this.broadcastUpdate();
      return usageData;
    } catch (error) {
      logger.main.error('[CodexUsageService] Error refreshing usage:', error);
      const errorData = this.buildUnavailableUsage(
        error instanceof Error ? error.message : 'Unknown error reading Codex session files',
      );
      this.cachedUsage = errorData;
      this.broadcastUpdate();
      return errorData;
    }
  }

  stop(): void {
    this.turnRefreshQueued = false;
    this.turnRefreshCancelled = true;
    if (this.turnRefreshTimer) {
      clearTimeout(this.turnRefreshTimer);
      this.turnRefreshTimer = null;
    }
    this.resolveTurnRefreshDelay?.();
    this.resolveTurnRefreshDelay = null;
    this.stopPolling();
    logger.main.info('[CodexUsageService] Stopped');
  }

  private async drainTurnRefreshQueue(): Promise<CodexUsageData | null> {
    let latestUsage = this.cachedUsage;
    while (this.turnRefreshQueued && !this.turnRefreshCancelled) {
      this.turnRefreshQueued = false;
      await this.waitForTurnRefreshDelay();
      if (this.turnRefreshCancelled) break;
      latestUsage = await this.refresh();
    }
    return latestUsage;
  }

  private waitForTurnRefreshDelay(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveTurnRefreshDelay = resolve;
      this.turnRefreshTimer = setTimeout(() => {
        this.turnRefreshTimer = null;
        this.resolveTurnRefreshDelay = null;
        resolve();
      }, this.turnRefreshDelayMs);
    });
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
    if (Date.now() - this.lastActivityTime > IDLE_TIMEOUT_MS) {
      logger.main.info('[CodexUsageService] Going to sleep due to inactivity');
      this.isSleeping = true;
      this.stopPolling();
      return;
    }
    await this.refresh();
  }

  /** Collect the newest snapshot for every pool across all Codex rollout files. */
  private async findLatestUsageSnapshot(): Promise<CodexUsageSnapshot> {
    const recentFiles = await this.getSessionFiles();
    logger.main.debug('[CodexUsageService] Found session files:', recentFiles.length);

    const combined: CodexUsageSnapshot = {
      pools: {},
      tokenUsage: null,
      credits: null,
    };

    for (const file of recentFiles) {
      const snapshot = await this.extractUsageSnapshotFromFile(file);
      for (const [key, candidate] of Object.entries(snapshot.pools)) {
        combined.pools[key] = mergeUsagePoolSnapshot(combined.pools[key], candidate);
      }
      if (
        snapshot.tokenUsage
        && (!combined.tokenUsage || snapshot.tokenUsage.updatedAt >= combined.tokenUsage.updatedAt)
      ) {
        combined.tokenUsage = snapshot.tokenUsage;
      }
      if (
        snapshot.credits
        && (!combined.credits || snapshot.credits.updatedAt >= combined.credits.updatedAt)
      ) {
        combined.credits = snapshot.credits;
      }
    }

    return combined;
  }

  /** Walk every nested date directory; no fixed file-count cap may hide a pool. */
  private async getSessionFiles(): Promise<SessionFileInfo[]> {
    const files: SessionFileInfo[] = [];

    const walk = async (dirPath: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dirPath, { withFileTypes: true });
      } catch (error) {
        logger.main.debug('[CodexUsageService] Could not read sessions directory:', dirPath, error);
        return;
      }

      await Promise.all(entries.map(async (entry) => {
        const entryPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
          return;
        }
        if (!entry.isFile() || !entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) {
          return;
        }
        try {
          const fileStat = await stat(entryPath);
          files.push({ path: entryPath, mtime: fileStat.mtimeMs });
        } catch {
          // A rollout can disappear between readdir and stat; skip that file.
        }
      }));
    };

    await walk(this.sessionsDir);
    files.sort((a, b) => b.mtime - a.mtime);
    return files;
  }

  private async extractUsageSnapshotFromFile(file: SessionFileInfo): Promise<CodexUsageSnapshot> {
    const snapshot: CodexUsageSnapshot = {
      pools: {},
      tokenUsage: null,
      credits: null,
    };

    try {
      const content = await readFile(file.path, 'utf8');
      const lines = content.split('\n');

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const tokenCountPayload = this.getTokenCountPayload(event);
          if (!tokenCountPayload) continue;

          const updatedAt = this.getSnapshotTimestamp(event, file.mtime);
          const tokenUsage = this.extractTokenUsage(tokenCountPayload);
          if (!snapshot.tokenUsage || (tokenUsage && updatedAt >= snapshot.tokenUsage.updatedAt)) {
            if (tokenUsage) snapshot.tokenUsage = { value: tokenUsage, updatedAt };
          }

          const rateLimits = tokenCountPayload.rate_limits as CodexRateLimits | undefined;
          if (!rateLimits) continue;
          const activeLimits = filterRateLimitsByExpiry(rateLimits, Date.now() / 1000);
          const limitWindow = activeLimits?.primary ?? activeLimits?.secondary ?? null;
          const limitId = activeLimits?.limit_id;
          if (!limitWindow || typeof limitId !== 'string' || limitId.length === 0) continue;
          if (typeof limitWindow.used_percent !== 'number' || !Number.isFinite(limitWindow.used_percent)) {
            continue;
          }

          const key = makeUsagePoolKey('openai-codex', limitId);
          const candidate: UsagePool = {
            key,
            provider: 'openai-codex',
            limitId,
            name: typeof rateLimits.limit_name === 'string' && rateLimits.limit_name.length > 0
              ? rateLimits.limit_name
              : limitId,
            utilization: limitWindow.used_percent,
            resetsAt: typeof limitWindow.resets_at === 'number' && Number.isFinite(limitWindow.resets_at)
              ? new Date(limitWindow.resets_at * 1000).toISOString()
              : null,
            windowMinutes: typeof limitWindow.window_minutes === 'number'
              ? limitWindow.window_minutes
              : null,
            updatedAt,
            stale: false,
          };
          snapshot.pools[key] = mergeUsagePoolSnapshot(snapshot.pools[key], candidate);

          if (activeLimits?.credits && (!snapshot.credits || updatedAt >= snapshot.credits.updatedAt)) {
            snapshot.credits = {
              value: {
                hasCredits: activeLimits.credits.has_credits,
                unlimited: activeLimits.credits.unlimited,
                balance: activeLimits.credits.balance,
              },
              updatedAt,
            };
          }
        } catch {
          // Ignore partial/unparseable JSONL lines and continue collecting other pools.
        }
      }
    } catch (error) {
      logger.main.debug(`[CodexUsageService] Error reading file ${file.path}:`, error);
    }

    return snapshot;
  }

  private getTokenCountPayload(event: Record<string, unknown>): Record<string, unknown> | null {
    if (event.type === 'event_msg') {
      const payload = event.payload as Record<string, unknown> | undefined;
      return payload?.type === 'token_count' ? payload : null;
    }
    return event.type === 'token_count' ? event : null;
  }

  private extractTokenUsage(tokenCountPayload: Record<string, unknown>): CodexTokenUsage | null {
    const info = tokenCountPayload.info as
      | {
          total_token_usage?: { total_tokens?: number };
          last_token_usage?: { total_tokens?: number };
        }
      | undefined;
    const totalTokens = info?.total_token_usage?.total_tokens;
    if (typeof totalTokens !== 'number') return null;
    return {
      totalTokens,
      lastTokens: typeof info?.last_token_usage?.total_tokens === 'number'
        ? info.last_token_usage.total_tokens
        : null,
    };
  }

  private getSnapshotTimestamp(event: Record<string, unknown>, fallback: number): number {
    const timestamp = event.timestamp;
    if (typeof timestamp === 'string') {
      const parsed = Date.parse(timestamp);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
    }
    return fallback;
  }

  private buildUnavailableUsage(error: string): CodexUsageData {
    if (this.cachedUsage) {
      return {
        ...this.cachedUsage,
        pools: markUsagePoolsStale(this.cachedUsage.pools),
        error,
      };
    }
    return {
      provider: 'openai-codex',
      pools: {},
      lastUpdated: null,
      error,
    };
  }

  private broadcastUpdate(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('codex-usage:update', this.cachedUsage);
      }
    }
  }
}

export const codexUsageService = new CodexUsageService();

/**
 * Drop expired windows from a Codex rate-limit block.
 *
 * Returns null when neither primary nor secondary is active. Missing resets_at
 * remains active for compatibility with older/partial Codex snapshots.
 */
export function filterRateLimitsByExpiry(
  rateLimits: CodexRateLimits,
  nowSeconds: number,
): CodexRateLimits | null {
  const primary = rateLimits.primary ?? null;
  const secondary = rateLimits.secondary ?? null;

  const primaryActive =
    primary !== null
    && (typeof primary.resets_at !== 'number' || primary.resets_at > nowSeconds);
  const secondaryActive =
    secondary !== null
    && (typeof secondary.resets_at !== 'number' || secondary.resets_at > nowSeconds);

  if (!primaryActive && !secondaryActive) return null;

  return {
    ...rateLimits,
    primary: primaryActive ? primary : null,
    secondary: secondaryActive ? secondary : null,
  };
}

export type { CodexRateLimits };

/**
 * CodexUsageService - Tracks OpenAI Codex usage limits.
 *
 * Codex writes subscription usage snapshots to token_count events under
 * ~/.codex/sessions. A rate_limits block is identified by its original
 * limit_id; primary/secondary are fields inside that pool, not global slots.
 */

import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { createHash } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
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
  resets_at?: number;
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
  ctime: number;
  size: number;
  dev: number;
  ino: number;
}

interface IndexedTokenCountRecord {
  explicitTimestamp: number | null;
  tokenUsage: CodexTokenUsage | null;
  rateLimits: CodexRateLimits | null;
}

interface IndexedSessionFile {
  mtime: number;
  ctime: number;
  size: number;
  dev: number;
  ino: number;
  completeThrough: number;
  tailBase64: string;
  contentFingerprint: string;
  records: IndexedTokenCountRecord[];
  tailRecord: IndexedTokenCountRecord | null;
}

interface PersistedCodexUsageIndex {
  schemaVersion: number;
  parserVersion: number;
  sessionsDir: string;
  files: Record<string, IndexedSessionFile>;
}

export interface CodexUsageServiceOptions {
  sessionsDir?: string;
  turnRefreshDelayMs?: number;
  cachePath?: string | null;
  useIncrementalIndex?: boolean;
}

const DEFAULT_CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const TURN_REFRESH_DELAY_MS = 1_000;
const INDEX_SCHEMA_VERSION = 1;
const INDEX_PARSER_VERSION = 1;
const INDEX_FILENAME = 'codex-usage-index-v1.json';
const CONTENT_FINGERPRINT_SAMPLE_BYTES = 4 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIndexedTokenCountRecord(value: unknown): value is IndexedTokenCountRecord {
  if (!isRecord(value)) return false;
  if (value.explicitTimestamp !== null && !isFiniteNumber(value.explicitTimestamp)) return false;
  if (value.tokenUsage !== null) {
    if (!isRecord(value.tokenUsage) || !isFiniteNumber(value.tokenUsage.totalTokens)) return false;
    if (value.tokenUsage.lastTokens !== null && !isFiniteNumber(value.tokenUsage.lastTokens)) return false;
  }
  return value.rateLimits === null || isCodexRateLimits(value.rateLimits);
}

function isCodexRateLimitWindow(value: unknown): value is CodexRateLimitWindow {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.used_percent)
    && isFiniteNumber(value.window_minutes)
    && (value.resets_at === undefined || isFiniteNumber(value.resets_at));
}

function isCodexRateLimits(value: unknown): value is CodexRateLimits {
  if (!isRecord(value)) return false;
  if (value.limit_id !== undefined && typeof value.limit_id !== 'string') return false;
  if (
    value.limit_name !== undefined
    && value.limit_name !== null
    && typeof value.limit_name !== 'string'
  ) {
    return false;
  }
  for (const window of [value.primary, value.secondary]) {
    if (window !== undefined && window !== null && !isCodexRateLimitWindow(window)) return false;
  }
  const credits = value.credits;
  if (credits !== undefined && credits !== null) {
    if (
      !isRecord(credits)
      || typeof credits.has_credits !== 'boolean'
      || typeof credits.unlimited !== 'boolean'
      || (credits.balance !== null && !isFiniteNumber(credits.balance))
    ) {
      return false;
    }
  }
  return true;
}

function isIndexedSessionFile(value: unknown): value is IndexedSessionFile {
  if (!isRecord(value)) return false;
  if (![value.mtime, value.ctime, value.size, value.dev, value.ino, value.completeThrough]
    .every(isFiniteNumber)) {
    return false;
  }
  if (
    (value.size as number) < 0
    || (value.completeThrough as number) < 0
    || (value.completeThrough as number) > (value.size as number)
    || typeof value.tailBase64 !== 'string'
    || typeof value.contentFingerprint !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.contentFingerprint)
    || !Array.isArray(value.records)
    || !value.records.every(isIndexedTokenCountRecord)
    || (value.tailRecord !== null && !isIndexedTokenCountRecord(value.tailRecord))
  ) {
    return false;
  }
  const tail = Buffer.from(value.tailBase64, 'base64');
  return tail.toString('base64') === value.tailBase64
    && (value.completeThrough as number) + tail.length === value.size;
}

function isPersistedIndex(value: unknown, sessionsDir: string): value is PersistedCodexUsageIndex {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== INDEX_SCHEMA_VERSION
    || value.parserVersion !== INDEX_PARSER_VERSION
    || value.sessionsDir !== sessionsDir
    || !isRecord(value.files)
  ) {
    return false;
  }
  return Object.values(value.files).every(isIndexedSessionFile);
}

export class CodexUsageService {
  private cachedUsage: CodexUsageData | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private turnRefreshTimer: NodeJS.Timeout | null = null;
  private turnRefreshPromise: Promise<CodexUsageData | null> | null = null;
  private resolveTurnRefreshDelay: (() => void) | null = null;
  private turnRefreshQueued = false;
  private turnRefreshCancelled = false;
  private refreshInFlight: Promise<CodexUsageData> | null = null;
  private lastActivityTime = 0;
  private isPolling = false;
  private isSleeping = true;
  private readonly sessionsDir: string;
  private readonly turnRefreshDelayMs: number;
  private readonly configuredCachePath: string | null | undefined;
  private readonly useIncrementalIndex: boolean;
  private indexLoaded = false;
  private indexDirty = false;
  private indexedFiles: Record<string, IndexedSessionFile> = {};

  constructor(options: CodexUsageServiceOptions = {}) {
    this.sessionsDir = options.sessionsDir ?? DEFAULT_CODEX_SESSIONS_DIR;
    this.turnRefreshDelayMs = options.turnRefreshDelayMs ?? TURN_REFRESH_DELAY_MS;
    this.configuredCachePath = Object.prototype.hasOwnProperty.call(options, 'cachePath')
      ? options.cachePath
      : options.sessionsDir
        ? null
        : undefined;
    this.useIncrementalIndex = options.useIncrementalIndex !== false;
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

  refresh(): Promise<CodexUsageData> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const run = this.performRefresh();
    const tracked = run.finally(() => {
      if (this.refreshInFlight === tracked) this.refreshInFlight = null;
    });
    this.refreshInFlight = tracked;
    return tracked;
  }

  private async performRefresh(): Promise<CodexUsageData> {
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

      const activeRefresh = this.refreshInFlight;
      if (activeRefresh) {
        await activeRefresh;
        if (this.turnRefreshCancelled) break;
      }

      // Every turn observed before this scan is covered by the one refresh
      // below. Turns that arrive during it set the flag again and create at
      // most one subsequent trailing refresh.
      this.turnRefreshQueued = false;
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
    const nowSeconds = Date.now() / 1000;

    const combined: CodexUsageSnapshot = {
      pools: {},
      tokenUsage: null,
      credits: null,
    };

    if (!this.useIncrementalIndex) {
      for (const file of recentFiles) {
        try {
          const indexedFile = await this.readIndexedSessionFile(file);
          this.mergeUsageSnapshot(combined, this.materializeIndexedFile(indexedFile, nowSeconds));
        } catch (error) {
          logger.main.debug(`[CodexUsageService] Error reading file ${file.path}:`, error);
        }
      }
      return combined;
    }

    await this.loadPersistentIndex();
    const previousFiles = this.indexedFiles;
    const nextFiles: Record<string, IndexedSessionFile> = {};
    let indexChanged = this.indexDirty;

    for (const file of recentFiles) {
      const cached = previousFiles[file.path];
      try {
        let indexedFile: IndexedSessionFile;
        if (cached && this.isUnchangedFile(cached, file)) {
          indexedFile = cached;
        } else if (cached && this.canAppendToIndexedFile(cached, file)) {
          indexedFile = await this.appendIndexedSessionFile(cached, file);
          indexChanged = true;
        } else {
          indexedFile = await this.readIndexedSessionFile(file);
          indexChanged = true;
        }
        nextFiles[file.path] = indexedFile;
        this.mergeUsageSnapshot(combined, this.materializeIndexedFile(indexedFile, nowSeconds));
      } catch (error) {
        if (cached) indexChanged = true;
        logger.main.debug(`[CodexUsageService] Error indexing file ${file.path}:`, error);
      }
    }

    if (Object.keys(previousFiles).some((filePath) => !(filePath in nextFiles))) {
      indexChanged = true;
    }
    this.indexedFiles = nextFiles;
    this.indexDirty = indexChanged;
    await this.persistIndexIfNeeded();

    return combined;
  }

  private mergeUsageSnapshot(target: CodexUsageSnapshot, candidate: CodexUsageSnapshot): void {
    for (const [key, pool] of Object.entries(candidate.pools)) {
      target.pools[key] = mergeUsagePoolSnapshot(target.pools[key], pool);
    }
    if (
      candidate.tokenUsage
      && (!target.tokenUsage || candidate.tokenUsage.updatedAt >= target.tokenUsage.updatedAt)
    ) {
      target.tokenUsage = candidate.tokenUsage;
    }
    if (
      candidate.credits
      && (!target.credits || candidate.credits.updatedAt >= target.credits.updatedAt)
    ) {
      target.credits = candidate.credits;
    }
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
          files.push({
            path: entryPath,
            mtime: fileStat.mtimeMs,
            ctime: fileStat.ctimeMs,
            size: fileStat.size,
            dev: fileStat.dev,
            ino: fileStat.ino,
          });
        } catch {
          // A rollout can disappear between readdir and stat; skip that file.
        }
      }));
    };

    await walk(this.sessionsDir);
    files.sort((a, b) => (b.mtime - a.mtime) || a.path.localeCompare(b.path));
    return files;
  }

  private isUnchangedFile(cached: IndexedSessionFile, file: SessionFileInfo): boolean {
    return cached.mtime === file.mtime
      && cached.ctime === file.ctime
      && cached.size === file.size
      && cached.dev === file.dev
      && cached.ino === file.ino;
  }

  private canAppendToIndexedFile(cached: IndexedSessionFile, file: SessionFileInfo): boolean {
    const tailLength = Buffer.from(cached.tailBase64, 'base64').length;
    return cached.dev === file.dev
      && cached.ino === file.ino
      && file.size > cached.size
      && cached.completeThrough + tailLength === cached.size;
  }

  private async readIndexedSessionFile(file: SessionFileInfo): Promise<IndexedSessionFile> {
    const content = await readFile(file.path);
    const parsed = this.parseJsonlChunk(content);
    return {
      mtime: file.mtime,
      ctime: file.ctime,
      size: content.length,
      dev: file.dev,
      ino: file.ino,
      completeThrough: parsed.completeThrough,
      tailBase64: parsed.tail.toString('base64'),
      contentFingerprint: this.fingerprintContent(content),
      records: parsed.records,
      tailRecord: parsed.tailRecord,
    };
  }

  private async appendIndexedSessionFile(
    cached: IndexedSessionFile,
    file: SessionFileInfo,
  ): Promise<IndexedSessionFile> {
    const previousSamples = await this.readFingerprintSamples(file.path, cached.size);
    if (this.fingerprintSamples(previousSamples.head, previousSamples.boundary, cached.size)
      !== cached.contentFingerprint) {
      return this.readIndexedSessionFile(file);
    }

    const suffix = await this.readFileRange(file.path, cached.size, file.size - cached.size);
    const previousTail = Buffer.from(cached.tailBase64, 'base64');
    const parsed = this.parseJsonlChunk(Buffer.concat([previousTail, suffix]));
    const newHead = cached.size >= CONTENT_FINGERPRINT_SAMPLE_BYTES
      ? previousSamples.head
      : Buffer.concat([previousSamples.head, suffix]).subarray(
        0,
        CONTENT_FINGERPRINT_SAMPLE_BYTES,
      );
    const newBoundarySource = Buffer.concat([previousSamples.boundary, suffix]);
    const newBoundary = newBoundarySource.subarray(
      Math.max(0, newBoundarySource.length - CONTENT_FINGERPRINT_SAMPLE_BYTES),
    );
    return {
      mtime: file.mtime,
      ctime: file.ctime,
      size: file.size,
      dev: file.dev,
      ino: file.ino,
      completeThrough: cached.completeThrough + parsed.completeThrough,
      tailBase64: parsed.tail.toString('base64'),
      contentFingerprint: this.fingerprintSamples(newHead, newBoundary, file.size),
      records: [...cached.records, ...parsed.records],
      tailRecord: parsed.tailRecord,
    };
  }

  private async readFileRange(filePath: string, position: number, length: number): Promise<Buffer> {
    const handle = await open(filePath, 'r');
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    try {
      while (bytesRead < length) {
        const result = await handle.read(
          buffer,
          bytesRead,
          length - bytesRead,
          position + bytesRead,
        );
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
    } finally {
      await handle.close();
    }
    if (bytesRead !== length) {
      throw new Error(`Codex rollout changed while reading ${filePath}`);
    }
    return buffer;
  }

  private async readFingerprintSamples(
    filePath: string,
    size: number,
  ): Promise<{ head: Buffer; boundary: Buffer }> {
    if (size === 0) return { head: Buffer.alloc(0), boundary: Buffer.alloc(0) };
    const sampleLength = Math.min(size, CONTENT_FINGERPRINT_SAMPLE_BYTES);
    const head = await this.readFileRange(filePath, 0, sampleLength);
    const boundaryPosition = Math.max(0, size - CONTENT_FINGERPRINT_SAMPLE_BYTES);
    const boundary = boundaryPosition === 0
      ? head
      : await this.readFileRange(filePath, boundaryPosition, size - boundaryPosition);
    return { head, boundary };
  }

  private fingerprintContent(content: Buffer): string {
    const head = content.subarray(0, CONTENT_FINGERPRINT_SAMPLE_BYTES);
    const boundary = content.subarray(
      Math.max(0, content.length - CONTENT_FINGERPRINT_SAMPLE_BYTES),
    );
    return this.fingerprintSamples(head, boundary, content.length);
  }

  private fingerprintSamples(head: Buffer, boundary: Buffer, size: number): string {
    return createHash('sha256')
      .update(String(size))
      .update('\0')
      .update(head)
      .update('\0')
      .update(boundary)
      .digest('hex');
  }

  private parseJsonlChunk(content: Buffer): {
    completeThrough: number;
    tail: Buffer;
    records: IndexedTokenCountRecord[];
    tailRecord: IndexedTokenCountRecord | null;
  } {
    const lastNewline = content.lastIndexOf(0x0a);
    const completeThrough = lastNewline >= 0 ? lastNewline + 1 : 0;
    const records: IndexedTokenCountRecord[] = [];
    if (completeThrough > 0) {
      const completeText = content.subarray(0, completeThrough).toString('utf8');
      for (const rawLine of completeText.split('\n')) {
        const record = this.parseTokenCountRecord(rawLine);
        if (record) records.push(record);
      }
    }
    const tail = content.subarray(completeThrough);
    const tailRecord = tail.length > 0
      ? this.parseTokenCountRecord(tail.toString('utf8'))
      : null;
    return { completeThrough, tail, records, tailRecord };
  }

  private parseTokenCountRecord(rawLine: string): IndexedTokenCountRecord | null {
    const line = rawLine.trim();
    if (!line || !line.includes('token_count')) return null;

    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const tokenCountPayload = this.getTokenCountPayload(event);
      if (!tokenCountPayload) return null;
      return {
        explicitTimestamp: this.getExplicitSnapshotTimestamp(event),
        tokenUsage: this.extractTokenUsage(tokenCountPayload),
        rateLimits: this.extractRateLimits(tokenCountPayload),
      };
    } catch {
      return null;
    }
  }

  private extractRateLimits(tokenCountPayload: Record<string, unknown>): CodexRateLimits | null {
    const raw = tokenCountPayload.rate_limits;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const copyWindow = (window: unknown): CodexRateLimitWindow | null => {
      if (!window || typeof window !== 'object' || Array.isArray(window)) return null;
      const candidate = window as Record<string, unknown>;
      return {
        used_percent: candidate.used_percent as number,
        window_minutes: candidate.window_minutes as number,
        ...(Object.prototype.hasOwnProperty.call(candidate, 'resets_at')
          ? { resets_at: candidate.resets_at as number }
          : {}),
      };
    };
    const rawCredits = value.credits;
    const credits = rawCredits && typeof rawCredits === 'object' && !Array.isArray(rawCredits)
      ? rawCredits as Record<string, unknown>
      : null;
    return {
      limit_id: value.limit_id as string | undefined,
      limit_name: value.limit_name as string | null | undefined,
      primary: copyWindow(value.primary),
      secondary: copyWindow(value.secondary),
      credits: credits
        ? {
            has_credits: credits.has_credits as boolean,
            unlimited: credits.unlimited as boolean,
            balance: credits.balance as number | null,
          }
        : null,
    };
  }

  private materializeIndexedFile(
    indexedFile: IndexedSessionFile,
    nowSeconds: number,
  ): CodexUsageSnapshot {
    const snapshot: CodexUsageSnapshot = {
      pools: {},
      tokenUsage: null,
      credits: null,
    };

    const records = indexedFile.tailRecord
      ? [...indexedFile.records, indexedFile.tailRecord]
      : indexedFile.records;
    for (const record of records) {
      const updatedAt = record.explicitTimestamp ?? indexedFile.mtime;
      if (
        record.tokenUsage
        && (!snapshot.tokenUsage || updatedAt >= snapshot.tokenUsage.updatedAt)
      ) {
        snapshot.tokenUsage = { value: record.tokenUsage, updatedAt };
      }

      const rateLimits = record.rateLimits;
      if (!rateLimits) continue;
      const activeLimits = filterRateLimitsByExpiry(rateLimits, nowSeconds);
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
    }

    return snapshot;
  }

  private resolveCachePath(): string | null {
    if (this.configuredCachePath !== undefined) return this.configuredCachePath;
    try {
      return join(app.getPath('userData'), INDEX_FILENAME);
    } catch (error) {
      logger.main.warn('[CodexUsageService] Could not resolve usage index path:', error);
      return null;
    }
  }

  private async loadPersistentIndex(): Promise<void> {
    if (this.indexLoaded) return;
    this.indexLoaded = true;
    const cachePath = this.resolveCachePath();
    if (!cachePath) return;

    try {
      const parsed = JSON.parse(await readFile(cachePath, 'utf8')) as unknown;
      if (!isPersistedIndex(parsed, this.sessionsDir)) {
        throw new Error('Codex usage index schema or contents are invalid');
      }
      this.indexedFiles = parsed.files;
      this.indexDirty = false;
    } catch (error) {
      this.indexedFiles = {};
      this.indexDirty = true;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        logger.main.debug('[CodexUsageService] Usage index missing; rebuilding');
      } else {
        logger.main.warn('[CodexUsageService] Usage index invalid; rebuilding:', error);
      }
    }
  }

  private async persistIndexIfNeeded(): Promise<void> {
    if (!this.indexDirty) return;
    const cachePath = this.resolveCachePath();
    if (!cachePath) {
      this.indexDirty = false;
      return;
    }

    const persisted: PersistedCodexUsageIndex = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      parserVersion: INDEX_PARSER_VERSION,
      sessionsDir: this.sessionsDir,
      files: this.indexedFiles,
    };
    const temporaryPath = `${cachePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(persisted)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, cachePath);
      this.indexDirty = false;
    } catch (error) {
      logger.main.warn('[CodexUsageService] Could not persist usage index:', error);
      await unlink(temporaryPath).catch(() => {});
    }
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

  private getExplicitSnapshotTimestamp(event: Record<string, unknown>): number | null {
    const timestamp = event.timestamp;
    if (typeof timestamp === 'string') {
      const parsed = Date.parse(timestamp);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
    }
    return null;
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

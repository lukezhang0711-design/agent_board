import { execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger';
import { getEnhancedPath } from './CLIManager';
import { resolveClaudeCodeExecutablePath } from '@nimbalyst/runtime/electron/claudeCodeEnvironment';

export type ClaudeAuthStateKind = 'logged-in' | 'logged-out' | 'check-failed' | 'unknown';

export interface ClaudeAuthState {
  status: ClaudeAuthStateKind;
  source: 'claude-cli-auth-status';
  checkedAt: number | null;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  organization?: string;
  subscriptionType?: string;
  error?: string;
}

interface AuthStatusCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error & {
    code?: string | number;
    killed?: boolean;
    signal?: string | null;
  };
}

interface ClaudeAuthStateServiceOptions {
  now?: () => number;
  cacheTtlMs?: number;
  runAuthStatus?: () => Promise<AuthStatusCommandResult>;
  publishState?: (state: ClaudeAuthState) => void;
}

interface ClaudeAuthStatusJson {
  loggedIn?: unknown;
  authMethod?: unknown;
  apiProvider?: unknown;
  email?: unknown;
  orgName?: unknown;
  subscriptionType?: unknown;
}

const AUTH_CHECK_TIMEOUT_MS = 10_000;
const AUTH_CACHE_TTL_MS = 30_000;
const CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDECODE',
] as const;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function unknownState(): ClaudeAuthState {
  return {
    status: 'unknown',
    source: 'claude-cli-auth-status',
    checkedAt: null,
  };
}

interface ClaudeCliCommandOptions {
  platform?: NodeJS.Platform;
  enhancedPath?: string;
  homedir?: string;
  appData?: string;
  comSpec?: string;
  pathExists?: (candidate: string) => boolean;
  preferredExecutable?: string;
}

export interface ClaudeCliCommand {
  file: string;
  args: string[];
}

function quoteCmdArgument(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isBundledClaudeExecutable(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/app.asar/')
    || normalized.includes('/app.asar.unpacked/')
    || normalized.includes('/node_modules/@anthropic-ai/claude-agent-sdk')
    || normalized.includes('/claude-agent-sdk-');
}

function systemClaudeExecutableCandidates(options: ClaudeCliCommandOptions): string[] {
  const platform = options.platform ?? process.platform;
  const enhancedPath = options.enhancedPath ?? getEnhancedPath();
  const homedir = options.homedir ?? os.homedir();

  if (platform === 'win32') {
    const windowsPath = path.win32;
    const appData = options.appData ?? process.env.APPDATA;
    const candidates = [
      windowsPath.join(homedir, '.local', 'bin', 'claude.exe'),
      windowsPath.join(homedir, '.local', 'bin', 'claude.cmd'),
      ...(appData ? [windowsPath.join(appData, 'npm', 'claude.cmd')] : []),
      windowsPath.join(homedir, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    ];
    for (const entry of enhancedPath.split(';')) {
      const cleanEntry = entry.trim().replace(/^"(.*)"$/, '$1');
      if (!cleanEntry) continue;
      candidates.push(
        windowsPath.join(cleanEntry, 'claude.exe'),
        windowsPath.join(cleanEntry, 'claude.cmd'),
      );
    }
    return candidates;
  }

  const candidates = [
    path.join(homedir, '.local', 'bin', 'claude'),
    path.join(homedir, '.npm-global', 'bin', 'claude'),
    path.join(homedir, 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude',
  ];
  for (const entry of enhancedPath.split(':')) {
    const cleanEntry = entry.trim().replace(/^"(.*)"$/, '$1');
    if (cleanEntry) candidates.push(path.join(cleanEntry, 'claude'));
  }
  return candidates;
}

function resolveSystemClaudeExecutable(options: ClaudeCliCommandOptions): string | undefined {
  if (options.preferredExecutable) {
    return isBundledClaudeExecutable(options.preferredExecutable)
      ? undefined
      : options.preferredExecutable;
  }
  const pathExists = options.pathExists ?? fs.existsSync;
  return systemClaudeExecutableCandidates(options).find(
    (candidate) => !isBundledClaudeExecutable(candidate) && pathExists(candidate),
  );
}

function buildCommandForExecutable(
  args: readonly string[],
  resolvedExecutable: string | undefined,
  options: ClaudeCliCommandOptions,
): ClaudeCliCommand {
  const platform = options.platform ?? process.platform;
  const enhancedPath = options.enhancedPath ?? getEnhancedPath();
  const homedir = options.homedir ?? os.homedir();
  const pathExists = options.pathExists ?? fs.existsSync;

  if (platform !== 'win32') {
    return { file: resolvedExecutable ?? 'claude', args: [...args] };
  }

  const windowsPath = path.win32;
  const candidates: string[] = [];
  if (resolvedExecutable) {
    candidates.push(resolvedExecutable);
  } else {
    candidates.push(
      windowsPath.join(homedir, '.local', 'bin', 'claude.exe'),
      windowsPath.join(homedir, '.local', 'bin', 'claude.cmd'),
    );
    const appData = options.appData ?? process.env.APPDATA;
    if (appData) {
      candidates.push(windowsPath.join(appData, 'npm', 'claude.cmd'));
    }
    candidates.push(windowsPath.join(homedir, 'AppData', 'Roaming', 'npm', 'claude.cmd'));
    for (const entry of enhancedPath.split(';')) {
      const cleanEntry = entry.trim().replace(/^"(.*)"$/, '$1');
      if (!cleanEntry) continue;
      candidates.push(
        windowsPath.join(cleanEntry, 'claude.exe'),
        windowsPath.join(cleanEntry, 'claude.cmd'),
      );
    }
  }

  const executable = candidates.find((candidate) => pathExists(candidate))
    ?? resolvedExecutable
    ?? 'claude';
  if (executable.toLowerCase().endsWith('.exe')) {
    return { file: executable, args: [...args] };
  }

  const commandLine = [executable, ...args].map(quoteCmdArgument).join(' ');
  return {
    file: options.comSpec ?? process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
  };
}

/**
 * Resolve a directly executable Claude binary, or safely wrap a Windows npm
 * `.cmd` shim with cmd.exe. The arguments are controlled constants at each
 * call site; no user-provided shell text is interpolated.
 */
export function buildClaudeCliCommand(
  args: readonly string[],
  options: ClaudeCliCommandOptions = {},
): ClaudeCliCommand {
  const enhancedPath = options.enhancedPath ?? getEnhancedPath();
  const resolvedExecutable = options.preferredExecutable ?? resolveClaudeCodeExecutablePath({
    pathValue: enhancedPath,
    allowSystemFallback: true,
  });
  return buildCommandForExecutable(args, resolvedExecutable, options);
}

/**
 * Build a command for a user-installed, full Claude CLI. The bundled Agent
 * SDK binary deliberately never qualifies: it does not support the local
 * `/usage` refresh command used by ClaudeUsageService.
 */
export function buildSystemClaudeCliCommand(
  args: readonly string[],
  options: ClaudeCliCommandOptions = {},
): ClaudeCliCommand | null {
  const systemExecutable = resolveSystemClaudeExecutable(options);
  return systemExecutable
    ? buildCommandForExecutable(args, systemExecutable, options)
    : null;
}

export class ClaudeAuthStateService {
  private cachedState: ClaudeAuthState = unknownState();
  private inflightCheck: Promise<ClaudeAuthState> | null = null;
  private generation = 0;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly runAuthStatus: () => Promise<AuthStatusCommandResult>;
  private readonly publishState: (state: ClaudeAuthState) => void;

  constructor(options: ClaudeAuthStateServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? AUTH_CACHE_TTL_MS;
    this.runAuthStatus = options.runAuthStatus ?? (() => this.runCliAuthStatus());
    this.publishState = options.publishState ?? ((state) => this.broadcastState(state));
  }

  getCachedState(): ClaudeAuthState {
    return this.cachedState;
  }

  async getState(options: { forceRefresh?: boolean } = {}): Promise<ClaudeAuthState> {
    if (options.forceRefresh) {
      this.invalidate();
    }

    const checkedAt = this.cachedState.checkedAt;
    if (
      this.cachedState.status !== 'unknown'
      && checkedAt !== null
      && this.now() - checkedAt < this.cacheTtlMs
    ) {
      return this.cachedState;
    }

    if (this.inflightCheck) {
      return this.inflightCheck;
    }

    const generation = this.generation;
    const check = this.checkState().then((state) => {
      if (generation !== this.generation) {
        return this.getState();
      }
      return this.commitState(state);
    });
    this.inflightCheck = check;

    try {
      return await check;
    } finally {
      if (this.inflightCheck === check) {
        this.inflightCheck = null;
      }
    }
  }

  invalidate(): void {
    this.generation += 1;
    this.commitState(unknownState());
    this.inflightCheck = null;
  }

  /**
   * An unknown state is never TTL-cacheable, so this starts (or joins) exactly
   * one fresh CLI check. It intentionally does not call forceRefresh: repeated
   * focus events must share the pending check instead of restarting it.
   */
  async recheckIfUnknownOnWindowFocus(): Promise<ClaudeAuthState | null> {
    if (this.cachedState.status !== 'unknown') {
      return null;
    }
    return this.getState();
  }

  private async checkState(): Promise<ClaudeAuthState> {
    const checkedAt = this.now();
    let result: AuthStatusCommandResult;
    try {
      result = await this.runAuthStatus();
    } catch (error) {
      return this.checkFailed(
        checkedAt,
        `Claude authentication check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const timedOut = result.error?.code === 'ETIMEDOUT'
      || result.error?.killed === true
      || result.error?.signal === 'SIGTERM';
    const processFailed = result.error?.killed === true
      || Boolean(result.error?.signal)
      || typeof result.error?.code === 'string';
    if (processFailed) {
      return this.commandFailed(checkedAt, result, timedOut);
    }

    let parsed: ClaudeAuthStatusJson;
    try {
      parsed = JSON.parse(result.stdout.trim()) as ClaudeAuthStatusJson;
    } catch (error) {
      return this.checkFailed(
        checkedAt,
        `Claude authentication check returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsedState = this.stateFromPayload(parsed, checkedAt);
    const exitedNonZero = typeof result.exitCode === 'number' && result.exitCode !== 0;
    const commandFailed = Boolean(result.error) || result.exitCode !== 0;

    // Claude 1.x reports a complete logged-out JSON payload with exit code 1.
    // The payload is authoritative only for this self-consistent logged-out
    // shape; timeouts, process errors, malformed data, and logged-in payloads
    // on a non-zero exit remain check failures.
    if (commandFailed) {
      if (exitedNonZero && parsedState.status === 'logged-out') {
        return parsedState;
      }
      return this.commandFailed(checkedAt, result, false);
    }

    return parsedState;
  }

  private stateFromPayload(parsed: ClaudeAuthStatusJson, checkedAt: number): ClaudeAuthState {
    if (!parsed || typeof parsed !== 'object' || typeof parsed.loggedIn !== 'boolean') {
      return this.checkFailed(checkedAt, 'Claude authentication check returned an incomplete status payload.');
    }

    const authMethod = optionalString(parsed.authMethod);
    const apiProvider = optionalString(parsed.apiProvider);
    if (!apiProvider || apiProvider === 'none') {
      return this.checkFailed(checkedAt, 'Claude authentication status did not identify an API provider.');
    }

    if (parsed.loggedIn === true) {
      if (!authMethod || authMethod === 'none') {
        return this.checkFailed(checkedAt, 'Claude reported logged in without a valid authentication method.');
      }
      return {
        status: 'logged-in',
        source: 'claude-cli-auth-status',
        checkedAt,
        authMethod,
        apiProvider,
        email: optionalString(parsed.email),
        organization: optionalString(parsed.orgName),
        subscriptionType: optionalString(parsed.subscriptionType),
      };
    }

    if (authMethod !== 'none') {
      return this.checkFailed(checkedAt, 'Claude reported logged out with an inconsistent authentication method.');
    }

    return {
      status: 'logged-out',
      source: 'claude-cli-auth-status',
      checkedAt,
      authMethod,
      apiProvider,
    };
  }

  private commandFailed(
    checkedAt: number,
    result: AuthStatusCommandResult,
    timedOut: boolean,
  ): ClaudeAuthState {
    const detail = timedOut
      ? `Claude authentication check timed out after ${AUTH_CHECK_TIMEOUT_MS}ms.`
      : result.stderr.trim()
        || result.error?.message
        || `claude auth status exited with code ${String(result.exitCode)}.`;
    return this.checkFailed(checkedAt, detail);
  }

  private commitState(state: ClaudeAuthState): ClaudeAuthState {
    this.cachedState = state;
    this.publishState(state);
    return state;
  }

  private broadcastState(state: ClaudeAuthState): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('claude-auth:update', state);
      }
    }
  }

  private checkFailed(checkedAt: number, error: string): ClaudeAuthState {
    logger.main.warn('[ClaudeAuthStateService] Authentication status check failed:', error);
    return {
      status: 'check-failed',
      source: 'claude-cli-auth-status',
      checkedAt,
      error,
    };
  }

  private runCliAuthStatus(): Promise<AuthStatusCommandResult> {
    const enhancedPath = getEnhancedPath();
    const command = buildClaudeCliCommand(['auth', 'status', '--json'], {
      enhancedPath,
      appData: process.env.APPDATA,
      comSpec: process.env.ComSpec,
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: enhancedPath,
      TERM: 'dumb',
      CI: 'true',
    };
    for (const key of CREDENTIAL_ENV_KEYS) {
      delete env[key];
    }

    return new Promise((resolve) => {
      execFile(
        command.file,
        command.args,
        {
          env,
          timeout: AUTH_CHECK_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const commandError = error as AuthStatusCommandResult['error'];
          resolve({
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            exitCode: error
              ? typeof commandError?.code === 'number' ? commandError.code : null
              : 0,
            ...(commandError ? { error: commandError } : {}),
          });
        },
      );
    });
  }
}

export const claudeAuthStateService = new ClaudeAuthStateService();

/**
 * Channel health checks are login/control-plane probes by default. A real
 * prompt remains available only as an explicit deep diagnostic; startup and
 * normal panel checks must not consume inference quota or create a session.
 */

export const CHANNEL_HEALTH_PROMPT = 'Reply with one word: pong';
export const CHANNEL_HEALTH_SLOW_MS = 10_000;
export const CHANNEL_HEALTH_TIMEOUT_MS = 60_000;
export const CHANNEL_HEALTH_AUTO_DEDUPE_MS = 10 * 60 * 1_000;

export type ChannelHealthTrigger = 'manual' | 'automatic';
export type ChannelHealthTransport = 'streaming' | 'claude-cli';
export type ChannelHealthState = 'never' | 'healthy' | 'slow' | 'failed' | 'unknown' | 'disabled';
export type ChannelHealthFailureKind =
  | 'not_logged_in'
  | 'missing_binary'
  | 'not_started'
  | 'timeout'
  | 'missing_api_key'
  | 'auth_check_timeout'
  | 'auth_check_unknown'
  | 'engine_error';

export interface ChannelHealthChannel {
  id: string;
  displayName: string;
  transport: ChannelHealthTransport;
  /** Disabled rows remain visible but must never send a health request. */
  enabled?: boolean;
}

export interface ChannelHealthProbeResult {
  /** A provider may return a neutral state without throwing (e.g. API-key mode). */
  state?: Exclude<ChannelHealthState, 'never' | 'disabled'>;
  failureKind?: ChannelHealthFailureKind;
  /** Time from probe submission to the first observable control-plane receipt. */
  firstResponseMs?: number;
  /** Time from probe submission to completion. */
  completionMs?: number;
  summary?: string;
  guidance?: string;
  rawOutput?: string;
}

/**
 * Receipt shape for the opt-in deep diagnostic only. It is intentionally not
 * used by normal/startup health checks.
 */
export interface ChannelHealthTransportResult {
  firstResponseMs?: number;
  completionMs?: number;
  responseText?: string;
}

export interface ChannelHealthResult extends ChannelHealthChannel {
  state: ChannelHealthState;
  checkedAt?: number;
  trigger?: ChannelHealthTrigger;
  firstResponseMs?: number;
  completionMs?: number;
  failureKind?: ChannelHealthFailureKind;
  /** Present only for a locally observed CLI process exit. */
  exitCode?: number;
  summary?: string;
  guidance?: string;
  rawOutput?: string;
}

export interface ChannelHealthSnapshot {
  running: boolean;
  results: ChannelHealthResult[];
}

export interface ChannelHealthRunContext {
  event: Electron.IpcMainInvokeEvent;
  workspacePath: string;
  /** Omit to run every enabled channel; provide one id for the row retry button. */
  channelId?: string;
}

export interface ChannelHealthServiceDeps {
  listEnabledChannels: () => Promise<ChannelHealthChannel[]> | ChannelHealthChannel[];
  runChannel: (input: {
    channel: ChannelHealthChannel;
    event: Electron.IpcMainInvokeEvent;
    workspacePath: string;
  }) => Promise<ChannelHealthProbeResult>;
  /** Explicit opt-in only: may send a real prompt and consume inference. */
  runDeepChannel?: (input: {
    channel: ChannelHealthChannel;
    event: Electron.IpcMainInvokeEvent;
    workspacePath: string;
    prompt: string;
  }) => Promise<ChannelHealthTransportResult>;
  isAutoCheckEnabled: () => boolean;
  /** Receives only fixed telemetry fields; never a prompt, response, or user data. */
  log: (line: string) => void;
  now?: () => number;
  timeoutMs?: number;
}

type ChannelHealthProbeRunner = (
  channel: ChannelHealthChannel,
  context: ChannelHealthRunContext,
) => Promise<ChannelHealthProbeResult>;

/** Typed errors let production adapters preserve actionable classifications. */
export class ChannelHealthError extends Error {
  constructor(
    readonly failureKind: ChannelHealthFailureKind,
    message?: string,
    readonly exitCode?: number,
  ) {
    super(message ?? failureKind);
    this.name = 'ChannelHealthError';
  }
}

export function classifyChannelHealthError(error: unknown): ChannelHealthFailureKind {
  if (error instanceof ChannelHealthError) return error.failureKind;
  const message = error instanceof Error ? error.message : String(error);
  if (/(?:api[\s_-]?key|密钥).*(?:not configured|missing|required|未配置)|(?:not configured|missing|required).*(?:api[\s_-]?key|密钥)/i.test(message)) {
    return 'missing_api_key';
  }
  if (/not.?logged.?in|not authenticated|unauthenticated|auth(?:entication)? failed|oauth|login|\b401\b/i.test(message)) {
    return 'not_logged_in';
  }
  if (/not installed|missing binary|enoent|command not found|executable.*not found/i.test(message)) {
    return 'missing_binary';
  }
  if (/workspace untrusted|not started|not ready|booting|initializ(?:e|ing)|extension-agent-denied/i.test(message)) {
    return 'not_started';
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return 'timeout';
  }
  return 'engine_error';
}

export function channelHealthFailureCopy(
  channelId: string,
  failureKind: ChannelHealthFailureKind,
  exitCode?: number,
): { summary: string; guidance: string } {
  switch (failureKind) {
    case 'not_logged_in':
      if (channelId === 'antigravity-gemini-agent') {
        return { summary: '未登录', guidance: '请在终端登录 antigravity 命令行后重试' };
      }
      if (channelId === 'claude-code-cli') {
        return { summary: '未登录', guidance: '请运行 claude /login 后重试' };
      }
      if (channelId === 'openai-codex' || channelId === 'openai-codex-acp') {
        return { summary: '未登录', guidance: '请运行 codex login 后重试' };
      }
      return { summary: '未登录', guidance: '请完成该引擎登录后重试' };
    case 'missing_binary':
      if (channelId === 'antigravity-gemini-agent') {
        return { summary: '未找到 Antigravity CLI', guidance: '请安装 agy 命令行后重试' };
      }
      if (channelId === 'claude-code-cli') {
        return { summary: '未找到 Claude CLI', guidance: '请安装 Claude CLI 后重试' };
      }
      return { summary: '未找到本地引擎', guidance: '请安装或配置该引擎后重试' };
    case 'timeout':
      return { summary: '检测超时', guidance: '引擎状态暂时未知，请稍后重试' };
    case 'not_started':
      return { summary: '引擎未就绪', guidance: '请等待工作区和引擎启动完成后重试' };
    case 'missing_api_key':
      return { summary: '未配置密钥', guidance: '在设置中填入 API Key，或不使用此通道可忽略' };
    case 'auth_check_timeout':
    case 'auth_check_unknown': {
      const summary = failureKind === 'auth_check_timeout' ? '检测超时' : '检测状态未知';
      if (channelId === 'antigravity-gemini-agent') {
        return { summary, guidance: '请稍后重试；若持续出现，请检查 Antigravity CLI 状态' };
      }
      if (channelId === 'claude-code-cli') {
        return { summary, guidance: '请稍后重试；若持续出现，请检查 Claude CLI 状态' };
      }
      if (channelId === 'openai-codex' || channelId === 'openai-codex-acp') {
        return { summary, guidance: '请稍后重试；若持续出现，请检查 Codex CLI 状态' };
      }
      return { summary, guidance: '请稍后重试；若持续出现，请检查该引擎状态' };
    }
    case 'engine_error':
      return {
        summary: '引擎错误',
        guidance: typeof exitCode === 'number'
          ? `引擎异常退出（退出码 ${exitCode}），请检查引擎配置后重试`
          : '请检查引擎配置后重试',
      };
  }
}

/**
 * Owns the product-level health state and automatic-run throttle. It is
 * deliberately probe-agnostic: callers supply each engine's native,
 * zero-inference login/control-plane check.
 */
export class ChannelHealthService {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly results = new Map<string, ChannelHealthResult>();
  private readonly lastAutomaticAttemptAt = new Map<string, number>();
  private running: Promise<ChannelHealthSnapshot> | null = null;

  constructor(private readonly deps: ChannelHealthServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? CHANNEL_HEALTH_TIMEOUT_MS;
  }

  async getSnapshot(): Promise<ChannelHealthSnapshot> {
    const channels = await this.deps.listEnabledChannels();
    return {
      running: this.running !== null,
      results: channels.map((channel) => {
        if (channel.enabled === false) {
          return {
            ...channel,
            state: 'disabled' as const,
            summary: '未启用',
          };
        }
        return this.results.get(channel.id) ?? {
          ...channel,
          state: 'never' as const,
        };
      }),
    };
  }

  async runManually(context: ChannelHealthRunContext): Promise<ChannelHealthSnapshot> {
    return this.run(context, 'manual');
  }

  /**
   * A deliberately separate, opt-in diagnostic for troubleshooting a real
   * model turn. Normal/manual/startup checks must never call this path.
   */
  async runDeepManually(
    context: ChannelHealthRunContext,
    prompt = CHANNEL_HEALTH_PROMPT,
  ): Promise<ChannelHealthSnapshot> {
    if (!this.deps.runDeepChannel) {
      throw new ChannelHealthError('not_started', 'Deep channel health is not configured');
    }
    return this.run(
      context,
      'manual',
      false,
      async (channel, runContext) => {
        const receipt = await this.deps.runDeepChannel!({
          channel,
          event: runContext.event,
          workspacePath: runContext.workspacePath,
          prompt,
        });
        return {
          state: 'healthy',
          summary: '深度体检通过',
          firstResponseMs: receipt.firstResponseMs,
          completionMs: receipt.completionMs,
        };
      },
    );
  }

  async runOnStartup(context: ChannelHealthRunContext): Promise<ChannelHealthSnapshot> {
    if (!this.deps.isAutoCheckEnabled()) {
      this.deps.log('[ChannelHealth] {"event":"startup-skipped","reason":"disabled"}');
      return this.getSnapshot();
    }
    return this.run(context, 'automatic');
  }

  /** One startup-only retry for an extension backend that was not ready yet. */
  async retryStartupUnknown(context: ChannelHealthRunContext): Promise<ChannelHealthSnapshot> {
    return this.run(context, 'automatic', true);
  }

  private async run(
    context: ChannelHealthRunContext,
    trigger: ChannelHealthTrigger,
    bypassAutomaticThrottle = false,
    runProbe?: ChannelHealthProbeRunner,
  ): Promise<ChannelHealthSnapshot> {
    // Avoid launching a second set of probes when the user clicks while
    // the startup pass is still running. The panel will refresh its snapshot.
    if (this.running) return this.running;

    const task = this.runInternal(context, trigger, bypassAutomaticThrottle, runProbe);
    this.running = task;
    try {
      await task;
    } finally {
      this.running = null;
    }
    return this.getSnapshot();
  }

  private async runInternal(
    context: ChannelHealthRunContext,
    trigger: ChannelHealthTrigger,
    bypassAutomaticThrottle: boolean,
    runProbe: ChannelHealthProbeRunner = (channel, runContext) => this.deps.runChannel({
      channel,
      event: runContext.event,
      workspacePath: runContext.workspacePath,
    }),
  ): Promise<ChannelHealthSnapshot> {
    const channels = await this.deps.listEnabledChannels();
    const selectedChannels = context.channelId
      ? channels.filter((channel) => channel.id === context.channelId)
      : channels;

    for (const channel of selectedChannels) {
      if (channel.enabled === false) continue;
      const now = this.now();
      if (
        trigger === 'automatic'
        && !bypassAutomaticThrottle
        && now - (this.lastAutomaticAttemptAt.get(channel.id) ?? Number.NEGATIVE_INFINITY)
          < CHANNEL_HEALTH_AUTO_DEDUPE_MS
      ) {
        this.deps.log(`[ChannelHealth] ${JSON.stringify({
          channel: channel.id,
          result: 'skipped',
          reason: 'automatic-throttled',
        })}`);
        continue;
      }
      if (trigger === 'automatic') this.lastAutomaticAttemptAt.set(channel.id, now);
      await this.runOne(channel, context, trigger, runProbe);
    }

    return this.getSnapshot();
  }

  private async runOne(
    channel: ChannelHealthChannel,
    context: ChannelHealthRunContext,
    trigger: ChannelHealthTrigger,
    runProbe: ChannelHealthProbeRunner,
  ): Promise<void> {
    const startedAt = this.now();
    try {
      const probeResult = await this.withTimeout(
        runProbe(channel, context),
      );
      const completionMs = Math.max(
        0,
        probeResult.completionMs ?? this.now() - startedAt,
      );
      const firstResponseMs = Math.max(
        0,
        probeResult.firstResponseMs ?? completionMs,
      );
      const failureKind = probeResult.failureKind;
      const state: Exclude<ChannelHealthState, 'never' | 'disabled'> = probeResult.state
        ?? (failureKind
          ? this.stateForFailure(failureKind)
          : completionMs > CHANNEL_HEALTH_SLOW_MS
            ? 'slow'
            : 'healthy');
      const copy = failureKind
        ? channelHealthFailureCopy(channel.id, failureKind)
        : undefined;
      const result: ChannelHealthResult = {
        ...channel,
        state,
        checkedAt: this.now(),
        trigger,
        firstResponseMs,
        completionMs,
        ...(failureKind ? { failureKind } : {}),
        ...(probeResult.rawOutput ? { rawOutput: probeResult.rawOutput } : {}),
        summary: probeResult.summary ?? copy?.summary ?? (state === 'slow' ? '响应较慢' : state === 'healthy' ? '已登录' : '检测状态未知'),
        ...(probeResult.guidance ?? copy?.guidance ? { guidance: probeResult.guidance ?? copy?.guidance } : {}),
      };
      this.results.set(channel.id, result);
      this.logResult(result);
    } catch (error) {
      const failureKind = classifyChannelHealthError(error);
      const exitCode = error instanceof ChannelHealthError ? error.exitCode : undefined;
      const copy = channelHealthFailureCopy(channel.id, failureKind, exitCode);
      const state = this.stateForFailure(failureKind);
      const rawOutput = error instanceof Error ? error.message : String(error);
      const result: ChannelHealthResult = {
        ...channel,
        state,
        checkedAt: this.now(),
        trigger,
        completionMs: Math.max(0, this.now() - startedAt),
        failureKind,
        ...(typeof exitCode === 'number' ? { exitCode } : {}),
        ...(rawOutput ? { rawOutput } : {}),
        ...copy,
      };
      this.results.set(channel.id, result);
      this.logResult(result);
    }
  }

  private stateForFailure(failureKind: ChannelHealthFailureKind): 'failed' | 'unknown' {
    return failureKind === 'timeout'
      || failureKind === 'auth_check_timeout'
      || failureKind === 'auth_check_unknown'
      || failureKind === 'not_started'
      ? 'unknown'
      : 'failed';
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new ChannelHealthError('timeout', 'Channel health check timed out')),
        this.timeoutMs,
      );
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private logResult(result: ChannelHealthResult): void {
    // Keep this allow-listed. Provider error strings can contain remote details;
    // health logs intentionally retain only the product-safe classification.
    this.deps.log(`[ChannelHealth] ${JSON.stringify({
      channel: result.id,
      result: result.state,
      firstResponseMs: result.firstResponseMs,
      completionMs: result.completionMs,
      failureClass: result.failureKind,
      exitCode: result.exitCode,
      trigger: result.trigger,
    })}`);
  }
}

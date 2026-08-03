/**
 * Channel health checks exercise the same request boundary a user would use,
 * but keep their status bookkeeping outside normal conversations.
 *
 * The transport is injected by AIService because the SDK-backed providers and
 * the genuine Claude CLI intentionally have different production send paths.
 */

export const CHANNEL_HEALTH_PROMPT = 'Reply with one word: pong';
export const CHANNEL_HEALTH_SLOW_MS = 10_000;
export const CHANNEL_HEALTH_TIMEOUT_MS = 20_000;
export const CHANNEL_HEALTH_AUTO_DEDUPE_MS = 10 * 60 * 1_000;

export type ChannelHealthTrigger = 'manual' | 'automatic';
export type ChannelHealthTransport = 'streaming' | 'claude-cli';
export type ChannelHealthState = 'never' | 'healthy' | 'slow' | 'failed';
export type ChannelHealthFailureKind =
  | 'not_logged_in'
  | 'missing_binary'
  | 'timeout'
  | 'engine_error';

export interface ChannelHealthChannel {
  id: string;
  displayName: string;
  transport: ChannelHealthTransport;
}

export interface ChannelHealthTransportResult {
  /** Time from request submission to the first observable provider response. */
  firstResponseMs?: number;
  /** Time from request submission to the completed turn. */
  completionMs?: number;
  /** A non-empty receipt proves the transport produced a response. */
  responseText?: string;
}

export interface ChannelHealthResult extends ChannelHealthChannel {
  state: ChannelHealthState;
  checkedAt?: number;
  trigger?: ChannelHealthTrigger;
  firstResponseMs?: number;
  completionMs?: number;
  failureKind?: ChannelHealthFailureKind;
  summary?: string;
  guidance?: string;
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
    prompt: string;
  }) => Promise<ChannelHealthTransportResult>;
  isAutoCheckEnabled: () => boolean;
  /** Receives only fixed telemetry fields; never a prompt, response, or user data. */
  log: (line: string) => void;
  now?: () => number;
  timeoutMs?: number;
}

/** Typed errors let production adapters preserve actionable classifications. */
export class ChannelHealthError extends Error {
  constructor(
    readonly failureKind: ChannelHealthFailureKind,
    message?: string,
  ) {
    super(message ?? failureKind);
    this.name = 'ChannelHealthError';
  }
}

export function classifyChannelHealthError(error: unknown): ChannelHealthFailureKind {
  if (error instanceof ChannelHealthError) return error.failureKind;
  const message = error instanceof Error ? error.message : String(error);
  if (/not.?logged.?in|not authenticated|unauthenticated|auth(?:entication)? failed|oauth|login|\b401\b/i.test(message)) {
    return 'not_logged_in';
  }
  if (/not installed|missing binary|enoent|command not found|executable.*not found/i.test(message)) {
    return 'missing_binary';
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return 'timeout';
  }
  return 'engine_error';
}

export function channelHealthFailureCopy(
  channelId: string,
  failureKind: ChannelHealthFailureKind,
): { summary: string; guidance: string } {
  switch (failureKind) {
    case 'not_logged_in':
      if (channelId === 'claude-code-cli') {
        return { summary: '未登录', guidance: '请运行 claude /login 后重试' };
      }
      if (channelId === 'openai-codex' || channelId === 'openai-codex-acp') {
        return { summary: '未登录', guidance: '请运行 codex login 后重试' };
      }
      return { summary: '未登录', guidance: '请完成该引擎登录后重试' };
    case 'missing_binary':
      if (channelId === 'claude-code-cli') {
        return { summary: '未找到 Claude CLI', guidance: '请安装 Claude CLI 后重试' };
      }
      return { summary: '未找到本地引擎', guidance: '请安装或配置该引擎后重试' };
    case 'timeout':
      return { summary: '请求超时', guidance: '请检查网络或引擎状态后重试' };
    case 'engine_error':
      return { summary: '引擎错误', guidance: '请检查引擎配置后重试' };
  }
}

/**
 * Owns the product-level health state and automatic-run throttle. It is
 * deliberately transport-agnostic: callers must supply the real production
 * send path rather than a provider-level shortcut.
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
      results: channels.map((channel) => this.results.get(channel.id) ?? {
        ...channel,
        state: 'never' as const,
      }),
    };
  }

  async runManually(context: ChannelHealthRunContext): Promise<ChannelHealthSnapshot> {
    return this.run(context, 'manual');
  }

  async runOnStartup(context: ChannelHealthRunContext): Promise<ChannelHealthSnapshot> {
    if (!this.deps.isAutoCheckEnabled()) {
      this.deps.log('[ChannelHealth] {"event":"startup-skipped","reason":"disabled"}');
      return this.getSnapshot();
    }
    return this.run(context, 'automatic');
  }

  private async run(
    context: ChannelHealthRunContext,
    trigger: ChannelHealthTrigger,
  ): Promise<ChannelHealthSnapshot> {
    // Avoid launching a second set of model calls when the user clicks while
    // the startup pass is still running. The panel will refresh its snapshot.
    if (this.running) return this.running;

    const task = this.runInternal(context, trigger);
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
  ): Promise<ChannelHealthSnapshot> {
    const channels = await this.deps.listEnabledChannels();
    const selectedChannels = context.channelId
      ? channels.filter((channel) => channel.id === context.channelId)
      : channels;

    for (const channel of selectedChannels) {
      const now = this.now();
      if (
        trigger === 'automatic'
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
      await this.runOne(channel, context, trigger);
    }

    return this.getSnapshot();
  }

  private async runOne(
    channel: ChannelHealthChannel,
    context: ChannelHealthRunContext,
    trigger: ChannelHealthTrigger,
  ): Promise<void> {
    const startedAt = this.now();
    try {
      const transportResult = await this.withTimeout(
        this.deps.runChannel({
          channel,
          event: context.event,
          workspacePath: context.workspacePath,
          prompt: CHANNEL_HEALTH_PROMPT,
        }),
      );
      const completionMs = Math.max(
        0,
        transportResult.completionMs ?? this.now() - startedAt,
      );
      const firstResponseMs = Math.max(
        0,
        transportResult.firstResponseMs ?? completionMs,
      );
      if (!transportResult.responseText?.trim()) {
        throw new ChannelHealthError('engine_error', 'Channel completed without a response receipt');
      }
      const state: ChannelHealthState = completionMs > CHANNEL_HEALTH_SLOW_MS
        ? 'slow'
        : 'healthy';
      const result: ChannelHealthResult = {
        ...channel,
        state,
        checkedAt: this.now(),
        trigger,
        firstResponseMs,
        completionMs,
        summary: state === 'slow' ? '响应较慢' : '通畅',
      };
      this.results.set(channel.id, result);
      this.logResult(result);
    } catch (error) {
      const failureKind = classifyChannelHealthError(error);
      const copy = channelHealthFailureCopy(channel.id, failureKind);
      const result: ChannelHealthResult = {
        ...channel,
        state: 'failed',
        checkedAt: this.now(),
        trigger,
        completionMs: Math.max(0, this.now() - startedAt),
        failureKind,
        ...copy,
      };
      this.results.set(channel.id, result);
      this.logResult(result);
    }
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
      trigger: result.trigger,
    })}`);
  }
}

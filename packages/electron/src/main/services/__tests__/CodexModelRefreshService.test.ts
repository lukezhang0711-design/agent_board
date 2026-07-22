import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICodexProvider } from '@nimbalyst/runtime/ai/server/providers/OpenAICodexProvider';
import { CodexModelRefreshService } from '../CodexModelRefreshService';

interface FakeChildOptions {
  codexHome?: string;
  modelResult?: unknown;
  modelError?: { code: number; message: string };
  hangModelList?: boolean;
  exitOnInitialize?: boolean;
  refreshErrorLine?: string;
  ignoreSigterm?: boolean;
}

class FakeCodexChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  exitEmitted = false;

  private buffer = '';
  private exitScheduled = false;

  constructor(private readonly options: FakeChildOptions = {}) {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.trim()) this.handleFrame(JSON.parse(line) as Record<string, unknown>);
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    this.killed = true;
    const normalized = signal ?? 'SIGTERM';
    if (this.options.ignoreSigterm && normalized !== 'SIGKILL') return true;
    this.finishExit(null, typeof normalized === 'string' ? normalized : 'SIGTERM');
    return true;
  }

  finishExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitScheduled || this.exitCode !== null || this.signalCode !== null) return;
    this.exitScheduled = true;
    queueMicrotask(() => {
      this.exitCode = code;
      this.signalCode = signal;
      this.exitEmitted = true;
      this.emit('exit', code, signal);
    });
  }

  private handleFrame(frame: Record<string, unknown>): void {
    if (frame.method === 'initialize') {
      if (this.options.exitOnInitialize) {
        this.finishExit(17, null);
        return;
      }
      this.respond(frame.id, {
        codexHome: this.options.codexHome ?? '/fake/codex-home',
        platformFamily: 'unix',
        platformOs: 'macos',
        userAgent: 'fake/0.136.0',
      });
      return;
    }
    if (frame.method !== 'model/list') return;
    if (this.options.refreshErrorLine) {
      this.stderr.write(`${this.options.refreshErrorLine}\n`);
    }
    if (this.options.hangModelList) return;
    if (this.options.modelError) {
      this.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: frame.id,
        error: this.options.modelError,
      })}\n`);
      return;
    }
    this.respond(frame.id, this.options.modelResult ?? {
      data: [modelPreset('gpt-5.4', 'GPT-5.4')],
      nextCursor: null,
    });
  }

  private respond(id: unknown, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }
}

function modelPreset(id: string, displayName: string) {
  return {
    id,
    model: id,
    displayName,
    description: `${displayName} description`,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [],
    isDefault: true,
    showInPicker: true,
    supportedInApi: true,
  };
}

function fullModelInfo(slug = 'gpt-5.4') {
  return {
    slug,
    display_name: 'GPT-5.4',
    description: null,
    supported_reasoning_levels: [],
    shell_type: 'default',
    visibility: 'list',
    supported_in_api: true,
    priority: 1,
    availability_nux: null,
    upgrade: null,
    base_instructions: 'bundled instructions',
    model_messages: null,
    supports_reasoning_summaries: false,
    default_reasoning_summary: 'auto',
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: { mode: 'bytes', limit: 10_000 },
    supports_parallel_tool_calls: false,
    context_window: 272_000,
    auto_compact_token_limit: null,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ['text', 'image'],
  };
}

function createHarness(options: {
  children?: FakeCodexChild[];
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  terminationGraceMs?: number;
  buildEnv?: () => NodeJS.ProcessEnv;
  loadApiKey?: () => string | undefined;
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), '.codex-model-refresh-test-'));
  const catalogPath = path.join(tempDir, 'nimbalyst-model-catalog.json');
  const children = [...(options.children ?? [])];
  const spawned: FakeCodexChild[] = [];
  const spawnTimes: number[] = [];
  const spawnEnvs: NodeJS.ProcessEnv[] = [];
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const service = new CodexModelRefreshService({
    catalogPath,
    retryDelaysMs: options.retryDelaysMs ?? [],
    requestTimeoutMs: options.requestTimeoutMs ?? 25,
    terminationGraceMs: options.terminationGraceMs ?? 10,
    resolveBinaryPath: () => '/fake/codex',
    buildEnv: options.buildEnv ?? (() => ({ PATH: '/fake/bin' })),
    loadApiKey: options.loadApiKey,
    spawnProcess: (_command, _args, spawnOptions) => {
      const child = children.shift();
      if (!child) throw new Error('test spawn queue exhausted');
      spawned.push(child);
      spawnTimes.push(Date.now());
      spawnEnvs.push({ ...spawnOptions.env });
      return child as never;
    },
    logger: log,
  });

  return {
    service,
    catalogPath,
    tempDir,
    spawned,
    spawnTimes,
    spawnEnvs,
    log,
    enqueue: (child: FakeCodexChild) => children.push(child),
  };
}

async function settleImmediate(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CodexModelRefreshService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T08:00:00.000Z'));
  });

  afterEach(() => {
    OpenAICodexProvider.setModelRefreshSnapshotResolver(null);
    OpenAICodexProvider.setModelCatalogPathResolver(null);
    OpenAICodexProvider.setTrustChecker(null);
    OpenAICodexProvider.setPermissionPatternChecker(null);
    OpenAICodexProvider.setPermissionPatternSaver(null);
    OpenAICodexProvider.setSecurityLogger(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a valid hidden sentinel catalog synchronously before any session can spawn', () => {
    const harness = createHarness();
    const catalog = JSON.parse(fs.readFileSync(harness.catalogPath, 'utf8')) as {
      models: Array<Record<string, unknown>>;
    };

    expect(harness.service.getCatalogPath()).toBe(harness.catalogPath);
    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({
      slug: '__nimbalyst_offline_catalog__',
      visibility: 'hide',
      supported_in_api: false,
    });
    expect(catalog.models[0].base_instructions).toBeTypeOf('string');

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('uses only the explicitly configured Codex API key for the refresh child', async () => {
    const harness = createHarness({
      children: [new FakeCodexChild()],
      buildEnv: () => ({
        PATH: '/fake/bin',
        OPENAI_API_KEY: 'implicit-openai-key',
        CODEX_API_KEY: 'implicit-codex-key',
      }),
      loadApiKey: () => 'configured-codex-key',
    });

    await harness.service.start();

    expect(harness.spawnEnvs[0]).toMatchObject({
      PATH: '/fake/bin',
      CODEX_API_KEY: 'configured-codex-key',
    });
    expect(harness.spawnEnvs[0]).not.toHaveProperty('OPENAI_API_KEY');

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('uses increasing backoff, stops at the cap, and waits for every timed-out child to exit', async () => {
    const children = [
      new FakeCodexChild({ hangModelList: true }),
      new FakeCodexChild({ hangModelList: true }),
      new FakeCodexChild({ hangModelList: true }),
    ];
    const harness = createHarness({
      children,
      retryDelaysMs: [100, 300],
      requestTimeoutMs: 25,
    });

    const firstAttempt = harness.service.start();
    await vi.advanceTimersByTimeAsync(25);
    await firstAttempt;

    expect(harness.service.getStatus()).toMatchObject({
      phase: 'retrying',
      attempt: 1,
      maxAttempts: 3,
      nextRetryAt: Date.now() + 100,
      lastError: { category: 'network' },
    });
    expect(harness.spawned[0].killSignals).toContain('SIGTERM');
    expect(harness.spawned[0].signalCode).toBe('SIGTERM');

    await vi.advanceTimersByTimeAsync(99);
    expect(harness.spawned).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.spawned).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(25);
    expect(harness.service.getStatus().nextRetryAt).toBe(Date.now() + 300);

    await vi.advanceTimersByTimeAsync(299);
    expect(harness.spawned).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.spawned).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(25);

    expect(harness.service.getStatus()).toMatchObject({
      phase: 'stopped',
      attempt: 3,
      maxAttempts: 3,
      nextRetryAt: null,
      lastError: { category: 'network' },
    });
    expect(harness.spawned.every((child) => (
      child.signalCode === 'SIGTERM' && child.exitEmitted
    ))).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.spawned).toHaveLength(3);

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('escalates to SIGKILL and observes exit when a timed-out child ignores SIGTERM', async () => {
    const child = new FakeCodexChild({ hangModelList: true, ignoreSigterm: true });
    const harness = createHarness({
      children: [child],
      requestTimeoutMs: 25,
      terminationGraceMs: 10,
    });

    const attempt = harness.service.start();
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(10);
    await attempt;

    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(child.signalCode).toBe('SIGKILL');
    expect(child.exitEmitted).toBe(true);
    expect(harness.service.getStatus().phase).toBe('stopped');

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('classifies upstream rejection and child-process failure distinctly in state and logs', async () => {
    const rejected = createHarness({
      children: [new FakeCodexChild({
        modelError: { code: 429, message: 'upstream rejected: rate limited' },
      })],
    });
    await rejected.service.start();
    expect(rejected.service.getStatus().lastError).toMatchObject({
      category: 'upstream_rejected',
      message: expect.stringMatching(/429|rate limited/i),
    });
    expect(rejected.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[upstream_rejected]'),
      expect.any(Object),
    );

    const childFailure = createHarness({
      children: [new FakeCodexChild({ exitOnInitialize: true })],
    });
    await childFailure.service.start();
    expect(childFailure.service.getStatus().lastError).toMatchObject({
      category: 'child_process',
    });
    expect(childFailure.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[child_process]'),
      expect.any(Object),
    );

    rejected.service.shutdown();
    childFailure.service.shutdown();
    fs.rmSync(rejected.tempDir, { recursive: true, force: true });
    fs.rmSync(childFailure.tempDir, { recursive: true, force: true });
  });

  it('treats the Codex refresh stderr marker as a network failure even when model/list falls back', async () => {
    const harness = createHarness({
      children: [new FakeCodexChild({
        refreshErrorLine: 'ERROR failed to refresh available models: dns lookup timed out',
      })],
    });

    await harness.service.start();

    expect(harness.service.getStatus()).toMatchObject({
      phase: 'stopped',
      lastError: {
        category: 'network',
        message: expect.stringMatching(/dns lookup timed out/i),
      },
    });

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('classifies the observed Codex child-exit timeout marker as a child-process failure', async () => {
    const harness = createHarness({
      children: [new FakeCodexChild({
        refreshErrorLine: 'ERROR failed to refresh available models: timeout waiting for child process to exit',
      })],
    });

    await harness.service.start();

    expect(harness.service.getStatus()).toMatchObject({
      phase: 'stopped',
      lastError: {
        category: 'child_process',
        message: expect.stringMatching(/timeout waiting for child process to exit/i),
      },
    });
    expect(harness.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[child_process]'),
      expect.any(Object),
    );

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('manual retry starts a fresh cycle, recovers, and retains the previous diagnostic', async () => {
    const harness = createHarness({
      children: [new FakeCodexChild({ hangModelList: true })],
      requestTimeoutMs: 25,
    });
    const firstAttempt = harness.service.start();
    await vi.advanceTimersByTimeAsync(25);
    await firstAttempt;
    const failedAt = harness.service.getStatus().lastError?.at;
    expect(harness.service.getStatus().phase).toBe('stopped');

    const handlers = new Map<
      string,
      (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    >();
    harness.service.registerIpcHandlers((channel, handler) => {
      handlers.set(channel, handler);
    });
    harness.enqueue(new FakeCodexChild());
    const manualResult = await handlers.get('ai:retryModelRefresh')?.({} as IpcMainInvokeEvent);

    expect(manualResult).toMatchObject({ success: true, status: { phase: 'normal' } });
    expect(harness.service.getStatus()).toMatchObject({
      phase: 'normal',
      attempt: 0,
      nextRetryAt: null,
      lastSuccessAt: Date.now(),
      lastError: { category: 'network', at: failedAt },
    });
    expect(harness.service.getModels()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai-codex:gpt-5.4',
        name: 'GPT-5.4',
        provider: 'openai-codex',
      }),
    ]));

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('coalesces repeated explicit retries for two seconds', async () => {
    const harness = createHarness({
      children: [new FakeCodexChild(), new FakeCodexChild()],
    });
    try {
      const first = harness.service.manualRetry();
      const concurrent = harness.service.manualRetry();
      await Promise.all([first, concurrent]);

      expect(concurrent).toBe(first);
      expect(harness.spawned).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1_999);
      await harness.service.manualRetry();
      expect(harness.spawned).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await harness.service.manualRetry();
      expect(harness.spawned).toHaveLength(2);
    } finally {
      harness.service.shutdown();
      fs.rmSync(harness.tempDir, { recursive: true, force: true });
    }
  });

  it('atomically promotes Codex full cache metadata after a successful refresh', async () => {
    const tempCodexHome = fs.mkdtempSync(path.join(process.cwd(), '.codex-home-test-'));
    const cachedModels = [fullModelInfo()];
    fs.writeFileSync(
      path.join(tempCodexHome, 'models_cache.json'),
      JSON.stringify({ fetched_at: Date.now(), etag: 'etag-1', models: cachedModels }),
      'utf8',
    );
    const harness = createHarness({
      children: [new FakeCodexChild({ codexHome: tempCodexHome })],
    });

    await harness.service.start();

    const promoted = JSON.parse(fs.readFileSync(harness.catalogPath, 'utf8')) as { models: unknown[] };
    expect(promoted.models).toEqual(cachedModels);
    expect(fs.readdirSync(path.dirname(harness.catalogPath)).filter((entry) => entry.includes('.tmp-'))).toEqual([]);

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
    fs.rmSync(tempCodexHome, { recursive: true, force: true });
  });

  it('registers query and manual-retry IPC entries at the main-process seam', async () => {
    const harness = createHarness();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const register = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });

    harness.service.registerIpcHandlers(register as never);

    expect(register).toHaveBeenCalledWith('ai:getModelRefreshStatus', expect.any(Function));
    expect(register).toHaveBeenCalledWith('ai:retryModelRefresh', expect.any(Function));
    expect(await handlers.get('ai:getModelRefreshStatus')?.({})).toEqual({
      success: true,
      status: harness.service.getStatus(),
    });

    harness.service.shutdown();
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('does not restart or duplicate an active provider turn when refresh times out', async () => {
    OpenAICodexProvider.setTrustChecker(() => ({ trusted: true, mode: 'allow-all' as never }));
    OpenAICodexProvider.setPermissionPatternChecker(async () => false);
    OpenAICodexProvider.setPermissionPatternSaver(async () => {});
    OpenAICodexProvider.setSecurityLogger(() => {});

    let releaseTurn!: () => void;
    const turnGate = new Promise<void>((resolve) => { releaseTurn = resolve; });
    const createSession = vi.fn(async () => ({
      id: 'thread-isolated',
      platform: 'codex-app-server',
      raw: { sessionChild: true },
    }));
    const protocolSend = vi.fn(async function* () {
      await turnGate;
      yield { type: 'text', content: 'one reply' };
      yield {
        type: 'complete',
        content: 'one reply',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    });
    const protocol = {
      platform: 'codex-app-server',
      createSession,
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      sendMessage: protocolSend,
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    } as never;
    const provider = new OpenAICodexProvider({}, { protocol, transport: 'app-server' });
    await provider.initialize({ model: 'openai-codex:gpt-5.4' });

    const refresh = createHarness({
      children: [new FakeCodexChild({ hangModelList: true })],
      requestTimeoutMs: 25,
    });
    const chunks: Array<{ type: string; content?: string }> = [];
    const turn = (async () => {
      for await (const chunk of provider.sendMessage(
        'keep this turn alive',
        undefined,
        'session-isolated',
        [],
        process.cwd(),
      )) {
        chunks.push(chunk as { type: string; content?: string });
      }
    })();
    const refreshAttempt = refresh.service.start();
    await settleImmediate();

    releaseTurn();
    // The provider intentionally waits briefly after completion for a session
    // naming notification; advance that timer and the refresh timeout together.
    await vi.advanceTimersByTimeAsync(500);
    await turn;
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(protocolSend).toHaveBeenCalledTimes(1);
    expect(chunks.filter((chunk) => chunk.type === 'complete')).toHaveLength(1);
    expect(chunks.filter((chunk) => chunk.type === 'text' && chunk.content === 'one reply')).toHaveLength(1);

    await refreshAttempt;
    expect(refresh.service.getStatus().phase).toBe('stopped');
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(protocolSend).toHaveBeenCalledTimes(1);

    provider.destroy();
    refresh.service.shutdown();
    fs.rmSync(refresh.tempDir, { recursive: true, force: true });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const appStoreMock = vi.hoisted(() => {
  const state: { metaAgentMaxParallel: unknown } = { metaAgentMaxParallel: 4 };
  return {
    state,
    get: vi.fn((key: string, defaultValue?: unknown) =>
      key === 'metaAgentMaxParallel' ? state.metaAgentMaxParallel : defaultValue),
  };
});

// Mirrors the mock surface of MetaAgentService.workstreamSync.test.ts, with two
// additions needed to exercise the child-spawn path:
//   1. AISessionsRepository.get  - the parent-session lookup the fix relies on.
//   2. A working ModelIdentifier.tryParse / getDefaultModelId (the sibling test
//      stubs ModelIdentifier as {}, which throws once tryParse is reached).
vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: {
    create: vi.fn(),
    updateMetadata: vi.fn(),
    get: vi.fn(),
  },
  AgentMessagesRepository: {},
  SessionFilesRepository: {},
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ClaudeCodeProvider: { setMetaAgentServerPort: vi.fn(), setNativeHeadPlanApprovalHandler: vi.fn() },
  OpenAICodexProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexACPProvider: { setMetaAgentServerPort: vi.fn() },
  SessionManager: class {
    async initialize() {}
  },
}));

vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  ModelIdentifier: {
    parse: (id: string) => {
      const i = typeof id === 'string' ? id.indexOf(':') : -1;
      if (i <= 0) {
        throw new Error(`invalid model: ${id}`);
      }
      const provider = id.slice(0, i);
      const model = id.slice(i + 1);
      if (provider === 'claude-code') {
        if (model === 'opus-4-8') return { provider, model: 'opus', combined: 'claude-code:opus' };
        if (model === 'opus-4-8-1m') return { provider, model: 'opus-1m', combined: 'claude-code:opus-1m' };
        if (model === 'unknown') throw new Error(`Unsupported Claude Agent model "${id}"`);
      }
      return { provider, model, combined: `${provider}:${model}` };
    },
    tryParse: (id: string) => {
      const i = typeof id === 'string' ? id.indexOf(':') : -1;
      return i > 0 ? { provider: id.slice(0, i), model: id.slice(i + 1) } : null;
    },
    getDefaultModelId: (provider: string) => `${provider}:default`,
  },
}));

vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({ subscribe: vi.fn() }),
}));

// resolveExtensionAgentRef is the "parent is a chat-only extension agent"
// detector the fix keys on. The real impl reads the AgentProviderRegistry
// singleton, which is empty in this hermetic unit test (no extension would be
// registered), so it would return null for 'antigravity-gemini-agent' and the
// redirect would never fire. Mock it to mark only the gemini provider as an
// extension agent; built-ins (claude-code, openai-codex) stay null.
vi.mock('../ai/providerResolution', () => ({
  resolveExtensionAgentRef: (provider: string) =>
    provider === 'antigravity-gemini-agent'
      ? { extensionId: 'antigravity-gemini', contributionId: provider }
      : null,
  isExtensionAgentProvider: (provider: string) => provider === 'antigravity-gemini-agent',
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { on: vi.fn(), getAppPath: () => '/', isPackaged: false },
}));

vi.mock('../SyncManager', () => ({ getSyncProvider: () => ({ pushChange: vi.fn() }) }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn(), safeOn: vi.fn() }));
vi.mock('../../utils/store', () => ({
  getDefaultAIModel: () => null,
  store: { get: appStoreMock.get },
}));
vi.mock('../../utils/timestampUtils', () => ({ toMillis: (v: unknown) => v }));
vi.mock('../WorktreeStore', () => ({ createWorktreeStore: vi.fn() }));
vi.mock('../GitWorktreeService', () => ({ GitWorktreeService: class {} }));
// createChildSessionInternal runs a spawn-gate query that selects { in_flight,
// total }, so the worker mock must return a shape with rows (both '0' => under
// both the parallel limit and the lifetime backstop, spawn proceeds).
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: { query: vi.fn().mockResolvedValue({ rows: [{ in_flight: '0', total: '0' }] }) },
}));
vi.mock('../../database/initialize', () => ({ getDatabase: () => null }));
vi.mock('../../file/GitRefWatcher', () => ({ gitRefWatcher: {} }));
vi.mock('../ai/AIService', () => ({
  AIService: class {},
  normalizePlanApprovalRequestId: (requestId: string) => requestId,
}));
vi.mock('../../mcp/metaAgentServer', () => ({
  startMetaAgentServer: vi.fn(),
  setMetaAgentToolFns: vi.fn(),
  shutdownMetaAgentServer: vi.fn(),
}));
vi.mock('../metaAgentNotificationSignature', () => ({ computeNotificationSignature: vi.fn() }));
vi.mock('../metaAgentMessageText', () => ({
  extractMessageText: vi.fn(),
  extractUserPrompts: vi.fn(),
}));
// NIM-828: MetaAgentService statically imports the CLI launcher singleton (to wire
// the meta-agent port); mock it so node-pty/electron-app don't enter the graph.
vi.mock('../ai/claudeCliLauncherSingleton', () => ({
  ClaudeCliLauncherConfig: { setMetaAgentServerPort: vi.fn() },
}));

import { AISessionsRepository } from '@nimbalyst/runtime';
import { database as databaseWorker } from '../../database/PGLiteDatabaseWorker';
import { MetaAgentService } from '../MetaAgentService';

const GEMINI_PARENT = {
  id: 'parent-gemini-session',
  provider: 'antigravity-gemini-agent',
  model: 'antigravity-gemini-agent:gemini-flash-3.5',
};

const CLAUDE_PARENT = {
  id: 'parent-claude-session',
  provider: 'claude-code',
  model: 'claude-code:opus',
};

const CODEX_PARENT = {
  id: 'parent-codex-session',
  provider: 'openai-codex',
  model: 'openai-codex:gpt-5.4',
};


describe('MetaAgentService child-spawn provider inheritance', () => {
  beforeEach(() => {
    vi.mocked(AISessionsRepository.create).mockReset();
    vi.mocked(AISessionsRepository.get).mockReset();
  });

  it('inherits the gemini parent provider+model when the parent is a chat-only extension agent and no provider is given', async () => {
    const service = MetaAgentService.getInstance();
    // The child-spawn path guards on this.aiService being present.
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(GEMINI_PARENT as any);

    // No explicit model/provider - the default delegated-child case. A gemini
    // (antigravity-gemini-agent) meta-agent parent spawns a gemini child by
    // default, the same way a claude-code parent spawns claude-code children and
    // an openai-codex parent spawns openai-codex children. The child inherits the
    // parent provider+model verbatim.
    await (service as any).createChildSessionInternal('parent-gemini-session', '/workspace/path', {});

    expect(AISessionsRepository.create).toHaveBeenCalledTimes(1);

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('antigravity-gemini-agent');
    expect(created.model).toBe('antigravity-gemini-agent:gemini-flash-3.5');
    // The regression guard: the gemini parent must NOT be silently redirected to
    // claude-code anymore.
    expect(created.provider).not.toBe('claude-code');
  });

  it('honors an explicit args.provider so the model can deliberately spawn a gemini child from a claude-code parent', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    // Parent is dev-capable claude-code, but the caller explicitly asks for the
    // chat-only gemini provider. The explicit override must win.
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);

    await (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {
      provider: 'antigravity-gemini-agent',
    });

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('antigravity-gemini-agent');
  });

  it('still inherits a dev-capable built-in parent (claude-code) when no provider is given', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);

    await (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {});

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    // resolveExtensionAgentRef returns null for built-ins, so the redirect does
    // not fire and the child inherits the parent provider+model unchanged.
    expect(created.provider).toBe('claude-code');
    expect(created.model).toBe('claude-code:opus');
  });

  it('still inherits a dev-capable built-in parent (openai-codex) when no provider is given', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CODEX_PARENT as any);

    await (service as any).createChildSessionInternal('parent-codex-session', '/workspace/path', {});

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('openai-codex');
    expect(created.model).toBe('openai-codex:gpt-5.4');
  });

  it('still lets an explicit model arg win over the inherited parent', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(GEMINI_PARENT as any);

    await (service as any).createChildSessionInternal('parent-gemini-session', '/workspace/path', {
      model: 'openai-codex:gpt-5.4',
    });

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('openai-codex');
    expect(created.model).toBe('openai-codex:gpt-5.4');
  });

  it('lets a claude-code parent launch an explicit openai-codex child without tripping the claude-code guard', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);

    // The "Implement in Codex" action: a claude-code originating session
    // launches a child with an explicit "openai-codex:gpt-5.5" model. The
    // model's own prefix must win over the parent's claude-code provider.
    await (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {
      model: 'openai-codex:gpt-5.5',
    });

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('openai-codex');
    expect(created.model).toBe('openai-codex:gpt-5.5');
  });

  it('normalizes explicit claude-code opus-4-8 aliases before persisting the child session', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(GEMINI_PARENT as any);

    await (service as any).createChildSessionInternal('parent-gemini-session', '/workspace/path', {
      model: 'claude-code:opus-4-8-1m',
    });

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('claude-code');
    expect(created.model).toBe('claude-code:opus-1m');
  });

  it('rejects unsupported explicit claude-code variants instead of silently falling back', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(GEMINI_PARENT as any);

    await expect(
      (service as any).createChildSessionInternal('parent-gemini-session', '/workspace/path', {
        model: 'claude-code:unknown',
      })
    ).rejects.toThrow('Unsupported Claude Agent model');
  });

  it('falls back to the hardcoded default for a genuine orphan call (no parent session found)', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(null as any);

    await (service as any).createChildSessionInternal('orphan-session', '/workspace/path', {});

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    // With no parent and getDefaultAIModel() null, the child falls back to the
    // claude-code provider's default (stored as normalizedModel via
    // ModelIdentifier.getDefaultModelId('claude-code')). The invariant that
    // matters: an orphan call still resolves to claude-code, unchanged by the fix.
    expect(created.provider).toBe('claude-code');
    expect(created.model).toMatch(/^claude-code:/);
  });

  it('inherits the gemini MODEL via args.model from a gemini parent (spawn_session inheritModel path)', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(GEMINI_PARENT as any);

    // spawn_session with inheritModel passes the parent's gemini model verbatim as
    // args.model. The child keeps that model and tryParse recovers the gemini
    // provider, so the child stays gemini - the desired same-provider inheritance.
    await (service as any).createChildSessionInternal('parent-gemini-session', '/workspace/path', {
      model: 'antigravity-gemini-agent:gemini-flash-3.5',
    });

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('antigravity-gemini-agent');
    expect(created.model).toBe('antigravity-gemini-agent:gemini-flash-3.5');
    expect(created.provider).not.toBe('claude-code');
  });

  it('honors an explicit gemini provider on a gemini parent (explicit-copy path is no longer forced to claude-code)', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(GEMINI_PARENT as any);

    // A gemini parent that copies its own provider into args.provider must be
    // honored as gemini - the same-provider default. The old post-resolution force
    // wrongly rewrote this to claude-code; that override is reverted.
    await (service as any).createChildSessionInternal('parent-gemini-session', '/workspace/path', {
      provider: 'antigravity-gemini-agent',
    });

    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('antigravity-gemini-agent');
    expect(created.provider).not.toBe('claude-code');
  });
});

describe('MetaAgentService dispatch limits', () => {
  beforeEach(() => {
    vi.mocked(AISessionsRepository.create).mockReset();
    vi.mocked(AISessionsRepository.get).mockReset();
    appStoreMock.state.metaAgentMaxParallel = 4;
    appStoreMock.get.mockClear();
    // Reset the shared worker-query mock back to the under-cap default so other
    // tests in this file are unaffected by the over-cap override below.
    vi.mocked(databaseWorker.query).mockResolvedValue({ rows: [{ in_flight: '0', total: '0' }] } as any);
  });

  it('reads the global setting for every dispatch so the fifth child is rejected at 4 and allowed at 5', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);
    vi.mocked(databaseWorker.query).mockResolvedValue({ rows: [{ in_flight: '4', total: '4' }] } as any);

    await expect(
      (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {})
    ).rejects.toThrow(
      'Head Agent concurrency limit reached (4 running, limit 4); adjust the limit in Settings.',
    );

    expect(AISessionsRepository.create).not.toHaveBeenCalled();

    appStoreMock.state.metaAgentMaxParallel = 5;
    await (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {});

    expect(AISessionsRepository.create).toHaveBeenCalledTimes(1);
    expect(appStoreMock.get).toHaveBeenCalledTimes(2);
  });

  it('falls back to the default limit of 4 when the stored setting is missing or invalid', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);
    vi.mocked(databaseWorker.query).mockResolvedValue({ rows: [{ in_flight: '4', total: '4' }] } as any);

    for (const invalidValue of [undefined, null, 0, -1, 1.5, Number.NaN, '6']) {
      appStoreMock.state.metaAgentMaxParallel = invalidValue;
      await expect(
        (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {})
      ).rejects.toThrow(/limit 4/);
    }

    expect(AISessionsRepository.create).not.toHaveBeenCalled();
  });

  it('counts only running children, so 3 running plus 2 waiting still allows one dispatch at limit 4', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);
    vi.mocked(databaseWorker.query).mockResolvedValue({ rows: [{ in_flight: '3', total: '5' }] } as any);

    await (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {});

    const gateQuery = vi.mocked(databaseWorker.query).mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('FROM ai_sessions') && sql.includes('created_by_session_id'));
    expect(gateQuery).toContain("status = 'running'");
    expect(gateQuery).not.toContain('waiting_for_input');
    expect(AISessionsRepository.create).toHaveBeenCalledTimes(1);
  });

  it('clamps a higher override and keeps a lower override effective', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);
    appStoreMock.state.metaAgentMaxParallel = 2;
    vi.mocked(databaseWorker.query).mockResolvedValue({ rows: [{ in_flight: '2', total: '2' }] } as any);

    await expect(
      (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {
        maxParallelOverride: 3,
      })
    ).rejects.toThrow(/limit 2/);
    expect(AISessionsRepository.create).not.toHaveBeenCalled();

    appStoreMock.state.metaAgentMaxParallel = 4;
    vi.mocked(databaseWorker.query).mockResolvedValue({ rows: [{ in_flight: '1', total: '1' }] } as any);
    await expect(
      (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {
        maxParallelOverride: 1,
      })
    ).rejects.toThrow(/limit 1/);
    expect(AISessionsRepository.create).not.toHaveBeenCalled();
  });

  it('keeps the independent lifetime backstop at 50', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(CLAUDE_PARENT as any);
    appStoreMock.state.metaAgentMaxParallel = 50;
    vi.mocked(databaseWorker.query).mockResolvedValue({
      rows: [{ in_flight: '0', total: '50' }],
    } as any);

    await expect(
      (service as any).createChildSessionInternal('parent-claude-session', '/workspace/path', {})
    ).rejects.toThrow(
      'Meta-agent lifetime spawn backstop reached (50 total children spawned by this parent); refusing to spawn more',
    );

    expect(AISessionsRepository.create).not.toHaveBeenCalled();
  });

  it('never pairs an explicit claude-code provider with the inherited gemini model (consistency guard)', async () => {
    const service = MetaAgentService.getInstance();
    (service as any).aiService = { queuePromptForSession: vi.fn() };
    vi.mocked(AISessionsRepository.get).mockResolvedValue(GEMINI_PARENT as any);
    // A Gemini meta-agent explicitly picks claude-code but passes NO model.
    // The child must NOT be persisted as claude-code + the inherited gemini
    // model (which routes to Claude Code, is rejected, and dies with no output).
    await (service as any).createChildSessionInternal('parent-gemini-session', '/workspace/path', { provider: 'claude-code' });
    const created = vi.mocked(AISessionsRepository.create).mock.calls[0][0] as any;
    expect(created.provider).toBe('claude-code');
    expect(String(created.model)).not.toContain('antigravity-gemini-agent');
    expect(String(created.model).startsWith('claude-code:')).toBe(true);
  });
});

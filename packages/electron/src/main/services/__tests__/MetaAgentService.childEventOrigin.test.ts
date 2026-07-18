import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseQuery = vi.hoisted(() => vi.fn());

vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { create: vi.fn(), updateMetadata: vi.fn(), get: vi.fn() },
  AgentMessagesRepository: { list: vi.fn() },
  SessionFilesRepository: { getFilesBySession: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ClaudeCodeProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexACPProvider: { setMetaAgentServerPort: vi.fn() },
  SessionManager: class { async initialize() {} },
}));
vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  ModelIdentifier: {
    parse: (id: string) => ({ provider: id.split(':')[0], model: id.split(':')[1], combined: id }),
    tryParse: () => null,
    getDefaultModelId: (provider: string) => `${provider}:default`,
  },
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({ subscribe: vi.fn() }),
}));
vi.mock('../ai/providerResolution', () => ({
  resolveExtensionAgentRef: () => null,
  isExtensionAgentProvider: () => false,
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../SyncManager', () => ({ getSyncProvider: () => null }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn() }));
vi.mock('../../utils/store', () => ({ getDefaultAIModel: () => null }));
vi.mock('../../utils/timestampUtils', () => ({ toMillis: (value: unknown) => value }));
vi.mock('../WorktreeStore', () => ({ createWorktreeStore: vi.fn() }));
vi.mock('../GitWorktreeService', () => ({ GitWorktreeService: class {} }));
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: { query: databaseQuery },
}));
vi.mock('../../database/initialize', () => ({ getDatabase: () => null }));
vi.mock('../../file/GitRefWatcher', () => ({ gitRefWatcher: {} }));
vi.mock('../ai/AIService', () => ({ AIService: class {} }));
vi.mock('../../mcp/tools/trackerToolHandlers', () => ({ createBidirectionalLink: vi.fn() }));
vi.mock('../../mcp/metaAgentServer', () => ({
  startMetaAgentServer: vi.fn(),
  setMetaAgentToolFns: vi.fn(),
  shutdownMetaAgentServer: vi.fn(),
}));
vi.mock('../metaAgentNotificationSignature', () => ({
  computeNotificationSignature: (eventType: string) => eventType,
}));
vi.mock('../metaAgentMessageText', () => ({
  extractMessageText: vi.fn(),
  extractUserPrompts: vi.fn(),
}));
vi.mock('../ai/claudeCliLauncherSingleton', () => ({
  ClaudeCliLauncherConfig: { setMetaAgentServerPort: vi.fn() },
}));

import { AISessionsRepository } from '@nimbalyst/runtime';
import { MetaAgentService } from '../MetaAgentService';

const eventCases = [
  ['session:completed', 'idle'],
  ['session:error', 'error'],
  ['session:waiting', 'waiting_for_input'],
  ['session:interrupted', 'interrupted'],
] as const;

describe('MetaAgentService child event queue origin', () => {
  const queuePromptForSession = vi.fn();
  const triggerQueuedPromptProcessingForSession = vi.fn();
  const service = MetaAgentService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
    databaseQuery.mockResolvedValue({ rows: [{ count: '0' }] });
    (service as any).notificationSignatures.clear();
    (service as any).interruptedChildSessionIds?.clear();
    (service as any).releasedDispatchPromptIdsByHead?.clear();
    (service as any).aiService = {
      queuePromptForSession,
      triggerQueuedPromptProcessingForSession,
    };
    vi.mocked(AISessionsRepository.get).mockImplementation(async (sessionId: string) => {
      if (sessionId === 'parent-session') {
        return {
          id: 'parent-session',
          workspacePath: '/workspace',
          provider: 'claude-code',
        } as any;
      }
      return {
        id: sessionId,
        title: `Child ${sessionId}`,
        workspacePath: '/workspace',
        provider: 'claude-code',
        agentRole: 'standard',
        createdBySessionId: 'parent-session',
        metadata: {},
      } as any;
    });
    vi.spyOn(service as any, 'getSessionStatusRow').mockResolvedValue({ status: 'idle' });
  });

  it.each(eventCases)('queues %s as a child_session_event', async (eventType, status) => {
    const childSessionId = `child-${eventType}`;
    vi.spyOn(service as any, 'buildSessionResultData').mockResolvedValue({
      sessionId: childSessionId,
      title: `Child ${eventType}`,
      provider: 'claude-code',
      model: null,
      status,
      lastActivity: 1,
      originalPrompt: 'inspect the queue',
      userPrompts: ['inspect the queue'],
      lastResponse: `result for ${eventType}`,
      fullResponse: `result for ${eventType}`,
      recentMessages: [],
      editedFiles: [],
      pendingPrompt: null,
      createdAt: 1,
      updatedAt: 2,
      worktreeId: null,
      toolScope: null,
    });

    await (service as any).handleChildSessionEvent(childSessionId, eventType);

    expect(queuePromptForSession).toHaveBeenCalledWith(
      'parent-session',
      expect.stringContaining(`Event: ${eventType}`),
      undefined,
      undefined,
      'child_session_event',
    );
    expect(triggerQueuedPromptProcessingForSession).toHaveBeenCalledWith(
      'parent-session',
      '/workspace',
    );
  });

  it('does not deliver completed after the same child was interrupted', async () => {
    const childSessionId = 'child-interrupted-then-completed';
    vi.spyOn(service as any, 'buildSessionResultData').mockResolvedValue({
      sessionId: childSessionId,
      title: 'Interrupted child',
      provider: 'claude-code',
      model: null,
      status: 'interrupted',
      lastActivity: 1,
      originalPrompt: 'stop this task',
      userPrompts: ['stop this task'],
      lastResponse: null,
      fullResponse: null,
      recentMessages: [],
      editedFiles: [],
      pendingPrompt: null,
      createdAt: 1,
      updatedAt: 2,
      worktreeId: null,
      toolScope: null,
    });

    await (service as any).handleChildSessionEvent(childSessionId, 'session:interrupted');
    await (service as any).handleChildSessionEvent(childSessionId, 'session:completed');

    expect(queuePromptForSession).toHaveBeenCalledTimes(1);
    expect(queuePromptForSession).toHaveBeenCalledWith(
      'parent-session',
      expect.stringContaining('Event: session:interrupted'),
      undefined,
      undefined,
      'child_session_event',
    );
  });

  it('still delivers the child event when work-order status persistence fails', async () => {
    const childSessionId = 'child-with-tracker-failure';
    const trackerError = new Error('tracker status unavailable');
    databaseQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(trackerError)
      .mockResolvedValue({ rows: [{ count: '0' }] });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(service as any, 'buildSessionResultData').mockResolvedValue({
      sessionId: childSessionId,
      title: 'Child with tracker failure',
      provider: 'claude-code',
      model: null,
      status: 'idle',
      lastActivity: 1,
      originalPrompt: 'finish despite tracker failure',
      userPrompts: ['finish despite tracker failure'],
      lastResponse: 'done',
      fullResponse: 'done',
      recentMessages: [],
      editedFiles: [],
      pendingPrompt: null,
      createdAt: 1,
      updatedAt: 2,
      worktreeId: null,
      toolScope: null,
    });

    await (service as any).handleChildSessionEvent(childSessionId, 'session:completed');

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to update work-order for child ${childSessionId}`),
      trackerError,
    );
    expect(queuePromptForSession).toHaveBeenCalledWith(
      'parent-session',
      expect.stringContaining('Event: session:completed'),
      undefined,
      undefined,
      'child_session_event',
    );
  });
});

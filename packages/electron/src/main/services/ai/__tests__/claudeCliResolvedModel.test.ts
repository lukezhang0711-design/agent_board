import { describe, expect, it, vi } from 'vitest';

vi.mock('@nimbalyst/runtime', () => ({
  AgentMessagesRepository: { create: vi.fn() },
  AISessionsRepository: { updateMetadata: vi.fn(), get: vi.fn() },
}));

// The helpers under test are pure; keep this fixture isolated from the proxy's
// unrelated persistence/notification graph.
vi.mock('../claudeCliUserPromptLog', () => ({ broadcastMessageLogged: vi.fn() }));
vi.mock('../claudeCliToolResultLog', () => ({
  logClaudeCliToolResults: vi.fn(),
  loadSeenToolResultIds: vi.fn(async () => []),
}));
vi.mock('../claudeCliToolResultSeen', () => ({
  getSeenToolResultIds: vi.fn(() => new Set()),
  clearSeenToolResultIds: vi.fn(),
}));
vi.mock('../claudeCliContextUsage', () => ({ logClaudeCliContextUsage: vi.fn() }));
vi.mock('../claudeCliErrorLog', () => ({ logClaudeCliUpstreamError: vi.fn() }));
vi.mock('../claudeCliFileTracking', () => ({ trackClaudeCliFileEdits: vi.fn() }));
vi.mock('../../SessionFileTracker', () => ({
  sessionFileTracker: { trackToolExecution: vi.fn() },
}));
vi.mock('../../../window/WindowManager', () => ({ findWindowByWorkspace: vi.fn() }));
vi.mock('../../SyncManager', () => ({
  getSyncProvider: vi.fn(),
  isDesktopTrulyAway: vi.fn(() => false),
}));
import {
  extractResolvedClaudeCliModel,
  mergeResolvedModelMetadata,
} from '../claudeCliObservationSingleton';

describe('Claude CLI resolved-model receipt', () => {
  it('extracts the existing SSE-assembled model and prepares a metadata update', () => {
    const resolvedModel = extractResolvedClaudeCliModel({ model: 'claude-sonnet-5' });
    expect(resolvedModel).toBe('claude-sonnet-5');
    if (!resolvedModel) throw new Error('fixture must include a resolved model');
    expect(mergeResolvedModelMetadata({ currentTodos: [] }, resolvedModel)).toEqual({
      currentTodos: [],
      resolvedModel: 'claude-sonnet-5',
    });
  });

  it('ignores missing and whitespace-only SSE model values', () => {
    expect(extractResolvedClaudeCliModel({ model: '   ' })).toBeNull();
    expect(extractResolvedClaudeCliModel({})).toBeNull();
  });
});

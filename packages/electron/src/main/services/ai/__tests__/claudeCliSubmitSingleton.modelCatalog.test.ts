import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  writeToTerminal: vi.fn(),
  logUserPrompt: vi.fn(),
  sendEvent: vi.fn(),
}));

vi.mock('@nimbalyst/runtime', () => ({
  AISessionsRepository: { get: mocks.getSession },
}));
vi.mock('../../TerminalSessionManager', () => ({
  getTerminalSessionManager: () => ({ writeToTerminal: mocks.writeToTerminal }),
}));
vi.mock('../../analytics/AnalyticsService', () => ({
  AnalyticsService: { getInstance: () => ({ sendEvent: mocks.sendEvent }) },
}));
vi.mock('../aiServiceUtils', () => ({ bucketMessageLength: () => 'short' }));
vi.mock('../claudeCliUserPromptLog', () => ({ logClaudeCliUserPrompt: mocks.logUserPrompt }));
vi.mock('../claudeCliRevealTerminal', () => ({ broadcastClaudeCliRevealTerminal: vi.fn() }));
import { submitClaudeCliPromptProduction } from '../claudeCliSubmitSingleton';

describe('Claude CLI production submit model pass-through', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      id: 'cli-session',
      provider: 'claude-code-cli',
      model: 'claude-code-cli:claude-future-engine-model',
    });
  });

  it('GREEN EO: sends an explicit unlisted model session instead of catalog-blocking the PTY', async () => {
    await expect(submitClaudeCliPromptProduction({
      sessionId: 'cli-session',
      workspacePath: '/workspace',
      prompt: 'send unchanged',
    })).resolves.toEqual({ submitted: true });

    expect(mocks.writeToTerminal).toHaveBeenCalledWith(
      'cli-session',
      expect.stringContaining('send unchanged'),
    );
    expect(mocks.logUserPrompt).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'send unchanged',
    }));
  });

  it('GREEN EO: lets an omitted saved model reach the native CLI default', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'cli-session',
      provider: 'claude-code-cli',
      model: undefined,
    });

    await expect(submitClaudeCliPromptProduction({
      sessionId: 'cli-session',
      workspacePath: '/workspace',
      prompt: 'native default',
    })).resolves.toEqual({ submitted: true });

    expect(mocks.writeToTerminal).toHaveBeenCalledWith(
      'cli-session',
      expect.stringContaining('native default'),
    );
  });
});

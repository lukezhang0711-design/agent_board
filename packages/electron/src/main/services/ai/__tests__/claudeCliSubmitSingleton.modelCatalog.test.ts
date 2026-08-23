import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  validateCatalog: vi.fn(),
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
vi.mock('../modelCatalogValidation', () => ({
  assertDynamicModelCatalogSelection: mocks.validateCatalog,
}));

import { submitClaudeCliPromptProduction } from '../claudeCliSubmitSingleton';

describe('Claude CLI production submit model-directory gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      id: 'cli-session',
      provider: 'claude-code-cli',
      model: 'claude-code-cli:sonnet',
    });
    mocks.validateCatalog.mockResolvedValue(undefined);
  });

  it('rejects a failed live catalog before writing an active terminal', async () => {
    mocks.validateCatalog.mockRejectedValue(
      new Error('supportedModels(): request timed out'),
    );

    await expect(submitClaudeCliPromptProduction({
      sessionId: 'cli-session',
      workspacePath: '/workspace',
      prompt: 'do not send',
    })).rejects.toThrow('supportedModels(): request timed out');

    expect(mocks.validateCatalog).toHaveBeenCalledWith(
      'claude-code-cli',
      'claude-code-cli:sonnet',
    );
    expect(mocks.writeToTerminal).not.toHaveBeenCalled();
    expect(mocks.logUserPrompt).not.toHaveBeenCalled();
  });

  it('rejects a missing saved model instead of allowing the CLI default', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'cli-session',
      provider: 'claude-code-cli',
      model: undefined,
    });
    mocks.validateCatalog.mockRejectedValue(
      new Error('claude-code-cli 会话未设置已验证的模型。请重新选择模型。'),
    );

    await expect(submitClaudeCliPromptProduction({
      sessionId: 'cli-session',
      workspacePath: '/workspace',
      prompt: 'do not send',
    })).rejects.toThrow('未设置已验证的模型');

    expect(mocks.writeToTerminal).not.toHaveBeenCalled();
  });
});

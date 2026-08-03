import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPending: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  submit: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../RepositoryManager', () => ({
  getQueuedPromptsStore: () => ({
    listPending: mocks.listPending,
    claim: mocks.claim,
    complete: mocks.complete,
    fail: mocks.fail,
  }),
}));

vi.mock('../claudeCliSubmitSingleton', () => ({
  submitClaudeCliPromptProduction: mocks.submit,
}));

vi.mock('../../../utils/logger', () => ({
  logger: { main: { info: mocks.info, warn: mocks.warn, error: mocks.error } },
}));

import {
  flushNextClaudeCliQueuedPromptForSession,
} from '../claudeCliQueueFlushSingleton';
import { clearClaudeCliQueueAuthPrecheck, setClaudeCliQueueAuthPrecheck } from '../ClaudeCliSessionLauncher';

describe('flushNextClaudeCliQueuedPromptForSession observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClaudeCliQueueAuthPrecheck('session-1');
  });

  it('does not claim or submit when the launcher blocked the auth precheck', async () => {
    setClaudeCliQueueAuthPrecheck('session-1', {
      blocked: true,
      raw: '{"loggedIn":false,"authMethod":"none"}',
    });

    await expect(flushNextClaudeCliQueuedPromptForSession('session-1', '/workspace')).resolves.toBe(false);

    expect(mocks.listPending).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      '[CliQueue] precheck result={"loggedIn":false,"authMethod":"none"} action=blocked',
    );
  });

  it('emits the same prompt ID through list, claim, and submit', async () => {
    mocks.listPending.mockResolvedValue([{ id: 'trace-1', prompt: 'secret prompt', origin: 'user' }]);
    mocks.claim.mockResolvedValue({ id: 'trace-1', prompt: 'secret prompt', origin: 'user' });
    mocks.submit.mockResolvedValue({ submitted: true });

    await expect(flushNextClaudeCliQueuedPromptForSession('session-1', '/workspace', 'idle-transition')).resolves.toBe(true);

    expect(mocks.info.mock.calls.map(([line]) => line)).toEqual(expect.arrayContaining([
      '[CliQueue] flush triggered sessionId=session-1 reason=idle-transition',
      '[CliQueue] flush listPending sessionId=session-1 count=1 promptIds=trace-1',
      '[CliQueue] flush claim sessionId=session-1 promptId=trace-1 result=claimed',
      '[CliQueue] flush submit sessionId=session-1 promptId=trace-1 result=submitted',
    ]));
    expect(mocks.info).not.toHaveBeenCalledWith(expect.stringContaining('secret prompt'));
  });
});

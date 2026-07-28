import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { respondToPromptAtom } from '../atoms/sessions';

const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ success: true });
  vi.stubGlobal('window', {
    electronAPI: { invoke },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('respondToPromptAtom plan approvals', () => {
  it('uses only the canonical ExitPlanMode response entry point', async () => {
    const state = createStore();
    const compositeRequestId = 'nimtc|approval-49|1784297999209|21431';

    await expect(state.set(respondToPromptAtom, {
      sessionId: 'head-session',
      promptId: compositeRequestId,
      promptType: 'exit_plan_mode_request',
      response: {
        approved: false,
        feedback: 'Split persistence from delivery.',
      },
    })).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      'ai:exitPlanModeConfirmResponse',
      compositeRequestId,
      'head-session',
      {
        approved: false,
        feedback: 'Split persistence from delivery.',
      },
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'messages:respond-to-prompt',
      expect.anything(),
    );
  });
});

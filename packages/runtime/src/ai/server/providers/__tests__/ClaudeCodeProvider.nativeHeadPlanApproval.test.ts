import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeProvider } from '../ClaudeCodeProvider';

type NativeHeadApproval = {
  approved: boolean;
  planId: string;
  feedback?: string;
  deliveryMethod: 'direct' | 'revive';
};

function createExitPlanModeProbe(agentRole: 'meta-agent' | 'standard') {
  const provider = Object.create(ClaudeCodeProvider.prototype) as ClaudeCodeProvider;
  const logAgentMessage = vi.fn().mockResolvedValue(undefined);
  const emit = vi.fn();
  Object.assign(provider as any, {
    currentMode: 'planning',
    pendingExitPlanModeConfirmations: new Map(),
    logAgentMessage,
    emit,
    getAgentRole: vi.fn().mockResolvedValue(agentRole),
  });
  return { provider, logAgentMessage, emit };
}

function nativeHandlerSetter() {
  const setter = (ClaudeCodeProvider as any).setNativeHeadPlanApprovalHandler;
  expect(setter).toBeTypeOf('function');
  return setter as (handler: unknown) => void;
}

afterEach(() => {
  const setter = (ClaudeCodeProvider as any).setNativeHeadPlanApprovalHandler;
  if (typeof setter === 'function') setter(null);
  vi.restoreAllMocks();
});

describe('ClaudeCodeProvider native Head plan approval bridge', () => {
  it('routes a Head native ExitPlanMode through the durable handler without a legacy abort waiter', async () => {
    const { provider, logAgentMessage, emit } = createExitPlanModeProbe('meta-agent');
    let resolveApproval: ((value: NativeHeadApproval) => void) | undefined;
    const durableHandler = vi.fn().mockImplementation(() => new Promise<NativeHeadApproval>((resolve) => {
      resolveApproval = resolve;
    }));
    nativeHandlerSetter()(durableHandler);

    const controller = new AbortController();
    const input = {
      planFilePath: '/workspace/.claude/plans/claude-head-plan.md',
      plan: '完整中文方案',
    };
    const completion = (provider as any).handleExitPlanMode('head-session', input, {
      signal: controller.signal,
      toolUseID: 'toolu_01V5qt_native_head',
    });

    await vi.waitFor(() => {
      expect(durableHandler).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'head-session',
        requestId: 'toolu_01V5qt_native_head',
        planSummary: '完整中文方案',
        planFilePath: input.planFilePath,
      }));
    });
    controller.abort();
    await Promise.resolve();

    expect((provider as any).pendingExitPlanModeConfirmations.size).toBe(0);
    expect(emit).not.toHaveBeenCalledWith('exitPlanMode:confirm', expect.anything());
    expect(logAgentMessage.mock.calls.map((call) => JSON.parse(call[3]))).toEqual([
      expect.objectContaining({
        type: 'exit_plan_mode_request',
        requestId: 'toolu_01V5qt_native_head',
      }),
    ]);

    resolveApproval?.({
      approved: true,
      planId: 'plan-fb-072',
      deliveryMethod: 'revive',
    });
    await expect(completion).resolves.toEqual({
      behavior: 'allow',
      updatedInput: {
        ...input,
        planId: 'plan-fb-072',
      },
    });
    expect((provider as any).currentMode).toBe('agent');
    expect(logAgentMessage.mock.calls.map((call) => JSON.parse(call[3]))).not.toContainEqual(
      expect.objectContaining({ type: 'exit_plan_mode_response', cancelled: true }),
    );
  });

  it('keeps a non-Head native ExitPlanMode on the existing in-memory confirmation path', async () => {
    const { provider, emit } = createExitPlanModeProbe('standard');
    const durableHandler = vi.fn();
    nativeHandlerSetter()(durableHandler);
    const requestId = 'toolu_01V5qt_standard_session';
    const completion = (provider as any).handleExitPlanMode('standard-session', {
      planFilePath: '/workspace/.claude/plans/standard-plan.md',
      plan: '普通会话方案',
    }, {
      signal: new AbortController().signal,
      toolUseID: requestId,
    });

    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith('exitPlanMode:confirm', expect.objectContaining({ requestId }));
    });
    expect(durableHandler).not.toHaveBeenCalled();
    expect((provider as any).pendingExitPlanModeConfirmations.has(requestId)).toBe(true);

    expect((provider as any).resolveExitPlanModeConfirmation(
      requestId,
      { approved: false, feedback: '请继续完善方案。' },
      'standard-session',
    )).toBe(true);
    await expect(completion).resolves.toEqual({
      behavior: 'deny',
      message: 'The user chose to continue planning.\n\nUser feedback: "请继续完善方案。"',
    });
  });
});

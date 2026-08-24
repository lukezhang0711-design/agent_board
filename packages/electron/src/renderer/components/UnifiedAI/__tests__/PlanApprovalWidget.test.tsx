// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { noopInteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import type { CustomToolWidgetProps } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import type { InteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptProjector';
import { getTranscriptToolWidget } from '@nimbalyst/runtime/ui/AgentTranscript/contributions';
import {
  PlanApprovalWidget,
  formatPlanOutputPath,
  hasPendingSubmittedPlanApproval,
  registerPlanApprovalWidget,
  unregisterPlanApprovalWidget,
} from '../PlanApprovalWidget';

const sessionId = 'plan-approval-session';
const compositeRequestId =
  'nimtc|94471805-5eca-4d66-a448-56e438de6ab3|1784297999209|21431';

function makeMessage(
  arguments_: Record<string, unknown>,
  providerToolCallId: string | null = compositeRequestId,
): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(),
    type: 'tool_call',
    subagentId: null,
    toolCall: {
      toolName: 'ExitPlanMode',
      toolDisplayName: 'ExitPlanMode',
      status: 'running',
      description: null,
      arguments: arguments_,
      targetFilePath: null,
      mcpServer: null,
      mcpTool: null,
      providerToolCallId,
      progress: [],
    },
  };
}

function renderWidget(
  arguments_: Record<string, unknown>,
  hostOverrides: Partial<InteractiveWidgetHost> = {},
  providerToolCallId: string | null = compositeRequestId,
  widgetOverrides: Partial<CustomToolWidgetProps> = {},
) {
  const jotaiStore = createStore();
  jotaiStore.set(interactiveWidgetHostAtom(sessionId), {
    ...noopInteractiveWidgetHost,
    ...hostOverrides,
  });
  return render(
    <JotaiProvider store={jotaiStore}>
      <PlanApprovalWidget
        message={makeMessage(arguments_, providerToolCallId)}
        isExpanded={false}
        onToggle={() => {}}
        sessionId={sessionId}
        {...widgetOverrides}
      />
    </JotaiProvider>,
  );
}

const planArguments = {
  planId: 'plan-42',
  title: 'Review child-session plan',
  planItems: ['Inspect the durable response', 'Gate implementation dispatch'],
  workOrderCount: 3,
  risks: 'A stale response could approve the wrong plan.',
};

const structuredPlanArguments = {
  ...planArguments,
  modules: [
    {
      title: '审批卡片',
      outputFiles: [
        '/Users/lukezhang/Desktop/project/packages/electron/PlanApprovalWidget.tsx',
      ],
      inputs: ['现有审批卡片'],
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
      effortLevel: 'medium',
      doneCriteria: '矩阵、单选和审批参数均有测试。',
      candidates: [
        {
          name: '方案 A',
          approach: '用对齐矩阵展示候选方案。',
          pros: ['字段同一水平线', '窄屏可横向滚动'],
          cons: '需要增加候选选择状态。',
          risks: ['旧卡片格式需要继续兼容。'],
          provider: 'openai-codex',
          model: 'gpt-5.4-mini',
          effortLevel: 'low',
        },
        {
          name: '方案 B',
          approach: '把候选方案堆成串行长段落。',
          pros: '实现改动小。',
          cons: ['同字段不对齐', '阅读成本高'],
          risks: '窄窗口会难以比较。',
          provider: 'claude-code',
          model: 'haiku',
          effortLevel: 'high',
        },
      ],
    },
  ],
};

const multiModulePlanArguments = {
  ...planArguments,
  title: '三模块并行方案',
  modules: [1, 2, 3].map((moduleIndex) => ({
    title: `模块 ${moduleIndex}`,
    outputFiles: [`packages/example/module-${moduleIndex}.ts`],
    inputs: [`模块 ${moduleIndex} 的输入`],
    provider: 'openai-codex',
    model: 'gpt-5.4-mini',
    effortLevel: 'medium',
    doneCriteria: `模块 ${moduleIndex} 的完成标准`,
  })),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('PlanApprovalWidget', () => {
  it('registers as the ExitPlanMode transcript override', () => {
    try {
      registerPlanApprovalWidget();
      expect(getTranscriptToolWidget('ExitPlanMode')).toBe(PlanApprovalWidget);
    } finally {
      unregisterPlanApprovalWidget();
    }
  });

  it('shows submitted plan details and plan-specific actions', () => {
    renderWidget(planArguments);

    expect(screen.getByText('Review child-session plan')).toBeTruthy();
    expect(screen.getByText('Inspect the durable response')).toBeTruthy();
    expect(screen.getByText('Gate implementation dispatch')).toBeTruthy();
    expect(screen.getByText('3 work orders')).toBeTruthy();
    expect(
      screen.getByText('A stale response could approve the wrong plan.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Request changes' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss plan' })).toBeTruthy();
    expect(screen.queryByText('Ready to exit planning mode?')).toBeNull();
  });

  it('renders structured module fields and an aligned candidate matrix', () => {
    renderWidget(structuredPlanArguments, {
      workspacePath: '/Users/lukezhang/Desktop/project',
    });

    expect(screen.getByTestId('plan-approval-modules')).toBeTruthy();
    expect(screen.getByText('审批卡片')).toBeTruthy();
    expect(
      screen.getByText('packages/electron/PlanApprovalWidget.tsx'),
    ).toBeTruthy();
    expect(screen.getByText('现有审批卡片')).toBeTruthy();
    expect(screen.getAllByText('gpt-5.4-mini').length).toBeGreaterThan(0);
    expect(screen.getByTestId('plan-candidate-matrix')).toBeTruthy();
    expect(screen.getByText('怎么干')).toBeTruthy();
    expect(screen.getByText('优势')).toBeTruthy();
    expect(screen.getByText('劣势')).toBeTruthy();
    expect(screen.getByText('风险')).toBeTruthy();
    expect(screen.getAllByText('模型').length).toBeGreaterThan(0);
    expect(screen.getAllByText('思考强度').length).toBeGreaterThan(0);
    expect(screen.getByTestId('plan-candidate-radio-0-方案 A')).toBeTruthy();
    expect(screen.getByTestId('plan-candidate-radio-0-方案 B')).toBeTruthy();
    expect(screen.getAllByText('选这个').length).toBe(2);
  });

  it('renders a multi-module plan as one card per module under a plan header', () => {
    renderWidget(multiModulePlanArguments);

    const header = screen.getByTestId('plan-approval-header');
    expect(header).toBeTruthy();
    expect(header.className).toContain('sticky');
    expect(
      header.querySelector('[data-testid="plan-approval-approve-all"]'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('plan-approval-module-count').textContent,
    ).toContain('3 个模块');
    expect(screen.getAllByTestId(/^plan-module-card-/)).toHaveLength(3);
    expect(screen.getByTestId('plan-module-card-1').textContent).toContain(
      '模块 1',
    );
    expect(screen.getByTestId('plan-module-card-2').textContent).toContain(
      '模块 2',
    );
    expect(screen.getByTestId('plan-module-card-3').textContent).toContain(
      '模块 3',
    );
    expect(screen.getByRole('button', { name: '全部批准' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '打回这一条' })).toHaveLength(
      3,
    );
  });

  it('rejects only module two and preserves the other module card states', async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(multiModulePlanArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByTestId('plan-module-request-changes-2'));
    fireEvent.change(screen.getByTestId('plan-module-feedback-input-2'), {
      target: { value: '模块二需要补充回滚验收。' },
    });
    fireEvent.click(screen.getByTestId('plan-module-submit-changes-2'));

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        '模块二需要补充回滚验收。',
        2,
      );
    });
    expect(screen.getByTestId('plan-module-status-2').textContent).toContain(
      '已打回·待修订',
    );
    expect(screen.getByTestId('plan-module-feedback-2').textContent).toContain(
      '模块二需要补充回滚验收。',
    );
    expect(screen.getByTestId('plan-module-status-1').textContent).toContain(
      '待审批',
    );
    expect(screen.getByTestId('plan-module-status-3').textContent).toContain(
      '待审批',
    );
    expect(
      screen.getByTestId('plan-approval-revision-warning').textContent,
    ).toContain('1 个模块待修订，Head 需重新递交');
  });

  it('approves every current module with one all-approve action', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    renderWidget(multiModulePlanArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: '全部批准' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId);
    });
    expect(screen.getByTestId('plan-module-status-1').textContent).toContain(
      '已批准',
    );
    expect(screen.getByTestId('plan-module-status-2').textContent).toContain(
      '已批准',
    );
    expect(screen.getByTestId('plan-module-status-3').textContent).toContain(
      '已批准',
    );
  });

  it('sends the selected candidate with approval', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    renderWidget(structuredPlanArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByTestId('plan-candidate-radio-0-方案 B'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId, [
        {
          moduleIndex: 0,
          moduleTitle: '审批卡片',
          name: '方案 B',
          approach: '把候选方案堆成串行长段落。',
          pros: '实现改动小。',
          cons: ['同字段不对齐', '阅读成本高'],
          risks: '窄窗口会难以比较。',
          provider: 'claude-code',
          model: 'haiku',
          effortLevel: 'high',
        },
      ]);
    });
  });

  it('keeps approval actions sticky while a long card scrolls', () => {
    renderWidget({
      ...planArguments,
      planItems: Array.from(
        { length: 30 },
        (_, index) => `Long plan item ${index + 1}`,
      ),
    });

    const actions = screen.getByTestId('plan-approval-actions');
    expect(actions.className).toContain('sticky');
    expect(actions.className).toContain('bottom-0');
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Request changes' }),
    ).toBeTruthy();
  });

  it('formats output paths relative to the project root without truncation', () => {
    expect(
      formatPlanOutputPath(
        '/Users/lukezhang/Desktop/project/packages/electron/PlanApprovalWidget.tsx',
        '/Users/lukezhang/Desktop/project',
      ),
    ).toBe('packages/electron/PlanApprovalWidget.tsx');
    expect(
      formatPlanOutputPath(
        '/desktop/generated/result.md',
        '/Users/lukezhang/Desktop/project',
      ),
    ).toBe('desktop/generated/result.md');
  });

  it('renders an unavailable submitted plan as an explicit invalid card', async () => {
    renderWidget(planArguments, {}, compositeRequestId, {
      workspacePath: '/workspace',
      getInteractivePromptStatus: vi.fn().mockResolvedValue({
        status: 'unavailable',
        reason: 'supplier gone',
      }),
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
      ).toBe('invalid');
    });
    expect(screen.getByText('已失效')).toBeTruthy();
    expect(screen.getByText('重新发送消息继续')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
  });

  it('states plainly when the submitted plan declares no risks', () => {
    renderWidget({
      ...planArguments,
      risks: [],
    });

    expect(screen.getByText('未申报风险')).toBeTruthy();
  });

  it('marks a submitted plan as a commander approval only for a meta-agent session', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      session: {
        id: sessionId,
        agentRole: 'meta-agent',
        isArchived: false,
      },
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });

    renderWidget(planArguments);

    expect(await screen.findByTestId('meta-agent-plan-marker')).toBeTruthy();
  });

  it('does not attach the commander marker to a standard submitted plan', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      session: {
        id: sessionId,
        agentRole: 'standard',
        isArchived: false,
      },
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });

    renderWidget(planArguments);

    await waitFor(() => {
      expect(
        screen
          .getByTestId('plan-approval-widget')
          .getAttribute('data-agent-role'),
      ).toBe('standard');
    });
    expect(screen.queryByTestId('meta-agent-plan-marker')).toBeNull();
  });

  it('renders a native Claude Head plan summary in the existing approval card', () => {
    renderWidget({
      ...planArguments,
      planSummary:
        '完整中文方案\n1. 进入 durable 审批。\n2. 批准后带 planId 派发。',
    });

    expect(screen.getByTestId('plan-approval-summary')).toBeTruthy();
    expect(screen.getByText('完整中文方案', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(screen.queryByText('Ready to exit planning mode?')).toBeNull();
  });

  it('does not invent a response ID when the durable provider tool-call ID is missing', () => {
    renderWidget(planArguments, {}, null);

    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Request changes' }),
    ).toBeNull();
    expect(screen.getByText('Waiting for a durable approval ID…')).toBeTruthy();
  });

  it('reuses the existing approve response route with the composite request ID', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId);
    });
  });

  it('waits for the durable tool result before showing an approved completion state', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId);
    });
    expect(
      screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
    ).toBe('pending');
    expect(screen.getByText('Awaiting review')).toBeTruthy();
    expect(screen.queryByText('Plan approved')).toBeNull();
  });

  it('flips to changes requested as soon as the durable state reaches responded', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        state: { status: 'submitted', requestId: compositeRequestId },
      })
      .mockResolvedValue({
        success: true,
        state: {
          status: 'responded',
          requestId: compositeRequestId,
          decision: 'rejected',
        },
      });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        invoke,
      },
    });
    renderWidget(planArguments, { workspacePath: '/workspace' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'ai:getPlanApprovalState',
        '/workspace',
        sessionId,
        compositeRequestId,
      );
    });

    await waitFor(
      () => {
        expect(
          screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
        ).toBe('changes-requested');
        expect(screen.getByText('Changes requested')).toBeTruthy();
        expect(
          screen.getByText(
            'Response recorded. Head is preparing the revision…',
          ),
        ).toBeTruthy();
      },
      { timeout: 2_000 },
    );
  });

  it('keeps the approval action available when the existing response route fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitPlanModeApprove = vi
      .fn()
      .mockRejectedValue(new Error('persist failed'));
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Approve plan' })
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    expect(
      screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
    ).toBe('pending');
    expect(
      screen.queryByText(
        'Response submitted. Waiting for durable confirmation…',
      ),
    ).toBeNull();
  });

  it('sends requested changes through the existing deny plus feedback route', async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    fireEvent.change(screen.getByLabelText('Requested changes'), {
      target: { value: 'Split the persistence and dispatch work orders.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        'Split the persistence and dispatch work orders.',
      );
    });
  });

  it('keeps IME feedback from submitting on the composition commit key', async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    const feedback = screen.getByLabelText(
      'Requested changes',
    ) as HTMLTextAreaElement;
    fireEvent.compositionStart(feedback, { data: '' });
    fireEvent.compositionUpdate(feedback, { data: 'zhongwen' });
    fireEvent.change(feedback, { target: { value: 'zhongwen' } });

    const compositionCommit = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(compositionCommit, 'isComposing', { value: false });
    Object.defineProperty(compositionCommit, 'keyCode', { value: 0 });
    fireEvent(feedback, compositionCommit);

    expect(compositionCommit.defaultPrevented).toBe(false);
    expect(exitPlanModeDeny).not.toHaveBeenCalled();

    fireEvent.compositionEnd(feedback, { data: '中文反馈' });
    fireEvent.change(feedback, { target: { value: '中文反馈' } });
    fireEvent.keyDown(feedback, {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        '中文反馈',
      );
    });
  });

  it('dismisses a submitted plan through the durable denial route', async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss plan' }));

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        'User dismissed the plan.',
      );
    });
  });

  it('recognizes only an unresolved submitted plan as an interrupt guard', () => {
    const pendingPlan = makeMessage(planArguments);
    const completedPlan = makeMessage(planArguments);
    completedPlan.toolCall!.result = JSON.stringify({ approved: false });
    const ordinaryExitPlanMode = makeMessage({ planFilePath: 'docs/plan.md' });

    expect(hasPendingSubmittedPlanApproval([pendingPlan])).toBe(true);
    expect(hasPendingSubmittedPlanApproval([completedPlan])).toBe(false);
    expect(hasPendingSubmittedPlanApproval([ordinaryExitPlanMode])).toBe(false);
  });

  it('shows a retryable failure when a submitted rejection is not durably confirmed', async () => {
    vi.useFakeTimers();
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Requested changes'), {
        target: { value: 'Split the persistence and dispatch work orders.' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(exitPlanModeDeny).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(
      screen.getByText(
        'Response was saved, but confirmation did not arrive. Retry the response.',
      ),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('plan-approval-retry-response'));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(exitPlanModeDeny).toHaveBeenCalledTimes(2));
    expect(exitPlanModeDeny).toHaveBeenLastCalledWith(
      compositeRequestId,
      'Split the persistence and dispatch work orders.',
    );
  });

  it('leaves ordinary ExitPlanMode prompts unchanged when planId is absent', () => {
    renderWidget({ planFilePath: 'docs/plan.md' });

    expect(screen.getByText('Ready to exit planning mode?')).toBeTruthy();
    expect(screen.getByText('Would you like to proceed?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    expect(screen.queryByTestId('meta-agent-plan-marker')).toBeNull();
  });
});

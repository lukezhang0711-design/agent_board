// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import {
  noopInteractiveWidgetHost,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import type { InteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptProjector';
import { getTranscriptToolWidget } from '@nimbalyst/runtime/ui/AgentTranscript/contributions';
import {
  PlanApprovalWidget,
  hasPendingSubmittedPlanApproval,
  registerPlanApprovalWidget,
  unregisterPlanApprovalWidget,
} from '../PlanApprovalWidget';

const sessionId = 'plan-approval-session';
const compositeRequestId = 'nimtc|94471805-5eca-4d66-a448-56e438de6ab3|1784297999209|21431';

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
    expect(screen.getByText('A stale response could approve the wrong plan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss plan' })).toBeTruthy();
    expect(screen.queryByText('Ready to exit planning mode?')).toBeNull();
  });

  it('renders a native Claude Head plan summary in the existing approval card', () => {
    renderWidget({
      ...planArguments,
      planSummary: '完整中文方案\n1. 进入 durable 审批。\n2. 批准后带 planId 派发。',
    });

    expect(screen.getByTestId('plan-approval-summary')).toBeTruthy();
    expect(screen.getByText('完整中文方案', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(screen.queryByText('Ready to exit planning mode?')).toBeNull();
  });

  it('does not invent a response ID when the durable provider tool-call ID is missing', () => {
    renderWidget(planArguments, {}, null);

    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull();
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
    expect(screen.getByTestId('plan-approval-widget').getAttribute('data-state')).toBe('pending');
    expect(screen.getByText('Awaiting review')).toBeTruthy();
    expect(screen.queryByText('Plan approved')).toBeNull();
  });

  it('flips to changes requested as soon as the durable state reaches responded', async () => {
    const invoke = vi.fn()
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

    await waitFor(() => {
      expect(screen.getByTestId('plan-approval-widget').getAttribute('data-state'))
        .toBe('changes-requested');
      expect(screen.getByText('Changes requested')).toBeTruthy();
      expect(screen.getByText('Response recorded. Head is preparing the revision…')).toBeTruthy();
    }, { timeout: 2_000 });
  });

  it('keeps the approval action available when the existing response route fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitPlanModeApprove = vi.fn().mockRejectedValue(new Error('persist failed'));
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve plan' }).hasAttribute('disabled')).toBe(false);
    });
    expect(screen.getByTestId('plan-approval-widget').getAttribute('data-state')).toBe('pending');
    expect(screen.queryByText('Response submitted. Waiting for durable confirmation…')).toBeNull();
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
    expect(screen.getByText('Response was saved, but confirmation did not arrive. Retry the response.')).toBeTruthy();

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
  });
});

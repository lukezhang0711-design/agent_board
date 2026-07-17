// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  registerPlanApprovalWidget,
  unregisterPlanApprovalWidget,
} from '../PlanApprovalWidget';

const sessionId = 'plan-approval-session';
const compositeRequestId = 'nimtc|94471805-5eca-4d66-a448-56e438de6ab3|1784297999209|21431';

function makeMessage(arguments_: Record<string, unknown>): TranscriptViewMessage {
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
      providerToolCallId: compositeRequestId,
      progress: [],
    },
  };
}

function renderWidget(
  arguments_: Record<string, unknown>,
  hostOverrides: Partial<InteractiveWidgetHost> = {},
) {
  const jotaiStore = createStore();
  jotaiStore.set(interactiveWidgetHostAtom(sessionId), {
    ...noopInteractiveWidgetHost,
    ...hostOverrides,
  });
  return render(
    <JotaiProvider store={jotaiStore}>
      <PlanApprovalWidget
        message={makeMessage(arguments_)}
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
    expect(screen.queryByText('Ready to exit planning mode?')).toBeNull();
  });

  it('reuses the existing approve response route with the composite request ID', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId);
    });
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

  it('leaves ordinary ExitPlanMode prompts unchanged when planId is absent', () => {
    renderWidget({ planFilePath: 'docs/plan.md' });

    expect(screen.getByText('Ready to exit planning mode?')).toBeTruthy();
    expect(screen.getByText('Would you like to proceed?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
  });
});

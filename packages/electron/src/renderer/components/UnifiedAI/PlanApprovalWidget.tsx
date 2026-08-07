import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  ExitPlanModeWidget,
  type CustomToolWidgetProps,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import {
  clearTranscriptToolWidgets,
  setTranscriptToolWidgets,
} from '@nimbalyst/runtime/ui/AgentTranscript/contributions';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptProjector';
import {
  planApprovalStateAtom,
  refreshPlanApprovalStateAtom,
} from '../../store/atoms/sessions';
import { isImeCompositionActive } from '../../utils/imeEventTrace';

interface SubmittedPlanArgs {
  planId: string;
  title?: string;
  planItems?: unknown[];
  workOrderCount?: number;
  risks?: string;
  planSummary?: string;
}

const PLAN_APPROVAL_WIDGET_SOURCE = 'nimbalyst:electron-plan-approval';
// Match the durable interactive-prompt polling backstop. A successful IPC write
// is not a confirmation that the waiting Head turn consumed it.
const DURABLE_CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000;
const DURABLE_STATE_POLL_INTERVAL_MS = 500;
type SessionAgentRole = 'standard' | 'meta-agent' | null;

function getSubmittedPlanArgs(value: unknown): SubmittedPlanArgs | null {
  if (!value || typeof value !== 'object') return null;
  const args = value as Record<string, unknown>;
  if (typeof args.planId !== 'string' || args.planId.trim() === '') return null;
  return args as unknown as SubmittedPlanArgs;
}

/**
 * The immediate-send control must only defer to the submitted-plan approval
 * card. Ordinary planning-mode ExitPlanMode prompts retain their own behavior.
 */
export function hasPendingSubmittedPlanApproval(messages: readonly TranscriptViewMessage[]): boolean {
  return messages.some((message) => {
    const toolCall = message.toolCall;
    return toolCall?.toolName === 'ExitPlanMode'
      && toolCall.status === 'running'
      && !toolCall.result
      && getSubmittedPlanArgs(toolCall.arguments) !== null;
  });
}

const SubmittedPlanApprovalCard: React.FC<{
  props: CustomToolWidgetProps;
  args: SubmittedPlanArgs;
}> = ({ props, args }) => {
  const { message, sessionId } = props;
  const toolCall = message.toolCall!;

  const host = useAtomValue(interactiveWidgetHostAtom(sessionId));
  const [agentRole, setAgentRole] = useState<SessionAgentRole>(null);
  const requestId = toolCall.providerToolCallId?.trim() || null;
  const title = typeof args.title === 'string' && args.title.trim()
    ? args.title.trim()
    : 'Submitted plan';
  const planItems = Array.isArray(args.planItems)
    ? args.planItems.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
  const workOrderCount = Number.isInteger(args.workOrderCount) && (args.workOrderCount ?? -1) >= 0
    ? args.workOrderCount as number
    : 0;
  const risks = typeof args.risks === 'string' && args.risks.trim()
    ? args.risks.trim()
    : 'No risks provided.';
  const planSummary = typeof args.planSummary === 'string' && args.planSummary.trim()
    ? args.planSummary.trim()
    : null;
  const toolResult = toolCall.result ?? '';
  const autoApproved = useMemo(() => {
    try { return JSON.parse(toolResult).autoApproved === true; } catch { return false; }
  }, [toolResult]);
  const isPending = toolResult === '';
  const approvalStateKey = useMemo(() => ({
    sessionId,
    promptId: requestId ?? '',
  }), [requestId, sessionId]);
  const durableState = useAtomValue(planApprovalStateAtom(approvalStateKey));
  const refreshPlanApprovalState = useSetAtom(refreshPlanApprovalStateAtom);

  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [responseSubmitted, setResponseSubmitted] = useState(false);
  const [confirmationTimedOut, setConfirmationTimedOut] = useState(false);
  const [submittedResponse, setSubmittedResponse] = useState<{
    approved: boolean;
    feedback?: string;
  } | null>(null);
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null);
  const feedbackCompositionRef = useRef(false);
  const stateReadErrorLoggedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const invoke = window.electronAPI?.invoke;
    if (!invoke) return undefined;

    void invoke('sessions:get', sessionId)
      .then((result) => {
        if (disposed) return;
        const role = result?.success && result.session?.agentRole === 'meta-agent'
          ? 'meta-agent'
          : 'standard';
        setAgentRole(role);
      })
      .catch(() => {
        if (!disposed) setAgentRole(null);
      });

    return () => {
      disposed = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (showFeedbackInput) feedbackInputRef.current?.focus();
  }, [showFeedbackInput]);

  const refreshDurableState = useCallback(async () => {
    if (!requestId || !host?.workspacePath || !window.electronAPI?.invoke) return;
    try {
      await refreshPlanApprovalState({
        sessionId,
        promptId: requestId,
        workspacePath: host.workspacePath,
      });
      stateReadErrorLoggedRef.current = false;
    } catch (error) {
      if (!stateReadErrorLoggedRef.current) {
        console.error('[PlanApprovalWidget] Failed to read durable approval state:', error);
        stateReadErrorLoggedRef.current = true;
      }
    }
  }, [host?.workspacePath, refreshPlanApprovalState, requestId, sessionId]);

  useEffect(() => {
    if (
      !requestId
      || !host?.workspacePath
      || !isPending
      || (durableState !== null && durableState.status !== 'submitted')
    ) {
      return;
    }
    void refreshDurableState();
    const interval = window.setInterval(
      () => void refreshDurableState(),
      DURABLE_STATE_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [durableState, host?.workspacePath, isPending, refreshDurableState, requestId]);

  const completedResult = useMemo<'approved' | 'changes-requested' | null>(() => {
    if (durableState?.decision === 'approved') return 'approved';
    if (durableState?.decision === 'rejected' || durableState?.decision === 'dismissed') {
      return 'changes-requested';
    }
    if (!toolResult) return null;
    const normalized = toolResult.toLowerCase();
    if (normalized.includes('continue planning') || normalized.includes('denied')) {
      return 'changes-requested';
    }
    if (normalized.includes('approved')) return 'approved';
    return null;
  }, [durableState?.decision, toolResult]);
  const displayResult = completedResult;
  const hasRecordedResponse = durableState !== null && durableState.status !== 'submitted';
  const awaitingResponse = isPending && !hasRecordedResponse;

  useEffect(() => {
    if (!responseSubmitted || !awaitingResponse || displayResult) return;
    const timeout = window.setTimeout(
      () => setConfirmationTimedOut(true),
      DURABLE_CONFIRMATION_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [awaitingResponse, displayResult, responseSubmitted]);

  const submitResponse = useCallback(async (response: { approved: boolean; feedback?: string }) => {
    if (!host || !requestId || !awaitingResponse || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (response.approved) {
        await host.exitPlanModeApprove(requestId);
      } else {
        await host.exitPlanModeDeny(requestId, response.feedback);
      }
      await refreshDurableState();
      setSubmittedResponse(response);
      setResponseSubmitted(true);
      setConfirmationTimedOut(false);
    } catch (error) {
      console.error('[PlanApprovalWidget] Failed to submit plan response:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [awaitingResponse, host, isSubmitting, refreshDurableState, requestId]);

  const handleApprove = useCallback(async () => {
    if (responseSubmitted) return;
    await submitResponse({ approved: true });
  }, [responseSubmitted, submitResponse]);

  const handleRequestChanges = useCallback(async () => {
    const trimmedFeedback = feedback.trim();
    if (responseSubmitted || !trimmedFeedback) return;
    await submitResponse({ approved: false, feedback: trimmedFeedback });
  }, [feedback, responseSubmitted, submitResponse]);

  const handleDismiss = useCallback(async () => {
    if (responseSubmitted) return;
    // A plan dismissal is a durable denial with explicit feedback. The existing
    // response path closes the waiter and returns this reason to the Head turn.
    await submitResponse({ approved: false, feedback: 'User dismissed the plan.' });
  }, [responseSubmitted, submitResponse]);

  const handleRetry = useCallback(async () => {
    if (!submittedResponse) return;
    await submitResponse(submittedResponse);
  }, [submittedResponse, submitResponse]);

  return (
    <div
      data-testid="plan-approval-widget"
      data-state={displayResult ?? (isPending ? 'pending' : 'completed')}
      data-agent-role={agentRole ?? 'unverified'}
      className="plan-approval-widget rounded-lg overflow-hidden border border-nim-primary bg-nim-secondary"
    >
      <div className="flex items-start gap-3 px-4 py-3 border-b border-nim bg-nim-tertiary">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-xs font-medium text-nim">Plan approval</div>
            {agentRole === 'meta-agent' && (
              <span
                className="meta-agent-plan-marker rounded-full border border-[var(--nim-primary)] bg-[rgba(59,130,246,0.12)] px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-[var(--nim-primary)]"
                data-testid="meta-agent-plan-marker"
                aria-label="META AGENT"
              >
                META AGENT
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-nim">{title}</div>
        </div>
        <span className="text-xs text-nim-muted shrink-0">
          {displayResult === 'approved'
            ? 'Plan approved'
            : displayResult === 'changes-requested'
              ? 'Changes requested'
              : 'Awaiting review'}
        </span>
        {autoApproved && displayResult === 'approved' && (
          <span data-testid="plan-auto-approved-badge" className="text-xs text-amber-700 dark:text-amber-300 shrink-0">
            已自动批准（测试模式）
          </span>
        )}
      </div>

      <div className="p-4">
        {planSummary && (
          <div data-testid="plan-approval-summary" className="mb-3 rounded-md bg-nim-tertiary p-3">
            <div className="text-xs font-semibold text-nim mb-1">Plan summary</div>
            <div className="text-[13px] leading-relaxed text-nim-muted whitespace-pre-wrap select-text">
              {planSummary}
            </div>
          </div>
        )}

        <ol className="m-0 pl-5 space-y-1 text-[13px] text-nim select-text">
          {planItems.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ol>

        <div className="mt-3 text-xs font-medium text-nim-muted">
          {workOrderCount} {workOrderCount === 1 ? 'work order' : 'work orders'}
        </div>

        <div className="mt-3 rounded-md bg-nim-tertiary p-3">
          <div className="text-xs font-semibold text-nim mb-1">Risks</div>
          <div className="text-[13px] leading-relaxed text-nim-muted whitespace-pre-wrap select-text">
            {risks}
          </div>
        </div>

        {!displayResult && awaitingResponse && host && requestId && !responseSubmitted && (
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              data-testid="plan-approval-approve"
              onClick={() => void handleApprove()}
              disabled={isSubmitting}
              className="w-full px-4 py-2 rounded-md border-none bg-nim-primary text-white text-[13px] font-medium cursor-pointer hover:bg-nim-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Approve plan
            </button>

            {!showFeedbackInput ? (
              <>
                <button
                  type="button"
                  data-testid="plan-approval-request-changes"
                  onClick={() => setShowFeedbackInput(true)}
                  disabled={isSubmitting}
                  className="w-full px-4 py-2 rounded-md border border-nim bg-nim-tertiary text-nim text-[13px] font-medium cursor-pointer hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Request changes
                </button>
                <button
                  type="button"
                  data-testid="plan-approval-dismiss"
                  onClick={() => void handleDismiss()}
                  disabled={isSubmitting}
                  className="w-full px-4 py-2 rounded-md border border-nim bg-transparent text-nim-muted text-[13px] font-medium cursor-pointer hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Dismiss plan
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor={`plan-change-feedback-${message.id}`} className="text-xs font-medium text-nim">
                  Requested changes
                </label>
                <textarea
                  ref={feedbackInputRef}
                  id={`plan-change-feedback-${message.id}`}
                  data-testid="plan-approval-feedback-input"
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  onCompositionStart={() => {
                    feedbackCompositionRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    feedbackCompositionRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (isImeCompositionActive(event.nativeEvent, feedbackCompositionRef.current)) {
                      return;
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleRequestChanges();
                    } else if (event.key === 'Escape') {
                      setShowFeedbackInput(false);
                      setFeedback('');
                    }
                  }}
                  placeholder="Describe what should change in the plan..."
                  rows={3}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 rounded-md text-[13px] border border-nim bg-nim-tertiary text-nim placeholder:text-nim-muted resize-none focus:outline-none focus:border-nim-focus"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFeedbackInput(false);
                      setFeedback('');
                    }}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 rounded-md border border-nim bg-transparent text-nim-muted text-xs cursor-pointer hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="plan-approval-submit-changes"
                    onClick={() => void handleRequestChanges()}
                    disabled={isSubmitting || feedback.trim() === ''}
                    className="px-3 py-1.5 rounded-md border-none bg-nim-primary text-white text-xs cursor-pointer hover:bg-nim-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Request changes
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {displayResult && isPending && hasRecordedResponse && (
          <div className="mt-4 text-xs text-nim-muted">
            {displayResult === 'approved'
              ? 'Response recorded. Head is preparing to start work…'
              : 'Response recorded. Head is preparing the revision…'}
          </div>
        )}

        {!displayResult && awaitingResponse && responseSubmitted && !confirmationTimedOut && (
          <div className="mt-4 text-xs text-nim-muted">
            Response submitted. Waiting for durable confirmation…
          </div>
        )}

        {!displayResult && awaitingResponse && responseSubmitted && confirmationTimedOut && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-nim">
            <span>Response was saved, but confirmation did not arrive. Retry the response.</span>
            <button
              type="button"
              data-testid="plan-approval-retry-response"
              onClick={() => void handleRetry()}
              disabled={isSubmitting || !submittedResponse}
              className="shrink-0 px-3 py-1.5 rounded-md border border-nim bg-nim-tertiary text-nim text-xs cursor-pointer hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Retry response
            </button>
          </div>
        )}

        {!displayResult && awaitingResponse && !requestId && !responseSubmitted && (
          <div className="mt-4 text-xs text-nim-muted">Waiting for a durable approval ID…</div>
        )}

        {!displayResult && awaitingResponse && requestId && !host && !responseSubmitted && (
          <div className="mt-4 text-xs text-nim-muted">Waiting for an active approval surface…</div>
        )}
      </div>
    </div>
  );
};

export const PlanApprovalWidget: React.FC<CustomToolWidgetProps> = (props) => {
  const args = getSubmittedPlanArgs(props.message.toolCall?.arguments);
  if (!args) return <ExitPlanModeWidget {...props} />;
  return <SubmittedPlanApprovalCard props={props} args={args} />;
};

export function registerPlanApprovalWidget(): void {
  setTranscriptToolWidgets(PLAN_APPROVAL_WIDGET_SOURCE, {
    ExitPlanMode: PlanApprovalWidget,
  });
}

export function unregisterPlanApprovalWidget(): void {
  clearTranscriptToolWidgets(PLAN_APPROVAL_WIDGET_SOURCE);
}

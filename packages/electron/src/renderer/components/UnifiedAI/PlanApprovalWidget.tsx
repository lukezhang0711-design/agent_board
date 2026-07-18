import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  ExitPlanModeWidget,
  type CustomToolWidgetProps,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import {
  clearTranscriptToolWidgets,
  setTranscriptToolWidgets,
} from '@nimbalyst/runtime/ui/AgentTranscript/contributions';

interface SubmittedPlanArgs {
  planId: string;
  title?: string;
  planItems?: unknown[];
  workOrderCount?: number;
  risks?: string;
}

const PLAN_APPROVAL_WIDGET_SOURCE = 'nimbalyst:electron-plan-approval';

function getSubmittedPlanArgs(value: unknown): SubmittedPlanArgs | null {
  if (!value || typeof value !== 'object') return null;
  const args = value as Record<string, unknown>;
  if (typeof args.planId !== 'string' || args.planId.trim() === '') return null;
  return args as unknown as SubmittedPlanArgs;
}

const SubmittedPlanApprovalCard: React.FC<{
  props: CustomToolWidgetProps;
  args: SubmittedPlanArgs;
}> = ({ props, args }) => {
  const { message, sessionId } = props;
  const toolCall = message.toolCall!;

  const host = useAtomValue(interactiveWidgetHostAtom(sessionId));
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
  const toolResult = toolCall.result ?? '';
  const isPending = toolResult === '';

  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [responseSubmitted, setResponseSubmitted] = useState(false);
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showFeedbackInput) feedbackInputRef.current?.focus();
  }, [showFeedbackInput]);

  const completedResult = useMemo<'approved' | 'changes-requested' | null>(() => {
    if (!toolResult) return null;
    const normalized = toolResult.toLowerCase();
    if (normalized.includes('continue planning') || normalized.includes('denied')) {
      return 'changes-requested';
    }
    if (normalized.includes('approved')) return 'approved';
    return null;
  }, [toolResult]);
  const displayResult = completedResult;

  const handleApprove = useCallback(async () => {
    if (!host || !requestId || !isPending || isSubmitting || responseSubmitted) return;
    setIsSubmitting(true);
    try {
      await host.exitPlanModeApprove(requestId);
      setResponseSubmitted(true);
    } catch (error) {
      console.error('[PlanApprovalWidget] Failed to approve plan:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [host, isPending, isSubmitting, requestId, responseSubmitted]);

  const handleRequestChanges = useCallback(async () => {
    const trimmedFeedback = feedback.trim();
    if (!host || !requestId || !isPending || isSubmitting || responseSubmitted || !trimmedFeedback) return;
    setIsSubmitting(true);
    try {
      await host.exitPlanModeDeny(requestId, trimmedFeedback);
      setResponseSubmitted(true);
    } catch (error) {
      console.error('[PlanApprovalWidget] Failed to request plan changes:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [feedback, host, isPending, isSubmitting, requestId, responseSubmitted]);

  return (
    <div
      data-testid="plan-approval-widget"
      data-state={displayResult ?? (isPending ? 'pending' : 'completed')}
      className="plan-approval-widget rounded-lg overflow-hidden border border-nim-primary bg-nim-secondary"
    >
      <div className="flex items-start gap-3 px-4 py-3 border-b border-nim bg-nim-tertiary">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-nim mb-1">Plan approval</div>
          <div className="text-sm font-semibold text-nim">{title}</div>
        </div>
        <span className="text-xs text-nim-muted shrink-0">
          {displayResult === 'approved'
            ? 'Plan approved'
            : displayResult === 'changes-requested'
              ? 'Changes requested'
              : 'Awaiting review'}
        </span>
      </div>

      <div className="p-4">
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

        {!displayResult && isPending && host && requestId && !responseSubmitted && (
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
              <button
                type="button"
                data-testid="plan-approval-request-changes"
                onClick={() => setShowFeedbackInput(true)}
                disabled={isSubmitting}
                className="w-full px-4 py-2 rounded-md border border-nim bg-nim-tertiary text-nim text-[13px] font-medium cursor-pointer hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Request changes
              </button>
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
                  onKeyDown={(event) => {
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

        {!displayResult && isPending && responseSubmitted && (
          <div className="mt-4 text-xs text-nim-muted">
            Response submitted. Waiting for durable confirmation…
          </div>
        )}

        {!displayResult && isPending && !requestId && !responseSubmitted && (
          <div className="mt-4 text-xs text-nim-muted">Waiting for a durable approval ID…</div>
        )}

        {!displayResult && isPending && requestId && !host && !responseSubmitted && (
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

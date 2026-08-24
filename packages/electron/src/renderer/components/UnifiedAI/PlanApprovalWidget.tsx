import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  ExitPlanModeWidget,
  InteractivePromptStatusCard,
  useInteractivePromptStatus,
  type CustomToolWidgetProps,
  type PlanModuleApproval,
  type SelectedPlanCandidate,
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
  risks?: unknown;
  planSummary?: string;
  modules?: unknown;
  moduleApprovals?: unknown;
}

type StructuredText = string | string[];

interface RenderCandidate {
  name: string;
  approach: string;
  pros: StructuredText;
  cons: StructuredText;
  risks: StructuredText;
  provider: string;
  model: string;
  effortLevel: SelectedPlanCandidate['effortLevel'];
}

interface RenderModule {
  title: string;
  outputFiles: string[];
  inputs: string[];
  provider: string;
  model: string;
  effortLevel: SelectedPlanCandidate['effortLevel'];
  doneCriteria: string;
  candidates: RenderCandidate[];
}

type RenderModuleApprovalStatus = PlanModuleApproval['status'];

interface RenderModuleApproval {
  moduleIndex: number;
  status: RenderModuleApprovalStatus;
  feedback?: string;
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

function getDisplayString(value: unknown, fallback = '未提供'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getDisplayStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    )
    .map((item) => item.trim());
}

function getStructuredText(value: unknown): StructuredText {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const list = getDisplayStringList(value);
  return list.length > 0 ? list : '未提供';
}

function getEffortLevel(value: unknown): SelectedPlanCandidate['effortLevel'] {
  return getDisplayString(value) as SelectedPlanCandidate['effortLevel'];
}

function parsePlanModules(value: unknown): RenderModule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (value): value is Record<string, unknown> =>
        !!value && typeof value === 'object',
    )
    .map((module, moduleIndex) => ({
      title: getDisplayString(module.title, `模块 ${moduleIndex + 1}`),
      outputFiles: getDisplayStringList(module.outputFiles),
      inputs: getDisplayStringList(module.inputs),
      provider: getDisplayString(module.provider),
      model: getDisplayString(module.model),
      effortLevel: getEffortLevel(module.effortLevel),
      doneCriteria: getDisplayString(module.doneCriteria),
      candidates: Array.isArray(module.candidates)
        ? module.candidates
            .filter(
              (candidate): candidate is Record<string, unknown> =>
                !!candidate && typeof candidate === 'object',
            )
            .map((candidate) => ({
              name: getDisplayString(candidate.name, '未命名方案'),
              approach: getDisplayString(candidate.approach),
              pros: getStructuredText(candidate.pros),
              cons: getStructuredText(candidate.cons),
              risks: getStructuredText(candidate.risks),
              provider: getDisplayString(candidate.provider),
              model: getDisplayString(candidate.model),
              effortLevel: getEffortLevel(candidate.effortLevel),
            }))
        : [],
    }));
}

function parseModuleApprovals(value: unknown): RenderModuleApproval[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const approval = value as Record<string, unknown>;
    const moduleIndex = approval.moduleIndex;
    const status = approval.status;
    if (
      typeof moduleIndex !== 'number' ||
      !Number.isInteger(moduleIndex) ||
      moduleIndex < 1 ||
      (status !== 'pending' && status !== 'approved' && status !== 'rejected')
    ) {
      return [];
    }
    return [
      {
        moduleIndex,
        status,
        ...(typeof approval.feedback === 'string' && approval.feedback.trim()
          ? { feedback: approval.feedback }
          : {}),
      } satisfies RenderModuleApproval,
    ];
  });
}

export function formatPlanOutputPath(
  filePath: string,
  workspacePath?: string,
): string {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedWorkspace = workspacePath
    ?.replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (
    normalizedWorkspace &&
    normalizedPath.startsWith(`${normalizedWorkspace}/`)
  ) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath.replace(/^\/+/, '');
}

function renderStructuredText(value: StructuredText): React.ReactNode {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item, index) => (
    <div key={`${index}-${item}`} className="whitespace-pre-wrap break-words">
      {item}
    </div>
  ));
}

const CANDIDATE_MATRIX_ROWS: Array<{
  label: string;
  key: 'approach' | 'pros' | 'cons' | 'risks' | 'model' | 'effortLevel';
}> = [
  { label: '怎么干', key: 'approach' },
  { label: '优势', key: 'pros' },
  { label: '劣势', key: 'cons' },
  { label: '风险', key: 'risks' },
  { label: '模型', key: 'model' },
  { label: '思考强度', key: 'effortLevel' },
];

/**
 * The immediate-send control must only defer to the submitted-plan approval
 * card. Ordinary planning-mode ExitPlanMode prompts retain their own behavior.
 */
export function hasPendingSubmittedPlanApproval(
  messages: readonly TranscriptViewMessage[],
): boolean {
  return messages.some((message) => {
    const toolCall = message.toolCall;
    return (
      toolCall?.toolName === 'ExitPlanMode' &&
      toolCall.status === 'running' &&
      !toolCall.result &&
      getSubmittedPlanArgs(toolCall.arguments) !== null
    );
  });
}

const SubmittedPlanApprovalCard: React.FC<{
  props: CustomToolWidgetProps;
  args: SubmittedPlanArgs;
}> = ({ props, args }) => {
  const { message, sessionId, workspacePath, getInteractivePromptStatus } =
    props;
  const toolCall = message.toolCall!;

  const host = useAtomValue(interactiveWidgetHostAtom(sessionId));
  const [agentRole, setAgentRole] = useState<SessionAgentRole>(null);
  const requestId = toolCall.providerToolCallId?.trim() || null;
  const title =
    typeof args.title === 'string' && args.title.trim()
      ? args.title.trim()
      : 'Submitted plan';
  const planItems = Array.isArray(args.planItems)
    ? args.planItems.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim() !== '',
      )
    : [];
  const workOrderCount =
    Number.isInteger(args.workOrderCount) && (args.workOrderCount ?? -1) >= 0
      ? (args.workOrderCount as number)
      : 0;
  const declaredRisks = Array.isArray(args.risks)
    ? args.risks
        .filter(
          (risk): risk is string =>
            typeof risk === 'string' && risk.trim() !== '',
        )
        .map((risk) => risk.trim())
        .join('\n')
    : typeof args.risks === 'string' && args.risks.trim()
    ? args.risks.trim()
    : '';
  const risks = declaredRisks || '未申报风险';
  const planSummary =
    typeof args.planSummary === 'string' && args.planSummary.trim()
      ? args.planSummary.trim()
      : null;
  const modules = useMemo(() => parsePlanModules(args.modules), [args.modules]);
  const isMultiModulePlan = modules.length > 1;
  const [selectedCandidateNames, setSelectedCandidateNames] = useState<
    Record<number, string>
  >({});
  const selectedCandidates = useMemo<SelectedPlanCandidate[]>(
    () =>
      modules.flatMap((module, moduleIndex) => {
        const selectedName = selectedCandidateNames[moduleIndex];
        if (!selectedName) return [];
        const candidate = module.candidates.find(
          (item) => item.name === selectedName,
        );
        if (!candidate) return [];
        return [
          {
            moduleIndex,
            moduleTitle: module.title,
            ...candidate,
          },
        ];
      }),
    [modules, selectedCandidateNames],
  );
  const toolResult = toolCall.result ?? '';
  const autoApproved = useMemo(() => {
    try {
      return JSON.parse(toolResult).autoApproved === true;
    } catch {
      return false;
    }
  }, [toolResult]);
  const isPending = toolResult === '';
  const { status: promptStatus, markUnavailable } = useInteractivePromptStatus(
    getInteractivePromptStatus,
    requestId ?? '',
    'exit_plan_mode',
    isPending,
    getInteractivePromptStatus ? 'checking' : host ? 'available' : 'checking',
  );
  const effectiveWorkspacePath = workspacePath || host?.workspacePath;
  const approvalStateKey = useMemo(
    () => ({
      sessionId,
      promptId: requestId ?? '',
    }),
    [requestId, sessionId],
  );
  const durableState = useAtomValue(planApprovalStateAtom(approvalStateKey));
  const refreshPlanApprovalState = useSetAtom(refreshPlanApprovalStateAtom);
  const [moduleApprovalOverrides, setModuleApprovalOverrides] = useState<
    Record<number, RenderModuleApproval>
  >({});
  const [moduleFeedback, setModuleFeedback] = useState<Record<number, string>>(
    {},
  );
  const [activeFeedbackModuleIndex, setActiveFeedbackModuleIndex] = useState<
    number | null
  >(null);

  const moduleApprovalStates = useMemo<RenderModuleApproval[]>(() => {
    const states = new Map<number, RenderModuleApproval>();
    const durableApprovals = parseModuleApprovals(
      durableState?.moduleApprovals,
    );
    const submittedApprovals =
      durableApprovals.length > 0
        ? durableApprovals
        : parseModuleApprovals(args.moduleApprovals);
    submittedApprovals.forEach((approval) =>
      states.set(approval.moduleIndex, approval),
    );
    if (
      durableState?.decision === 'approved' &&
      submittedApprovals.length === 0
    ) {
      modules.forEach((_module, index) => {
        states.set(index + 1, { moduleIndex: index + 1, status: 'approved' });
      });
    }
    if (
      durableState?.decision === 'rejected' &&
      durableState.moduleIndex !== undefined
    ) {
      states.set(durableState.moduleIndex, {
        moduleIndex: durableState.moduleIndex,
        status: 'rejected',
        ...(durableState.feedback ? { feedback: durableState.feedback } : {}),
      });
    }
    Object.values(moduleApprovalOverrides).forEach((approval) => {
      states.set(approval.moduleIndex, approval);
    });
    return modules.map(
      (_module, index) =>
        states.get(index + 1) ?? {
          moduleIndex: index + 1,
          status: 'pending',
        },
    );
  }, [args.moduleApprovals, durableState, modules, moduleApprovalOverrides]);
  const rejectedModuleCount = moduleApprovalStates.filter(
    (approval) => approval.status === 'rejected',
  ).length;

  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [responseSubmitted, setResponseSubmitted] = useState(false);
  const [confirmationTimedOut, setConfirmationTimedOut] = useState(false);
  const [submittedResponse, setSubmittedResponse] = useState<{
    approved: boolean;
    feedback?: string;
    moduleIndex?: number;
    moduleApprovals?: PlanModuleApproval[];
    selectedCandidates?: SelectedPlanCandidate[];
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
        const role =
          result?.success && result.session?.agentRole === 'meta-agent'
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
    if (!requestId || !effectiveWorkspacePath || !window.electronAPI?.invoke)
      return;
    try {
      await refreshPlanApprovalState({
        sessionId,
        promptId: requestId,
        workspacePath: effectiveWorkspacePath,
      });
      stateReadErrorLoggedRef.current = false;
    } catch (error) {
      if (!stateReadErrorLoggedRef.current) {
        console.error(
          '[PlanApprovalWidget] Failed to read durable approval state:',
          error,
        );
        stateReadErrorLoggedRef.current = true;
      }
    }
  }, [effectiveWorkspacePath, refreshPlanApprovalState, requestId, sessionId]);

  useEffect(() => {
    if (
      !requestId ||
      !effectiveWorkspacePath ||
      !isPending ||
      promptStatus === 'unavailable' ||
      promptStatus === 'resolved' ||
      (durableState !== null && durableState.status !== 'submitted')
    ) {
      return;
    }
    void refreshDurableState();
    const interval = window.setInterval(
      () => void refreshDurableState(),
      DURABLE_STATE_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [
    durableState,
    effectiveWorkspacePath,
    isPending,
    promptStatus,
    refreshDurableState,
    requestId,
  ]);

  const completedResult = useMemo<
    'approved' | 'changes-requested' | null
  >(() => {
    if (durableState?.decision === 'approved') return 'approved';
    if (
      durableState?.decision === 'rejected' ||
      durableState?.decision === 'dismissed'
    ) {
      return 'changes-requested';
    }
    if (!toolResult) return null;
    const normalized = toolResult.toLowerCase();
    if (
      normalized.includes('continue planning') ||
      normalized.includes('denied')
    ) {
      return 'changes-requested';
    }
    if (normalized.includes('approved')) return 'approved';
    return null;
  }, [durableState?.decision, toolResult]);
  const displayResult = completedResult;
  const hasRecordedResponse =
    durableState !== null && durableState.status !== 'submitted';
  const awaitingResponse = isPending && !hasRecordedResponse;

  useEffect(() => {
    if (!responseSubmitted || !awaitingResponse || displayResult) return;
    const timeout = window.setTimeout(
      () => setConfirmationTimedOut(true),
      DURABLE_CONFIRMATION_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [awaitingResponse, displayResult, responseSubmitted]);

  const submitResponse = useCallback(
    async (response: {
      approved: boolean;
      feedback?: string;
      moduleIndex?: number;
      moduleApprovals?: PlanModuleApproval[];
      selectedCandidates?: SelectedPlanCandidate[];
    }): Promise<boolean> => {
      if (
        !host ||
        !requestId ||
        promptStatus !== 'available' ||
        !awaitingResponse ||
        isSubmitting
      )
        return false;
      setIsSubmitting(true);
      try {
        if (response.approved) {
          if (response.moduleApprovals && response.moduleApprovals.length > 0) {
            await host.exitPlanModeApprove(
              requestId,
              response.selectedCandidates,
              response.moduleApprovals,
            );
          } else if (
            response.selectedCandidates &&
            response.selectedCandidates.length > 0
          ) {
            await host.exitPlanModeApprove(
              requestId,
              response.selectedCandidates,
            );
          } else {
            await host.exitPlanModeApprove(requestId);
          }
        } else {
          if (response.moduleIndex === undefined) {
            await host.exitPlanModeDeny(requestId, response.feedback);
          } else {
            await host.exitPlanModeDeny(
              requestId,
              response.feedback,
              response.moduleIndex,
            );
          }
        }
        await refreshDurableState();
        setSubmittedResponse(response);
        setResponseSubmitted(true);
        setConfirmationTimedOut(false);
        return true;
      } catch (error) {
        console.error(
          '[PlanApprovalWidget] Failed to submit plan response:',
          error,
        );
        if (getInteractivePromptStatus) markUnavailable();
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      awaitingResponse,
      getInteractivePromptStatus,
      host,
      isSubmitting,
      markUnavailable,
      promptStatus,
      refreshDurableState,
      requestId,
    ],
  );

  const handleApprove = useCallback(async () => {
    if (responseSubmitted) return;
    const moduleApprovals =
      isMultiModulePlan && rejectedModuleCount > 0
        ? moduleApprovalStates.map((approval) =>
            approval.status === 'rejected'
              ? approval
              : { ...approval, status: 'approved' as const },
          )
        : undefined;
    const submitted = await submitResponse({
      approved: true,
      ...(moduleApprovals ? { moduleApprovals } : {}),
      ...(selectedCandidates.length > 0 ? { selectedCandidates } : {}),
    });
    if (submitted && isMultiModulePlan) {
      setModuleApprovalOverrides(
        Object.fromEntries(
          moduleApprovalStates.map((approval) => [
            approval.moduleIndex,
            approval.status === 'rejected'
              ? approval
              : { ...approval, status: 'approved' as const },
          ]),
        ),
      );
    }
  }, [
    isMultiModulePlan,
    moduleApprovalStates,
    rejectedModuleCount,
    responseSubmitted,
    selectedCandidates,
    submitResponse,
  ]);

  const handleRequestChanges = useCallback(
    async (moduleIndex?: number) => {
      const trimmedFeedback =
        moduleIndex === undefined
          ? feedback.trim()
          : (moduleFeedback[moduleIndex] ?? '').trim();
      if (responseSubmitted || !trimmedFeedback) return;
      const submitted = await submitResponse({
        approved: false,
        feedback: trimmedFeedback,
        ...(moduleIndex === undefined ? {} : { moduleIndex }),
      });
      if (submitted && moduleIndex !== undefined) {
        setModuleApprovalOverrides((current) => ({
          ...current,
          [moduleIndex]: {
            moduleIndex,
            status: 'rejected',
            feedback: trimmedFeedback,
          },
        }));
        setActiveFeedbackModuleIndex(null);
      }
    },
    [feedback, moduleFeedback, responseSubmitted, submitResponse],
  );

  const handleDismiss = useCallback(async () => {
    if (responseSubmitted) return;
    // A plan dismissal is a durable denial with explicit feedback. The existing
    // response path closes the waiter and returns this reason to the Head turn.
    await submitResponse({
      approved: false,
      feedback: 'User dismissed the plan.',
    });
  }, [responseSubmitted, submitResponse]);

  const handleRetry = useCallback(async () => {
    if (!submittedResponse) return;
    await submitResponse(submittedResponse);
  }, [submittedResponse, submitResponse]);

  return (
    <div
      data-testid="plan-approval-widget"
      data-state={
        promptStatus === 'unavailable'
          ? 'invalid'
          : displayResult ?? (isPending ? 'pending' : 'completed')
      }
      data-agent-role={agentRole ?? 'unverified'}
      className="plan-approval-widget rounded-lg overflow-visible border border-nim-primary bg-nim-secondary"
    >
      <div
        data-testid="plan-approval-header"
        className={`flex flex-col gap-2 px-4 py-3 border-b border-nim bg-nim-tertiary ${
          isMultiModulePlan ? 'sticky top-0 z-20' : ''
        }`}
      >
        <div className="flex items-start gap-3">
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
            <span
              data-testid="plan-auto-approved-badge"
              className="text-xs text-amber-700 dark:text-amber-300 shrink-0"
            >
              已自动批准（测试模式）
            </span>
          )}
        </div>
        {isMultiModulePlan && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-nim-muted">
            <span data-testid="plan-approval-module-count">
              方案包含 {modules.length} 个模块
            </span>
            <span data-testid="plan-approval-header-risks">
              总体风险：{risks}
            </span>
          </div>
        )}
        {isMultiModulePlan && rejectedModuleCount > 0 && (
          <div
            data-testid="plan-approval-revision-warning"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200"
          >
            {rejectedModuleCount} 个模块待修订，Head 需重新递交
          </div>
        )}
        {isMultiModulePlan &&
          promptStatus !== 'unavailable' &&
          !displayResult &&
          awaitingResponse &&
          promptStatus === 'available' &&
          host &&
          requestId &&
          !responseSubmitted && (
            <button
              type="button"
              data-testid="plan-approval-approve-all"
              onClick={() => void handleApprove()}
              disabled={isSubmitting}
              className="w-full px-4 py-2 rounded-md border-none bg-nim-primary text-white text-[13px] font-medium cursor-pointer hover:bg-nim-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              全部批准
            </button>
          )}
      </div>

      <div className="p-4">
        {(promptStatus === 'unavailable' ||
          (promptStatus === 'resolved' && !displayResult)) && (
          <InteractivePromptStatusCard
            testId="plan-approval-status"
            title="Plan approval"
            status={promptStatus}
            detail={
              promptStatus === 'unavailable'
                ? '方案审批供应端已失效。'
                : '方案审批响应已记录。'
            }
          />
        )}

        {planSummary && (
          <div
            data-testid="plan-approval-summary"
            className="mb-3 rounded-md bg-nim-tertiary p-3"
          >
            <div className="text-xs font-semibold text-nim mb-1">
              Plan summary
            </div>
            <div className="text-[13px] leading-relaxed text-nim-muted whitespace-pre-wrap select-text">
              {planSummary}
            </div>
          </div>
        )}

        {modules.length > 0 && (
          <div
            data-testid="plan-approval-modules"
            className={
              isMultiModulePlan
                ? 'mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3'
                : 'mb-4 flex flex-col gap-4'
            }
          >
            {modules.map((module, moduleIndex) => {
              const stableModuleIndex = moduleIndex + 1;
              const moduleApproval = moduleApprovalStates[moduleIndex];
              const isModuleRejected = moduleApproval.status === 'rejected';
              const isModuleFeedbackOpen =
                activeFeedbackModuleIndex === stableModuleIndex;
              return (
                <section
                  key={`${moduleIndex}-${module.title}`}
                  data-testid={`plan-module-card-${stableModuleIndex}`}
                  className="rounded-md border border-nim bg-nim-tertiary p-3"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-nim">
                      {module.title}
                    </div>
                    {isMultiModulePlan && (
                      <span
                        data-testid={`plan-module-status-${stableModuleIndex}`}
                        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                          isModuleRejected
                            ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                            : moduleApproval.status === 'approved'
                            ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                            : 'bg-nim-secondary text-nim-muted'
                        }`}
                      >
                        {isModuleRejected
                          ? '已打回·待修订'
                          : moduleApproval.status === 'approved'
                          ? '已批准'
                          : '待审批'}
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold text-nim-muted">
                        产出文件
                      </dt>
                      <dd className="mt-1 flex min-w-0 flex-col gap-1 text-nim select-text">
                        {module.outputFiles.length > 0
                          ? module.outputFiles.map((filePath) => (
                              <code
                                key={filePath}
                                className="whitespace-nowrap text-[12px]"
                              >
                                {formatPlanOutputPath(
                                  filePath,
                                  effectiveWorkspacePath,
                                )}
                              </code>
                            ))
                          : '未提供'}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold text-nim-muted">
                        原料
                      </dt>
                      <dd className="mt-1 text-nim select-text">
                        {module.inputs.length > 0
                          ? renderStructuredText(module.inputs)
                          : '未提供'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-nim-muted">
                        提供方
                      </dt>
                      <dd className="mt-1 text-nim select-text">
                        {module.provider}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-nim-muted">
                        模型
                      </dt>
                      <dd className="mt-1 whitespace-nowrap text-nim select-text">
                        {module.model}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-nim-muted">
                        思考强度
                      </dt>
                      <dd className="mt-1 text-nim select-text">
                        {module.effortLevel}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold text-nim-muted">
                        完成标准
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words text-nim select-text">
                        {module.doneCriteria}
                      </dd>
                    </div>
                  </dl>

                  {module.candidates.length > 0 && (
                    <div data-testid="plan-candidate-matrix" className="mt-4">
                      <div className="mb-2 text-xs font-semibold text-nim">
                        候选方案对比
                      </div>
                      <div className="overflow-x-auto pb-2">
                        <div
                          className="grid min-w-max text-[13px]"
                          style={{
                            gridTemplateColumns: `minmax(76px, 0.35fr) repeat(${module.candidates.length}, minmax(220px, 1fr))`,
                          }}
                        >
                          <div className="sticky left-0 z-10 border-b border-r border-nim bg-nim-tertiary p-2 text-xs font-semibold text-nim-muted">
                            字段
                          </div>
                          {module.candidates.map((candidate) => (
                            <div
                              key={candidate.name}
                              className="border-b border-nim p-2 text-nim"
                            >
                              <div className="mb-2 whitespace-nowrap font-semibold">
                                {candidate.name}
                              </div>
                              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-nim-muted">
                                <input
                                  type="radio"
                                  name={`plan-candidate-${args.planId}-${moduleIndex}`}
                                  value={candidate.name}
                                  checked={
                                    selectedCandidateNames[moduleIndex] ===
                                    candidate.name
                                  }
                                  onChange={() =>
                                    setSelectedCandidateNames((current) => ({
                                      ...current,
                                      [moduleIndex]: candidate.name,
                                    }))
                                  }
                                  data-testid={`plan-candidate-radio-${moduleIndex}-${candidate.name}`}
                                  aria-label={`选这个 ${candidate.name}`}
                                />
                                <span>选这个</span>
                              </label>
                            </div>
                          ))}
                          {CANDIDATE_MATRIX_ROWS.map((row) => (
                            <React.Fragment key={row.key}>
                              <div className="sticky left-0 z-10 border-b border-r border-nim bg-nim-tertiary p-2 text-xs font-semibold text-nim-muted">
                                {row.label}
                              </div>
                              {module.candidates.map((candidate) => (
                                <div
                                  key={`${candidate.name}-${row.key}`}
                                  className={`border-b border-nim p-2 text-nim ${
                                    row.key === 'model'
                                      ? 'whitespace-nowrap'
                                      : 'whitespace-normal break-words'
                                  }`}
                                >
                                  {renderStructuredText(candidate[row.key])}
                                </div>
                              ))}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {isMultiModulePlan && (
                    <div className="mt-4 border-t border-nim pt-3">
                      {isModuleRejected && moduleApproval.feedback && (
                        <div
                          data-testid={`plan-module-feedback-${stableModuleIndex}`}
                          className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-900 dark:text-amber-100"
                        >
                          意见：{moduleApproval.feedback}
                        </div>
                      )}
                      {!displayResult &&
                        awaitingResponse &&
                        promptStatus === 'available' &&
                        host &&
                        requestId &&
                        !responseSubmitted &&
                        !isModuleRejected &&
                        (!isModuleFeedbackOpen ? (
                          <button
                            type="button"
                            data-testid={`plan-module-request-changes-${stableModuleIndex}`}
                            onClick={() => {
                              setActiveFeedbackModuleIndex(stableModuleIndex);
                              setModuleFeedback((current) => ({
                                ...current,
                                [stableModuleIndex]:
                                  current[stableModuleIndex] ?? '',
                              }));
                            }}
                            disabled={isSubmitting}
                            className="w-full rounded-md border border-nim bg-nim-secondary px-3 py-2 text-xs font-medium text-nim hover:bg-nim-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            打回这一条
                          </button>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <label
                              htmlFor={`plan-module-feedback-${message.id}-${stableModuleIndex}`}
                              className="text-xs font-medium text-nim"
                            >
                              打回意见
                            </label>
                            <textarea
                              id={`plan-module-feedback-${message.id}-${stableModuleIndex}`}
                              data-testid={`plan-module-feedback-input-${stableModuleIndex}`}
                              value={moduleFeedback[stableModuleIndex] ?? ''}
                              onChange={(event) =>
                                setModuleFeedback((current) => ({
                                  ...current,
                                  [stableModuleIndex]: event.target.value,
                                }))
                              }
                              onCompositionStart={() => {
                                feedbackCompositionRef.current = true;
                              }}
                              onCompositionEnd={() => {
                                feedbackCompositionRef.current = false;
                              }}
                              onKeyDown={(event) => {
                                if (
                                  isImeCompositionActive(
                                    event.nativeEvent,
                                    feedbackCompositionRef.current,
                                  )
                                )
                                  return;
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault();
                                  void handleRequestChanges(stableModuleIndex);
                                } else if (event.key === 'Escape') {
                                  setActiveFeedbackModuleIndex(null);
                                }
                              }}
                              placeholder="写明这一模块需要修订的内容…"
                              rows={3}
                              disabled={isSubmitting}
                              className="w-full resize-none rounded-md border border-nim bg-nim-secondary px-3 py-2 text-xs text-nim placeholder:text-nim-muted focus:border-nim-focus focus:outline-none"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveFeedbackModuleIndex(null)
                                }
                                disabled={isSubmitting}
                                className="rounded-md border border-nim bg-transparent px-3 py-1.5 text-xs text-nim-muted hover:bg-nim-hover disabled:opacity-50"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                data-testid={`plan-module-submit-changes-${stableModuleIndex}`}
                                onClick={() =>
                                  void handleRequestChanges(stableModuleIndex)
                                }
                                disabled={
                                  isSubmitting ||
                                  (
                                    moduleFeedback[stableModuleIndex] ?? ''
                                  ).trim() === ''
                                }
                                className="rounded-md bg-nim-primary px-3 py-1.5 text-xs text-white hover:bg-nim-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                提交打回
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <ol className="m-0 pl-5 space-y-1 text-[13px] text-nim select-text">
          {planItems.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ol>

        {!isMultiModulePlan && (
          <div className="mt-3 text-xs font-medium text-nim-muted">
            {workOrderCount}{' '}
            {workOrderCount === 1 ? 'work order' : 'work orders'}
          </div>
        )}

        {!isMultiModulePlan && (
          <div className="mt-3 rounded-md bg-nim-tertiary p-3">
            <div className="text-xs font-semibold text-nim mb-1">Risks</div>
            <div className="text-[13px] leading-relaxed text-nim-muted whitespace-pre-wrap select-text">
              {risks}
            </div>
          </div>
        )}

        {!isMultiModulePlan &&
          promptStatus !== 'unavailable' &&
          !displayResult &&
          awaitingResponse &&
          promptStatus === 'available' &&
          host &&
          requestId &&
          !responseSubmitted && (
            <div
              data-testid="plan-approval-actions"
              className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-4 flex flex-col gap-2 border-t border-nim bg-nim-secondary/95 p-4 backdrop-blur"
            >
              <>
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
                    <label
                      htmlFor={`plan-change-feedback-${message.id}`}
                      className="text-xs font-medium text-nim"
                    >
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
                        if (
                          isImeCompositionActive(
                            event.nativeEvent,
                            feedbackCompositionRef.current,
                          )
                        ) {
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
              </>
            </div>
          )}

        {displayResult && isPending && hasRecordedResponse && (
          <div className="mt-4 text-xs text-nim-muted">
            {displayResult === 'approved'
              ? 'Response recorded. Head is preparing to start work…'
              : 'Response recorded. Head is preparing the revision…'}
          </div>
        )}

        {!displayResult &&
          awaitingResponse &&
          responseSubmitted &&
          !confirmationTimedOut && (
            <div className="mt-4 text-xs text-nim-muted">
              Response submitted. Waiting for durable confirmation…
            </div>
          )}

        {!displayResult &&
          awaitingResponse &&
          responseSubmitted &&
          confirmationTimedOut && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-nim">
              <span>
                Response was saved, but confirmation did not arrive. Retry the
                response.
              </span>
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

        {!displayResult &&
          awaitingResponse &&
          !requestId &&
          !responseSubmitted && (
            <div className="mt-4 text-xs text-nim-muted">
              Waiting for a durable approval ID…
            </div>
          )}

        {!displayResult &&
          awaitingResponse &&
          promptStatus === 'checking' &&
          !responseSubmitted && (
            <div className="mt-4 text-xs text-nim-muted">
              Checking approval availability…
            </div>
          )}

        {!displayResult &&
          awaitingResponse &&
          promptStatus !== 'unavailable' &&
          requestId &&
          !host &&
          !responseSubmitted && (
            <div className="mt-4 text-xs text-nim-muted">
              Waiting for an active approval surface…
            </div>
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

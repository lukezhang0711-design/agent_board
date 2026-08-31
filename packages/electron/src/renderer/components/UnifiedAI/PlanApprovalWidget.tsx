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
  getDefaultDispatchPermissionKnobs,
  getDispatchDisturbanceLevelLabel,
  getDispatchPermissionCapabilities,
  getDispatchPermissionScopeLabel,
  isDispatchDisturbanceLevel,
  isDispatchPermissionScope,
  resolveDispatchPermission,
  type DispatchDisturbanceLevel,
  type DispatchPermissionKnobs,
  type DispatchPermissionScope,
} from '@nimbalyst/runtime/ai/server/dispatchPermissionKnobs';
import {
  CODEX_SKILL_CONTROL_NOTICE,
  DISPATCH_SKILL_SETTINGS_KEY,
  filterEnabledDispatchSkills,
  getDispatchSkillEngineForProvider,
  readDispatchSkillSettings,
  sameDispatchSkillSelection,
  sanitizeDispatchSkillSettingsForLibrary,
  type DispatchSkillDescriptor,
  type DispatchSkillSelection,
  type DispatchSkillSettings,
} from '../../utils/dispatchSkillLibrary';
import {
  planApprovalStateAtom,
  refreshPlanApprovalStateAtom,
} from '../../store/atoms/sessions';
import { isImeCompositionActive } from '../../utils/imeEventTrace';
import './PlanApprovalWidget.css';

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
  effortLevel?: SelectedPlanCandidate['effortLevel'];
  intent: PlanWorkerIntent;
  permissionScope?: DispatchPermissionScope;
  disturbanceLevel?: DispatchDisturbanceLevel;
  skillBundleName?: string;
  skillIds: string[];
  hasSkillSelection: boolean;
}

type PlanWorkerIntent = 'investigation' | 'implementation';

interface RenderModule {
  title: string;
  outputFiles: string[];
  inputs: string[];
  provider: string;
  model: string;
  modelCatalogPending: boolean;
  effortLevel: SelectedPlanCandidate['effortLevel'] | '';
  intent: PlanWorkerIntent;
  permissionScope?: DispatchPermissionScope;
  disturbanceLevel?: DispatchDisturbanceLevel;
  skillBundleName?: string;
  skillIds: string[];
  hasSkillSelection: boolean;
  doneCriteria: string;
  candidates: RenderCandidate[];
}

type PlanEffortLevel = NonNullable<SelectedPlanCandidate['effortLevel']>;

interface PlanCatalogModel {
  id: string;
  provider: string;
  supportedEffortLevels: PlanEffortLevel[];
  defaultEffortLevel?: PlanEffortLevel;
}

interface PlanCatalogStatus {
  modelSource?: 'runtime' | 'cache' | 'placeholder' | 'none';
  verified?: boolean;
  lastError?: { message?: string } | null;
}

interface PlanCatalogState {
  status: 'loading' | 'ready' | 'failed';
  models: PlanCatalogModel[];
}

interface ModuleRouteSelection {
  model: string;
  effortLevel?: PlanEffortLevel;
}

interface ResolvedModuleRoute {
  provider: string;
  model: string;
  effortLevel?: PlanEffortLevel;
}

interface ModuleDispatchSelection {
  permissionScope: DispatchPermissionScope;
  disturbanceLevel: DispatchDisturbanceLevel;
}

interface DispatchSkillLibraryState {
  status: 'loading' | 'ready' | 'failed';
  skills: DispatchSkillDescriptor[];
  settings: DispatchSkillSettings;
}

function parseDurableDispatchSelections(
  value: unknown,
): Record<number, ModuleDispatchSelection> {
  if (!Array.isArray(value)) return {};
  return value.reduce<Record<number, ModuleDispatchSelection>>((selections, candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return selections;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.moduleIndex !== 'number'
      || !Number.isInteger(record.moduleIndex)
      || record.moduleIndex < 0
      || !isDispatchPermissionScope(record.permissionScope)
      || !isDispatchDisturbanceLevel(record.disturbanceLevel)
    ) {
      return selections;
    }
    selections[record.moduleIndex] = {
      permissionScope: record.permissionScope,
      disturbanceLevel: record.disturbanceLevel,
    };
    return selections;
  }, {});
}

function parseDurableModuleRouteSelections(
  value: unknown,
): Record<number, ModuleRouteSelection> {
  if (!Array.isArray(value)) return {};
  return value.reduce<Record<number, ModuleRouteSelection>>((selections, candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return selections;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.moduleIndex !== 'number'
      || !Number.isInteger(record.moduleIndex)
      || record.moduleIndex < 0
    ) {
      return selections;
    }
    const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
    const model = typeof record.model === 'string' ? record.model.trim() : '';
    const modelId = toProviderQualifiedModelId(provider, model);
    if (!modelId) return selections;
    const effortLevel = isPlanEffortLevel(record.effortLevel)
      ? record.effortLevel.trim() as PlanEffortLevel
      : undefined;
    selections[record.moduleIndex] = {
      model: modelId,
      ...(effortLevel ? { effortLevel } : {}),
    };
    return selections;
  }, {});
}

function parseDurableSkillSelections(
  value: unknown,
): Record<number, DispatchSkillSelection> {
  if (!Array.isArray(value)) return {};
  return value.reduce<Record<number, DispatchSkillSelection>>((selections, candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return selections;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.moduleIndex !== 'number'
      || !Number.isInteger(record.moduleIndex)
      || record.moduleIndex < 0
    ) {
      return selections;
    }
    const skillBundleName = getOptionalSkillBundleName(record.skillBundleName);
    const hasSkillIdsField = Array.isArray(record.skillIds);
    const skillIds = getSkillIds(record.skillIds);
    if (!skillBundleName && !hasSkillIdsField) {
      return selections;
    }
    selections[record.moduleIndex] = {
      ...(skillBundleName ? { skillBundleName } : {}),
      skillIds,
    };
    return selections;
  }, {});
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

function getNativePlanFilePath(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const path = (value as Record<string, unknown>).planFilePath;
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

function useSessionAgentRole(sessionId: string): SessionAgentRole {
  const [agentRole, setAgentRole] = useState<SessionAgentRole>(null);

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

  return agentRole;
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

function getEffortLevel(value: unknown): SelectedPlanCandidate['effortLevel'] | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim() as SelectedPlanCandidate['effortLevel']
    : undefined;
}

function getOptionalEffortLevel(
  value: unknown,
): SelectedPlanCandidate['effortLevel'] | '' {
  return getDisplayString(value, '') as SelectedPlanCandidate['effortLevel'] | '';
}

function getPlanWorkerIntent(
  value: unknown,
  fallback: PlanWorkerIntent = 'implementation',
): PlanWorkerIntent {
  return value === 'investigation' || value === 'implementation'
    ? value
    : fallback;
}

function getOptionalPermissionScope(
  value: unknown,
): DispatchPermissionScope | undefined {
  return isDispatchPermissionScope(value) ? value : undefined;
}

function getOptionalDisturbanceLevel(
  value: unknown,
): DispatchDisturbanceLevel | undefined {
  return isDispatchDisturbanceLevel(value) ? value : undefined;
}

function getOptionalSkillBundleName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getSkillIds(value: unknown): string[] {
  return getDisplayStringList(value);
}

function getSuggestedDispatchPermission(
  module: Pick<RenderModule, 'intent' | 'permissionScope' | 'disturbanceLevel'>,
): DispatchPermissionKnobs {
  const defaults = getDefaultDispatchPermissionKnobs(module.intent);
  return {
    permissionScope: module.permissionScope ?? defaults.permissionScope,
    disturbanceLevel: module.disturbanceLevel ?? defaults.disturbanceLevel,
  };
}

function getSuggestedDispatchSkillSelection(
  module: { skillBundleName?: string; skillIds: string[]; hasSkillSelection: boolean },
): DispatchSkillSelection | undefined {
  if (!module.hasSkillSelection) return undefined;
  return {
    ...(module.skillBundleName ? { skillBundleName: module.skillBundleName } : {}),
    skillIds: module.skillIds,
  };
}

function getBundleByNameOrId(
  settings: DispatchSkillSettings,
  bundleNameOrId: string | undefined,
) {
  if (!bundleNameOrId) return undefined;
  return settings.bundles.find(
    (bundle) => bundle.id === bundleNameOrId || bundle.name === bundleNameOrId,
  );
}

function getProviderGrantableSkills(
  skills: DispatchSkillDescriptor[],
  settings: DispatchSkillSettings,
  provider: string,
): DispatchSkillDescriptor[] {
  const engine = getDispatchSkillEngineForProvider(provider);
  return filterEnabledDispatchSkills(skills, settings).filter(
    (skill) => !engine || skill.engine === engine,
  );
}

function expandDispatchSkillSelection(
  selection: DispatchSkillSelection | undefined,
  provider: string,
  library: DispatchSkillLibraryState,
): DispatchSkillSelection {
  if (!selection) {
    return {
      skillIds: getProviderGrantableSkills(library.skills, library.settings, provider)
        .map((skill) => skill.id),
    };
  }
  const bundle = getBundleByNameOrId(library.settings, selection.skillBundleName);
  const idsFromSelection = selection.skillIds.length > 0;
  const rawSkillIds = idsFromSelection
    ? selection.skillIds
    : bundle?.skillIds ?? [];
  const grantableIds = new Set(
    getProviderGrantableSkills(library.skills, library.settings, provider).map(
      (skill) => skill.id,
    ),
  );
  return {
    ...(selection.skillBundleName ? { skillBundleName: selection.skillBundleName } : {}),
    skillIds: rawSkillIds.filter((id) => grantableIds.has(id)),
  };
}

function getUnfilteredDispatchSkillSelection(
  selection: DispatchSkillSelection | undefined,
  library: DispatchSkillLibraryState,
): DispatchSkillSelection | undefined {
  if (!selection) return undefined;
  const bundle = getBundleByNameOrId(library.settings, selection.skillBundleName);
  const skillIds = selection.skillIds.length > 0 || !bundle
    ? selection.skillIds
    : bundle.skillIds;
  return {
    ...(selection.skillBundleName ? { skillBundleName: selection.skillBundleName } : {}),
    skillIds: [...new Set(skillIds)],
  };
}

function getUnavailableSkillNotice(
  selection: DispatchSkillSelection | undefined,
  provider: string,
  skillsById: Map<string, DispatchSkillDescriptor>,
  library: DispatchSkillLibraryState,
): string | undefined {
  const engine = getDispatchSkillEngineForProvider(provider);
  const rawSelection = getUnfilteredDispatchSkillSelection(selection, library);
  if (!engine || !rawSelection) return undefined;
  const unavailableSkills = rawSelection.skillIds.flatMap((skillId) => {
    const skill = skillsById.get(skillId);
    return skill && skill.engine !== engine ? [skill] : [];
  });
  if (unavailableSkills.length === 0) return undefined;
  const engineNames = [...new Set(unavailableSkills.map((skill) => skill.engine))]
    .map((name) => (name === 'claude' ? 'Claude' : name === 'codex' ? 'Codex' : 'Gemini'))
    .join('、');
  return `${unavailableSkills.length} 个技能在当前引擎不可用（换回 ${engineNames} 引擎会恢复）`;
}

function formatSkillSelection(
  selection: DispatchSkillSelection,
  skillsById: Map<string, DispatchSkillDescriptor>,
): string {
  if (selection.skillIds.length === 0) {
    return selection.skillBundleName ? `${selection.skillBundleName}（空）` : '不授予';
  }
  const names = selection.skillIds.map((id) => skillsById.get(id)?.name ?? id);
  return `${selection.skillBundleName ? `${selection.skillBundleName}：` : ''}${names.join('、')}`;
}

function parsePlanModules(value: unknown): RenderModule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (value): value is Record<string, unknown> =>
        !!value && typeof value === 'object',
    )
    .map((module, moduleIndex) => {
      const intent = getPlanWorkerIntent(module.intent);
      const skillBundleName = getOptionalSkillBundleName(module.skillBundleName);
      const hasSkillIds = Array.isArray(module.skillIds);
      return {
        title: getDisplayString(module.title, `模块 ${moduleIndex + 1}`),
        outputFiles: getDisplayStringList(module.outputFiles),
        inputs: getDisplayStringList(module.inputs),
        provider: getDisplayString(module.provider),
        model: getDisplayString(module.model, ''),
        modelCatalogPending: module.modelCatalogPending === true,
        effortLevel: getOptionalEffortLevel(module.effortLevel),
        intent,
        ...(getOptionalPermissionScope(module.permissionScope)
          ? { permissionScope: getOptionalPermissionScope(module.permissionScope) }
          : {}),
        ...(getOptionalDisturbanceLevel(module.disturbanceLevel)
          ? { disturbanceLevel: getOptionalDisturbanceLevel(module.disturbanceLevel) }
          : {}),
        ...(skillBundleName
          ? { skillBundleName }
          : {}),
        skillIds: getSkillIds(module.skillIds),
        hasSkillSelection: Boolean(skillBundleName) || hasSkillIds,
        doneCriteria: getDisplayString(module.doneCriteria),
        candidates: Array.isArray(module.candidates)
          ? module.candidates
              .filter(
                (candidate): candidate is Record<string, unknown> =>
                  !!candidate && typeof candidate === 'object',
              )
              .map((candidate) => {
                const skillBundleName = getOptionalSkillBundleName(candidate.skillBundleName);
                const hasSkillIds = Array.isArray(candidate.skillIds);
                return {
                  name: getDisplayString(candidate.name, '未命名方案'),
                  approach: getDisplayString(candidate.approach),
                  pros: getStructuredText(candidate.pros),
                  cons: getStructuredText(candidate.cons),
                  risks: getStructuredText(candidate.risks),
                  provider: getDisplayString(candidate.provider),
                  model: getDisplayString(candidate.model),
                  intent: getPlanWorkerIntent(candidate.intent, intent),
                  ...(getEffortLevel(candidate.effortLevel)
                    ? { effortLevel: getEffortLevel(candidate.effortLevel) }
                    : {}),
                  ...(getOptionalPermissionScope(candidate.permissionScope)
                    ? { permissionScope: getOptionalPermissionScope(candidate.permissionScope) }
                    : {}),
                  ...(getOptionalDisturbanceLevel(candidate.disturbanceLevel)
                    ? { disturbanceLevel: getOptionalDisturbanceLevel(candidate.disturbanceLevel) }
                    : {}),
                  ...(skillBundleName ? { skillBundleName } : {}),
                  skillIds: getSkillIds(candidate.skillIds),
                  hasSkillSelection: Boolean(skillBundleName) || hasSkillIds,
                };
              })
          : [],
      };
    });
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

function isPlanEffortLevel(value: unknown): value is PlanEffortLevel {
  return typeof value === 'string' && value.trim().length > 0;
}

function toProviderQualifiedModelId(provider: string, model: string): string {
  const normalizedModel = model.trim();
  if (!normalizedModel || normalizedModel === '未提供') return '';
  if (normalizedModel.includes(':')) return normalizedModel;
  const normalizedProvider = provider.trim();
  return normalizedProvider && normalizedProvider !== '未提供'
    ? `${normalizedProvider}:${normalizedModel}`
    : '';
}

function isLiveCatalogStatus(status: PlanCatalogStatus | undefined): boolean {
  if (!status) return true;
  return status.modelSource === 'runtime'
    && status.verified === true
    && !status.lastError;
}

function parseLiveCatalogModels(value: unknown): PlanCatalogModel[] | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Record<string, unknown>;
  if (response.success !== true || !response.grouped || typeof response.grouped !== 'object') {
    return null;
  }
  const statuses = response.catalogStatuses && typeof response.catalogStatuses === 'object'
    ? response.catalogStatuses as Record<string, PlanCatalogStatus>
    : {};
  const uniqueModels = new Map<string, PlanCatalogModel>();
  for (const [groupedProvider, models] of Object.entries(
    response.grouped as Record<string, unknown>,
  )) {
    if (!Array.isArray(models)) {
      continue;
    }
    for (const model of models) {
      if (!model || typeof model !== 'object') continue;
      const record = model as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const provider = typeof record.provider === 'string'
        ? record.provider.trim()
        : groupedProvider;
      if (!isLiveCatalogStatus(statuses[provider])) continue;
      const providerPrefix = `${provider}:`;
      if (!id || !provider || !id.startsWith(providerPrefix)) continue;
      const supportedEffortLevels = Array.isArray(record.supportedEffortLevels)
        ? Array.from(new Set(record.supportedEffortLevels
          .filter(isPlanEffortLevel)
          .map((level) => level.trim())))
        : [];
      const defaultEffortLevel = isPlanEffortLevel(record.defaultEffortLevel)
        && supportedEffortLevels.includes(record.defaultEffortLevel)
        ? record.defaultEffortLevel
        : undefined;
      uniqueModels.set(id, {
        id,
        provider,
        supportedEffortLevels,
        ...(defaultEffortLevel ? { defaultEffortLevel } : {}),
      });
    }
  }
  return [...uniqueModels.values()];
}

function resolveModuleEffortLevel(
  model: PlanCatalogModel | undefined,
  requestedEffort: unknown,
): PlanEffortLevel | null {
  if (!model || model.supportedEffortLevels.length === 0) return null;
  if (
    isPlanEffortLevel(requestedEffort)
    && model.supportedEffortLevels.includes(requestedEffort)
  ) {
    return requestedEffort;
  }
  if (
    model.defaultEffortLevel
    && model.supportedEffortLevels.includes(model.defaultEffortLevel)
  ) {
    return model.defaultEffortLevel;
  }
  return model.supportedEffortLevels[0] ?? null;
}

function isSameModuleRoute(
  module: RenderModule,
  route: ResolvedModuleRoute,
): boolean {
  return route.provider === module.provider
    && route.model === toProviderQualifiedModelId(module.provider, module.model)
    && (route.effortLevel ?? '') === module.effortLevel;
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

interface RedispatchWorkOrderParameters {
  provider: string;
  model: string;
  effortLevel?: PlanEffortLevel;
  prompt: string;
  permissionScope: DispatchPermissionScope;
  disturbanceLevel: DispatchDisturbanceLevel;
  skillBundleName?: string;
  skillIds: string[];
}

interface RedispatchWorkOrderArgs {
  redispatchRequestId: string;
  trackerItemId: string;
  title: string;
  attemptCount: number;
  failureReason?: string;
  changeSummary?: string;
  original: RedispatchWorkOrderParameters;
  suggested: RedispatchWorkOrderParameters;
}

function readRedispatchParameters(
  value: unknown,
): RedispatchWorkOrderParameters | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const provider = getDisplayString(record.provider, '');
  const model = getDisplayString(record.model, '');
  const prompt = getDisplayString(record.prompt, '');
  if (
    !provider
    || !model
    || !prompt
    || !isDispatchPermissionScope(record.permissionScope)
    || !isDispatchDisturbanceLevel(record.disturbanceLevel)
  ) {
    return null;
  }
  const effortLevel = getEffortLevel(record.effortLevel);
  const skillBundleName = getOptionalSkillBundleName(record.skillBundleName);
  return {
    provider,
    model,
    ...(effortLevel ? { effortLevel } : {}),
    prompt,
    permissionScope: record.permissionScope,
    disturbanceLevel: record.disturbanceLevel,
    ...(skillBundleName ? { skillBundleName } : {}),
    skillIds: getSkillIds(record.skillIds),
  };
}

function getRedispatchWorkOrderArgs(value: unknown): RedispatchWorkOrderArgs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const redispatchRequestId = getDisplayString(record.redispatchRequestId, '');
  const trackerItemId = getDisplayString(record.trackerItemId, '');
  const title = getDisplayString(record.title, '');
  const original = readRedispatchParameters(record.original);
  const suggested = readRedispatchParameters(record.suggested);
  if (!redispatchRequestId || !trackerItemId || !title || !original || !suggested) {
    return null;
  }
  const attemptCount =
    typeof record.attemptCount === 'number' && Number.isSafeInteger(record.attemptCount)
      ? record.attemptCount
      : 0;
  const failureReason = getDisplayString(record.failureReason, '');
  const changeSummary = getDisplayString(record.changeSummary, '');
  return {
    redispatchRequestId,
    trackerItemId,
    title,
    attemptCount,
    ...(failureReason ? { failureReason } : {}),
    ...(changeSummary ? { changeSummary } : {}),
    original,
    suggested,
  };
}

function parseRedispatchResult(value: unknown): { approved: boolean } | null {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.approved === true) return { approved: true };
    if (record.approved === false) return { approved: false };
  } catch {
    return null;
  }
  return null;
}

function formatRedispatchParameter(
  parameters: RedispatchWorkOrderParameters,
  field: keyof RedispatchWorkOrderParameters,
  skillsById: Map<string, DispatchSkillDescriptor>,
): string {
  if (field === 'permissionScope') {
    return getDispatchPermissionScopeLabel(parameters.permissionScope);
  }
  if (field === 'disturbanceLevel') {
    return getDispatchDisturbanceLevelLabel(parameters.disturbanceLevel);
  }
  if (field === 'skillIds') {
    return formatSkillSelection(parameters, skillsById);
  }
  const value = parameters[field];
  if (Array.isArray(value)) return value.join('、') || '不授予';
  return typeof value === 'string' && value.trim() ? value.trim() : '未提供';
}

const RedispatchTrace: React.FC<{
  label: string;
  original: string;
  suggested: string;
  current: string;
  testId: string;
}> = ({ label, original, suggested, current, testId }) => (
  <div data-testid={testId} className="min-w-0">
    <dt className="text-xs font-semibold text-nim-muted">{label}</dt>
    <dd className="mt-1 min-w-0 text-[13px] text-nim">
      <div className="break-words text-nim-muted">原参数：{original}</div>
      <div className="break-words">
        Head 建议：{suggested} → 当前：{current}
      </div>
    </dd>
  </div>
);

export const RedispatchWorkOrderWidget: React.FC<CustomToolWidgetProps> = (props) => {
  const args = getRedispatchWorkOrderArgs(props.message.toolCall?.arguments);
  const { message, sessionId, workspacePath } = props;
  const toolCall = message.toolCall;
  const host = useAtomValue(interactiveWidgetHostAtom(sessionId));
  const effectiveWorkspacePath = workspacePath || host?.workspacePath;
  const [modelCatalog, setModelCatalog] = useState<PlanCatalogState>({
    status: (
      window as unknown as {
        electronAPI?: { aiGetModels?: () => Promise<unknown> };
      }
    ).electronAPI?.aiGetModels ? 'loading' : 'failed',
    models: [],
  });
  const [skillLibrary, setSkillLibrary] = useState<DispatchSkillLibraryState>({
    status: 'loading',
    skills: [],
    settings: readDispatchSkillSettings(undefined),
  });
  const [routeSelection, setRouteSelection] = useState<ModuleRouteSelection>({
    model: args?.suggested.model ?? '',
    ...(args?.suggested.effortLevel ? { effortLevel: args.suggested.effortLevel } : {}),
  });
  const [dispatchSelection, setDispatchSelection] = useState<ModuleDispatchSelection>({
    permissionScope: args?.suggested.permissionScope ?? 'workspace-write',
    disturbanceLevel: args?.suggested.disturbanceLevel ?? 'on-failure',
  });
  const [skillSelection, setSkillSelection] = useState<DispatchSkillSelection>({
    ...(args?.suggested.skillBundleName ? { skillBundleName: args.suggested.skillBundleName } : {}),
    skillIds: args?.suggested.skillIds ?? [],
  });
  const [prompt, setPrompt] = useState(args?.suggested.prompt ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localResult, setLocalResult] = useState<{ approved: boolean } | null>(null);

  useEffect(() => {
    if (!args) return;
    setRouteSelection({
      model: args.suggested.model,
      ...(args.suggested.effortLevel ? { effortLevel: args.suggested.effortLevel } : {}),
    });
    setDispatchSelection({
      permissionScope: args.suggested.permissionScope,
      disturbanceLevel: args.suggested.disturbanceLevel,
    });
    setSkillSelection({
      ...(args.suggested.skillBundleName ? { skillBundleName: args.suggested.skillBundleName } : {}),
      skillIds: args.suggested.skillIds,
    });
    setPrompt(args.suggested.prompt);
    setLocalResult(null);
  }, [args?.redispatchRequestId]);

  useEffect(() => {
    let disposed = false;
    const loadModels = (
      window as unknown as {
        electronAPI?: { aiGetModels?: () => Promise<unknown> };
      }
    ).electronAPI?.aiGetModels;
    if (!loadModels) return undefined;
    setModelCatalog({ status: 'loading', models: [] });
    void loadModels()
      .then((response) => {
        if (disposed) return;
        const models = parseLiveCatalogModels(response);
        setModelCatalog(
          models === null
            ? { status: 'failed', models: [] }
            : { status: 'ready', models },
        );
      })
      .catch(() => {
        if (!disposed) setModelCatalog({ status: 'failed', models: [] });
      });
    return () => {
      disposed = true;
    };
  }, [args?.redispatchRequestId]);

  useEffect(() => {
    let disposed = false;
    const invoke = window.electronAPI?.invoke;
    if (!invoke) {
      setSkillLibrary({
        status: 'ready',
        skills: [],
        settings: readDispatchSkillSettings(undefined),
      });
      return undefined;
    }
    setSkillLibrary((current) => ({ ...current, status: 'loading' }));
    void Promise.all([
      invoke('dispatch-skills:list', effectiveWorkspacePath),
      invoke('app-settings:get', DISPATCH_SKILL_SETTINGS_KEY),
    ])
      .then(([listResult, stored]) => {
        if (disposed) return;
        const skills = Array.isArray(listResult?.skills) ? listResult.skills : [];
        const settings = sanitizeDispatchSkillSettingsForLibrary(
          readDispatchSkillSettings(stored),
          skills,
        );
        setSkillLibrary({ status: 'ready', skills, settings });
      })
      .catch(() => {
        if (!disposed) {
          setSkillLibrary((current) => ({ ...current, status: 'failed' }));
        }
      });
    return () => {
      disposed = true;
    };
  }, [args?.redispatchRequestId, effectiveWorkspacePath]);

  const completedResult = localResult ?? parseRedispatchResult(toolCall?.result);
  const isPending = !completedResult && toolCall?.status === 'running';
  const catalogModelsById = useMemo(
    () => new Map(modelCatalog.models.map((model) => [model.id, model])),
    [modelCatalog.models],
  );
  const skillsById = useMemo(
    () => new Map(skillLibrary.skills.map((skill) => [skill.id, skill])),
    [skillLibrary.skills],
  );
  const routeModel = catalogModelsById.get(routeSelection.model);
  const route = routeModel
    ? {
        provider: routeModel.provider,
        model: routeModel.id,
        ...(resolveModuleEffortLevel(routeModel, routeSelection.effortLevel)
          ? { effortLevel: resolveModuleEffortLevel(routeModel, routeSelection.effortLevel)! }
          : {}),
      }
    : null;
  const dispatchCapabilities = getDispatchPermissionCapabilities(
    route?.provider ?? args?.suggested.provider ?? '',
  );
  const dispatchPermission = resolveDispatchPermission(
    route?.provider ?? args?.suggested.provider ?? '',
    dispatchSelection,
  );
  const resolvedSkillSelection = expandDispatchSkillSelection(
    skillSelection,
    route?.provider ?? args?.suggested.provider ?? '',
    skillLibrary,
  );
  const grantableSkills = getProviderGrantableSkills(
    skillLibrary.skills,
    skillLibrary.settings,
    route?.provider ?? args?.suggested.provider ?? '',
  );
  const selectedSkills = resolvedSkillSelection.skillIds
    .map((skillId) => skillsById.get(skillId))
    .filter((skill): skill is DispatchSkillDescriptor => Boolean(skill));
  const addableSkills = grantableSkills.filter(
    (skill) => !resolvedSkillSelection.skillIds.includes(skill.id),
  );
  const selectedBundle = getBundleByNameOrId(
    skillLibrary.settings,
    resolvedSkillSelection.skillBundleName,
  );
  const electronInvoke = window.electronAPI?.invoke;

  const handleModelChange = useCallback((modelId: string) => {
    const model = catalogModelsById.get(modelId);
    if (!model) {
      setRouteSelection({ model: '' });
      return;
    }
    const effortLevel = resolveModuleEffortLevel(model, undefined);
    setRouteSelection({
      model: model.id,
      ...(effortLevel ? { effortLevel } : {}),
    });
  }, [catalogModelsById]);

  const handleEffortChange = useCallback((effortLevel: string) => {
    const model = catalogModelsById.get(routeSelection.model);
    if (!model || !isPlanEffortLevel(effortLevel)) return;
    if (!model.supportedEffortLevels.includes(effortLevel)) return;
    setRouteSelection((current) => ({
      model: current.model,
      effortLevel,
    }));
  }, [catalogModelsById, routeSelection.model]);

  const handleSkillBundleChange = useCallback((bundleId: string) => {
    if (bundleId === '') {
      setSkillSelection({ skillIds: [] });
      return;
    }
    const bundle = skillLibrary.settings.bundles.find((item) => item.id === bundleId);
    if (!bundle) return;
    setSkillSelection(expandDispatchSkillSelection(
      { skillBundleName: bundle.name, skillIds: bundle.skillIds },
      route?.provider ?? args?.suggested.provider ?? '',
      skillLibrary,
    ));
  }, [args?.suggested.provider, route?.provider, skillLibrary]);

  const handleSkillRemove = useCallback((skillId: string) => {
    setSkillSelection((current) => ({
      ...(current.skillBundleName ? { skillBundleName: current.skillBundleName } : {}),
      skillIds: current.skillIds.filter((id) => id !== skillId),
    }));
  }, []);

  const handleSkillAdd = useCallback((skillId: string) => {
    if (!skillId) return;
    setSkillSelection((current) => current.skillIds.includes(skillId)
      ? current
      : {
          ...(current.skillBundleName ? { skillBundleName: current.skillBundleName } : {}),
          skillIds: [...current.skillIds, skillId],
        });
  }, []);

  const submitDecision = useCallback(async (approved: boolean) => {
    const invoke = electronInvoke;
    if (!args || !effectiveWorkspacePath || !invoke || isSubmitting || completedResult) return;
    const requestId = args.redispatchRequestId;
    setIsSubmitting(true);
    try {
      const channel = approved
        ? 'meta-agent:approve-redispatch-request'
        : 'meta-agent:reject-redispatch-request';
      const payload = approved
        ? {
            workspaceId: effectiveWorkspacePath,
            requestId,
            trackerItemId: args.trackerItemId,
            provider: route?.provider ?? args.suggested.provider,
            model: route?.model ?? routeSelection.model,
            ...(route?.effortLevel ? { effortLevel: route.effortLevel } : {}),
            prompt,
            permissionScope: dispatchPermission.requested.permissionScope,
            disturbanceLevel: dispatchPermission.requested.disturbanceLevel,
            ...(resolvedSkillSelection.skillBundleName
              ? { skillBundleName: resolvedSkillSelection.skillBundleName }
              : {}),
            skillIds: resolvedSkillSelection.skillIds,
          }
        : {
            workspaceId: effectiveWorkspacePath,
            requestId,
            trackerItemId: args.trackerItemId,
            reason: 'Owner rejected redispatch.',
          };
      const response = await invoke(channel, payload);
      if (!response?.success) {
        throw new Error(response?.error || 'Redispatch response failed');
      }
      setLocalResult({ approved });
    } catch (error) {
      console.error('[RedispatchWorkOrderWidget] Failed to submit redispatch response:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    args,
    completedResult,
    dispatchPermission.requested.disturbanceLevel,
    dispatchPermission.requested.permissionScope,
    electronInvoke,
    effectiveWorkspacePath,
    isSubmitting,
    prompt,
    resolvedSkillSelection.skillBundleName,
    resolvedSkillSelection.skillIds,
    route?.effortLevel,
    route?.model,
    route?.provider,
    routeSelection.model,
  ]);

  if (!args || !toolCall) {
    return (
      <InteractivePromptStatusCard
        testId="redispatch-work-order-status"
        title="Redispatch approval"
        status="unavailable"
        detail="重派确认卡参数无效。"
      />
    );
  }

  const routeModelUnavailable = modelCatalog.status !== 'ready' || !route;
  const currentParameters: RedispatchWorkOrderParameters = {
    provider: route?.provider ?? args.suggested.provider,
    model: route?.model ?? routeSelection.model,
    ...(route?.effortLevel ? { effortLevel: route.effortLevel } : {}),
    prompt,
    permissionScope: dispatchPermission.requested.permissionScope,
    disturbanceLevel: dispatchPermission.requested.disturbanceLevel,
    ...(resolvedSkillSelection.skillBundleName
      ? { skillBundleName: resolvedSkillSelection.skillBundleName }
      : {}),
    skillIds: resolvedSkillSelection.skillIds,
  };

  return (
    <div
      data-testid="redispatch-work-order-widget"
      data-state={completedResult ? (completedResult.approved ? 'approved' : 'rejected') : 'pending'}
      className="plan-approval-widget rounded-lg overflow-visible border border-nim-primary bg-nim-secondary"
    >
      <div className="flex items-start justify-between gap-3 border-b border-nim bg-nim-tertiary px-4 py-3">
        <div className="min-w-0">
          <div className="mb-1 text-xs font-medium text-nim">Redispatch approval</div>
          <div className="break-words text-sm font-semibold text-nim">{args.title}</div>
          <div className="mt-1 text-xs text-nim-muted">
            工单 {args.trackerItemId} · attempts {args.attemptCount}
          </div>
        </div>
        <span className="shrink-0 text-xs text-nim-muted">
          {completedResult
            ? completedResult.approved ? 'Redispatch approved' : 'Redispatch rejected'
            : 'Awaiting review'}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {args.failureReason && (
          <div
            data-testid="redispatch-failure-reason"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs leading-5 text-nim"
          >
            {args.failureReason}
          </div>
        )}
        {args.changeSummary && (
          <div
            data-testid="redispatch-change-summary"
            className="rounded-md bg-nim-tertiary p-3 text-xs leading-5 text-nim-muted"
          >
            {args.changeSummary}
          </div>
        )}

        <dl
          data-testid="redispatch-param-grid"
          className="plan-module-fields text-[13px]"
        >
          <RedispatchTrace
            label="引擎"
            testId="redispatch-provider-trace"
            original={args.original.provider}
            suggested={args.suggested.provider}
            current={currentParameters.provider}
          />
          <div data-testid="redispatch-model-field" className="plan-module-model-field min-w-0">
            <dt className="text-xs font-semibold text-nim-muted">模型</dt>
            <dd className="mt-1 min-w-0">
              <div className="mb-1 break-words text-xs text-nim-muted">
                原参数：{args.original.model}
              </div>
              <select
                data-testid="redispatch-model-select"
                aria-label="重派模型"
                value={route?.model ?? ''}
                onChange={(event) => handleModelChange(event.target.value)}
                disabled={isSubmitting || completedResult !== null || modelCatalog.status !== 'ready'}
                className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">请选择模型</option>
                {modelCatalog.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
              <p data-testid="redispatch-model-trace" className="mt-1 text-xs text-nim-muted">
                Head 建议：{args.suggested.model} → 当前：{currentParameters.model || '未选择'}
              </p>
            </dd>
          </div>
          {routeModel && routeModel.supportedEffortLevels.length > 0 ? (
            <div data-testid="redispatch-effort-field" className="plan-module-effort-field min-w-0">
              <dt className="text-xs font-semibold text-nim-muted">思考强度</dt>
              <dd className="mt-1 min-w-0">
                <div className="mb-1 break-words text-xs text-nim-muted">
                  原参数：{args.original.effortLevel ?? '未提供'}
                </div>
                <select
                  data-testid="redispatch-effort-select"
                  aria-label="重派思考强度"
                  value={route?.effortLevel ?? ''}
                  onChange={(event) => handleEffortChange(event.target.value)}
                  disabled={isSubmitting || completedResult !== null}
                  className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {routeModel.supportedEffortLevels.map((effortLevel) => (
                    <option key={effortLevel} value={effortLevel}>
                      {effortLevel}
                    </option>
                  ))}
                </select>
                <p data-testid="redispatch-effort-trace" className="mt-1 text-xs text-nim-muted">
                  Head 建议：{args.suggested.effortLevel ?? '未提供'} → 当前：{currentParameters.effortLevel ?? '未提供'}
                </p>
              </dd>
            </div>
          ) : (
            <RedispatchTrace
              label="思考强度"
              testId="redispatch-effort-trace"
              original={args.original.effortLevel ?? '未提供'}
              suggested={args.suggested.effortLevel ?? '未提供'}
              current={currentParameters.effortLevel ?? '未提供'}
            />
          )}
          <div data-testid="redispatch-permission-scope-field" className="min-w-0">
            <dt className="text-xs font-semibold text-nim-muted">权限范围</dt>
            <dd className="mt-1 min-w-0">
              <div className="mb-1 break-words text-xs text-nim-muted">
                原参数：{getDispatchPermissionScopeLabel(args.original.permissionScope)}
              </div>
              <select
                data-testid="redispatch-permission-scope-select"
                aria-label="重派权限范围"
                value={
                  dispatchCapabilities.permissionScopes.includes(dispatchPermission.effective.permissionScope)
                    ? dispatchPermission.effective.permissionScope
                    : ''
                }
                onChange={(event) => {
                  const permissionScope = event.target.value;
                  if (!isDispatchPermissionScope(permissionScope)) return;
                  setDispatchSelection((current) => ({
                    permissionScope,
                    disturbanceLevel: current.disturbanceLevel,
                  }));
                }}
                disabled={isSubmitting || completedResult !== null || dispatchCapabilities.permissionScopes.length === 0}
                className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {dispatchCapabilities.permissionScopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {getDispatchPermissionScopeLabel(scope)}
                  </option>
                ))}
              </select>
              <p data-testid="redispatch-permission-scope-trace" className="mt-1 text-xs text-nim-muted">
                Head 建议：{getDispatchPermissionScopeLabel(args.suggested.permissionScope)} → 当前：{getDispatchPermissionScopeLabel(currentParameters.permissionScope)}
              </p>
            </dd>
          </div>
          <div data-testid="redispatch-disturbance-level-field" className="min-w-0">
            <dt className="text-xs font-semibold text-nim-muted">打扰程度</dt>
            <dd className="mt-1 min-w-0">
              <div className="mb-1 break-words text-xs text-nim-muted">
                原参数：{getDispatchDisturbanceLevelLabel(args.original.disturbanceLevel)}
              </div>
              <select
                data-testid="redispatch-disturbance-level-select"
                aria-label="重派打扰程度"
                value={
                  dispatchCapabilities.disturbanceLevels.includes(dispatchPermission.effective.disturbanceLevel)
                    ? dispatchPermission.effective.disturbanceLevel
                    : ''
                }
                onChange={(event) => {
                  const disturbanceLevel = event.target.value;
                  if (!isDispatchDisturbanceLevel(disturbanceLevel)) return;
                  setDispatchSelection((current) => ({
                    permissionScope: current.permissionScope,
                    disturbanceLevel,
                  }));
                }}
                disabled={isSubmitting || completedResult !== null || dispatchCapabilities.disturbanceLevels.length === 0}
                className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {dispatchCapabilities.disturbanceLevels.map((level) => (
                  <option key={level} value={level}>
                    {getDispatchDisturbanceLevelLabel(level)}
                  </option>
                ))}
              </select>
              <p data-testid="redispatch-disturbance-level-trace" className="mt-1 text-xs text-nim-muted">
                Head 建议：{getDispatchDisturbanceLevelLabel(args.suggested.disturbanceLevel)} → 当前：{getDispatchDisturbanceLevelLabel(currentParameters.disturbanceLevel)}
              </p>
              {dispatchPermission.notice && (
                <p data-testid="redispatch-dispatch-downgrade" className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                  {dispatchPermission.notice}
                </p>
              )}
            </dd>
          </div>
          <div data-testid="redispatch-skill-field" className="plan-module-skill-field min-w-0">
            <dt className="text-xs font-semibold text-nim-muted">技能</dt>
            <dd className="mt-1 min-w-0">
              <div className="mb-1 break-words text-xs text-nim-muted">
                原参数：{formatRedispatchParameter(args.original, 'skillIds', skillsById)}
              </div>
              <select
                data-testid="redispatch-skill-bundle-select"
                aria-label="重派技能包"
                value={selectedBundle?.id ?? ''}
                onChange={(event) => handleSkillBundleChange(event.target.value)}
                disabled={isSubmitting || completedResult !== null || skillLibrary.status === 'loading'}
                className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">不授予</option>
                {skillLibrary.settings.bundles.map((bundle) => (
                  <option key={bundle.id} value={bundle.id}>
                    {bundle.name}
                  </option>
                ))}
              </select>
              <div data-testid="redispatch-skill-tags" className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                {selectedSkills.length > 0 ? selectedSkills.map((skill) => (
                  <span
                    key={skill.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-nim bg-nim-secondary px-2 py-0.5 text-xs text-nim"
                  >
                    <span className="truncate">{skill.name}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${skill.name}`}
                      disabled={isSubmitting || completedResult !== null}
                      onClick={() => handleSkillRemove(skill.id)}
                      className="text-nim-muted hover:text-nim disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ×
                    </button>
                  </span>
                )) : (
                  <span className="text-xs text-nim-muted">不授予任何技能</span>
                )}
              </div>
              <select
                data-testid="redispatch-skill-add-select"
                aria-label="重派添加技能"
                value=""
                onChange={(event) => {
                  handleSkillAdd(event.target.value);
                  event.currentTarget.value = '';
                }}
                disabled={isSubmitting || completedResult !== null || addableSkills.length === 0}
                className="mt-2 w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">搜索添加技能</option>
                {addableSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
              <p data-testid="redispatch-skill-trace" className="mt-1 text-xs text-nim-muted">
                Head 建议：{formatRedispatchParameter(args.suggested, 'skillIds', skillsById)} → 当前：{formatSkillSelection(resolvedSkillSelection, skillsById)}
              </p>
              {(route?.provider ?? args.suggested.provider) === 'openai-codex' && (
                <p data-testid="redispatch-skill-codex-notice" className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                  {CODEX_SKILL_CONTROL_NOTICE}
                </p>
              )}
            </dd>
          </div>
          <div data-testid="redispatch-prompt-field" className="plan-module-done-criteria min-w-0">
            <dt className="text-xs font-semibold text-nim-muted">任务书</dt>
            <dd className="mt-1 min-w-0">
              <div className="mb-1 whitespace-pre-wrap break-words text-xs text-nim-muted">
                原参数：{args.original.prompt}
              </div>
              <textarea
                data-testid="redispatch-prompt-input"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                disabled={isSubmitting || completedResult !== null}
                className="w-full resize-y rounded-md border border-nim bg-nim-secondary px-3 py-2 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p data-testid="redispatch-prompt-trace" className="mt-1 whitespace-pre-wrap break-words text-xs text-nim-muted">
                Head 建议：{args.suggested.prompt} → 当前：{currentParameters.prompt || '未提供'}
              </p>
            </dd>
          </div>
        </dl>

        {routeModelUnavailable && isPending && (
          <div data-testid="redispatch-model-invalid" className="text-xs text-amber-800 dark:text-amber-200">
            Head 建议的模型不在当前清单里，请重新选一个。
          </div>
        )}

        {isPending && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-nim pt-3">
            <button
              type="button"
              data-testid="redispatch-reject"
              onClick={() => void submitDecision(false)}
              disabled={isSubmitting}
              className="rounded-md border border-nim bg-transparent px-3 py-2 text-xs font-medium text-nim hover:bg-nim-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              拒绝
            </button>
            <button
              type="button"
              data-testid="redispatch-approve"
              onClick={() => void submitDecision(true)}
              disabled={isSubmitting || routeModelUnavailable || !prompt.trim() || !effectiveWorkspacePath}
              className="rounded-md bg-[var(--nim-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              批准重派
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const SubmittedPlanApprovalCard: React.FC<{
  props: CustomToolWidgetProps;
  args: SubmittedPlanArgs;
}> = ({ props, args }) => {
  const { message, sessionId, workspacePath, getInteractivePromptStatus } =
    props;
  const toolCall = message.toolCall!;

  const host = useAtomValue(interactiveWidgetHostAtom(sessionId));
  const agentRole = useSessionAgentRole(sessionId);
  const requestId = toolCall.providerToolCallId?.trim() || null;
  const effectiveWorkspacePath = workspacePath || host?.workspacePath;
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
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);

  useEffect(() => {
    setActiveModuleIndex(0);
  }, [args.planId]);

  useEffect(() => {
    setActiveModuleIndex((current) =>
      Math.min(current, Math.max(modules.length - 1, 0))
    );
  }, [modules.length]);

  const visibleModuleIndexes = isMultiModulePlan
    ? [activeModuleIndex]
    : modules.map((_module, moduleIndex) => moduleIndex);
  const [selectedCandidateNames, setSelectedCandidateNames] = useState<
    Record<number, string>
  >({});
  const [modelCatalog, setModelCatalog] = useState<PlanCatalogState>({
    status: (
      window as unknown as {
        electronAPI?: { aiGetModels?: () => Promise<unknown> };
      }
    ).electronAPI?.aiGetModels ? 'loading' : 'failed',
    models: [],
  });
  const [moduleRouteSelections, setModuleRouteSelections] = useState<
    Record<number, ModuleRouteSelection>
  >({});
  const [moduleDispatchSelections, setModuleDispatchSelections] = useState<
    Record<number, ModuleDispatchSelection>
  >({});
  const [moduleSkillSelections, setModuleSkillSelections] = useState<
    Record<number, DispatchSkillSelection>
  >({});
  const [expandedSkillModules, setExpandedSkillModules] = useState<Record<number, boolean>>({});
  const [skillLibrary, setSkillLibrary] = useState<DispatchSkillLibraryState>({
    status: 'loading',
    skills: [],
    settings: readDispatchSkillSettings(undefined),
  });
  const approvalStateKey = useMemo(
    () => ({
      sessionId,
      promptId: requestId ?? '',
    }),
    [requestId, sessionId],
  );
  const durableState = useAtomValue(planApprovalStateAtom(approvalStateKey));
  const refreshPlanApprovalState = useSetAtom(refreshPlanApprovalStateAtom);
  const durableModuleRouteSelections = useMemo(
    () => durableState?.decision === 'approved'
      ? parseDurableModuleRouteSelections(durableState.selectedCandidates)
      : {},
    [durableState?.decision, durableState?.selectedCandidates],
  );
  const durableDispatchSelections = useMemo(
    () => durableState?.decision === 'approved'
      ? parseDurableDispatchSelections(durableState.selectedCandidates)
      : {},
    [durableState?.decision, durableState?.selectedCandidates],
  );
  const durableSkillSelections = useMemo(
    () => durableState?.decision === 'approved'
      ? parseDurableSkillSelections(durableState.selectedCandidates)
      : {},
    [durableState?.decision, durableState?.selectedCandidates],
  );

  useEffect(() => {
    let disposed = false;
    const loadModels = (
      window as unknown as {
        electronAPI?: { aiGetModels?: () => Promise<unknown> };
      }
    ).electronAPI?.aiGetModels;
    if (!loadModels) {
      return undefined;
    }
    setModelCatalog({ status: 'loading', models: [] });
    void loadModels()
      .then((response) => {
        if (disposed) return;
        const models = parseLiveCatalogModels(response);
        setModelCatalog(
          models === null
            ? { status: 'failed', models: [] }
            : { status: 'ready', models },
        );
      })
      .catch(() => {
        if (!disposed) setModelCatalog({ status: 'failed', models: [] });
      });
    return () => {
      disposed = true;
    };
  }, [args.planId]);

  useEffect(() => {
    let disposed = false;
    const invoke = window.electronAPI?.invoke;
    if (!invoke) {
      setSkillLibrary({
        status: 'ready',
        skills: [],
        settings: readDispatchSkillSettings(undefined),
      });
      return undefined;
    }
    setSkillLibrary((current) => ({ ...current, status: 'loading' }));
    void Promise.all([
      invoke('dispatch-skills:list', effectiveWorkspacePath),
      invoke('app-settings:get', DISPATCH_SKILL_SETTINGS_KEY),
    ])
      .then(([listResult, stored]) => {
        if (disposed) return;
        const skills = Array.isArray(listResult?.skills) ? listResult.skills : [];
        const settings = sanitizeDispatchSkillSettingsForLibrary(
          readDispatchSkillSettings(stored),
          skills,
        );
        setSkillLibrary({ status: 'ready', skills, settings });
      })
      .catch(() => {
        if (!disposed) {
          setSkillLibrary((current) => ({ ...current, status: 'failed' }));
        }
      });
    return () => {
      disposed = true;
    };
  }, [args.planId, effectiveWorkspacePath]);

  const catalogModelsById = useMemo(
    () => new Map(modelCatalog.models.map((model) => [model.id, model])),
    [modelCatalog.models],
  );
  const skillsById = useMemo(
    () => new Map(skillLibrary.skills.map((skill) => [skill.id, skill])),
    [skillLibrary.skills],
  );
  const moduleRoutes = useMemo<(ResolvedModuleRoute | null)[]>(
    () =>
      modules.map((module, moduleIndex) => {
        const selection = moduleRouteSelections[moduleIndex]
          ?? durableModuleRouteSelections[moduleIndex];
        const modelId = selection?.model
          ?? toProviderQualifiedModelId(module.provider, module.model);
        const model = catalogModelsById.get(modelId);
        const effortLevel = resolveModuleEffortLevel(
          model,
          selection?.effortLevel ?? module.effortLevel,
        );
        return model
          ? {
              provider: model.provider,
              model: model.id,
              ...(effortLevel ? { effortLevel } : {}),
            }
          : null;
      }),
    [catalogModelsById, durableModuleRouteSelections, moduleRouteSelections, modules],
  );
  const hasUnavailableModuleRoute =
    modules.length > 0
    && (modelCatalog.status !== 'ready' || moduleRoutes.some((route) => !route));
  const moduleDispatchPermissions = useMemo(
    () => modules.map((module, moduleIndex) => {
      const selected = moduleDispatchSelections[moduleIndex]
        ?? durableDispatchSelections[moduleIndex];
      const requested: DispatchPermissionKnobs = selected ?? getSuggestedDispatchPermission(module);
      const provider = moduleRoutes[moduleIndex]?.provider ?? module.provider;
      return resolveDispatchPermission(provider, requested);
    }),
    [durableDispatchSelections, moduleDispatchSelections, moduleRoutes, modules],
  );
  const moduleSkillSelectionsRaw = useMemo(
    () => modules.map((module, moduleIndex) =>
      moduleSkillSelections[moduleIndex]
      ?? durableSkillSelections[moduleIndex]
      ?? getSuggestedDispatchSkillSelection(module),
    ),
    [durableSkillSelections, moduleSkillSelections, modules],
  );
  const moduleSkillSelectionsResolved = useMemo(
    () => modules.map((module, moduleIndex) => {
      const provider = moduleRoutes[moduleIndex]?.provider ?? module.provider;
      return expandDispatchSkillSelection(
        moduleSkillSelectionsRaw[moduleIndex],
        provider,
        skillLibrary,
      );
    }),
    [moduleRoutes, moduleSkillSelectionsRaw, modules, skillLibrary],
  );
  const selectedCandidates = useMemo<SelectedPlanCandidate[]>(
    () =>
      modules.flatMap((module, moduleIndex) => {
        const route = moduleRoutes[moduleIndex];
        if (!route) return [];
        const selectedName = selectedCandidateNames[moduleIndex];
        const candidate = selectedName
          ? module.candidates.find((item) => item.name === selectedName)
          : undefined;
        const dispatch = moduleDispatchPermissions[moduleIndex];
        const hasDispatchSelection = moduleDispatchSelections[moduleIndex] !== undefined
          || durableDispatchSelections[moduleIndex] !== undefined;
        const shouldIncludeDispatch = hasDispatchSelection
          || candidate?.permissionScope !== undefined
          || candidate?.disturbanceLevel !== undefined
          || module.permissionScope !== undefined
          || module.disturbanceLevel !== undefined;
        const skillSelection = getUnfilteredDispatchSkillSelection(
          moduleSkillSelectionsRaw[moduleIndex],
          skillLibrary,
        );
        const hasSkillSelection =
          moduleSkillSelections[moduleIndex] !== undefined
          || durableSkillSelections[moduleIndex] !== undefined
          || candidate?.hasSkillSelection === true
          || module.hasSkillSelection;
        if (
          !candidate
          && isSameModuleRoute(module, route)
          && !hasDispatchSelection
          && !hasSkillSelection
        ) return [];
        // The route is the capability-checked source of truth. In particular,
        // a candidate may carry a historical effort string for a model (such
        // as Haiku) that declares no independent effort dimension.
        const candidateDetails = candidate
          ? {
              name: candidate.name,
              approach: candidate.approach,
              pros: candidate.pros,
              cons: candidate.cons,
              risks: candidate.risks,
            }
          : {
              name: '模块路由调整',
              approach: module.doneCriteria,
              pros: [],
              cons: [],
              risks: [],
            };
        return [
          {
            moduleIndex,
            moduleTitle: module.title,
            ...candidateDetails,
            provider: route.provider,
            model: route.model,
            ...(route.effortLevel ? { effortLevel: route.effortLevel } : {}),
            ...(dispatch && shouldIncludeDispatch
              ? {
                  // Keep the owner-selected product request durable. The
                  // dispatch service resolves it again after final routing so
                  // its receipt can truthfully retain any engine downgrade.
                  permissionScope: dispatch.requested.permissionScope,
                  disturbanceLevel: dispatch.requested.disturbanceLevel,
                }
              : {}),
            ...(skillSelection && hasSkillSelection
              ? {
                  ...(skillSelection.skillBundleName
                    ? { skillBundleName: skillSelection.skillBundleName }
                    : {}),
                  skillIds: skillSelection.skillIds,
                }
              : {}),
          },
        ];
      }),
    [
      moduleDispatchPermissions,
      moduleDispatchSelections,
      moduleSkillSelections,
      moduleSkillSelectionsRaw,
      durableDispatchSelections,
      durableSkillSelections,
      moduleRoutes,
      modules,
      selectedCandidateNames,
      skillLibrary,
    ],
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

  const handleModuleModelChange = useCallback(
    (moduleIndex: number, modelId: string) => {
      const model = catalogModelsById.get(modelId);
      if (!model) {
        setModuleRouteSelections((current) => ({
          ...current,
          [moduleIndex]: { model: '' },
        }));
        return;
      }
      // A model change is an engine boundary. Do not translate/reuse a tier
      // merely because another engine happens to spell it the same; start at
      // the newly selected model's declared default (or first declaration).
      const effortLevel = resolveModuleEffortLevel(model, undefined);
      setModuleRouteSelections((current) => ({
        ...current,
        [moduleIndex]: {
          model: model.id,
          ...(effortLevel ? { effortLevel } : {}),
        },
      }));
    },
    [catalogModelsById],
  );

  const handleModuleEffortChange = useCallback(
    (moduleIndex: number, effortLevel: string) => {
      const route = moduleRoutes[moduleIndex];
      const model = route ? catalogModelsById.get(route.model) : undefined;
      if (!route || !model || !isPlanEffortLevel(effortLevel)) return;
      if (!model.supportedEffortLevels.includes(effortLevel)) return;
      setModuleRouteSelections((current) => ({
        ...current,
        [moduleIndex]: {
          model: route.model,
          effortLevel,
        },
      }));
    },
    [catalogModelsById, moduleRoutes],
  );

  const handleModulePermissionScopeChange = useCallback(
    (moduleIndex: number, permissionScope: string) => {
      if (!isDispatchPermissionScope(permissionScope)) return;
      const current = moduleDispatchPermissions[moduleIndex];
      if (!current) return;
      setModuleDispatchSelections((selections) => ({
        ...selections,
        [moduleIndex]: {
          permissionScope,
          disturbanceLevel: current.effective.disturbanceLevel,
        },
      }));
    },
    [moduleDispatchPermissions],
  );

  const handleModuleDisturbanceLevelChange = useCallback(
    (moduleIndex: number, disturbanceLevel: string) => {
      if (!isDispatchDisturbanceLevel(disturbanceLevel)) return;
      const current = moduleDispatchPermissions[moduleIndex];
      if (!current) return;
      setModuleDispatchSelections((selections) => ({
        ...selections,
        [moduleIndex]: {
          permissionScope: current.effective.permissionScope,
          disturbanceLevel,
        },
      }));
    },
    [moduleDispatchPermissions],
  );

  const handleModuleSkillBundleChange = useCallback(
    (moduleIndex: number, bundleId: string) => {
      if (bundleId === '') {
        setModuleSkillSelections((current) => ({
          ...current,
          [moduleIndex]: { skillIds: [] },
        }));
        return;
      }
      const bundle = skillLibrary.settings.bundles.find((item) => item.id === bundleId);
      if (!bundle) return;
      setModuleSkillSelections((current) => ({
        ...current,
        [moduleIndex]: { skillBundleName: bundle.name, skillIds: bundle.skillIds },
      }));
    },
    [skillLibrary],
  );

  const handleModuleSkillRemove = useCallback(
    (moduleIndex: number, skillId: string) => {
      const current = getUnfilteredDispatchSkillSelection(
        moduleSkillSelectionsRaw[moduleIndex],
        skillLibrary,
      ) ?? moduleSkillSelectionsResolved[moduleIndex] ?? { skillIds: [] };
      setModuleSkillSelections((selections) => ({
        ...selections,
        [moduleIndex]: {
          ...(current.skillBundleName ? { skillBundleName: current.skillBundleName } : {}),
          skillIds: current.skillIds.filter((id) => id !== skillId),
        },
      }));
    },
    [moduleSkillSelectionsRaw, moduleSkillSelectionsResolved, skillLibrary],
  );

  const handleModuleSkillAdd = useCallback(
    (moduleIndex: number, skillId: string) => {
      if (!skillId) return;
      const current = getUnfilteredDispatchSkillSelection(
        moduleSkillSelectionsRaw[moduleIndex],
        skillLibrary,
      ) ?? moduleSkillSelectionsResolved[moduleIndex] ?? { skillIds: [] };
      if (current.skillIds.includes(skillId)) return;
      setModuleSkillSelections((selections) => ({
        ...selections,
        [moduleIndex]: {
          ...(current.skillBundleName ? { skillBundleName: current.skillBundleName } : {}),
          skillIds: [...current.skillIds, skillId],
        },
      }));
    },
    [moduleSkillSelectionsRaw, moduleSkillSelectionsResolved, skillLibrary],
  );

  const handleCandidateSelection = useCallback(
    (moduleIndex: number, candidate: RenderCandidate) => {
      setSelectedCandidateNames((current) => ({
        ...current,
        [moduleIndex]: candidate.name,
      }));
      const modelId = toProviderQualifiedModelId(
        candidate.provider,
        candidate.model,
      );
      const model = catalogModelsById.get(modelId);
      const effortLevel = resolveModuleEffortLevel(model, candidate.effortLevel);
      setModuleRouteSelections((current) => ({
        ...current,
        [moduleIndex]: {
          model: model?.id ?? '',
          ...(effortLevel ? { effortLevel } : {}),
        },
      }));
      if (
        candidate.permissionScope !== undefined
        || candidate.disturbanceLevel !== undefined
      ) {
        const defaults = getDefaultDispatchPermissionKnobs(candidate.intent);
        const requested: DispatchPermissionKnobs = {
          permissionScope: candidate.permissionScope ?? defaults.permissionScope,
          disturbanceLevel: candidate.disturbanceLevel ?? defaults.disturbanceLevel,
        };
        setModuleDispatchSelections((current) => ({
          ...current,
          // Preserve a candidate's original request even when its engine
          // cannot express it. The visible select renders the effective
          // supported value; the durable receipt records the downgrade.
          [moduleIndex]: requested,
        }));
      }
      if (candidate.hasSkillSelection) {
        setModuleSkillSelections((current) => ({
          ...current,
          [moduleIndex]: getSuggestedDispatchSkillSelection(candidate)!,
        }));
      }
    },
    [catalogModelsById],
  );

  const handleApprove = useCallback(async () => {
    if (responseSubmitted || hasUnavailableModuleRoute) return;
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
    hasUnavailableModuleRoute,
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
                ? 'plan-approval-modules mb-4 flex flex-col gap-4'
                : 'mb-4 flex flex-col gap-4'
            }
          >
            {isMultiModulePlan && (
              <div
                data-testid="plan-module-pagination"
                className="plan-module-pagination flex flex-wrap items-center justify-between gap-3 rounded-md border border-nim bg-nim-secondary px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 text-xs font-medium text-nim">
                    第 {activeModuleIndex + 1} 个 / 共 {modules.length} 个
                  </span>
                  <div
                    data-testid="plan-module-status-dots"
                    aria-label="模块审批状态"
                    className="flex items-center gap-1.5"
                  >
                    {moduleApprovalStates.map((approval, moduleIndex) => {
                      const isCurrentModule = moduleIndex === activeModuleIndex;
                      const statusClassName =
                        approval.status === "rejected"
                          ? "bg-[var(--nim-warning)]"
                          : approval.status === "approved"
                          ? "bg-[var(--nim-success)]"
                          : "bg-[var(--nim-text-faint)]";
                      return (
                        <span
                          key={approval.moduleIndex}
                          data-testid={`plan-module-status-dot-${approval.moduleIndex}`}
                          data-status={approval.status}
                          data-current={isCurrentModule ? "true" : "false"}
                          aria-label={`模块 ${approval.moduleIndex}：${
                            approval.status === "rejected"
                              ? "已打回·待修订"
                              : approval.status === "approved"
                              ? "已批准"
                              : "待审批"
                          }`}
                          aria-current={isCurrentModule ? "step" : undefined}
                          className={`h-2.5 w-2.5 rounded-full ${statusClassName} ${
                            isCurrentModule
                              ? "ring-2 ring-[var(--nim-primary)] ring-offset-2 ring-offset-[var(--nim-bg-secondary)]"
                              : ""
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="plan-module-previous"
                    onClick={() =>
                      setActiveModuleIndex((current) =>
                        Math.max(0, current - 1)
                      )
                    }
                    disabled={activeModuleIndex === 0}
                    className="rounded-md border border-nim bg-transparent px-3 py-1.5 text-xs font-medium text-nim hover:bg-nim-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    上一个
                  </button>
                  <button
                    type="button"
                    data-testid="plan-module-next"
                    onClick={() =>
                      setActiveModuleIndex((current) =>
                        Math.min(modules.length - 1, current + 1)
                      )
                    }
                    disabled={activeModuleIndex === modules.length - 1}
                    className="rounded-md border border-nim bg-transparent px-3 py-1.5 text-xs font-medium text-nim hover:bg-nim-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    下一个
                  </button>
                </div>
              </div>
            )}
            {visibleModuleIndexes.map((moduleIndex) => {
              const module = modules[moduleIndex]!;
              const stableModuleIndex = moduleIndex + 1;
              const moduleApproval = moduleApprovalStates[moduleIndex];
              const moduleRoute = moduleRoutes[moduleIndex];
              const routeModel = moduleRoute
                ? catalogModelsById.get(moduleRoute.model)
                : undefined;
              const dispatchPermission = moduleDispatchPermissions[moduleIndex];
              const dispatchCapabilities = getDispatchPermissionCapabilities(
                moduleRoute?.provider ?? module.provider,
              );
              const suggestedDispatchPermission = getSuggestedDispatchPermission(module);
              const permissionScopeChanged = dispatchPermission
                && suggestedDispatchPermission.permissionScope
                  !== dispatchPermission.effective.permissionScope;
              const disturbanceLevelChanged = dispatchPermission
                && suggestedDispatchPermission.disturbanceLevel
                  !== dispatchPermission.effective.disturbanceLevel;
              const selectedCandidateName = selectedCandidateNames[moduleIndex];
              const selectedCandidate = selectedCandidateName
                ? module.candidates.find((candidate) => candidate.name === selectedCandidateName)
                : undefined;
              const suggestedRouteProvider = selectedCandidate?.provider ?? module.provider;
              const suggestedRouteModel = toProviderQualifiedModelId(
                suggestedRouteProvider,
                selectedCandidate?.model ?? module.model,
              );
              const suggestedRouteModelText =
                suggestedRouteModel || getDisplayString(selectedCandidate?.model ?? module.model);
              const providerChanged = Boolean(
                moduleRoute
                && suggestedRouteProvider
                && moduleRoute.provider !== suggestedRouteProvider,
              );
              const modelChanged = Boolean(
                moduleRoute
                && suggestedRouteModel
                && moduleRoute.model !== suggestedRouteModel,
              );
              const suggestedRouteModelRecord = suggestedRouteModel
                ? catalogModelsById.get(suggestedRouteModel)
                : undefined;
              const suggestedEffortLevel = resolveModuleEffortLevel(
                suggestedRouteModelRecord,
                selectedCandidate?.effortLevel ?? module.effortLevel,
              );
              const effortLevelChanged = Boolean(
                moduleRoute
                && routeModel
                && routeModel.supportedEffortLevels.length > 0
                && suggestedEffortLevel
                && moduleRoute.effortLevel
                && suggestedEffortLevel !== moduleRoute.effortLevel,
              );
              const providerForSkills = moduleRoute?.provider ?? module.provider;
              const rawSkillSelection = moduleSkillSelectionsRaw[moduleIndex];
              const skillSelection = moduleSkillSelectionsResolved[moduleIndex] ?? { skillIds: [] };
              const suggestedSkillSelection = expandDispatchSkillSelection(
                getSuggestedDispatchSkillSelection(selectedCandidate ?? module),
                providerForSkills,
                skillLibrary,
              );
              const skillSelectionChanged = !sameDispatchSkillSelection(
                suggestedSkillSelection,
                skillSelection,
              );
              const grantableSkills = getProviderGrantableSkills(
                skillLibrary.skills,
                skillLibrary.settings,
                providerForSkills,
              );
              const selectedSkills = skillSelection.skillIds
                .map((skillId) => skillsById.get(skillId))
                .filter((skill): skill is DispatchSkillDescriptor => Boolean(skill));
              const addableSkills = grantableSkills.filter(
                (skill) => !skillSelection.skillIds.includes(skill.id),
              );
              const selectedBundle = getBundleByNameOrId(
                skillLibrary.settings,
                skillSelection.skillBundleName,
              );
              const skillSummary = !rawSkillSelection
                ? `全部（${grantableSkills.length}）`
                : rawSkillSelection.skillBundleName
                  ? `${rawSkillSelection.skillBundleName}（${skillSelection.skillIds.length}）`
                  : rawSkillSelection.skillIds.length === 0
                    ? '不授予'
                    : `已选（${skillSelection.skillIds.length}）`;
              const unavailableSkillNotice = getUnavailableSkillNotice(
                rawSkillSelection,
                providerForSkills,
                skillsById,
                skillLibrary,
              );
              const isSkillEditorExpanded = expandedSkillModules[moduleIndex] === true;
              const isModuleRejected = moduleApproval.status === 'rejected';
              const isModuleFeedbackOpen =
                activeFeedbackModuleIndex === stableModuleIndex;
              const moduleControlsDisabled = isSubmitting || displayResult !== null;
              return (
                <section
                  key={`${moduleIndex}-${module.title}`}
                  data-testid={`plan-module-card-${stableModuleIndex}`}
                  className="plan-module-card flex flex-col rounded-md border border-nim bg-nim-tertiary p-3"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 break-words text-sm font-semibold text-nim">
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
                  <dl
                    data-testid={`plan-module-fields-${stableModuleIndex}`}
                    className="plan-module-fields text-[13px]"
                  >
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold text-nim-muted">
                        产出文件
                      </dt>
                      <dd className="mt-1 flex min-w-0 flex-col gap-1 text-nim select-text">
                        {module.outputFiles.length > 0
                          ? module.outputFiles.map((filePath) => (
                              <code
                                key={filePath}
                                className="block max-w-full whitespace-pre-wrap break-all text-[12px]"
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
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold text-nim-muted">
                        提供方
                      </dt>
                      <dd className="mt-1 break-words text-nim select-text">
                        <span data-testid={`plan-module-provider-value-${stableModuleIndex}`}>
                          {moduleRoute?.provider ?? module.provider}
                        </span>
                        {providerChanged && moduleRoute && (
                          <p
                            data-testid={`plan-module-provider-trace-${stableModuleIndex}`}
                            className="mt-1 text-xs text-nim-muted"
                          >
                            Head 建议：{suggestedRouteProvider} → 当前：{moduleRoute.provider}
                          </p>
                        )}
                      </dd>
                    </div>
                    <div
                      data-testid={`plan-module-model-field-${stableModuleIndex}`}
                      className="plan-module-model-field min-w-0"
                    >
                      <dt className="text-xs font-semibold text-nim-muted">
                        模型
                      </dt>
                      <dd className="mt-1 min-w-0">
                        <select
                          data-testid={`plan-module-model-select-${stableModuleIndex}`}
                          aria-label={`${module.title} 模型`}
                          aria-invalid={!moduleRoute}
                          value={moduleRoute?.model ?? ''}
                          onChange={(event) =>
                            handleModuleModelChange(
                              moduleIndex,
                              event.target.value,
                            )
                          }
                          disabled={
                            modelCatalog.status !== 'ready' || moduleControlsDisabled
                          }
                          className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="">请选择模型</option>
                          {modelCatalog.models.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.id}
                            </option>
                          ))}
                        </select>
                        {module.modelCatalogPending ? (
                          <p
                            data-testid={`plan-module-model-catalog-pending-${stableModuleIndex}`}
                            className="mt-1 text-xs text-nim-muted"
                          >
                            目录未就绪，模型待确认
                          </p>
                        ) : modelCatalog.status === 'ready' && !moduleRoute ? (
                          <p
                            data-testid={`plan-module-model-invalid-${stableModuleIndex}`}
                            className="mt-1 text-xs text-amber-800 dark:text-amber-200"
                          >
                            Head 报的型号 <code>{module.model}</code> 不在当前清单里，请选一个
                          </p>
                        ) : null}
                        {modelChanged && moduleRoute && (
                          <p
                            data-testid={`plan-module-model-trace-${stableModuleIndex}`}
                            className="mt-1 text-xs text-nim-muted"
                          >
                            Head 建议：{suggestedRouteModelText} → 当前：{moduleRoute.model}
                          </p>
                        )}
                      </dd>
                    </div>
                    {routeModel && routeModel.supportedEffortLevels.length > 0 && (
                      <div
                        data-testid={`plan-module-effort-field-${stableModuleIndex}`}
                        className="plan-module-effort-field min-w-0"
                      >
                        <dt className="text-xs font-semibold text-nim-muted">
                          思考强度
                        </dt>
                        <dd className="mt-1 min-w-0">
                          <select
                            data-testid={`plan-module-effort-select-${stableModuleIndex}`}
                            aria-label={`${module.title} 思考强度`}
                            aria-invalid={!moduleRoute}
                            value={moduleRoute?.effortLevel ?? ''}
                            onChange={(event) =>
                              handleModuleEffortChange(
                                moduleIndex,
                                event.target.value,
                              )
                            }
                            disabled={moduleControlsDisabled}
                            className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {routeModel.supportedEffortLevels.map((effortLevel) => (
                              <option key={effortLevel} value={effortLevel}>
                                {effortLevel}
                              </option>
                            ))}
                          </select>
                          {effortLevelChanged && moduleRoute && (
                            <p
                              data-testid={`plan-module-effort-trace-${stableModuleIndex}`}
                              className="mt-1 text-xs text-nim-muted"
                            >
                              Head 建议：{suggestedEffortLevel} → 当前：{moduleRoute.effortLevel}
                            </p>
                          )}
                        </dd>
                      </div>
                    )}
                    <div
                      data-testid={`plan-module-permission-scope-field-${stableModuleIndex}`}
                      className="plan-module-permission-scope-field min-w-0"
                    >
                      <dt className="text-xs font-semibold text-nim-muted">
                        权限范围
                      </dt>
                      <dd className="mt-1 min-w-0">
                        <select
                          data-testid={`plan-module-permission-scope-select-${stableModuleIndex}`}
                          aria-label={`${module.title} 权限范围`}
                          value={
                            dispatchPermission
                            && dispatchCapabilities.permissionScopes.includes(
                              dispatchPermission.effective.permissionScope,
                            )
                              ? dispatchPermission.effective.permissionScope
                              : ''
                          }
                          onChange={(event) =>
                            handleModulePermissionScopeChange(
                              moduleIndex,
                              event.target.value,
                            )
                          }
                          disabled={
                            moduleControlsDisabled
                            || dispatchCapabilities.permissionScopes.length === 0
                          }
                          className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {dispatchCapabilities.permissionScopes.length === 0 ? (
                            <option value="">该引擎不支持此档</option>
                          ) : (
                            dispatchCapabilities.permissionScopes.map((scope) => (
                              <option key={scope} value={scope}>
                                {getDispatchPermissionScopeLabel(scope)}
                              </option>
                            ))
                          )}
                        </select>
                        {permissionScopeChanged && dispatchPermission && (
                          <p
                            data-testid={`plan-module-permission-scope-trace-${stableModuleIndex}`}
                            className="mt-1 text-xs text-nim-muted"
                          >
                            Head 建议：{getDispatchPermissionScopeLabel(suggestedDispatchPermission.permissionScope)} → 当前：{getDispatchPermissionScopeLabel(dispatchPermission.effective.permissionScope)}
                          </p>
                        )}
                      </dd>
                    </div>
                    <div
                      data-testid={`plan-module-disturbance-level-field-${stableModuleIndex}`}
                      className="plan-module-disturbance-level-field min-w-0"
                    >
                      <dt className="text-xs font-semibold text-nim-muted">
                        打扰程度
                      </dt>
                      <dd className="mt-1 min-w-0">
                        <select
                          data-testid={`plan-module-disturbance-level-select-${stableModuleIndex}`}
                          aria-label={`${module.title} 打扰程度`}
                          value={
                            dispatchPermission
                            && dispatchCapabilities.disturbanceLevels.includes(
                              dispatchPermission.effective.disturbanceLevel,
                            )
                              ? dispatchPermission.effective.disturbanceLevel
                              : ''
                          }
                          onChange={(event) =>
                            handleModuleDisturbanceLevelChange(
                              moduleIndex,
                              event.target.value,
                            )
                          }
                          disabled={
                            moduleControlsDisabled
                            || dispatchCapabilities.disturbanceLevels.length === 0
                          }
                          className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {dispatchCapabilities.disturbanceLevels.length === 0 ? (
                            <option value="">该引擎不支持此档</option>
                          ) : (
                            dispatchCapabilities.disturbanceLevels.map((level) => (
                              <option key={level} value={level}>
                                {getDispatchDisturbanceLevelLabel(level)}
                              </option>
                            ))
                          )}
                        </select>
                        {disturbanceLevelChanged && dispatchPermission && (
                          <p
                            data-testid={`plan-module-disturbance-level-trace-${stableModuleIndex}`}
                            className="mt-1 text-xs text-nim-muted"
                          >
                            Head 建议：{getDispatchDisturbanceLevelLabel(suggestedDispatchPermission.disturbanceLevel)} → 当前：{getDispatchDisturbanceLevelLabel(dispatchPermission.effective.disturbanceLevel)}
                          </p>
                        )}
                        {dispatchPermission?.notice && (
                          <p
                            data-testid={`plan-module-dispatch-downgrade-${stableModuleIndex}`}
                            className="mt-1 text-xs text-amber-800 dark:text-amber-200"
                          >
                            {dispatchPermission.notice}
                          </p>
                        )}
                      </dd>
                    </div>
                    <div
                      data-testid={`plan-module-skill-field-${stableModuleIndex}`}
                      className="plan-module-skill-field min-w-0"
                    >
                      <dt className="flex items-center justify-between gap-2 text-xs font-semibold text-nim-muted">
                        <span data-testid={`plan-module-skill-summary-${stableModuleIndex}`}>
                          技能：{skillSummary}
                        </span>
                        {skillSelectionChanged && (
                          <span
                            data-testid={`plan-module-skill-adjusted-${stableModuleIndex}`}
                            className="text-nim-muted"
                          >
                            · 已调整
                          </span>
                        )}
                        <button
                          type="button"
                          data-testid={`plan-module-skill-adjust-${stableModuleIndex}`}
                          onClick={() => setExpandedSkillModules((current) => ({
                            ...current,
                            [moduleIndex]: !current[moduleIndex],
                          }))}
                          className="ml-auto text-xs font-medium text-nim-link hover:text-nim-link-hover"
                        >
                          {isSkillEditorExpanded ? '收起' : '调整'}
                        </button>
                      </dt>
                      {unavailableSkillNotice && (
                        <p
                          data-testid={`plan-module-skill-unavailable-${stableModuleIndex}`}
                          className="mt-1 text-xs text-nim-muted"
                        >
                          {unavailableSkillNotice}
                        </p>
                      )}
                      <dd className="mt-1 min-w-0">
                        {isSkillEditorExpanded && (
                          <>
                        <select
                          data-testid={`plan-module-skill-bundle-select-${stableModuleIndex}`}
                          aria-label={`${module.title} 技能包`}
                          value={!rawSkillSelection
                            ? '__all__'
                            : selectedBundle?.id ?? (
                              rawSkillSelection.skillIds.length > 0 ? '__custom__' : ''
                            )}
                          onChange={(event) =>
                            handleModuleSkillBundleChange(moduleIndex, event.target.value)
                          }
                          disabled={moduleControlsDisabled || skillLibrary.status === 'loading'}
                          className="w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {!rawSkillSelection && (
                            <option value="__all__">全部（{grantableSkills.length}）</option>
                          )}
                          {rawSkillSelection && !selectedBundle && rawSkillSelection.skillIds.length > 0 && (
                            <option value="__custom__" disabled>已自选</option>
                          )}
                          <option value="">不授予</option>
                          {skillLibrary.settings.bundles.map((bundle) => (
                            <option key={bundle.id} value={bundle.id}>
                              {bundle.name}
                            </option>
                          ))}
                        </select>
                        <div
                          data-testid={`plan-module-skill-tags-${stableModuleIndex}`}
                          className="mt-2 flex min-w-0 flex-wrap gap-1.5"
                        >
                          {selectedSkills.length > 0 ? (
                            selectedSkills.map((skill) => (
                              <span
                                key={skill.id}
                                data-testid={`plan-module-skill-tag-${stableModuleIndex}`}
                                className="inline-flex max-w-full items-center gap-1 rounded-full border border-nim bg-nim-secondary px-2 py-0.5 text-xs text-nim"
                              >
                                <span className="truncate">{skill.name}</span>
                                <button
                                  type="button"
                                  aria-label={`移除 ${skill.name}`}
                                  disabled={moduleControlsDisabled}
                                  onClick={() => handleModuleSkillRemove(moduleIndex, skill.id)}
                                  className="text-nim-muted hover:text-nim disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          ) : (
                            <span
                              data-testid={`plan-module-skill-empty-${stableModuleIndex}`}
                              className="text-xs text-nim-muted"
                            >
                              不授予任何技能
                            </span>
                          )}
                        </div>
                        <select
                          data-testid={`plan-module-skill-add-select-${stableModuleIndex}`}
                          aria-label={`${module.title} 添加技能`}
                          value=""
                          onChange={(event) => {
                            handleModuleSkillAdd(moduleIndex, event.target.value);
                            event.currentTarget.value = '';
                          }}
                          disabled={moduleControlsDisabled || addableSkills.length === 0}
                          className="mt-2 w-full min-w-0 rounded-md border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim focus:border-nim-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="">搜索添加技能</option>
                          {addableSkills.map((skill) => (
                            <option key={skill.id} value={skill.id}>
                              {skill.name}
                            </option>
                          ))}
                        </select>
                        {skillSelectionChanged && (
                          <p
                            data-testid={`plan-module-skill-trace-${stableModuleIndex}`}
                            className="mt-1 text-xs text-nim-muted"
                          >
                            Head 建议：{formatSkillSelection(suggestedSkillSelection, skillsById)} → 当前：{formatSkillSelection(skillSelection, skillsById)}
                          </p>
                        )}
                        {providerForSkills === 'openai-codex' && (
                          <p
                            data-testid={`plan-module-skill-codex-notice-${stableModuleIndex}`}
                            className="mt-1 text-xs text-amber-800 dark:text-amber-200"
                          >
                            {CODEX_SKILL_CONTROL_NOTICE}
                          </p>
                        )}
                          </>
                        )}
                      </dd>
                    </div>
                    <div className="plan-module-done-criteria min-w-0">
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
                                  disabled={moduleControlsDisabled}
                                  checked={
                                    selectedCandidateNames[moduleIndex] ===
                                    candidate.name
                                  }
                                  onChange={() =>
                                    handleCandidateSelection(
                                      moduleIndex,
                                      candidate,
                                    )
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
                                  {renderStructuredText(candidate[row.key] ?? '不适用')}
                                </div>
                              ))}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {isMultiModulePlan && (
                    <div
                      data-testid={`plan-module-actions-${stableModuleIndex}`}
                      className="plan-module-actions mt-4 border-t border-nim pt-3"
                    >
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
                            className="plan-module-request-changes rounded-md border border-nim bg-transparent px-3 py-2 text-xs font-medium text-nim hover:bg-nim-hover disabled:cursor-not-allowed disabled:opacity-50"
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
                                className="rounded-md border border-[var(--nim-primary)] bg-transparent px-3 py-1.5 text-xs text-[var(--nim-primary)] hover:bg-nim-hover disabled:cursor-not-allowed disabled:opacity-50"
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

        {isMultiModulePlan &&
          promptStatus !== "unavailable" &&
          !displayResult &&
          awaitingResponse &&
          promptStatus === "available" &&
          host &&
          requestId &&
          !responseSubmitted && (
            <div
              data-testid="plan-approval-actions"
              className="plan-approval-actions sticky bottom-0 z-20 -mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-nim bg-nim-secondary/95 p-4 backdrop-blur"
            >
              <span className="text-xs text-nim-muted">
                批准所有未被打回的模块
              </span>
              <button
                type="button"
                data-testid="plan-approval-approve-all"
                onClick={() => void handleApprove()}
                disabled={isSubmitting || hasUnavailableModuleRoute}
                className="inline-flex shrink-0 items-center justify-center rounded-md border-none bg-nim-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-nim-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                全部批准
              </button>
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
                  disabled={isSubmitting || hasUnavailableModuleRoute}
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

const HeadNativePlanModeBlockedCard: React.FC<{ planFilePath: string | null }> = ({
  planFilePath,
}) => (
  <div
    data-testid="head-native-exit-plan-mode-blocked"
    data-state="invalid"
    className="rounded-md border border-nim-warning/60 bg-nim-warning/10 text-nim"
  >
    <div className="flex items-center justify-between gap-3 border-b border-nim-warning/30 px-4 py-3">
      <div className="text-sm font-semibold">Native Plan Mode disabled</div>
      <span
        data-testid="head-native-exit-plan-mode-invalid"
        className="rounded px-2 py-0.5 text-[11px] font-semibold uppercase text-nim-warning"
      >
        Invalid
      </span>
    </div>
    <div className="space-y-2 px-4 py-3 text-[13px] leading-5 text-nim-muted">
      <p>
        Head 的方案请走正牌方案卡：调用 `mcp__nimbalyst-meta-agent__submit_plan`
        提交审批。这个 Claude 原生 ExitPlanMode 请求已失效，不会在 Head 中审批。
      </p>
      {planFilePath && (
        <div className="break-all rounded bg-nim-bg-secondary px-2 py-1 text-xs">
          Native plan file: {planFilePath}
        </div>
      )}
    </div>
  </div>
);

const NativeExitPlanModeFallback: React.FC<CustomToolWidgetProps> = (props) => {
  const agentRole = useSessionAgentRole(props.sessionId);
  if (agentRole === 'meta-agent') {
    return (
      <HeadNativePlanModeBlockedCard
        planFilePath={getNativePlanFilePath(props.message.toolCall?.arguments)}
      />
    );
  }
  if (agentRole === 'standard') return <ExitPlanModeWidget {...props} />;
  return (
    <div
      data-testid="exit-plan-mode-role-checking"
      className="rounded-md border border-nim-border bg-nim-bg-secondary px-4 py-3 text-sm text-nim-muted"
    >
      Checking plan approval availability…
    </div>
  );
};

export const PlanApprovalWidget: React.FC<CustomToolWidgetProps> = (props) => {
  const args = getSubmittedPlanArgs(props.message.toolCall?.arguments);
  if (!args) return <NativeExitPlanModeFallback {...props} />;
  return <SubmittedPlanApprovalCard props={props} args={args} />;
};

export function registerPlanApprovalWidget(): void {
  setTranscriptToolWidgets(PLAN_APPROVAL_WIDGET_SOURCE, {
    ExitPlanMode: PlanApprovalWidget,
    RedispatchWorkOrder: RedispatchWorkOrderWidget,
  });
}

export function unregisterPlanApprovalWidget(): void {
  clearTranscriptToolWidgets(PLAN_APPROVAL_WIDGET_SOURCE);
}

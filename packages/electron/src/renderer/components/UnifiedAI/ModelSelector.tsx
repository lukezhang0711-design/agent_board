import React, { useState, useEffect } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';
import { isAgentProvider, shouldBlockStartedSessionProviderSwitch } from '@nimbalyst/runtime/ai/server/types';
import { getClaudeCodeModelLabel, getClaudeCodeModelShortLabel } from '../../utils/modelUtils';
import { apiKeysAtom, providersAtom, setAvailableModelsAtom } from '../../store/atoms/appSettings';
import { claudeAuthStateAtom } from '../../store/atoms/claudeAuthAtoms';
import { settingAtom } from '../../store/atoms/settingAtomFamily';
import { filterVisibleNewSessionModels } from '../../../shared/claudeChannelVisibility';
import { setWindowModeAtom } from '../../store/atoms/windowMode';
import { navigateToSettingsAtom } from '../../store/atoms/settingsNavigation';
import type { SettingsCategory } from '../Settings/SettingsSidebar';
import { AlphaBadge } from '../common/AlphaBadge';
import { HelpTooltip } from '../../help';
import { ClaudeIdentityBadge } from './ClaudeIdentityBadge';

const ALPHA_PROVIDERS = new Set(['opencode', 'copilot-cli']);

interface Model {
  id: string;
  name: string;
  provider: string;
  description?: string;
  resolvedModel?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: Array<'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'>;
  defaultEffortLevel?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  unverifiedPlaceholder?: boolean;
}

interface CatalogStatus {
  modelSource?: 'runtime' | 'cache' | 'placeholder' | 'none';
  verified?: boolean;
  lastSuccessAt?: number | null;
  lastError?: { message?: string } | null;
}

type ProviderType = 'agent' | 'model';

interface ModelSelectorProps {
  currentModel: string;  // Full provider:model ID
  onModelChange: (modelId: string) => void;
  sessionHasMessages?: boolean;  // Whether current session has any messages
  currentProvider?: string | null;  // Current session provider
  /**
   * Render the current model as a non-interactive chip (no dropdown). Used for
   * committed claude-code-cli sessions where the model is fixed at spawn — we
   * still want to SHOW which provider/model is running, just not let it change.
   */
  readOnly?: boolean;
  /** Tooltip shown on the read-only chip explaining why it can't change. */
  readOnlyTitle?: string;
}

export function ModelSelector({
  currentModel,
  onModelChange,
  sessionHasMessages = false,
  currentProvider = null,
  readOnly = false,
  readOnlyTitle,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<Record<string, Model[]>>({});
  const [providerLabels, setProviderLabels] = useState<Record<string, string>>({});
  const [providerIcons, setProviderIcons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const providers = useAtomValue(providersAtom);
  const showClaudeCliChannel = useAtomValue(settingAtom('ai.showClaudeCliChannel'));
  const claudeAuthState = useAtomValue(claudeAuthStateAtom);
  const apiKeys = useAtomValue(apiKeysAtom);
  const setWindowMode = useSetAtom(setWindowModeAtom);
  const navigateToSettings = useSetAtom(navigateToSettingsAtom);
  const setAvailableModels = useSetAtom(setAvailableModelsAtom);
  const [catalogStatuses, setCatalogStatuses] = useState<Record<string, CatalogStatus>>({});
  const [defaultModelWarning, setDefaultModelWarning] = useState<string | null>(null);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ['bottom-start', 'top-end', 'bottom-end'], padding: 8 }),
      shift({ padding: 8 }),
    ],
  });
  const dismiss = useDismiss(context, {
    escapeKey: true,
    outsidePress: (event) => !(event.target as Element | null)?.closest?.('.help-tooltip'),
  });
  const role = useRole(context, { role: 'menu' });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  // Clear cached models when provider settings change so next dropdown open fetches fresh data
  useEffect(() => {
    setModels({});
    void loadModels();
    // The shared available-model atom also drives the effort selector in the
    // transcript, so fetch once on mount instead of waiting for the first tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, showClaudeCliChannel]);

  // Reload when the dropdown opens or when visibility/provider settings change.
  // The main process applies the same filter; this renderer pass also prevents
  // a stale response from leaking a hidden CLI row.
  useEffect(() => {
    if (isOpen) void loadModels();
    // loadModels is intentionally kept as the local IPC boundary below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, providers, showClaudeCliChannel]);

  const loadModels = async () => {
    setLoading(true);
    try {
      const response = await window.electronAPI.aiGetModels();
      if (response.success && response.grouped) {
        setModels(
          Object.fromEntries(
            Object.entries(response.grouped)
              .filter(([provider]) => provider !== 'openai-codex-acp')
              .map(([provider, providerModels]) => [
                provider,
                filterVisibleNewSessionModels(providerModels as Model[], showClaudeCliChannel),
              ])
              .filter(([, providerModels]) => providerModels.length > 0),
          ),
        );
        const meta = response as {
          providerLabels?: Record<string, string>;
          providerIcons?: Record<string, string>;
        };
        if (meta.providerLabels) setProviderLabels(meta.providerLabels);
        if (meta.providerIcons) setProviderIcons(meta.providerIcons);
        const catalogMeta = response as { catalogStatuses?: Record<string, CatalogStatus> };
        if (catalogMeta.catalogStatuses) setCatalogStatuses(catalogMeta.catalogStatuses);
        const defaultMeta = response as { defaultModelWarning?: string | null };
        setDefaultModelWarning(defaultMeta.defaultModelWarning ?? null);
        for (const [providerId, providerModels] of Object.entries(response.grouped)) {
          setAvailableModels({ providerId, models: providerModels as Model[] });
        }
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsOpen(false);
  };

  const getSettingsCategoryForModel = (modelId: string): SettingsCategory => {
    const provider = modelId.split(':')[0];
    switch (provider) {
      case 'claude':
      case 'claude-code':
      case 'openai':
      case 'openai-codex':
      case 'opencode':
      case 'copilot-cli':
      case 'lmstudio':
        return provider;
      case 'openai-codex-acp':
        // Settings still live under the OpenAI Codex panel.
        return 'openai-codex';
      default:
        return 'claude-code';
    }
  };

  const handleConfigureModels = () => {
    setIsOpen(false);
    navigateToSettings({
      category: getSettingsCategoryForModel(currentModel),
      scope: 'user',
    });
    setWindowMode('settings');
  };

  const getCurrentModelName = () => {
    if (!currentModel) return 'Select Model';

    // Find the model in our list
    for (const providerModels of Object.values(models)) {
      const model = providerModels.find(m => m.id === currentModel);
      if (model) return model.name;
    }

    // Fallback - strip provider prefix for display
    if (currentModel.startsWith('claude-code:') && !showClaudeCliChannel) {
      return `Claude · ${getClaudeCodeModelShortLabel(currentModel)}`;
    }
    if (currentModel.startsWith('claude-code')) {
      return getClaudeCodeModelLabel(currentModel);
    }
    const [, ...modelParts] = currentModel.split(':');
    return modelParts.join(':') || currentModel;
  };

  const getProviderLabel = (provider: string) => {
    // Extension-contributed providers carry their manifest displayName from
    // ai:getModels; prefer it over the prettified-id fallback below.
    if (providerLabels[provider]) return providerLabels[provider];
    switch (provider) {
      case 'claude': return 'Claude Chat';
      case 'claude-code': return 'Claude';
      case 'claude-code-cli': return 'Claude Code CLI (Subscription)';
      case 'openai': return 'OpenAI';
      case 'openai-codex': return 'OpenAI Codex';
      case 'openai-codex-acp': return 'OpenAI Codex (ACP)';
      case 'opencode': return 'OpenCode';
      case 'copilot-cli': return 'GitHub Copilot';
      case 'lmstudio': return 'LMStudio';
      default: {
        // Extension-contributed providers carry their contribution id here
        // (e.g. "antigravity-gemini-agent"). Prettify it for the group header
        // rather than showing the raw id; the per-model names already come
        // from the extension manifest.
        const cleaned = provider.replace(/-agent$/, '').replace(/[-_]+/g, ' ').trim();
        return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) || provider;
      }
    }
  };

  const formatCatalogTime = (timestamp: number | null | undefined) => (
    typeof timestamp === 'number' ? new Date(timestamp).toLocaleString() : null
  );

  const isDynamicCatalogProvider = (provider: string) => (
    provider === 'claude-code' || provider === 'claude-code-cli' || provider === 'openai-codex'
  );

  const renderCatalogNotice = (provider: string) => {
    const status = catalogStatuses[provider];
    if (!status || !isDynamicCatalogProvider(provider)) return null;
    const cachedAt = formatCatalogTime(status.lastSuccessAt);
    if (status.lastError?.message) {
      return (
        <div
          className="mx-2 mb-1 rounded px-2 py-1 text-[10px] leading-relaxed text-[var(--nim-error)] bg-[rgba(239,68,68,0.08)]"
          data-testid={`model-catalog-status-${provider}`}
        >
          目录获取失败：{status.lastError.message}{cachedAt ? `。上次成功获取于 ${cachedAt}` : ''}。缓存仅供查看，不能创建会话。
        </div>
      );
    }
    if (!status.verified) {
      return (
        <div
          className="mx-2 mb-1 rounded px-2 py-1 text-[10px] leading-relaxed text-[var(--nim-warning)] bg-[rgba(245,158,11,0.08)]"
          data-testid={`model-catalog-status-${provider}`}
        >
          模型目录未验证，正在从引擎读取；此处的占位型号不可用于创建会话。
        </div>
      );
    }
    return null;
  };

  // Built-in chat-model providers are a small closed set. Built-in agent CLIs
  // are matched by isAgentProvider. Anything left over is an extension-
  // contributed agent provider id (e.g. antigravity-gemini-agent), which we
  // group under "Agents" so it surfaces the same way Codex / Claude Code do --
  // without the renderer needing the main-process AgentProviderRegistry.
  // Extension providers ship a Material icon name in their manifest; prefer it
  // so the picker header matches the Agent Providers sidebar. Built-ins fall
  // back to getProviderIcon.
  const renderProviderIcon = (provider: string, size: number) => {
    const ext = providerIcons[provider];
    if (ext) return <MaterialSymbol icon={ext} size={size} />;
    return getProviderIcon(provider, { size });
  };

  const CHAT_MODEL_PROVIDERS = new Set(['claude', 'openai', 'lmstudio']);
  const getProviderType = (provider: string): ProviderType => {
    if (isAgentProvider(provider)) return 'agent';
    if (CHAT_MODEL_PROVIDERS.has(provider)) return 'model';
    return 'agent';
  };

  const isProviderSwitchDisabled = (targetProvider: string): boolean => {
    return shouldBlockStartedSessionProviderSwitch(currentProvider, targetProvider, sessionHasMessages);
  };

  const isSectionDisabled = (sectionType: 'agent' | 'model'): boolean => {
    if (!sessionHasMessages || !currentProvider) return false;
    const currentProviderType = getProviderType(currentProvider);
    return sectionType !== currentProviderType;
  };

  // Group providers by type (agents vs models)
  const groupedProviders = Object.entries(models).reduce((acc, [provider, providerModels]) => {
    const isAgent = getProviderType(provider) === 'agent';
    const type = isAgent ? 'agents' : 'models';
    if (!acc[type]) acc[type] = {};
    acc[type][provider] = providerModels;
    return acc;
  }, {} as Record<'agents' | 'models', Record<string, Model[]>>);

  // Read-only chip: show the running provider/model without a dropdown. Used by
  // committed claude-code-cli sessions where the model is fixed at spawn.
  if (readOnly) {
    return (
      <div className="model-selector inline-block">
        <span
          className="model-selector-button model-selector-readonly flex items-center gap-1 px-2 py-[3px] rounded-xl text-[11px] font-medium whitespace-nowrap max-w-[200px] bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)] border border-[var(--nim-border)] cursor-default"
          aria-label={`Current model: ${getCurrentModelName()}`}
          data-testid="model-picker"
          title={readOnlyTitle}
        >
          <span className="model-selector-label overflow-hidden text-ellipsis">{getCurrentModelName()}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="model-selector inline-block">
      <button
        ref={refs.setReference}
        className="model-selector-button flex items-center gap-1 px-2 py-[3px] rounded-xl text-[11px] font-medium cursor-pointer transition-all duration-200 outline-none whitespace-nowrap max-w-[200px] bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)] border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)]"
        aria-label={`Current model: ${getCurrentModelName()}`}
        data-testid="model-picker"
        {...getReferenceProps({
          onClick: () => setIsOpen(open => !open),
        })}
      >
        <span className="model-selector-label overflow-hidden text-ellipsis">{getCurrentModelName()}</span>
        <MaterialSymbol icon="expand_more" size={14} className={`model-selector-arrow transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="model-selector-dropdown nim-scrollbar min-w-[240px] max-w-[320px] max-h-[min(400px,calc(100vh-24px))] overflow-y-auto rounded-lg p-1 z-[1000] bg-[var(--nim-bg)] border border-[var(--nim-border)] shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
            style={floatingStyles}
            {...getFloatingProps()}
          >
          {!loading && ['claude-code', 'openai-codex']
            // First-install placeholders are intentionally filtered out by
            // the main process so they can never be selected. Still render
            // their status here; otherwise a picker with other providers
            // would hide the required “unverified” explanation entirely.
            .filter((provider) => !models[provider] && (
              !!catalogStatuses[provider]?.lastError?.message
              || catalogStatuses[provider]?.verified !== true
            ))
            .map((provider) => (
              <React.Fragment key={`missing-catalog-${provider}`}>
                {renderCatalogNotice(provider)}
              </React.Fragment>
            ))}
          {loading ? (
            <div className="model-selector-loading p-3 text-center text-xs text-[var(--nim-text-faint)]">Loading models...</div>
          ) : Object.keys(models).length === 0 ? (
            <div className="model-selector-empty p-3 text-center text-xs text-[var(--nim-text-faint)]">No models available</div>
          ) : (
            <>
              {defaultModelWarning && (
                <div
                  className="mx-2 mb-1 rounded px-2 py-1.5 text-[10px] leading-relaxed text-[var(--nim-error)] bg-[rgba(239,68,68,0.08)]"
                  data-testid="model-default-unavailable"
                >
                  {defaultModelWarning}
                </div>
              )}
              {/* Agents Section */}
              {groupedProviders.agents && Object.keys(groupedProviders.agents).length > 0 && (
                <>
                  <div className="model-selector-section-header px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nim-text-faint)]">Agents</div>
                  {isSectionDisabled('agent') && (
                    <div className="model-selector-disabled-notice px-2 pt-1 pb-1.5 text-[11px] italic text-[var(--nim-text-faint)]">
                      Start a new session to use agents
                    </div>
                  )}
                  {Object.entries(groupedProviders.agents).map(([provider, providerModels]) => (
                    <div key={provider} className="model-selector-provider-group mb-1">
                      {/* Hover help (NIM-825): providers with a
                          model-picker-provider-<id> HelpContent entry get a
                          tooltip explaining the provider; others render
                          unchanged. */}
                      <HelpTooltip testId={`model-picker-provider-${provider}`} placement="right">
                        <div
                          className="model-selector-provider-header flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-[var(--nim-text-muted)]"
                          data-testid={`model-picker-provider-${provider}`}
                        >
                          {renderProviderIcon(provider, 12)}
                          <span>{getProviderLabel(provider)}</span>
                          {provider === 'claude-code' && (
                            <ClaudeIdentityBadge
                              authState={claudeAuthState}
                              apiKeys={apiKeys}
                            />
                          )}
                          {ALPHA_PROVIDERS.has(provider) && <AlphaBadge size="xs" />}
                        </div>
                      </HelpTooltip>
                      {renderCatalogNotice(provider)}
                      {providerModels.map(model => {
                        const isCurrent = model.id === currentModel;
                        const isUnverifiedPlaceholder = model.unverifiedPlaceholder === true;
                        const catalogFetchFailed = isDynamicCatalogProvider(provider)
                          && !!catalogStatuses[provider]?.lastError?.message;
                        const isDisabled = isProviderSwitchDisabled(provider) || isUnverifiedPlaceholder || catalogFetchFailed;
                        const disabledTooltip = catalogFetchFailed
                          ? '模型目录获取失败；上次成功缓存仅供查看，不能创建会话'
                          : isUnverifiedPlaceholder
                          ? '模型目录尚未验证，不能用占位型号创建会话'
                          : 'Start a new session to switch providers after the session has started';
                        return (
                          <button
                            key={model.id}
                            className={`model-selector-option flex items-center justify-between gap-2 pl-6 pr-2 py-1.5 w-full border-none rounded text-xs cursor-pointer transition-[background] duration-150 text-left text-[var(--nim-text)] ${isCurrent ? 'selected bg-[var(--nim-bg-secondary)] text-[var(--nim-primary)]' : ''} ${isDisabled ? 'disabled opacity-50 cursor-not-allowed' : 'hover:bg-[var(--nim-bg-hover)]'}`}
                            onClick={() => !isDisabled && handleModelSelect(model.id)}
                            title={isDisabled ? disabledTooltip : undefined}
                            aria-disabled={isDisabled}
                            disabled={isDisabled}
                          >
                            <span className={`model-selector-option-name flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${isDisabled ? 'text-[var(--nim-text-faint)]' : ''}`} title={model.resolvedModel ? `${model.description ?? ''}\nResolved: ${model.resolvedModel}`.trim() : model.description}>
                              {model.name}
                              {model.resolvedModel ? ` → ${model.resolvedModel}` : ''}
                            </span>
                            {isDisabled ? (
                              <MaterialSymbol icon="block" size={14} className="disabled-icon text-[var(--nim-text-faint)]" />
                            ) : isCurrent ? (
                              <MaterialSymbol icon="check" size={14} />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}

              {/* Chat with open document Section */}
              {groupedProviders.models && Object.keys(groupedProviders.models).length > 0 && (
                <>
                  {groupedProviders.agents && Object.keys(groupedProviders.agents).length > 0 && (
                    <div className="model-selector-divider h-px my-1 bg-[var(--nim-border)]" />
                  )}
                  <div className="model-selector-section-header px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nim-text-faint)]">Chat with open document</div>
                  {isSectionDisabled('model') && (
                    <div className="model-selector-disabled-notice px-2 pt-1 pb-1.5 text-[11px] italic text-[var(--nim-text-faint)]">
                      Start a new session to use chat models
                    </div>
                  )}
                  {Object.entries(groupedProviders.models).map(([provider, providerModels]) => (
                    <div key={provider} className="model-selector-provider-group mb-1">
                      <div className="model-selector-provider-header flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-[var(--nim-text-muted)]">
                        {renderProviderIcon(provider, 12)}
                        {getProviderLabel(provider)}
                      </div>
                      {providerModels.map(model => {
                        const isCurrent = model.id === currentModel;
                        const isUnverifiedPlaceholder = model.unverifiedPlaceholder === true;
                        const isDisabled = isProviderSwitchDisabled(provider) || isUnverifiedPlaceholder;
                        const disabledTooltip = isUnverifiedPlaceholder
                          ? '模型目录尚未验证，不能用占位型号创建会话'
                          : 'Start a new session to switch providers after the session has started';
                        return (
                          <button
                            key={model.id}
                            className={`model-selector-option flex items-center justify-between gap-2 pl-6 pr-2 py-1.5 w-full border-none rounded text-xs cursor-pointer transition-[background] duration-150 text-left text-[var(--nim-text)] ${isCurrent ? 'selected bg-[var(--nim-bg-secondary)] text-[var(--nim-primary)]' : ''} ${isDisabled ? 'disabled opacity-50 cursor-not-allowed' : 'hover:bg-[var(--nim-bg-hover)]'}`}
                            onClick={() => !isDisabled && handleModelSelect(model.id)}
                            title={isDisabled ? disabledTooltip : undefined}
                            aria-disabled={isDisabled}
                            disabled={isDisabled}
                          >
                            <span className={`model-selector-option-name flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${isDisabled ? 'text-[var(--nim-text-faint)]' : ''}`}>{model.name}</span>
                            {isDisabled ? (
                              <MaterialSymbol icon="block" size={14} className="disabled-icon text-[var(--nim-text-faint)]" />
                            ) : isCurrent ? (
                              <MaterialSymbol icon="check" size={14} />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}

              {/* Configure Models */}
              <div className="model-selector-divider h-px my-1 bg-[var(--nim-border)]" />
              <button
                className="model-selector-configure flex items-center gap-2 px-2 py-1.5 w-full bg-transparent border-none rounded text-xs cursor-pointer transition-[background] duration-150 text-left text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                onClick={handleConfigureModels}
              >
                <MaterialSymbol icon="settings" size={14} />
                <span>Configure models</span>
              </button>
            </>
          )}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

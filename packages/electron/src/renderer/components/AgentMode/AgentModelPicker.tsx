import React, { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { getClaudeCodeModelLabel } from '../../utils/modelUtils';
import { settingAtom } from '../../store/atoms/settingAtomFamily';
import { isNewSessionProviderVisible } from '../../../shared/claudeChannelVisibility';

export interface AgentModelOption {
  id: string;
  name: string;
  provider: string;
}

interface AgentModelPickerProps {
  models: AgentModelOption[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

const providerLabels: Record<string, string> = {
  'claude-code': 'Claude',
  'claude-code-cli': 'Claude Code CLI',
  'openai-codex': 'OpenAI Codex',
  'openai-codex-acp': 'OpenAI Codex (ACP)',
};

function getModelLabel(model: AgentModelOption): string {
  if (model.name) return model.name;
  if (model.id.startsWith('claude-code')) return getClaudeCodeModelLabel(model.id);
  const [, ...parts] = model.id.split(':');
  return parts.join(':') || model.id;
}

export function AgentModelPicker({
  models,
  selectedModel,
  onModelChange,
  isLoading = false,
  disabled = false,
}: AgentModelPickerProps) {
  const showClaudeCliChannel = useAtomValue(settingAtom('ai.showClaudeCliChannel'));
  const selectableModels = useMemo(
    () => models.filter((model) => (
      model.provider !== 'openai-codex-acp'
      && isNewSessionProviderVisible(model.provider, showClaudeCliChannel)
    )),
    [models, showClaudeCliChannel],
  );

  const groupedModels = useMemo(() => {
    return selectableModels.reduce((acc, model) => {
      const key = model.provider || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(model);
      return acc;
    }, {} as Record<string, AgentModelOption[]>);
  }, [selectableModels]);

  const hasModels = selectableModels.length > 0;
  const selectValue = hasModels ? selectedModel : '';
  const isDisabled = disabled || (!hasModels && !isLoading);

  return (
    <div className="merge-conflict-dialog-model flex flex-col gap-2 p-3 mb-4 rounded-lg bg-[var(--nim-bg-secondary)]">
      <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--nim-text)]">
        <MaterialSymbol icon="memory" size={16} />
        <span>Model</span>
      </div>
      <select
        className="w-full border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-xs px-2 py-1.5 focus:outline-none focus:border-[var(--nim-primary)]"
        value={selectValue}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={isDisabled}
      >
        {isLoading && (
          <option value={selectValue}>Loading models...</option>
        )}
        {!isLoading && !hasModels && (
          <option value="">No agent models available</option>
        )}
        {!isLoading && hasModels && Object.entries(groupedModels).map(([provider, providerModels]) => (
          <optgroup key={provider} label={providerLabels[provider] || provider}>
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {getModelLabel(model)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export default AgentModelPicker;

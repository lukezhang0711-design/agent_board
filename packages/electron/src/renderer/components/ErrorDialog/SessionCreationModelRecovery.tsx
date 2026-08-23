import React, { useState } from 'react';
import { useSetAtom } from 'jotai';
import { ModelSelector } from '../UnifiedAI/ModelSelector';
import { setAgentModeSettingsAtom } from '../../store/atoms/appSettings';

interface SessionCreationModelRecoveryProps {
  currentModel?: string;
  onResolved: () => void;
}

/**
 * Recovery affordance for a failed creation. It deliberately reuses the live
 * model picker instead of inventing a static fallback or selecting a model on
 * the user's behalf.
 */
export function SessionCreationModelRecovery({
  currentModel = '',
  onResolved,
}: SessionCreationModelRecoveryProps) {
  const [showPicker, setShowPicker] = useState(false);
  const setAgentModeSettings = useSetAtom(setAgentModeSettingsAtom);

  if (!showPicker) {
    return (
      <div className="mt-4">
        <button
          type="button"
          className="nim-btn-primary px-3 py-2 text-sm"
          data-testid="session-create-reselect-model"
          onClick={() => setShowPicker(true)}
        >
          重新选择模型
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2" data-testid="session-create-model-picker">
      <p className="m-0 text-sm text-[var(--nim-text-muted)]">
        请从当前引擎目录中选择模型；不会自动替换为其他型号。
      </p>
      <ModelSelector
        currentModel={currentModel}
        currentProvider={null}
        sessionHasMessages={false}
        onModelChange={(model) => {
          setAgentModeSettings({ defaultModel: model });
          onResolved();
        }}
      />
    </div>
  );
}

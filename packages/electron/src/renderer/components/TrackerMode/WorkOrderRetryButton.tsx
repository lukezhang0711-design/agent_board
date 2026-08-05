import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface WorkOrderRetryButtonProps {
  onRetry: () => void;
  retrying?: boolean;
}

export const WorkOrderRetryButton: React.FC<WorkOrderRetryButtonProps> = ({
  onRetry,
  retrying = false,
}) => (
  <button
    type="button"
    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-400/50 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
    onClick={onRetry}
    disabled={retrying}
    title="老板手动授权重试"
    data-testid="work-order-retry"
  >
    <MaterialSymbol icon={retrying ? 'hourglass_empty' : 'refresh'} size={15} />
    {retrying ? '重试中…' : '重试'}
  </button>
);

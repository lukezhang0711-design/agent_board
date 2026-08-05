import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface WorkOrderRetryButtonProps {
  onRetry: () => void;
  retrying?: boolean;
  workspaceId?: string;
  trackerItemId?: string;
}

const RETRY_OWNER_UNAVAILABLE_REASON = '原指挥官会话已不存在，无法重派';

interface RetryAvailability {
  canRetry: boolean;
  reason?: string;
}

export const WorkOrderRetryButton: React.FC<WorkOrderRetryButtonProps> = ({
  onRetry,
  retrying = false,
  workspaceId,
  trackerItemId,
}) => {
  const [availability, setAvailability] = React.useState<RetryAvailability>({
    canRetry: false,
    reason: '正在检查重试条件…',
  });

  React.useEffect(() => {
    let active = true;
    const workspace = workspaceId?.trim();
    const trackerItem = trackerItemId?.trim();
    if (!workspace || !trackerItem) {
      setAvailability({ canRetry: false, reason: RETRY_OWNER_UNAVAILABLE_REASON });
      return () => { active = false; };
    }

    setAvailability({ canRetry: false, reason: '正在检查重试条件…' });
    window.electronAPI.invoke('meta-agent:can-retry-work-order', {
      workspaceId: workspace,
      trackerItemId: trackerItem,
    }).then((result: { success?: boolean; canRetry?: boolean; reason?: string }) => {
      if (!active) return;
      if (result?.success && result.canRetry === true) {
        setAvailability({ canRetry: true });
        return;
      }
      setAvailability({
        canRetry: false,
        reason: result?.reason || RETRY_OWNER_UNAVAILABLE_REASON,
      });
    }).catch(() => {
      if (!active) return;
      setAvailability({ canRetry: false, reason: RETRY_OWNER_UNAVAILABLE_REASON });
    });

    return () => { active = false; };
  }, [workspaceId, trackerItemId]);

  const disabled = retrying || !availability.canRetry;
  const title = retrying
    ? '老板手动授权重试'
    : availability.reason || '老板手动授权重试';
  const handleClick = () => {
    if (!disabled) onRetry();
  };

  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-400/50 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        onClick={handleClick}
        disabled={disabled}
        title={title}
        data-testid="work-order-retry"
      >
        <MaterialSymbol icon={retrying ? 'hourglass_empty' : 'refresh'} size={15} />
        {retrying ? '重试中…' : '重试'}
      </button>
      {!retrying && !availability.canRetry && availability.reason && (
        <span className="text-[10px] text-nim-muted" data-testid="work-order-retry-reason">
          {availability.reason}
        </span>
      )}
    </span>
  );
};

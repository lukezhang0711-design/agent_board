import React, { useEffect, type RefObject } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { codexUsageAtom } from '../../store/atoms/codexUsageAtoms';
import { useSetSetting } from '../../hooks/useSetting';
import { useFloatingMenu, FloatingPortal } from '../../hooks/useFloatingMenu';
import { UsagePoolList, formatUsageLastUpdated } from '../UsageIndicator/UsagePoolList';

interface CodexUsagePopoverProps {
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const CodexUsagePopover: React.FC<CodexUsagePopoverProps> = ({
  anchorRef,
  onClose,
  onRefresh,
}) => {
  const usage = useAtomValue(codexUsageAtom);
  const setUsageIndicatorEnabled = useSetSetting('ai.showCodexUsageIndicator');
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const menu = useFloatingMenu({
    placement: 'right-end',
    open: true,
    onOpenChange: (open) => { if (!open) onClose(); },
  });

  useEffect(() => {
    if (anchorRef.current) menu.refs.setReference(anchorRef.current);
  }, [anchorRef, menu.refs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!usage) return null;
  const hasPools = Object.keys(usage.pools).length > 0;

  return (
    <FloatingPortal>
      <div
        ref={menu.refs.setFloating}
        style={menu.floatingStyles}
        {...menu.getFloatingProps()}
        className="codex-usage-popover w-64 overflow-y-auto rounded-lg border border-nim bg-nim-secondary shadow-lg z-50"
        data-testid="codex-usage-popover"
        data-component="CodexUsagePopover"
      >
        <div className="flex items-center justify-between border-b border-nim px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-nim-success"
            >
              <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
            </svg>
            <span className="text-[14px] font-semibold text-nim">Codex Usage</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="rounded p-1 text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim disabled:opacity-50"
              aria-label="Refresh usage"
            >
              <MaterialSymbol icon="refresh" size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim"
              aria-label="Close"
            >
              <MaterialSymbol icon="close" size={14} />
            </button>
          </div>
        </div>

        <div className="px-4 py-3">
          {usage.error && !hasPools ? (
            <div className="text-[13px] text-nim-error">{usage.error}</div>
          ) : (
            <>
              {usage.error && (
                <div className="mb-3 text-[11px] text-nim-warning">Refresh failed: {usage.error}</div>
              )}
              <UsagePoolList
                pools={usage.pools}
                emptyMessage="No Codex quota pools found in recent session data."
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-nim px-4 py-2">
          <div className="flex items-center justify-between">
            {usage.lastUpdated !== null && (
              <span className="text-[10px] text-nim-faint">
                Last updated {formatUsageLastUpdated(usage.lastUpdated)}
              </span>
            )}
            <button
              onClick={() => {
                setUsageIndicatorEnabled(false);
                onClose();
              }}
              className="text-[11px] text-nim-muted transition-colors hover:text-nim"
            >
              Disable
            </button>
          </div>
          <button
            onClick={() => window.electronAPI.openExternal('https://status.openai.com')}
            className="flex items-center gap-1 text-[11px] text-nim-muted transition-colors hover:text-nim"
          >
            <MaterialSymbol icon="open_in_new" size={12} />
            <span>OpenAI Status Page</span>
          </button>
        </div>
      </div>
    </FloatingPortal>
  );
};

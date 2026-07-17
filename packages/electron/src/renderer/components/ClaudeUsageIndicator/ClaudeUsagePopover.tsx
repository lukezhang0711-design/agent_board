import React, { useEffect, type RefObject } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { claudeUsageAtom } from '../../store/atoms/claudeUsageAtoms';
import { useSetSetting } from '../../hooks/useSetting';
import { useFloatingMenu, FloatingPortal } from '../../hooks/useFloatingMenu';
import { UsagePoolList, formatUsageLastUpdated } from '../UsageIndicator/UsagePoolList';

interface ClaudeUsagePopoverProps {
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const ClaudeUsagePopover: React.FC<ClaudeUsagePopoverProps> = ({
  anchorRef,
  onClose,
  onRefresh,
}) => {
  const usage = useAtomValue(claudeUsageAtom);
  const setUsageIndicatorEnabled = useSetSetting('ai.showUsageIndicator');
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
        className="claude-usage-popover w-64 overflow-y-auto rounded-lg border border-nim bg-nim-secondary shadow-lg z-50"
        data-testid="claude-usage-popover"
        data-component="ClaudeUsagePopover"
      >
        <div className="flex items-center justify-between border-b border-nim px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-nim-warning"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span className="text-[14px] font-semibold text-nim">Claude Usage</span>
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
                emptyMessage="No Claude quota pools returned by the Usage API."
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
            onClick={() => window.electronAPI.openExternal('https://status.anthropic.com')}
            className="flex items-center gap-1 text-[11px] text-nim-muted transition-colors hover:text-nim"
          >
            <MaterialSymbol icon="open_in_new" size={12} />
            <span>Anthropic Status Page</span>
          </button>
        </div>
      </div>
    </FloatingPortal>
  );
};

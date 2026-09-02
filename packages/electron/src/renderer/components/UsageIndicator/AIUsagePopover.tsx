import React, { useEffect, type RefObject } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { claudeUsageAtom, formatResetTime } from '../../store/atoms/claudeUsageAtoms';
import { claudeAuthStateAtom } from '../../store/atoms/claudeAuthAtoms';
import { codexUsageAtom } from '../../store/atoms/codexUsageAtoms';
import { geminiUsageAtom } from '../../store/atoms/geminiUsageAtoms';
import { useFloatingMenu, FloatingPortal } from '../../hooks/useFloatingMenu';
import { UsagePoolList, formatUsageLastUpdated } from './UsagePoolList';

interface AIUsagePopoverProps {
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

function getUtilizationColor(utilization: number): { text: string; bar: string } {
  if (utilization >= 80) return { text: 'text-nim-error', bar: 'bg-[var(--nim-error)]' };
  if (utilization >= 50) return { text: 'text-nim-warning', bar: 'bg-[var(--nim-warning)]' };
  return { text: 'text-nim-success', bar: 'bg-[var(--nim-success)]' };
}

export const AIUsagePopover: React.FC<AIUsagePopoverProps> = ({
  anchorRef,
  onClose,
  onRefresh,
}) => {
  const claudeUsage = useAtomValue(claudeUsageAtom);
  const claudeAuthState = useAtomValue(claudeAuthStateAtom);
  const codexUsage = useAtomValue(codexUsageAtom);
  const geminiUsage = useAtomValue(geminiUsageAtom);

  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const menu = useFloatingMenu({
    placement: 'right-end',
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
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

  const claudeHasPools = claudeUsage && Object.keys(claudeUsage.pools).length > 0;
  const claudeAuthHint = claudeUsage?.error?.includes('Usage authorization failed')
    ? claudeAuthState.status === 'logged-out'
      ? 'Claude 登录已失效。请重新登录后再刷新额度信息。'
      : claudeAuthState.status === 'logged-in'
        ? 'Claude 已登录，但用量 API 拒绝了额度授权。'
        : claudeAuthState.status === 'check-failed'
          ? 'Claude 登录状态无法验证；额度授权失败是独立问题。'
          : '正在重新检查 Claude 登录状态；额度授权失败是独立问题。'
    : null;

  const codexHasPools = codexUsage && Object.keys(codexUsage.pools).length > 0;
  const geminiLimitsAvailable = Boolean(geminiUsage?.limitsAvailable && (
    (geminiUsage.groups && geminiUsage.groups.length > 0) ||
    geminiUsage.fiveHour.utilization > 0 ||
    Boolean(geminiUsage.fiveHour.resetsAt)
  ));

  return (
    <FloatingPortal>
      <div
        ref={menu.refs.setFloating}
        style={menu.floatingStyles}
        {...menu.getFloatingProps()}
        className="ai-usage-popover w-80 max-h-[85vh] overflow-y-auto rounded-lg border border-nim bg-nim-secondary shadow-lg z-50 flex flex-col"
        data-testid="ai-usage-popover"
        data-component="AIUsagePopover"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-nim px-4 py-3 shrink-0 bg-nim-secondary sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <MaterialSymbol icon="speed" size={20} className="text-nim" />
            <span className="text-ui-subhead font-semibold text-nim">AI 用量</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="rounded p-1 text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim disabled:opacity-50"
              aria-label="刷新全部用量"
              title="刷新全部用量"
            >
              <MaterialSymbol icon="refresh" size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-nim-muted transition-colors hover:bg-nim-tertiary hover:text-nim"
              aria-label="关闭"
            >
              <MaterialSymbol icon="close" size={16} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex flex-col divide-y divide-nim px-4 py-2">
          {/* Section 1: Claude */}
          <div className="py-3" data-testid="ai-usage-section-claude">
            <div className="flex items-center gap-2 mb-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-nim-warning"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <span className="text-ui-body font-semibold text-nim">Claude Code</span>
            </div>

            {claudeUsage?.error && !claudeHasPools ? (
              <div className="text-ui-compact text-nim-error">
                <div>{claudeUsage.error}</div>
                {claudeAuthHint && (
                  <div className="mt-1 text-ui-caption text-nim-muted">{claudeAuthHint}</div>
                )}
              </div>
            ) : (
              <>
                {claudeUsage?.error && (
                  <div className="mb-2 text-ui-caption text-nim-warning">
                    <div>刷新失败：{claudeUsage.error}</div>
                    {claudeAuthHint && <div className="mt-0.5">{claudeAuthHint}</div>}
                  </div>
                )}
                <UsagePoolList
                  pools={claudeUsage?.pools ?? {}}
                  emptyMessage="用量 API 未返回 Claude 额度池。"
                />
              </>
            )}
          </div>

          {/* Section 2: Codex */}
          <div className="py-3" data-testid="ai-usage-section-codex">
            <div className="flex items-center gap-2 mb-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-nim-success"
              >
                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
              </svg>
              <span className="text-ui-body font-semibold text-nim">Codex</span>
            </div>

            {codexUsage?.error && !codexHasPools ? (
              <div className="text-ui-compact text-nim-error">{codexUsage.error}</div>
            ) : (
              <>
                {codexUsage?.error && (
                  <div className="mb-2 text-ui-caption text-nim-warning">
                    刷新失败：{codexUsage.error}
                  </div>
                )}
                <UsagePoolList
                  pools={codexUsage?.pools ?? {}}
                  emptyMessage="近期会话数据中未找到 Codex 额度池。"
                />
                {codexUsage?.credits && (
                  <div className="mt-2.5 pt-2 border-t border-nim/50 text-ui-caption text-nim-muted flex justify-between">
                    <span>积分</span>
                    <span>
                      {codexUsage.credits.unlimited
                        ? '无限制'
                        : codexUsage.credits.balance !== null
                          ? `剩余 ${codexUsage.credits.balance}`
                          : '可用'}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Section 3: Gemini (Antigravity) */}
          <div className="py-3" data-testid="ai-usage-section-gemini">
            <div className="flex items-center gap-2 mb-2.5">
              <MaterialSymbol icon="gemini" size={18} className="text-blue-500" />
              <span className="text-ui-body font-semibold text-nim">Gemini (Antigravity)</span>
            </div>

            {/* Branch A: Real Quota from Desktop App */}
            {geminiLimitsAvailable ? (
              <div className="flex flex-col gap-3" data-testid="gemini-desktop-quota">
                {geminiUsage?.groups && geminiUsage.groups.length > 0 ? (
                  geminiUsage.groups.map((group) => (
                    <div key={group.groupName} className="flex flex-col gap-2">
                      <div className="text-ui-caption font-semibold text-nim-muted uppercase tracking-wider">
                        {group.groupName}
                      </div>
                      {group.models.map((model) => {
                        const colors = getUtilizationColor(model.utilization);
                        const barWidth = Math.max(0, Math.min(100, model.utilization));
                        return (
                          <div
                            key={model.model}
                            className="usage-pool-row"
                            data-testid={`gemini-quota-row-${model.model}`}
                          >
                            <div className="mb-1 flex items-baseline justify-between gap-3">
                              <div className="truncate text-ui-body font-semibold text-nim" title={model.label}>
                                {model.label}
                              </div>
                              <div className={`shrink-0 text-ui-subhead font-semibold ${colors.text}`}>
                                {model.utilization}%
                              </div>
                            </div>
                            <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-nim-tertiary">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                            <div className="flex items-center gap-1 text-ui-caption text-nim-muted">
                              <MaterialSymbol icon="schedule" size={12} className="opacity-70" />
                              <span>
                                {model.resetsAt
                                  ? `${formatResetTime(model.resetsAt)}后重置`
                                  : '重置时间不可用'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                ) : (
                  // Fallback if groups not formatted
                  <div className="flex flex-col gap-2">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <div className="text-ui-body font-semibold text-nim">会话</div>
                      <div className="text-ui-subhead font-semibold text-nim">
                        {Math.round(geminiUsage?.fiveHour?.utilization ?? 0)}%
                      </div>
                    </div>
                    <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-nim-tertiary">
                      <div
                        className="h-full rounded-full bg-green-500"
                        style={{ width: `${Math.min(geminiUsage?.fiveHour?.utilization ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Branch B: Token Fallback without Progress Bar */
              <div
                className="flex flex-col gap-1.5 p-2.5 rounded-md bg-nim-tertiary/50 border border-nim/50 text-ui-compact"
                data-testid="gemini-token-fallback"
              >
                <div className="flex items-center justify-between">
                  <span className="text-nim-muted">已消耗 Token</span>
                  <span className="font-semibold text-nim font-mono text-ui-body">
                    {(geminiUsage?.tokenUsage?.totalTokens ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="text-ui-caption text-nim-faint">
                  （本次会话累计消耗，非剩余额度）
                </div>
                <div className="mt-1 text-ui-caption text-nim-muted">
                  原因：{geminiUsage?.error || 'Antigravity 桌面版未运行。请先打开 Antigravity 并确认已登录，然后重新打开用量浮窗。'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-1.5 border-t border-nim px-4 py-2.5 shrink-0 bg-nim-secondary mt-auto">
          <div className="text-ui-micro text-nim-faint mb-1">
            {claudeUsage?.lastUpdated && (
              <span>上次更新于 {formatUsageLastUpdated(claudeUsage.lastUpdated)}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-caption text-nim-muted">
            <button
              onClick={() => window.electronAPI.openExternal('https://status.anthropic.com')}
              className="flex items-center gap-1 hover:text-nim transition-colors"
            >
              <MaterialSymbol icon="open_in_new" size={12} />
              <span>Anthropic</span>
            </button>
            <button
              onClick={() => window.electronAPI.openExternal('https://status.openai.com')}
              className="flex items-center gap-1 hover:text-nim transition-colors"
            >
              <MaterialSymbol icon="open_in_new" size={12} />
              <span>OpenAI</span>
            </button>
            <button
              onClick={() => window.electronAPI.openExternal('https://status.cloud.google.com/')}
              className="flex items-center gap-1 hover:text-nim transition-colors"
            >
              <MaterialSymbol icon="open_in_new" size={12} />
              <span>Google Cloud</span>
            </button>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
};

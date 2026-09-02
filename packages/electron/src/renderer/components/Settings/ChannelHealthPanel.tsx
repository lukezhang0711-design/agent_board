import React, { useCallback, useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { settingAtom } from '../../store/atoms/settingAtomFamily';
import { apiKeysAtom } from '../../store/atoms/appSettings';
import { filterVisibleChannelHealthResults } from '../../../shared/claudeChannelVisibility';
import { SettingsToggle } from '../GlobalSettings/SettingsToggle';
import { PageHeader } from '../common/PageHeader';

export { filterVisibleChannelHealthResults } from '../../../shared/claudeChannelVisibility';

type ChannelHealthState = 'never' | 'healthy' | 'slow' | 'failed' | 'unknown' | 'disabled';
type ChannelHealthFailureKind =
  | 'not_logged_in'
  | 'missing_binary'
  | 'not_started'
  | 'timeout'
  | 'missing_api_key'
  | 'auth_check_timeout'
  | 'auth_check_unknown'
  | 'engine_error';

export interface ChannelHealthResultView {
  id: string;
  displayName: string;
  transport: 'streaming' | 'claude-cli';
  state: ChannelHealthState;
  checkedAt?: number;
  firstResponseMs?: number;
  completionMs?: number;
  failureKind?: ChannelHealthFailureKind;
  exitCode?: number;
  summary?: string;
  guidance?: string;
  rawOutput?: string;
}

export function getReLoginCommand(channelId: string): string {
  if (channelId === 'claude-code' || channelId === 'claude-code-cli') {
    return 'claude /login';
  }
  if (channelId === 'openai-codex' || channelId === 'openai-codex-acp') {
    return 'codex login';
  }
  if (channelId === 'antigravity-gemini-agent') {
    return 'antigravity auth login';
  }
  return 'claude /login';
}

interface ChannelHealthSnapshotView {
  running: boolean;
  results: ChannelHealthResultView[];
}

interface ModelCatalogStatusView {
  modelSource?: 'runtime' | 'cache' | 'placeholder' | 'none';
  verified?: boolean;
  lastSuccessAt?: number | null;
  lastError?: { message?: string } | null;
}

const EMPTY_SNAPSHOT: ChannelHealthSnapshotView = { running: false, results: [] };

function formatMs(ms: number | undefined): string {
  if (typeof ms !== 'number') return '—';
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)} 秒` : `${Math.round(ms)} 毫秒`;
}

function formatCheckedAt(timestamp: number | undefined): string {
  if (!timestamp) return '尚未体检';
  return `上次体检：${new Date(timestamp).toLocaleString()}`;
}

function formatCatalogStatus(status: ModelCatalogStatusView | undefined): { text: string; title?: string } | null {
  if (!status) return null;
  const cachedAt = typeof status.lastSuccessAt === 'number'
    ? `上次成功获取于 ${new Date(status.lastSuccessAt).toLocaleString()}`
    : null;
  if (status.lastError?.message) {
    return { text: `目录获取失败：${status.lastError.message}`, title: cachedAt ?? undefined };
  }
  if (!status.verified) return { text: '模型目录未验证，等待从引擎读取。', title: cachedAt ?? undefined };
  return cachedAt ? { text: '目录已验证', title: cachedAt } : null;
}

export function ChannelHealthRow({
  result,
  running,
  onRerun,
}: {
  result: ChannelHealthResultView;
  running: boolean;
  onRerun: (channelId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const status = result.state === 'disabled'
    ? { icon: 'pause_circle', className: 'text-[var(--nim-text-faint)]', text: '未启用' }
    : result.state === 'healthy'
      ? {
        icon: 'check_circle',
        className: 'text-[var(--nim-success)]',
        text: `${result.summary || '通畅'} · ${formatMs(result.completionMs)}`,
      }
      : result.state === 'slow'
        ? { icon: 'warning', className: 'text-[var(--nim-warning)]', text: `较慢 · ${formatMs(result.completionMs)}` }
        : result.state === 'failed'
          ? { icon: 'error', className: 'text-[var(--nim-error)]', text: `失败 · ${result.summary || '引擎错误'}` }
          : result.state === 'unknown'
            ? { icon: 'help', className: 'text-[var(--nim-text-faint)]', text: result.summary || '检测状态未知' }
            : { icon: 'help', className: 'text-[var(--nim-text-faint)]', text: '尚未体检' };
  const failureGuidance = result.guidance ?? (
    typeof result.exitCode === 'number'
      ? `引擎异常退出（退出码 ${result.exitCode}），请检查引擎配置后重试`
      : undefined
  );
  const canRerun = result.state !== 'disabled';

  return (
    <section
      className="channel-health-row rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-4"
      data-testid={`channel-health-row-${result.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="m-0 text-sm font-medium text-[var(--nim-text)]">{result.displayName}</h4>
            <span
              className={`channel-health-status inline-flex items-center gap-1 text-xs font-medium ${status.className}`}
              data-testid={`channel-health-status-${result.id}`}
              title={result.state === 'disabled' ? undefined : formatCheckedAt(result.checkedAt)}
            >
              <MaterialSymbol icon={status.icon} size={16} />
              {status.text}
            </span>
          </div>
          {result.state === 'disabled' && (
            <p className="mt-1 mb-0 text-xs text-[var(--nim-text-muted)]">未启用，不发送请求</p>
          )}
          {(result.state === 'failed' || result.state === 'unknown') && failureGuidance && (
            <p className={`mt-2 mb-0 text-xs ${result.state === 'failed' ? 'text-[var(--nim-error)]' : 'text-[var(--nim-text-muted)]'}`} data-testid={`channel-health-guidance-${result.id}`}>
              {failureGuidance}
            </p>
          )}
          {result.failureKind === 'not_logged_in' && (
            <div
              className="mt-2.5 flex flex-col gap-1.5 rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] p-2.5 text-xs"
              data-testid={`channel-health-relogin-exit-${result.id}`}
            >
              {result.rawOutput && (
                <div className="font-mono text-ui-caption text-[var(--nim-text-muted)] break-all" data-testid={`channel-health-raw-output-${result.id}`}>
                  <span className="font-sans text-[var(--nim-text-faint)]">引擎原话：</span>{result.rawOutput}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[var(--nim-text)]">
                  <span className="text-[var(--nim-text-muted)]">重登命令：</span>
                  <code
                    className="rounded bg-[var(--nim-bg-secondary)] px-1.5 py-0.5 font-mono text-ui-caption text-[var(--nim-text)] border border-[var(--nim-border)]"
                    data-testid={`channel-health-relogin-command-${result.id}`}
                  >
                    {getReLoginCommand(result.id)}
                  </code>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-2 py-1 text-ui-caption text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] transition-colors cursor-pointer"
                  onClick={() => {
                    void navigator.clipboard.writeText(getReLoginCommand(result.id));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  data-testid={`channel-health-copy-relogin-${result.id}`}
                >
                  {copied ? '已复制' : '复制命令'}
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] px-2.5 py-1.5 text-xs text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onRerun(result.id)}
          disabled={running || !canRerun}
          data-testid={`channel-health-rerun-${result.id}`}
        >
          {!canRerun ? '请先启用' : running ? '体检中…' : '重新体检'}
        </button>
      </div>
    </section>
  );
}

export function ChannelHealthPanel({ workspacePath }: { workspacePath?: string }) {
  const [autoCheckOnStartup, setAutoCheckOnStartup] = useAtom(
    settingAtom('ai.channelHealth.autoCheckOnStartup'),
  );
  const showClaudeCliChannel = useAtomValue(settingAtom('ai.showClaudeCliChannel'));
  const apiKeys = useAtomValue(apiKeysAtom);
  const [snapshot, setSnapshot] = useState<ChannelHealthSnapshotView>(EMPTY_SNAPSHOT);
  const [catalogs, setCatalogs] = useState<Record<string, ModelCatalogStatusView>>({});
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI.invoke('channel-health:get') as ChannelHealthSnapshotView;
      setSnapshot({
        running: next?.running === true,
        results: Array.isArray(next?.results) ? next.results : [],
      });
      const catalogResult = await window.electronAPI.invoke('ai:getModelCatalogStatus') as {
        catalogs?: Record<string, ModelCatalogStatusView>;
      };
      if (catalogResult?.catalogs) setCatalogs(catalogResult.catalogs);
      setRequestError(null);
    } catch {
      setRequestError('无法读取体检结果，请重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, showClaudeCliChannel, apiKeys?.anthropic]);

  useEffect(() => {
    if (!snapshot.running) return;
    const timer = window.setInterval(() => void refresh(), 750);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot.running]);

  const run = useCallback(async (channelId?: string, deep = false) => {
    if (channelId === 'claude-code-cli' && showClaudeCliChannel !== true) return;
    if (!workspacePath) {
      setRequestError('请先打开项目，再运行通道体检。');
      return;
    }
    setRequestError(null);
    setSnapshot((current) => ({ ...current, running: true }));
    try {
      const next = await window.electronAPI.invoke(
        deep ? 'channel-health:run-deep' : 'channel-health:run',
        workspacePath,
        channelId,
      ) as ChannelHealthSnapshotView;
      setSnapshot({
        running: next?.running === true,
        results: Array.isArray(next?.results) ? next.results : [],
      });
      const catalogResult = await window.electronAPI.invoke('ai:getModelCatalogStatus') as {
        catalogs?: Record<string, ModelCatalogStatusView>;
      };
      if (catalogResult?.catalogs) setCatalogs(catalogResult.catalogs);
    } catch {
      setRequestError(`${deep ? '深度体检' : '体检'}启动失败，请检查项目和引擎配置后重试。`);
      await refresh();
    }
  }, [refresh, showClaudeCliChannel, workspacePath]);

  const visibleResults = filterVisibleChannelHealthResults(snapshot.results, {
    showClaudeCliChannel,
    hasAnthropicApiKey: typeof apiKeys?.anthropic === 'string' && apiKeys.anthropic.trim().length > 0,
  });

  return (
    <div className="channel-health-panel provider-panel flex flex-col" data-testid="channel-health-panel">
      <PageHeader
        icon="health_and_safety"
        title={<span className="provider-panel-title">通道体检</span>}
        count={visibleResults.length}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-[var(--nim-primary)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void run()}
              disabled={snapshot.running || !workspacePath}
              data-testid="channel-health-run-all"
            >
              {snapshot.running ? '体检中…' : '体检全部'}
            </button>
            <button
              type="button"
              className="rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] px-3 py-2 text-xs font-medium text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void run(undefined, true)}
              disabled={snapshot.running || !workspacePath}
              data-testid="channel-health-run-deep"
              title="会向每个已启用通道发送一句固定提示"
            >
              深度体检
            </button>
          </div>
        }
        className="provider-panel-header mb-6"
      />

      <SettingsToggle
        checked={autoCheckOnStartup}
        onChange={(enabled) => { void setAutoCheckOnStartup(enabled); }}
        name="启动时后台体检"
        testId="channel-health-startup-toggle"
      />

      {(['claude-code', 'openai-codex'] as const).map((provider) => {
        const message = formatCatalogStatus(catalogs[provider]);
        return message ? (
          <p
            key={provider}
            data-testid={`model-catalog-health-${provider}`}
            className={`mb-2 text-xs ${catalogs[provider]?.lastError ? 'text-[var(--nim-error)]' : 'text-[var(--nim-text-muted)]'}`}
            title={message.title}
          >
            {provider === 'claude-code' ? 'Claude 模型目录：' : 'Codex 模型目录：'}{message.text}
          </p>
        ) : null;
      })}

      {requestError && (
        <p className="mb-3 text-sm text-[var(--nim-error)]" role="alert">{requestError}</p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--nim-text-muted)]">正在读取体检结果…</p>
      ) : visibleResults.length === 0 ? (
        <p className="text-sm text-[var(--nim-text-muted)]">当前没有已启用的引擎通道。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleResults.map((result) => (
            <ChannelHealthRow
              key={result.id}
              result={result}
              running={snapshot.running}
              onRerun={(channelId) => void run(channelId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

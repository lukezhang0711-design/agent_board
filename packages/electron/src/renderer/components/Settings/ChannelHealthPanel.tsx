import React, { useCallback, useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { settingAtom } from '../../store/atoms/settingAtomFamily';
import { SettingsToggle } from '../GlobalSettings/SettingsToggle';

type ChannelHealthState = 'never' | 'healthy' | 'slow' | 'failed' | 'unknown' | 'disabled';
type ChannelHealthFailureKind =
  | 'not_logged_in'
  | 'missing_binary'
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
}

interface ChannelHealthSnapshotView {
  running: boolean;
  results: ChannelHealthResultView[];
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

export function ChannelHealthRow({
  result,
  running,
  onRerun,
}: {
  result: ChannelHealthResultView;
  running: boolean;
  onRerun: (channelId: string) => void;
}) {
  const status = result.state === 'disabled'
    ? { icon: 'pause_circle', className: 'text-[var(--nim-text-faint)]', text: '未启用' }
    : result.state === 'healthy'
      ? { icon: 'check_circle', className: 'text-[var(--nim-success)]', text: `通畅 · ${formatMs(result.completionMs)}` }
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
            >
              <MaterialSymbol icon={status.icon} size={16} />
              {status.text}
            </span>
          </div>
          <p className="mt-1 mb-0 text-xs text-[var(--nim-text-muted)]">
            {result.state === 'disabled' ? '未启用，不发送请求' : formatCheckedAt(result.checkedAt)}
            {typeof result.firstResponseMs === 'number' && ` · 首响 ${formatMs(result.firstResponseMs)}`}
          </p>
          {(result.state === 'failed' || result.state === 'unknown') && failureGuidance && (
            <p className={`mt-2 mb-0 text-xs ${result.state === 'failed' ? 'text-[var(--nim-error)]' : 'text-[var(--nim-text-muted)]'}`} data-testid={`channel-health-guidance-${result.id}`}>
              {failureGuidance}
            </p>
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
  const [snapshot, setSnapshot] = useState<ChannelHealthSnapshotView>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI.invoke('channel-health:get') as ChannelHealthSnapshotView;
      setSnapshot({
        running: next?.running === true,
        results: Array.isArray(next?.results) ? next.results : [],
      });
      setRequestError(null);
    } catch {
      setRequestError('无法读取体检结果，请重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!snapshot.running) return;
    const timer = window.setInterval(() => void refresh(), 750);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot.running]);

  const run = useCallback(async (channelId?: string) => {
    if (!workspacePath) {
      setRequestError('请先打开项目，再运行通道体检。');
      return;
    }
    setRequestError(null);
    setSnapshot((current) => ({ ...current, running: true }));
    try {
      const next = await window.electronAPI.invoke(
        'channel-health:run',
        workspacePath,
        channelId,
      ) as ChannelHealthSnapshotView;
      setSnapshot({
        running: next?.running === true,
        results: Array.isArray(next?.results) ? next.results : [],
      });
    } catch {
      setRequestError('体检启动失败，请检查项目和引擎配置后重试。');
      await refresh();
    }
  }, [refresh, workspacePath]);

  return (
    <div className="channel-health-panel provider-panel flex flex-col" data-testid="channel-health-panel">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="provider-panel-title m-0 text-xl font-semibold text-[var(--nim-text)]">通道体检</h3>
            <p className="provider-panel-description mt-2 mb-0 text-sm leading-relaxed text-[var(--nim-text-muted)]">
              用各通道现有发送链路发送固定的一句话，确认壳层没有让引擎哑火。
            </p>
          </div>
          <button
            type="button"
            className="rounded bg-[var(--nim-primary)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void run()}
            disabled={snapshot.running || !workspacePath}
            data-testid="channel-health-run-all"
          >
            {snapshot.running ? '体检中…' : '体检全部'}
          </button>
        </div>
      </div>

      <SettingsToggle
        checked={autoCheckOnStartup}
        onChange={(enabled) => { void setAutoCheckOnStartup(enabled); }}
        name="启动时后台体检"
        description="默认开启；同一通道 10 分钟内不会重复自动体检。"
        testId="channel-health-startup-toggle"
      />

      <p className="my-3 text-xs text-[var(--nim-text-muted)]">
        每次体检会向每个已启用通道发送固定极短提示，并消耗极少量引擎额度。
      </p>

      {requestError && (
        <p className="mb-3 text-sm text-[var(--nim-error)]" role="alert">{requestError}</p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--nim-text-muted)]">正在读取体检结果…</p>
      ) : snapshot.results.length === 0 ? (
        <p className="text-sm text-[var(--nim-text-muted)]">当前没有已启用的引擎通道。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {snapshot.results.map((result) => (
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

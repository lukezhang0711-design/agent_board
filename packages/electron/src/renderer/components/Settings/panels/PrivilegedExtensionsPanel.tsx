/**
 * Settings -> Extensions -> Privileged Capabilities
 *
 * Lists every extension currently holding a privileged grant in this
 * workspace context (workspace + global scope), shows the live host state,
 * and surfaces the in-memory usage timeline so the user can see what these
 * modules have actually done.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { extensionPermissionHostStateVersionAtom } from '../../../store/atoms/extensionPermissions';
import { PageHeader } from '../../common/PageHeader';

interface PrivilegedExtensionsPanelProps {
  workspacePath?: string;
}

interface RegistryDescriptor {
  id: string;
  label: string;
  description: string;
  risk: 'low' | 'elevated' | 'high';
}

interface EnabledModuleRow {
  extensionId: string;
  moduleId: string;
  scopes: Array<'workspace' | 'global'>;
}

const TIMELINE_LIMIT = 25;

export const PrivilegedExtensionsPanel: React.FC<PrivilegedExtensionsPanelProps> = ({
  workspacePath,
}) => {
  const [enabledModules, setEnabledModules] = useState<EnabledModuleRow[]>([]);
  const [hostState, setHostState] = useState<ModuleHandleRow[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummaryRow[]>([]);
  const [recent, setRecent] = useState<UsageEventRow[]>([]);
  const [descriptors, setDescriptors] = useState<RegistryDescriptor[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostStateVersion = useAtomValue(extensionPermissionHostStateVersionAtom);

  const api = window.electronAPI?.extensions?.permissions;

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const [mods, state, summary, events, descs] = await Promise.all([
        api.listEnabledModules(workspacePath),
        api.listHostState(),
        api.usageSummary(),
        api.usageEventsAll(),
        api.listDescriptors(),
      ]);
      setEnabledModules(mods);
      setHostState(state);
      setUsageSummary(summary);
      setRecent(events.slice(-TIMELINE_LIMIT).reverse());
      setDescriptors(descs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load privileged extensions');
    }
  }, [api, workspacePath]);

  useEffect(() => {
    if (!api) return;
    // hostStateVersion bumps from the central listener whenever the host
    // emits a state-changed event; listing it as a dep re-runs the reload
    // without each panel needing its own IPC subscription.
    void reload();
  }, [api, hostStateVersion, reload]);

  const descriptorById = useMemo(() => {
    const map = new Map<string, RegistryDescriptor>();
    for (const d of descriptors) map.set(d.id, d);
    return map;
  }, [descriptors]);

  const handleRevoke = useCallback(
    async (extensionId: string, moduleId: string, scope: 'workspace' | 'global') => {
      if (!api) return;
      const key = `${extensionId}::${moduleId}::${scope}`;
      setBusy(key);
      try {
        await api.revokeModule({
          extensionId,
          moduleId,
          scope,
          workspacePath: workspacePath ?? '',
        });
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [api, reload, workspacePath]
  );

  if (!api) {
    return null;
  }

  return (
    <div className="privileged-extensions-panel max-w-4xl">
      <PageHeader
        icon="admin_panel_settings"
        title="Privileged Capabilities"
        subtitle="Extensions that have been granted permission to run code outside the app"
        className="mb-5"
      />

      {error && (
        <div className="mb-4 rounded-ui-base border border-[var(--nim-error)] bg-[color-mix(in_srgb,var(--nim-error)_8%,transparent)] p-3 text-ui-body text-[var(--nim-error)]">
          {error}
        </div>
      )}

      {enabledModules.length === 0 ? (
        <div className="rounded-ui-base border border-[var(--nim-border)] bg-[var(--nim-bg)] p-4 text-ui-body text-[var(--nim-text-muted)]">
          No extensions currently hold privileged grants.
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-6">
          {enabledModules.map((row) => {
            const handle = hostState.find(
              (h) =>
                h.extensionId === row.extensionId &&
                h.moduleId === row.moduleId &&
                h.workspacePath === (workspacePath ?? h.workspacePath)
            );
            const statusVal = handle?.state && (handle.state as { status?: string }).status;
            const status = typeof statusVal === 'string' ? statusVal : null;
            const summaryRows = usageSummary.filter(
              (s) => s.extensionId === row.extensionId && s.moduleId === row.moduleId
            );
            const totalCalls = summaryRows.reduce((acc, s) => acc + s.total, 0);
            const totalDenied = summaryRows.reduce((acc, s) => acc + s.denied, 0);

            return (
              <div
                key={`${row.extensionId}::${row.moduleId}`}
                className="privileged-extension rounded-ui-base border border-[var(--nim-border)] bg-[var(--nim-bg)] p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-ui-body font-medium text-[var(--nim-text)]">
                    <MaterialSymbol icon="extension" size={16} />
                    {row.extensionId}
                    <span className="text-ui-compact text-[var(--nim-text-faint)] font-mono">/{row.moduleId}</span>
                  </div>
                  {status && (
                    <span className="text-ui-micro font-semibold uppercase tracking-wider px-2 py-0.5 rounded-ui-base bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                      {status}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-2 text-ui-compact text-[var(--nim-text-muted)]">
                  <span>
                    Calls: <span className="text-[var(--nim-text)]">{totalCalls}</span>
                  </span>
                  {totalDenied > 0 && (
                    <span className="text-[var(--nim-error)]">denied: {totalDenied}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row.scopes.includes('workspace') && (
                    <button
                      type="button"
                      className="px-2 py-1 text-ui-compact rounded-ui-base border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] disabled:opacity-50"
                      disabled={
                        !workspacePath ||
                        busy === `${row.extensionId}::${row.moduleId}::workspace`
                      }
                      onClick={() => handleRevoke(row.extensionId, row.moduleId, 'workspace')}
                    >
                      Revoke (this workspace)
                    </button>
                  )}
                  {row.scopes.includes('global') && (
                    <button
                      type="button"
                      className="px-2 py-1 text-ui-compact rounded-ui-base border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] disabled:opacity-50"
                      disabled={busy === `${row.extensionId}::${row.moduleId}::global`}
                      onClick={() => handleRevoke(row.extensionId, row.moduleId, 'global')}
                    >
                      Revoke (all workspaces)
                    </button>
                  )}
                </div>

                {summaryRows.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {summaryRows.map((s) => {
                      const d = descriptorById.get(s.permissionId);
                      return (
                        <span
                          key={s.permissionId}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-ui-micro rounded-ui-base border border-[var(--nim-border)] text-[var(--nim-text-muted)]"
                          title={`${s.allowed} allowed, ${s.denied} denied`}
                        >
                          <MaterialSymbol icon="shield" size={10} />
                          {d?.label ?? s.permissionId}
                          <span className="font-mono">{s.total}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-2 text-ui-compact font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide">
        Recent activity
      </div>
      {recent.length === 0 ? (
        <div className="rounded-ui-base border border-[var(--nim-border)] bg-[var(--nim-bg)] p-3 text-ui-compact text-[var(--nim-text-muted)]">
          No privileged-capability calls recorded yet this session.
        </div>
      ) : (
        <div className="rounded-ui-base border border-[var(--nim-border)] bg-[var(--nim-bg)] divide-y divide-[var(--nim-border)]">
          {recent.map((evt, idx) => {
            const d = descriptorById.get(evt.permissionId);
            return (
              <div
                key={`${evt.timestamp}::${idx}`}
                className="flex items-center gap-2 px-3 py-2 text-ui-compact"
              >
                <span
                  className={`shrink-0 ${evt.outcome === 'denied' ? 'text-[var(--nim-error)]' : 'text-[var(--nim-success)]'}`}
                >
                  <MaterialSymbol
                    icon={evt.outcome === 'denied' ? 'block' : 'check_circle'}
                    size={12}
                  />
                </span>
                <span className="text-[var(--nim-text-faint)] tabular-nums w-[60px] shrink-0">
                  {formatTime(evt.timestamp)}
                </span>
                <span className="font-mono text-[var(--nim-text-muted)] truncate">
                  {evt.extensionId}/{evt.moduleId}
                </span>
                <span className="text-[var(--nim-text)] truncate">
                  {d?.label ?? evt.permissionId}
                </span>
                {evt.method && (
                  <span className="ml-auto text-[var(--nim-text-faint)] font-mono truncate">
                    {evt.method}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

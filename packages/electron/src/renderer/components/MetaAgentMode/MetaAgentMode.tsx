import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import { defaultAgentModelAtom } from '../../store/atoms/appSettings';
import { settingAtom } from '../../store/atoms/settingAtomFamily';
import { sessionRegistryAtom } from '../../store';
import { filePreviewWidthAtom, setFilePreviewWidthAtom } from '../../store/atoms/agentMode';
import { createMetaAgentSession } from '../../utils/metaAgentUtils';
import { resolveTranscriptClickPath } from '../../utils/resolveTranscriptClickPath';
import { SessionTranscript } from '../UnifiedAI/SessionTranscript';
import { FilePreviewRail, type ArtifactShelfItem } from './FilePreviewRail';
import { AgentBusyIndicator } from '../common/AgentBusyIndicator';
import { PageHeader } from '../common/PageHeader';
import { StatusBadge } from '../common/StatusBadge';

interface MetaAgentModeProps {
  workspacePath: string;
  isActive?: boolean;
  /** If provided, use this session ID directly instead of finding/creating one */
  sessionId?: string;
}

interface SpawnedSessionSummary {
  sessionId: string;
  title: string;
  provider: string;
  model: string | null;
  status: string;
  lastActivity: number | null;
  originalPrompt: string | null;
  lastResponse: string | null;
  editedFiles: string[];
  pendingPrompt: {
    promptId: string;
    promptType: string;
  } | null;
  createdAt: number;
  updatedAt: number;
  worktreeId?: string | null;
}

export function MetaAgentMode({
  workspacePath,
  isActive = false,
  sessionId: externalSessionId,
}: MetaAgentModeProps) {
  const defaultModel = useAtomValue(defaultAgentModelAtom);
  const showClaudeCliChannel = useAtomValue(settingAtom('ai.showClaudeCliChannel'));
  const [metaSessionId, setMetaSessionId] = useState<string | null>(null);
  const [planAutoApproveEnabled, setPlanAutoApproveEnabled] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [childSessions, setChildSessions] = useState<SpawnedSessionSummary[]>([]);
  // Right rail: collapsed by default, and `previewPath` survives a collapse so
  // reopening lands back on the file the user was last looking at.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const previewWidth = useAtomValue(filePreviewWidthAtom);
  const setPreviewWidth = useSetAtom(setFilePreviewWidthAtom);

  const createMetaSession = useCallback(
    async (): Promise<string | null> => {
      const result = await createMetaAgentSession(workspacePath, defaultModel, showClaudeCliChannel);
      return result?.id ?? null;
    },
    [defaultModel, showClaudeCliChannel, workspacePath]
  );

  const ensureMetaSession = useCallback(async () => {
    setMetaSessionId(null);
    setLoadingSession(true);
    try {
      const existing = await window.electronAPI.invoke('sessions:list', workspacePath, { includeArchived: false });
      if (existing?.success && Array.isArray(existing.sessions)) {
        const metaSessions = existing.sessions
          .filter((session: any) => session.agentRole === 'meta-agent' && !session.isArchived)
          .sort((a: any, b: any) => b.updatedAt - a.updatedAt);

        if (metaSessions.length > 0) {
          setMetaSessionId(metaSessions[0].id);
          return;
        }
      }

      const createdSessionId = await createMetaSession();
      if (createdSessionId) {
        setMetaSessionId(createdSessionId);
      }
    } catch (error) {
      console.error('[MetaAgentMode] Failed to initialize meta-agent session:', error);
    } finally {
      setLoadingSession(false);
    }
  }, [createMetaSession, workspacePath]);

  const refreshSpawnedSessions = useCallback(async (sessionId: string) => {
    setLoadingChildren(true);
    try {
      const result = await window.electronAPI.invoke('meta-agent:list-spawned-sessions', sessionId, workspacePath);
      if (result?.success && Array.isArray(result.sessions)) {
        setChildSessions(result.sessions);
      }
    } catch (error) {
      console.error('[MetaAgentMode] Failed to refresh spawned sessions:', error);
    } finally {
      setLoadingChildren(false);
    }
  }, [workspacePath]);

  const handleEmergencyStop = useCallback(async () => {
    if (!metaSessionId) return;
    try {
      await window.electronAPI.invoke('meta-agent:stop-and-clear', metaSessionId, workspacePath);
      await refreshSpawnedSessions(metaSessionId);
    } catch (error) {
      console.error('[MetaAgentMode] Failed to stop Head Agent work:', error);
    }
  }, [metaSessionId, refreshSpawnedSessions, workspacePath]);

  // When an external sessionId is provided, verify it against the durable
  // session row before exposing the meta-agent surface. The parent normally
  // routes by the registry role, but this boundary check prevents a stale or
  // optimistic renderer entry from granting a standard session commander UI.
  useEffect(() => {
    if (externalSessionId) {
      let disposed = false;
      setMetaSessionId(null);
      setLoadingSession(true);

      void window.electronAPI.invoke('sessions:get', externalSessionId)
        .then((result) => {
          if (disposed) return;
          const session = result?.success ? result.session : null;
          const isMetaAgent = session?.agentRole === 'meta-agent' && session?.isArchived !== true;
          setMetaSessionId(isMetaAgent ? externalSessionId : null);
        })
        .catch((error) => {
          if (!disposed) {
            console.error('[MetaAgentMode] Failed to verify session role:', error);
            setMetaSessionId(null);
          }
        })
        .finally(() => {
          if (!disposed) setLoadingSession(false);
        });

      return () => {
        disposed = true;
      };
    }
    void ensureMetaSession();
    return undefined;
  }, [externalSessionId, ensureMetaSession]);

  useEffect(() => {
    if (!metaSessionId || loadingSession) {
      setChildSessions([]);
      return;
    }
    void refreshSpawnedSessions(metaSessionId);
  }, [loadingSession, metaSessionId, refreshSpawnedSessions]);

  useEffect(() => {
    let disposed = false;
    const load = () => window.electronAPI.invoke('app-settings:get', 'metaAgentPlanAutoApprove')
      .then((value) => { if (!disposed) setPlanAutoApproveEnabled(value === true); })
      .catch((error) => console.error('[MetaAgentMode] Failed to load test-mode setting:', error));
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!metaSessionId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void refreshSpawnedSessions(metaSessionId);
      }, 300);
    };

    const unsubscribe = store.sub(sessionRegistryAtom, debouncedRefresh);

    // Also re-fetch when any session reaches a terminal state. A child's status
    // change (running -> idle on completion) does not reliably rebuild
    // sessionRegistryAtom - e.g. a worktree-resident child that is not part of the
    // main session list - so the registry subscription alone left the delegated
    // count stuck on "running" and the "Waiting for N sessions" text pinned until
    // the user clicked the child. Terminal events are the authoritative signal and
    // (preload keys listeners by callback) coexist with the central listener.
    const handleSessionEvent = (event: { type?: string }) => {
      if (
        event?.type === 'session:completed' ||
        event?.type === 'session:error' ||
        event?.type === 'session:interrupted'
      ) {
        debouncedRefresh();
      }
    };
    window.electronAPI?.sessionState?.onStateChange?.(handleSessionEvent);

    return () => {
      unsubscribe();
      window.electronAPI?.sessionState?.removeStateChangeListener?.(handleSessionEvent);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [metaSessionId, refreshSpawnedSessions]);

  const workspaceName = useMemo(() => {
    if (!workspacePath) return '';
    const parts = workspacePath.split(/[/\\]/).filter(Boolean);
    return parts.pop() || workspacePath;
  }, [workspacePath]);

  const summary = useMemo(() => {
    const waitingCount = childSessions.filter((session) => session.status === 'waiting_for_input').length;
    const runningCount = childSessions.filter((session) => session.status === 'running').length;
    const queuedCount = childSessions.filter((session) => session.status === 'queued').length;
    return {
      total: childSessions.length,
      waitingCount,
      runningCount,
      queuedCount,
    };
  }, [childSessions]);

  const activeChildSessionTeammates = useMemo(
    () =>
      childSessions
        .filter((session) => session.status === 'running')
        .map((session) => ({
          agentId: session.sessionId,
          status: 'running' as const,
        })),
    [childSessions]
  );

  /**
   * The artifact shelf: every file a worker under this Head delivered or
   * changed, taken from the work orders' edited-file records (the same list
   * the Head is told about when a child reports back). Deduped across
   * children, kept in the order the dispatcher lists them; a file touched by
   * two workers keeps both names.
   */
  const shelfItems = useMemo<ArtifactShelfItem[]>(() => {
    const byPath = new Map<string, ArtifactShelfItem>();
    for (const session of childSessions) {
      for (const relativePath of session.editedFiles ?? []) {
        if (!relativePath) continue;
        const existing = byPath.get(relativePath);
        if (existing) {
          if (!existing.sessionTitles.includes(session.title)) {
            existing.sessionTitles.push(session.title);
          }
          continue;
        }
        byPath.set(relativePath, {
          relativePath,
          absolutePath: resolveTranscriptClickPath(relativePath, workspacePath),
          sessionTitles: session.title ? [session.title] : [],
        });
      }
    }
    return Array.from(byPath.values());
  }, [childSessions, workspacePath]);

  /**
   * Transcript file links arrive already resolved. The same prop also backs
   * `host.openFile` for interactive widgets, which hands over whatever path
   * the widget had — often workspace-relative — so resolve again here. It is
   * a no-op for a path that is already absolute.
   */
  const handleTranscriptFileClick = useCallback((filePath: string) => {
    setPreviewPath(resolveTranscriptClickPath(filePath, workspacePath));
    setPreviewOpen(true);
  }, [workspacePath]);

  const handleSelectShelfItem = useCallback((item: ArtifactShelfItem) => {
    setPreviewPath(item.absolutePath);
    setPreviewOpen(true);
  }, []);

  const handleShowShelf = useCallback(() => {
    setPreviewPath(null);
  }, []);

  if (loadingSession) {
    return <div className="meta-agent-mode flex-1 flex items-center justify-center text-nim-muted">Loading meta-agent session...</div>;
  }

  if (!metaSessionId) {
    return <div className="meta-agent-mode flex-1 flex items-center justify-center text-nim-muted">Unable to initialize meta-agent mode.</div>;
  }

  return (
    <div className="meta-agent-mode relative flex-1 flex min-h-0" data-testid="meta-agent-mode">
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className="px-3 pt-3 pb-0 shrink-0">
          <PageHeader
            icon="hub"
            title="总指挥"
            subtitle={`${workspaceName} · ${summary.runningCount} 个在跑 · ${summary.waitingCount} 个等你确认`}
            actions={
              <div className="flex items-center gap-2">
                {planAutoApproveEnabled && (
                  <StatusBadge
                    status="waiting"
                    label="测试模式：方案将自动批准"
                    testId="meta-agent-test-mode-badge"
                  />
                )}
                <AgentBusyIndicator
                  runningCount={summary.runningCount}
                  totalCount={summary.total}
                  queuedCount={summary.queuedCount}
                  activeSessions={childSessions
                    .filter((s) => s.status === 'running')
                    .map((s) => ({
                      id: s.sessionId,
                      title: s.title,
                      provider: s.provider,
                      status: s.status,
                    }))}
                />
                <button
                  type="button"
                  className={`px-3 py-1 text-ui-compact font-medium rounded-ui-base border transition-colors ${
                    summary.runningCount > 0 || summary.queuedCount > 0
                      ? 'bg-nim-error-subtle text-[var(--nim-error)] border-nim-error-subtle hover:opacity-80 cursor-pointer'
                      : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-disabled)] border-[var(--nim-border)] cursor-not-allowed opacity-50'
                  }`}
                  onClick={handleEmergencyStop}
                  disabled={summary.runningCount === 0 && summary.queuedCount === 0}
                  data-testid="meta-agent-stop-all"
                  aria-label="全部停下"
                  title="全部停下"
                >
                  全部停下
                </button>
              </div>
            }
          />
        </div>
        <SessionTranscript
          sessionId={metaSessionId}
          workspacePath={workspacePath}
          mode="agent"
          disableModeToggle={true}
          hideSidebar={true}
          additionalTeammates={activeChildSessionTeammates}
          waitingForNoun="session"
          showStopAndClearQueue={summary.runningCount > 0 || summary.queuedCount > 0}
          onStopAndClearQueue={handleEmergencyStop}
          onFileClick={handleTranscriptFileClick}
        />
      </div>

      <FilePreviewRail
        open={previewOpen}
        filePath={previewPath}
        width={previewWidth}
        onWidthChange={setPreviewWidth}
        onOpen={() => setPreviewOpen(true)}
        onClose={() => setPreviewOpen(false)}
        shelfItems={shelfItems}
        shelfLoading={loadingChildren && childSessions.length === 0}
        onSelectShelfItem={handleSelectShelfItem}
        onShowShelf={handleShowShelf}
      />
    </div>
  );
}

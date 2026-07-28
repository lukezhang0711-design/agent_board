import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStateManager } from '../SessionStateManager';
import type { SessionStateEvent } from '../types/SessionState';

class FakeDatabaseWorker {
  public queries: Array<{ sql: string; params?: any[] }> = [];
  private workspaceIds = new Map<string, string>();
  private sessions = new Map<string, {
    status: string;
    metadata: Record<string, unknown>;
  }>();

  setWorkspace(sessionId: string, workspaceId: string): void {
    this.workspaceIds.set(sessionId, workspaceId);
  }

  setSession(sessionId: string, session: {
    status: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.sessions.set(sessionId, {
      status: session.status,
      metadata: session.metadata ?? {},
    });
  }

  getSession(sessionId: string): { status: string; metadata: Record<string, unknown> } | undefined {
    return this.sessions.get(sessionId);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql, params });

    if (sql.includes('SELECT workspace_id')) {
      const sessionId = params?.[0];
      const workspaceId = typeof sessionId === 'string' ? this.workspaceIds.get(sessionId) ?? null : null;
      return { rows: workspaceId ? [{ workspace_id: workspaceId } as T] : [] };
    }

    if (sql.includes("FROM ai_sessions WHERE status = 'running'")) {
      return {
        rows: Array.from(this.sessions.entries())
          .filter(([, session]) => session.status === 'running')
          .map(([id, session]) => ({ id, last_activity: new Date(), metadata: session.metadata } as T)),
      };
    }

    if (sql.includes('UPDATE ai_sessions SET status = $1') && params) {
      const status = params[0];
      const sessionId = params[params.length - 1];
      const existing = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined;
      if (existing && typeof status === 'string') {
        const metadataParam = params.length === 3 ? params[1] : undefined;
        this.sessions.set(sessionId, {
          status,
          metadata: typeof metadataParam === 'string'
            ? JSON.parse(metadataParam)
            : existing.metadata,
        });
      }
      return { rows: [] };
    }

    return { rows: [] };
  }
}

describe('SessionStateManager', () => {
  let manager: SessionStateManager;
  let database: FakeDatabaseWorker;

  beforeEach(() => {
    manager = new SessionStateManager();
    database = new FakeDatabaseWorker();
    manager.setDatabase(database);
  });

  it('emits session:completed when ending an active session', async () => {
    const listener = vi.fn<(event: SessionStateEvent) => void>();
    manager.subscribe(listener);

    await manager.startSession({
      sessionId: 'session-active',
      workspacePath: '/workspace/project',
    });

    listener.mockClear();

    await manager.endSession('session-active');

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session:completed',
      sessionId: 'session-active',
      workspacePath: '/workspace/project',
    }));
  });

  it('emits session:completed when an active session goes idle (CLI turn boundary)', async () => {
    // NIM-806: the claude-code-cli PID watcher reports turn end via
    // updateActivity({status:'idle'}). The renderer only clears the running
    // indicator on session:completed/error/interrupted — a 'session:activity'
    // event leaves the session spinning forever. So idle must emit completed.
    const listener = vi.fn<(event: SessionStateEvent) => void>();
    manager.subscribe(listener);

    await manager.startSession({
      sessionId: 'session-cli',
      workspacePath: '/workspace/project',
      initialStatus: 'running',
    });

    listener.mockClear();

    await manager.updateActivity({ sessionId: 'session-cli', status: 'idle', isStreaming: false });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session:completed',
      sessionId: 'session-cli',
    }));
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session:activity' }));

    // The session must stay active so the NEXT turn's running is still detected.
    expect(manager.isSessionActive('session-cli')).toBe(true);

    // A subsequent running->idle cycle still produces started then completed.
    listener.mockClear();
    await manager.updateActivity({ sessionId: 'session-cli', status: 'running', isStreaming: true });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'session:streaming' }));
    listener.mockClear();
    await manager.updateActivity({ sessionId: 'session-cli', status: 'idle', isStreaming: false });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'session:completed' }));
  });

  it('emits session:completed for sessions missing from active state', async () => {
    const listener = vi.fn<(event: SessionStateEvent) => void>();
    manager.subscribe(listener);
    database.setWorkspace('session-missing', '/workspace/project');

    await manager.endSession('session-missing');

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session:completed',
      sessionId: 'session-missing',
      workspacePath: '/workspace/project',
    }));
    expect(database.queries.some(({ sql }) => sql.includes('SELECT workspace_id'))).toBe(true);
    expect(database.queries.some(({ sql, params }) =>
      sql.includes('UPDATE ai_sessions SET status = $1') && params?.[0] === 'idle' && params?.[1] === 'session-missing'
    )).toBe(true);
  });

  it('marks an untracked running session interrupted during startup recovery', async () => {
    const recoveryManager = new SessionStateManager();
    const recoveryDatabase = new FakeDatabaseWorker();
    recoveryDatabase.setSession('stale-session', {
      status: 'running',
      metadata: { phase: 'implementing' },
    });
    const listener = vi.fn<(event: SessionStateEvent) => void>();
    recoveryManager.subscribe(listener);

    recoveryManager.setDatabase(recoveryDatabase);
    await recoveryManager.initialize();

    expect(recoveryDatabase.getSession('stale-session')).toEqual({
      status: 'idle',
      metadata: {
        phase: 'implementing',
        interruptedByHead: true,
      },
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session:interrupted',
      sessionId: 'stale-session',
    }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

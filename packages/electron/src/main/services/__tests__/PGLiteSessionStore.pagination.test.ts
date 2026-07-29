import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPGLiteSessionStore } from '../PGLiteSessionStore';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { createSQLiteStoreAdapter } from '../../database/sqlite/SQLiteStoreAdapter';

type Queryable = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

const WORKSPACE = '/pagination-fixture';
const PAGE_SIZE = 75;
const SQLITE_SCHEMA_DIR = path.resolve(__dirname, '../../database/sqlite/schemas');

const pgliteSchema = [
  `CREATE TABLE worktrees (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'worktree',
    path TEXT NOT NULL DEFAULT '/worktree',
    branch TEXT NOT NULL DEFAULT 'main',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE ai_sessions (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT,
    session_type TEXT DEFAULT 'session',
    mode TEXT DEFAULT 'agent',
    agent_role TEXT DEFAULT 'standard',
    created_by_session_id TEXT,
    title TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    worktree_id TEXT,
    parent_session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    branched_from_session_id TEXT,
    branch_point_message_id INTEGER,
    branched_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  )`,
  `CREATE TABLE ai_agent_messages (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    searchable_text TEXT,
    message_kind TEXT,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  'CREATE INDEX idx_fixture_sessions_updated ON ai_sessions(updated_at DESC)',
  'CREATE INDEX idx_fixture_sessions_parent ON ai_sessions(parent_session_id)',
];

function fixtureRow(index: number) {
  const groupStart = index - (index % 10);
  const isChild = index % 10 === 1 || index % 10 === 2;
  // Cover both a root and a child hidden by the archive filters. The latter
  // still contributes to its parent's legacy effective-updated timestamp.
  const isArchived = index === 3 || index === 11;
  const worktreeId = index === 4 || index === 12 ? 'archived-worktree' : null;
  const createdAt = new Date(1_700_000_000_000 + index * 1_000).toISOString();
  const updatedAt = new Date(1_700_000_000_000 + index * 2_000).toISOString();
  return {
    id: `session-${String(index).padStart(4, '0')}`,
    parentSessionId: isChild ? `session-${String(groupStart).padStart(4, '0')}` : null,
    worktreeId,
    createdAt,
    updatedAt,
    isArchived,
    isPinned: index % 97 === 0,
    metadata: JSON.stringify({
      hasUnread: index % 19 === 0,
      phase: index % 7 === 0 ? 'in_progress' : undefined,
      tags: index % 11 === 0 ? ['perf'] : undefined,
    }),
  };
}

async function seedFixture(db: Queryable, count: number): Promise<void> {
  await db.query(
    `INSERT INTO worktrees (id, workspace_id, name, path, branch, is_archived, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)`,
    ['archived-worktree', WORKSPACE, 'archived', '/archived-worktree', 'main', new Date(0).toISOString(), new Date(0).toISOString()],
  );
  await db.query('BEGIN');
  try {
    for (let index = 0; index < count; index++) {
      const row = fixtureRow(index);
      await db.query(
        `INSERT INTO ai_sessions (
          id, provider, model, session_type, mode, agent_role, created_by_session_id,
          title, workspace_id, worktree_id, parent_session_id, created_at, updated_at,
          is_archived, is_pinned, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
        [
          row.id, 'claude-code', 'claude-sonnet', 'session', 'agent', 'standard', null,
          `Session ${index}`, WORKSPACE, row.worktreeId, row.parentSessionId, row.createdAt, row.updatedAt,
          row.isArchived, row.isPinned, row.metadata,
        ],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function mergePageSessions(target: Map<string, any>, sessions: any[]): void {
  for (const session of sessions) {
    const existing = target.get(session.id);
    target.set(session.id, existing
      ? {
        ...session,
        updatedAt: Math.max(existing.updatedAt, session.updatedAt),
        childCount: Math.max(existing.childCount, session.childCount),
      }
      : session);
  }
}

async function readAllPages(store: any, sortBy: 'updated' | 'created' = 'updated') {
  const sessions = new Map<string, any>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: { sessions: any[]; nextCursor: string | null; hasMore: boolean } = await store.listPage(WORKSPACE, {
      includeArchived: false,
      limit: PAGE_SIZE,
      sortBy,
      cursor,
    });
    mergePageSessions(sessions, page.sessions);
    cursor = page.nextCursor;
    pages++;
    if (pages > 100) throw new Error('pagination did not terminate');
    if (!page.hasMore) break;
  } while (cursor);
  return { pages, sessions: Array.from(sessions.values()) };
}

function comparable(sessions: any[]) {
  return sessions
    .map((session) => ({
      id: session.id,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      childCount: session.childCount,
      isArchived: session.isArchived,
      parentSessionId: session.parentSessionId,
      hasUnread: session.hasUnread,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function sidebarComparable(sessions: any[], sortBy: 'updated' | 'created') {
  return sessions
    .filter((session) => !session.parentSessionId)
    .map((session) => ({
      id: session.id,
      timestamp: sortBy === 'updated' ? session.updatedAt : session.createdAt,
      childCount: session.childCount,
      hasUnread: session.hasUnread,
      isArchived: session.isArchived,
    }))
    .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
}

function observe(db: Queryable) {
  const rows = new Map<string, number>();
  const wrapped: Queryable = {
    async query<T = any>(sql: string, params?: any[]) {
      const result = await db.query<T>(sql, params);
      const marker = ['source', 'parents', 'child-stats'].find((name) => sql.includes(`session-list-page-${name}`));
      if (marker) rows.set(marker, (rows.get(marker) ?? 0) + result.rows.length);
      return result;
    },
  };
  return { db: wrapped, rows };
}

describe('PGLiteSessionStore list pagination', () => {
  it('returns a bounded first page and an opaque keyset cursor', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const store = createPGLiteSessionStore(db as any) as any;

    const page = await store.listPage('/workspace', { includeArchived: false, limit: 75, sortBy: 'updated' });

    expect(page.sessions).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
    const sourceSql = (db.query.mock.calls as unknown as Array<[string]>)[0]![0]!;
    expect(sourceSql).toContain('LIMIT $2');
    expect(sourceSql).not.toContain('OFFSET');
  });

  it.each([600, 2000])('keeps the PGLite first-page read bounded at %i sessions', async (count) => {
    const db = new PGlite();
    try {
      for (const statement of pgliteSchema) await db.query(statement);
      await seedFixture(db, count);
      const observed = observe(db);
      const store = createPGLiteSessionStore(observed.db as any) as any;

      const startedAt = performance.now();
      const firstPage = await store.listPage(WORKSPACE, { limit: PAGE_SIZE, sortBy: 'updated' });
      const pageMs = performance.now() - startedAt;
      const fullStartedAt = performance.now();
      const full = await store.list(WORKSPACE);
      const fullMs = performance.now() - fullStartedAt;

      expect(firstPage.scannedCount).toBeLessThanOrEqual(PAGE_SIZE * 2);
      expect(firstPage.sessions.filter((session: any) => !session.parentSessionId)).toHaveLength(PAGE_SIZE);
      expect(observed.rows.get('source')).toBeLessThanOrEqual(PAGE_SIZE * 2 + 1);
      expect((observed.rows.get('parents') ?? 0) + (observed.rows.get('child-stats') ?? 0)).toBeLessThanOrEqual(PAGE_SIZE * 6);
      expect(full.length).toBeGreaterThan(PAGE_SIZE * 4);
      console.info(`[PERF-2] PGLite ${count}: pageRows=${Array.from(observed.rows.values()).reduce((sum, value) => sum + value, 0)}, fullRows=${full.length}, pageMs=${pageMs.toFixed(1)}, fullMs=${fullMs.toFixed(1)}`);
    } finally {
      await db.close();
    }
  }, 60_000);

  it('concatenates PGLite pages to the same archive, unread, child-count and order result as list()', async () => {
    const db = new PGlite();
    try {
      for (const statement of pgliteSchema) await db.query(statement);
      await seedFixture(db, 600);
      const store = createPGLiteSessionStore(db as any) as any;

      const paged = await readAllPages(store);
      const full = await store.list(WORKSPACE, { includeArchived: false });

      expect(paged.pages).toBeGreaterThan(1);
      expect(new Set(paged.sessions.map((session) => session.id)).size).toBe(paged.sessions.length);
      expect(comparable(paged.sessions)).toEqual(comparable(full));
      expect(paged.sessions.find((session) => session.id === 'session-0000')?.childCount).toBe(2);
      expect(paged.sessions.some((session) => session.id === 'session-0003')).toBe(false);
      expect(paged.sessions.some((session) => session.id === 'session-0004')).toBe(false);

      const createdPaged = await readAllPages(store, 'created');
      expect(sidebarComparable(createdPaged.sessions, 'created'))
        .toEqual(sidebarComparable(full, 'created'));
    } finally {
      await db.close();
    }
  }, 60_000);

  it('returns the same continuation result through the SQLite adapter', async () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-page-sqlite-'));
    const sqlite = new SQLiteDatabase({ dbDir, schemaDir: SQLITE_SCHEMA_DIR, log: () => undefined });
    try {
      await sqlite.initialize();
      const adapter = createSQLiteStoreAdapter(sqlite);
      await seedFixture(adapter, 120);
      const store = createPGLiteSessionStore(adapter as any) as any;

      const paged = await readAllPages(store);
      const full = await store.list(WORKSPACE, { includeArchived: false });

      expect(comparable(paged.sessions)).toEqual(comparable(full));
      const createdPaged = await readAllPages(store, 'created');
      expect(sidebarComparable(createdPaged.sessions, 'created'))
        .toEqual(sidebarComparable(full, 'created'));
      await expect(store.search(WORKSPACE, 'Session', { limit: 3, timeRange: 'all' })).resolves.toHaveLength(3);
    } finally {
      await sqlite.close();
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('caps title/content fallback candidates before batched hydration', async () => {
    const titleSearch = vi.fn().mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({ session_id: `title-${index}`, rank: 1 })),
    );
    const contentSearch = vi.fn().mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({ session_id: `content-${index}`, rank: 1 })),
    );
    const queries: string[] = [];
    const db = {
      searchSessionTitles: titleSearch,
      searchTranscriptEventSessions: contentSearch,
      query: vi.fn(async (sql: string, params?: any[]) => {
        queries.push(sql);
        const ids = params?.[0] ?? [];
        return {
          rows: ids.map((id: string, index: number) => ({
            id,
            provider: 'claude-code',
            session_type: 'session',
            title: id,
            workspace_id: WORKSPACE,
            created_at: new Date(1_700_000_000_000 + index).toISOString(),
            updated_at: new Date(1_700_000_001_000 + index).toISOString(),
            is_archived: false,
            is_pinned: false,
            metadata: '{}',
            child_count: 0,
          })),
        };
      }),
    };
    const store = createPGLiteSessionStore(db as any) as any;

    const matches = await store.search(WORKSPACE, 'needle', { limit: 3, timeRange: 'all' });

    expect(matches).toHaveLength(3);
    expect(titleSearch).toHaveBeenCalledWith(WORKSPACE, 'needle', { includeArchived: false, limit: 3 });
    expect(contentSearch).toHaveBeenCalledWith('needle', expect.objectContaining({ limit: 3, workspaceId: WORKSPACE }));
    expect(queries[0]).toContain('parent_session_id = ANY($3::text[])');
  });

  it('applies the search cap in PGLite SQL before returning title matches', async () => {
    const db = new PGlite();
    try {
      for (const statement of pgliteSchema) await db.query(statement);
      await seedFixture(db, 12);
      const store = createPGLiteSessionStore(db as any) as any;

      const matches = await store.search(WORKSPACE, 'Session', { limit: 3, timeRange: 'all' });

      expect(matches).toHaveLength(3);
      const parentMatch = await store.search(WORKSPACE, 'Session 10', { limit: 3, timeRange: 'all' });
      expect(parentMatch.find((session: any) => session.id === 'session-0010')?.childCount).toBe(1);
    } finally {
      await db.close();
    }
  });
});

/**
 * PGLite implementation of SessionStore interface from runtime package
 */

import { toMillis } from '../utils/timestampUtils';
import { parseJsonObjectColumn } from '../utils/jsonColumn';

import type {
  SessionStore,
  SessionMeta,
  SessionListOptions,
  SessionListPage,
  SessionListPageOptions,
  SessionSearchOptions,
  CreateSessionPayload,
  UpdateSessionMetadataPayload,
  ChatSession,
  AgentMessage
} from '@nimbalyst/runtime';

type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  searchTranscriptEventSessions?(
    query: string,
    opts?: {
      limit?: number;
      sessionIds?: string[];
      workspaceId?: string;
      eventType?: 'user_message' | 'assistant_message' | null;
      cutoffDate?: Date | null;
    },
  ): Promise<Array<{ session_id: string; rank: number }>>;
  searchSessionTitles?(
    workspaceId: string,
    query: string,
    opts?: { includeArchived?: boolean; limit?: number },
  ): Promise<Array<{ session_id: string; rank: number }>>;
};

type EnsureReadyFn = () => Promise<void>;

function buildSessionArchiveFilter(includeArchived: boolean, sessionAlias = 's', worktreeAlias = 'w'): string {
  if (includeArchived) {
    return '';
  }

  return `AND (${sessionAlias}.is_archived = FALSE OR ${sessionAlias}.is_archived IS NULL)
          AND (${sessionAlias}.worktree_id IS NULL OR ${worktreeAlias}.is_archived = FALSE OR ${worktreeAlias}.is_archived IS NULL)`;
}

function buildSessionArchivePredicate(includeArchived: boolean, sessionAlias = 's', worktreeAlias = 'w'): string {
  if (includeArchived) return 'TRUE';
  return `(${sessionAlias}.is_archived = FALSE OR ${sessionAlias}.is_archived IS NULL)
          AND (${sessionAlias}.worktree_id IS NULL OR ${worktreeAlias}.is_archived = FALSE OR ${worktreeAlias}.is_archived IS NULL)`;
}

const DEFAULT_SESSION_LIST_PAGE_SIZE = 75;
const MAX_SESSION_LIST_PAGE_SIZE = 100;
// Keep one extra candidate so `sessions:search` can return 200 visible results
// while still reporting whether more matches exist. Search callers are never
// allowed to make the fallback tsvector path scan an unbounded result set.
const MAX_SESSION_SEARCH_CANDIDATE_LIMIT = 201;
// A child row can introduce its parent into the visible list. Reading at most
// two source windows keeps the first-screen query bounded while avoiding a
// sparse page for normal workstream distributions.
const SESSION_LIST_SCAN_MULTIPLIER = 2;

interface SessionListCursor {
  pinned: boolean;
  sortTimestamp: number;
  tieTimestamp: number;
  groupId: string;
  sourceId: string;
  sortBy: 'updated' | 'created';
}

function encodeSessionListCursor(cursor: SessionListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeSessionListCursor(cursor: string | null | undefined, sortBy: 'updated' | 'created'): SessionListCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<SessionListCursor>;
    if (
      parsed.sortBy !== sortBy
      || typeof parsed.pinned !== 'boolean'
      || !Number.isFinite(parsed.sortTimestamp)
      || !Number.isFinite(parsed.tieTimestamp)
      || typeof parsed.groupId !== 'string'
      || typeof parsed.sourceId !== 'string'
    ) {
      throw new Error('invalid session-list cursor shape');
    }
    return parsed as SessionListCursor;
  } catch {
    throw new Error('Invalid session list cursor');
  }
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function mapSessionMetaRow(
  row: any,
  overrides: { updatedAt?: number; childCount?: number } = {},
): SessionMeta & { hasPendingInteractivePrompt?: boolean; phase?: string; tags?: string[]; linkedTrackerItemIds?: string[] } {
  const metadata = normalizeJsonObject(row.metadata);
  return {
    id: row.id,
    provider: row.provider,
    model: row.model ?? undefined,
    sessionType: row.session_type || 'session',
    mode: row.mode ?? undefined,
    agentRole: row.agent_role ?? 'standard',
    title: row.title || 'Untitled Session',
    workspaceId: row.workspace_id,
    worktreeId: row.worktree_id ?? null,
    parentSessionId: row.parent_session_id ?? null,
    createdBySessionId: row.created_by_session_id ?? null,
    childCount: overrides.childCount ?? (Number(row.child_count ?? 0) || 0),
    uncommittedCount: 0,
    createdAt: toMillis(row.created_at)!,
    updatedAt: overrides.updatedAt ?? toMillis(row.effective_updated_at ?? row.updated_at)!,
    messageCount: 0,
    isArchived: toBoolean(row.is_archived),
    isPinned: toBoolean(row.is_pinned),
    branchedFromSessionId: row.branched_from_session_id ?? undefined,
    branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id, 10) : undefined,
    branchedAt: toMillis(row.branched_at) ?? undefined,
    hasUnread: metadata.metadata?.hasUnread ?? metadata.hasUnread ?? false,
    hasPendingInteractivePrompt: !!metadata.hasPendingPrompt,
    phase: metadata.phase ?? undefined,
    tags: Array.isArray(metadata.tags) ? metadata.tags : undefined,
    dispatchQueued: metadata.dispatchQueued === true ? true : undefined,
    interruptedByHead: metadata.interruptedByHead === true ? true : undefined,
    linkedTrackerItemIds: Array.isArray(metadata.linkedTrackerItemIds) ? metadata.linkedTrackerItemIds : undefined,
  };
}

// Shared with other JSON-typed column readers; see ../utils/jsonColumn.ts
// for the metadata-corruption postmortem.
const normalizeJsonObject = parseJsonObjectColumn;

/**
 * Parse a TEXT column that's supposed to hold JSON back into the value the
 * runtime expects. Under PGLite (JSONB) reads return parsed values directly,
 * under SQLite (TEXT) reads return raw strings. Without this normalization
 * any caller doing `{ ...session.metadata }` or `session.documentContext.foo`
 * silently iterates the string character by character (metadata) or returns
 * `undefined` for every field access (documentContext / providerConfig /
 * lastDocumentState). The metadata case is especially nasty because the
 * spread output gets re-serialized and written back, growing the row ~9x
 * per cycle until a single session metadata column hits hundreds of MB.
 * See `updateSessionTokenUsage` in SessionManager and the
 * `feedback_local_state_vs_server_state` memory.
 */
function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length === 0) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}


// Module-level reference for standalone functions
let moduleDb: PGliteLike | null = null;
let moduleEnsureReady: EnsureReadyFn | null = null;

/**
 * Get the database instance for direct queries (e.g., migrations)
 */
export function getDatabase(): PGliteLike | null {
  return moduleDb;
}

// Use AgentMessage from runtime for sync compatibility
type SyncedMessage = AgentMessage;

/**
 * Get all sessions for sync (no workspace filter)
 * Uses the module-level db reference set by createPGLiteSessionStore
 */
export async function getAllSessionsForSync(includeMessages = false): Promise<Array<{
  id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: string;
  sessionType?: string;
  parentSessionId?: string;
  agentRole?: string;
  createdBySessionId?: string | null;
  worktreeId?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  branchedFromSessionId?: string;
  branchPointMessageId?: number;
  branchedAt?: number;
  workspaceId?: string;
  workspacePath?: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  metadata?: Record<string, any>;
  messages?: SyncedMessage[];
}>> {
  // Log stack trace to identify callers
  // const stack = new Error().stack?.split('\n').slice(1, 5).join('\n') || 'no stack';
  // console.log('[PGLiteSessionStore] getAllSessionsForSync called from:\n' + stack);

  const startTime = performance.now();
  if (!moduleDb) {
    throw new Error('Session store not initialized');
  }
  if (moduleEnsureReady) {
    await moduleEnsureReady();
  }
  const ensureTime = performance.now() - startTime;

  const queryStart = performance.now();
  // The COUNT(m.id) projection used to live here, but the mapper below hardcodes
  // messageCount: 0, so the LEFT JOIN + GROUP BY produced ~2.4s of wasted work
  // on databases with ~1k sessions. Stripped down to an indexed SELECT.
  const { rows } = await moduleDb.query<any>(
    `SELECT s.id, s.provider, s.model, s.mode, s.session_type, s.parent_session_id, s.agent_role, s.created_by_session_id, s.title, s.workspace_id, s.draft_input,
            s.worktree_id, s.is_archived, s.is_pinned, s.branched_from_session_id, s.branch_point_message_id, s.branched_at,
            s.created_at, s.updated_at, s.metadata
     FROM ai_sessions s
     ORDER BY s.updated_at DESC`
  );
  const queryTime = performance.now() - queryStart;

  // Filter out sessions without workspace_id - they are legacy data that cannot be routed correctly
  // Do NOT fall back to 'default' as that masks the real issue (missing workspace tracking)
  const validRows = rows.filter((row: any) => {
    if (!row.workspace_id) {
      console.warn(`[PGLiteSessionStore] Skipping session ${row.id} - missing workspace_id (legacy data)`);
      return false;
    }
    return true;
  });

  const sessions = validRows.map((row: any) => {
    return {
      id: row.id,
      title: row.title || 'Untitled',
      provider: row.provider || 'unknown',
      model: row.model,
      mode: row.mode,
      sessionType: row.session_type || 'session',
      parentSessionId: row.parent_session_id || undefined,
      agentRole: row.agent_role || 'standard',
      createdBySessionId: row.created_by_session_id || undefined,
      worktreeId: row.worktree_id || undefined,
      isArchived: row.is_archived ?? false,
      isPinned: row.is_pinned ?? false,
      branchedFromSessionId: row.branched_from_session_id || undefined,
      branchPointMessageId: row.branch_point_message_id || undefined,
      branchedAt: toMillis(row.branched_at) ?? undefined,
      // workspace_id is required - we filtered out sessions without it above
      workspaceId: row.workspace_id,
      workspacePath: row.workspace_id, // workspace_id is the path in this system
      // NOTE: Do NOT include draftInput in bulk sync - it should only sync when actually changed
      // Including it here causes spurious metadata_updated events for all sessions on startup
      messageCount: 0,
      updatedAt: toMillis(row.updated_at)!,
      createdAt: toMillis(row.created_at)!,
      // Sync clients (mobile, peer devices) expect a parsed object here.
      // See `parseJsonColumn` for the SQLite/PGLite shape difference.
      metadata: normalizeJsonObject(row.metadata),
      messages: undefined as SyncedMessage[] | undefined,
    };
  });

  // Optionally fetch messages for each session (include hidden - mobile filters client-side)
  if (includeMessages) {
    for (const session of sessions) {
      const { rows: msgRows } = await moduleDb.query<any>(
        `SELECT id, session_id, created_at, source, direction, content, metadata, hidden
         FROM ai_agent_messages
         WHERE session_id = $1
         ORDER BY created_at ASC`,
        [session.id]
      );
      session.messages = msgRows.map((m: any): AgentMessage => ({
        id: m.id,
        sessionId: m.session_id,
        createdAt: m.created_at instanceof Date ? m.created_at : new Date(toMillis(m.created_at)!),
        source: m.source,
        direction: m.direction,
        content: m.content,
        metadata: m.metadata,
        hidden: m.hidden ?? false,
      }));
    }
  }

  // const totalTime = performance.now() - startTime;
  // console.log(`[PGLiteSessionStore] getAllSessionsForSync() - ensureReady: ${ensureTime.toFixed(1)}ms, query: ${queryTime.toFixed(1)}ms, total: ${totalTime.toFixed(1)}ms, rows: ${rows.length}`);
  return sessions;
}

/**
 * Get messages for a session created after a given timestamp.
 * Used for delta sync - only fetch messages newer than the server's last sync.
 *
 * @param sessionId The session ID
 * @param sinceTimestamp Epoch milliseconds - only return messages created AFTER this time (0 = all)
 */
export async function getSessionMessagesForSync(
  sessionId: string,
  sinceTimestamp: number = 0
): Promise<SyncedMessage[]> {
  if (!moduleDb) {
    throw new Error('Session store not initialized');
  }
  if (moduleEnsureReady) {
    await moduleEnsureReady();
  }

  // Convert milliseconds to Date for PostgreSQL comparison
  const sinceDate = new Date(sinceTimestamp);

  const { rows: msgRows } = await moduleDb.query<any>(
    `SELECT id, session_id, created_at, source, direction, content, metadata, hidden
     FROM ai_agent_messages
     WHERE session_id = $1 AND created_at > $2
     ORDER BY created_at ASC`,
    [sessionId, sinceDate]
  );

  return msgRows.map((m: any): AgentMessage => ({
    id: m.id,
    sessionId: m.session_id,
    createdAt: m.created_at instanceof Date ? m.created_at : new Date(toMillis(m.created_at)!),
    source: m.source,
    direction: m.direction,
    content: m.content,
    metadata: m.metadata,
    hidden: m.hidden ?? false,
  }));
}

/**
 * Batch-fetch messages for multiple sessions, each with its own sinceTimestamp.
 * Replaces the N+1 pattern of calling getSessionMessagesForSync() per session.
 * Returns a Map from sessionId -> messages.
 */
export async function getSessionMessagesForSyncBatch(
  requests: Array<{ sessionId: string; sinceTimestamp: number }>
): Promise<Map<string, SyncedMessage[]>> {
  const result = new Map<string, SyncedMessage[]>();
  if (requests.length === 0) return result;

  if (!moduleDb) {
    throw new Error('Session store not initialized');
  }
  if (moduleEnsureReady) {
    await moduleEnsureReady();
  }

  // Use the earliest sinceTimestamp across all requests as a lower bound,
  // then filter per-session in JS. This avoids building a complex SQL query
  // with per-session timestamps, while still doing only ONE database query.
  const earliestSince = Math.min(...requests.map(r => r.sinceTimestamp));
  const sinceDate = new Date(earliestSince);

  const sessionIds = requests.map(r => r.sessionId);
  const placeholders = sessionIds.map((_, i) => `$${i + 2}`).join(', ');

  const { rows: msgRows } = await moduleDb.query<any>(
    `SELECT id, session_id, created_at, source, direction, content, metadata, hidden
     FROM ai_agent_messages
     WHERE session_id IN (${placeholders}) AND created_at > $1
     ORDER BY created_at ASC`,
    [sinceDate, ...sessionIds]
  );

  // Build a per-session sinceTimestamp lookup for JS-side filtering
  const sinceMap = new Map<string, number>();
  for (const req of requests) {
    sinceMap.set(req.sessionId, req.sinceTimestamp);
    result.set(req.sessionId, []);
  }

  for (const m of msgRows) {
    const sessionSince = sinceMap.get(m.session_id) ?? 0;
    const createdAt = m.created_at instanceof Date ? m.created_at : new Date(toMillis(m.created_at)!);
    // Filter: only include messages newer than this session's sinceTimestamp
    if (createdAt.getTime() > sessionSince) {
      const arr = result.get(m.session_id);
      if (arr) {
        arr.push({
          id: m.id,
          sessionId: m.session_id,
          createdAt,
          source: m.source,
          direction: m.direction,
          content: m.content,
          metadata: m.metadata,
          hidden: m.hidden ?? false,
        });
      }
    }
  }

  return result;
}

export function createPGLiteSessionStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn): SessionStore {
  // Store db reference for module-level functions
  moduleDb = db;
  moduleEnsureReady = ensureDbReady ?? null;
  const ensureReady = async () => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  return {
    async ensureReady(): Promise<void> {
      await ensureReady();
    },

    async create(payload: CreateSessionPayload): Promise<void> {
      await ensureReady();
      const now = Date.now();
      const createdAtMs = payload.createdAt ?? now;
      const updatedAtMs = payload.updatedAt ?? now;

      // Convert epoch milliseconds to Date objects
      // TIMESTAMPTZ columns handle Date objects correctly
      const createdAt = new Date(createdAtMs);
      const updatedAt = new Date(updatedAtMs);

      const branchedAt = payload.branchedAt ? new Date(payload.branchedAt) : null;

      await db.query(
        `INSERT INTO ai_sessions (
          id, workspace_id, file_path, worktree_id, parent_session_id, provider, model, title, session_type, mode,
          agent_role, created_by_session_id,
          document_context, provider_config, provider_session_id, draft_input, metadata,
          has_been_named, created_at, updated_at,
          branched_from_session_id, branch_point_message_id, branched_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12,
          $13, $14, $15, $16, $17,
          $18, $19, $20,
          $21, $22, $23
        )
        ON CONFLICT (id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          file_path = EXCLUDED.file_path,
          worktree_id = EXCLUDED.worktree_id,
          parent_session_id = EXCLUDED.parent_session_id,
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          title = EXCLUDED.title,
          session_type = EXCLUDED.session_type,
          mode = EXCLUDED.mode,
          agent_role = EXCLUDED.agent_role,
          created_by_session_id = EXCLUDED.created_by_session_id,
          document_context = EXCLUDED.document_context,
          provider_config = EXCLUDED.provider_config,
          provider_session_id = EXCLUDED.provider_session_id,
          draft_input = EXCLUDED.draft_input,
          metadata = EXCLUDED.metadata,
          has_been_named = EXCLUDED.has_been_named,
          updated_at = EXCLUDED.updated_at,
          branched_from_session_id = EXCLUDED.branched_from_session_id,
          branch_point_message_id = EXCLUDED.branch_point_message_id,
          branched_at = EXCLUDED.branched_at
      `,
        [
          payload.id,
          payload.workspaceId,
          payload.filePath ?? null,
          payload.worktreeId ?? null,
          payload.parentSessionId ?? null,  // Parent session ID for hierarchical workstreams
          payload.provider,
          payload.model ?? null,
          payload.title ?? 'New conversation',
          payload.sessionType ?? 'session',
          payload.mode ?? 'agent',
          payload.agentRole ?? 'standard',
          payload.createdBySessionId ?? null,
          payload.documentContext ?? null,
          payload.providerConfig ?? null,
          payload.providerSessionId ?? null,
          null,
          (payload as any).metadata ?? {},
          (payload as any).hasBeenNamed ?? false,
          createdAt,
          updatedAt,
          payload.branchedFromSessionId ?? null,  // Branch tracking - separate from parent
          payload.branchPointMessageId ?? null,
          branchedAt,
        ]
      );

      // TODO: Debug logging - uncomment if needed
      // console.log('[PGLiteSessionStore] Session created successfully in database');
    },


    async updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void> {
      await ensureReady();
      const updates: string[] = [];
      const values: any[] = [sessionId];

      const pushUpdate = (clause: string, value: any) => {
        updates.push(`${clause} $${values.length + 1}`);
        values.push(value);
      };

      if (metadata.provider !== undefined) pushUpdate('provider =', metadata.provider);
      if (metadata.model !== undefined) pushUpdate('model =', metadata.model);
      if (metadata.title !== undefined) pushUpdate('title =', metadata.title ?? 'New conversation');
      if (metadata.sessionType !== undefined) pushUpdate('session_type =', metadata.sessionType);
      if (metadata.mode !== undefined) pushUpdate('mode =', metadata.mode);
      if (metadata.agentRole !== undefined) pushUpdate('agent_role =', metadata.agentRole);
      if (metadata.createdBySessionId !== undefined) pushUpdate('created_by_session_id =', metadata.createdBySessionId ?? null);
      if (metadata.workspaceId !== undefined) pushUpdate('workspace_id =', metadata.workspaceId);
      if (metadata.filePath !== undefined) pushUpdate('file_path =', metadata.filePath ?? null);
      if (metadata.providerConfig !== undefined) pushUpdate('provider_config =', metadata.providerConfig ?? null);
      if (metadata.providerSessionId !== undefined) pushUpdate('provider_session_id =', metadata.providerSessionId ?? null);
      if (metadata.documentContext !== undefined) pushUpdate('document_context =', metadata.documentContext ?? null);
      if (metadata.draftInput !== undefined) pushUpdate('draft_input =', metadata.draftInput ?? null);
      // NOTE: tokenUsage removed - it's derived from ai_agent_messages /context responses
      // NOTE: queuedPrompts removed - now uses separate queued_prompts table for atomic operations
      // Handle metadata field (the JSON blob) - do a shallow merge.
      //
      // Defense-in-depth: refuse any payload that isn't a plain object.
      // A caller passing a string here (e.g. a SQLite read that returned
      // the raw JSON text and got threaded back into update unchanged)
      // would otherwise spread to char-by-char numeric keys, get JSON-
      // stringified, written back, and re-corrupted on the next read.
      // We saw a single session's metadata column grow to 216 MB this
      // way before catching it. Drop the update on the floor and log
      // loudly so the upstream caller surfaces in main.log instead of
      // silently amplifying corruption.
      if (metadata.metadata !== undefined) {
        const incoming = metadata.metadata;
        if (
          incoming === null ||
          typeof incoming !== 'object' ||
          Array.isArray(incoming)
        ) {
          console.warn(
            `[PGLiteSessionStore] updateMetadata refused non-object metadata for session ${sessionId}: type=${typeof incoming}, isArray=${Array.isArray(incoming)}`,
          );
        } else {
          const { rows } = await db.query<{ metadata: unknown }>(
            `SELECT metadata FROM ai_sessions WHERE id = $1`,
            [sessionId],
          );
          const existingMetadata = normalizeJsonObject(rows[0]?.metadata);
          updates.push(`metadata = $${values.length + 1}`);
          values.push(JSON.stringify({ ...existingMetadata, ...incoming }));
        }
      }
      if ((metadata as any).hasBeenNamed !== undefined) pushUpdate('has_been_named =', (metadata as any).hasBeenNamed);
      if (metadata.isArchived !== undefined) pushUpdate('is_archived =', metadata.isArchived);
      if ((metadata as any).isPinned !== undefined) pushUpdate('is_pinned =', (metadata as any).isPinned);
      if (metadata.parentSessionId !== undefined) pushUpdate('parent_session_id =', metadata.parentSessionId);
      if (metadata.lastDocumentState !== undefined) pushUpdate('last_document_state =', metadata.lastDocumentState);
      // Canonical transcript transform status columns
      if (metadata.canonicalTransformVersion !== undefined) pushUpdate('canonical_transform_version =', metadata.canonicalTransformVersion);
      if (metadata.canonicalTransformStatus !== undefined) pushUpdate('canonical_transform_status =', metadata.canonicalTransformStatus);
      if (metadata.canonicalLastTransformedAt !== undefined) pushUpdate('canonical_last_transformed_at =', metadata.canonicalLastTransformedAt);
      if (metadata.canonicalLastRawMessageId !== undefined) pushUpdate('canonical_last_raw_message_id =', metadata.canonicalLastRawMessageId);

      // NOTE: We intentionally do NOT update updated_at here. The updated_at timestamp
      // should only change when messages are added (via PGLiteAgentMessagesStore.create),
      // so that session history sorting accurately reflects the last message time.
      if (!updates.length) {
        // Nothing to update - no-op
        return;
      }

      const setClause = updates.join(', ');
      await db.query(
        `UPDATE ai_sessions SET ${setClause} WHERE id=$1`,
        values
      );
    },

    async get(sessionId: string): Promise<ChatSession | null> {
      await ensureReady();
      const { rows } = await db.query<any>(
        `SELECT s.*,
         EXTRACT(EPOCH FROM s.last_read_timestamp) * 1000 AS last_read_ms,
         w.path AS worktree_path,
         w.workspace_id AS worktree_project_path,
         branched_from.provider_session_id AS branched_from_provider_session_id
         FROM ai_sessions s
         LEFT JOIN worktrees w ON s.worktree_id = w.id
         LEFT JOIN ai_sessions branched_from ON s.branched_from_session_id = branched_from.id
         WHERE s.id=$1 LIMIT 1`,
        [sessionId]
      );
      const row = rows[0];
      if (!row) return null;

      // NOTE: tokenUsage is no longer stored in ai_sessions
      // It's derived from ai_agent_messages /context responses when loading sessions
      // Parse JSON columns at the boundary so downstream callers (e.g.
      // SessionManager.updateSessionTokenUsage) can safely spread them.
      // See `parseJsonColumn` for the SQLite-vs-PGLite read-shape mismatch.
      const metadata = normalizeJsonObject(row.metadata);

      return {
        id: row.id,
        provider: row.provider,
        model: row.model ?? undefined,
        sessionType: row.session_type ?? undefined,
        mode: row.mode ?? undefined,
        agentRole: row.agent_role ?? 'standard',
        title: row.title ?? undefined,
        draftInput: row.draft_input ?? undefined,
        messages: [], // Messages are now stored in ai_agent_messages table
        workspacePath: row.workspace_id,
        worktreeId: row.worktree_id ?? undefined,
        worktreePath: row.worktree_path ?? undefined,
        worktreeProjectPath: row.worktree_project_path ?? undefined,
        parentSessionId: row.parent_session_id ?? null,  // Hierarchical workstream support
        createdBySessionId: row.created_by_session_id ?? null,
        createdAt: toMillis(row.created_at)!,
        updatedAt: toMillis(row.updated_at)!,
        metadata,
        documentContext: parseJsonColumn(row.document_context) ?? undefined,
        providerConfig: parseJsonColumn(row.provider_config) ?? undefined,
        providerSessionId: row.provider_session_id ?? undefined,
        lastReadMessageTimestamp: row.last_read_ms ? Number(row.last_read_ms) : undefined,
        hasBeenNamed: row.has_been_named ?? false,
        isArchived: row.is_archived ?? false,
        isPinned: row.is_pinned ?? false,
        // Branch tracking fields - SEPARATE from hierarchical parentSessionId
        branchedFromSessionId: row.branched_from_session_id ?? undefined,
        branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
        branchedAt: toMillis(row.branched_at) ?? undefined,
        branchedFromProviderSessionId: row.branched_from_provider_session_id ?? undefined,
        // Document context service state for transition detection
        lastDocumentState:
          (parseJsonColumn(row.last_document_state) as
            | { filePath: string; contentHash: string }
            | undefined) ?? undefined,
      } satisfies ChatSession;
    },

    async getMany(sessionIds: string[]): Promise<ChatSession[]> {
      if (sessionIds.length === 0) return [];
      await ensureReady();

      // Use ANY($1::text[]) for batch query - much more efficient than N individual queries
      const { rows } = await db.query<any>(
        `SELECT s.*,
         EXTRACT(EPOCH FROM s.last_read_timestamp) * 1000 AS last_read_ms,
         w.path AS worktree_path,
         w.workspace_id AS worktree_project_path,
         branched_from.provider_session_id AS branched_from_provider_session_id
         FROM ai_sessions s
         LEFT JOIN worktrees w ON s.worktree_id = w.id
         LEFT JOIN ai_sessions branched_from ON s.branched_from_session_id = branched_from.id
         WHERE s.id = ANY($1::text[])`,
        [sessionIds]
      );

      return rows.map((row: any) => {
        // Parse JSON columns at the boundary -- see `parseJsonColumn`.
        const metadata = normalizeJsonObject(row.metadata);
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type ?? undefined,
          mode: row.mode ?? undefined,
          agentRole: row.agent_role ?? 'standard',
          title: row.title ?? undefined,
          draftInput: row.draft_input ?? undefined,
          messages: [],
          workspacePath: row.workspace_id,
          worktreeId: row.worktree_id ?? undefined,
          worktreePath: row.worktree_path ?? undefined,
          worktreeProjectPath: row.worktree_project_path ?? undefined,
          parentSessionId: row.parent_session_id ?? null,
          createdBySessionId: row.created_by_session_id ?? null,
          createdAt: toMillis(row.created_at)!,
          updatedAt: toMillis(row.updated_at)!,
          metadata,
          documentContext: parseJsonColumn(row.document_context) ?? undefined,
          providerConfig: parseJsonColumn(row.provider_config) ?? undefined,
          providerSessionId: row.provider_session_id ?? undefined,
          lastReadMessageTimestamp: row.last_read_ms ? Number(row.last_read_ms) : undefined,
          hasBeenNamed: row.has_been_named ?? false,
          isArchived: row.is_archived ?? false,
          isPinned: row.is_pinned ?? false,
          branchedFromSessionId: row.branched_from_session_id ?? undefined,
          branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
          branchedAt: toMillis(row.branched_at) ?? undefined,
          branchedFromProviderSessionId: row.branched_from_provider_session_id ?? undefined,
        } satisfies ChatSession;
      });
    },

    async listPage(workspaceId: string, options?: SessionListPageOptions): Promise<SessionListPage> {
      await ensureReady();

      const includeArchived = options?.includeArchived ?? false;
      const sortBy = options?.sortBy ?? 'updated';
      const cursor = decodeSessionListCursor(options?.cursor, sortBy);
      const pageSize = Math.max(1, Math.min(options?.limit ?? DEFAULT_SESSION_LIST_PAGE_SIZE, MAX_SESSION_LIST_PAGE_SIZE));
      const scanLimit = pageSize * SESSION_LIST_SCAN_MULTIPLIER;
      const archivePredicate = buildSessionArchivePredicate(includeArchived);
      const sourceEligibility = sortBy === 'updated'
        // Child activity determines the sort position of a workstream parent.
        // Keep children in the source stream even if the child itself is
        // archived; the legacy list used the same effective parent timestamp.
        ? `(s.parent_session_id IS NOT NULL OR (${archivePredicate}))`
        : `(${archivePredicate}) AND (s.parent_session_id IS NULL OR p.session_type = 'blitz')`;
      const sortTimestamp = sortBy === 'created'
        ? `CASE
             WHEN s.worktree_id IS NOT NULL THEN COALESCE(w.created_at, s.created_at)
             WHEN p.session_type = 'blitz' THEN p.created_at
             ELSE s.created_at
           END`
        : 's.updated_at';
      const tieTimestamp = sortBy === 'updated'
        ? `CASE
             WHEN s.parent_session_id IS NOT NULL AND COALESCE(p.session_type, '') <> 'blitz' THEN p.created_at
             ELSE s.created_at
           END`
        : 's.created_at';
      const pinned = `CASE
        WHEN s.parent_session_id IS NOT NULL THEN COALESCE(p.is_pinned, FALSE)
        WHEN s.worktree_id IS NOT NULL THEN COALESCE(w.is_pinned, FALSE)
        ELSE COALESCE(s.is_pinned, FALSE)
      END`;

      const values: unknown[] = [workspaceId];
      let cursorClause = '';
      if (cursor) {
        values.push(
          cursor.pinned,
          new Date(cursor.sortTimestamp).toISOString(),
          new Date(cursor.tieTimestamp).toISOString(),
          cursor.groupId,
          cursor.sourceId,
        );
        cursorClause = `
          WHERE raw.list_pinned < $2
             OR (raw.list_pinned = $2 AND raw.list_sort_timestamp < $3)
             OR (raw.list_pinned = $2 AND raw.list_sort_timestamp = $3 AND raw.list_tie_timestamp < $4)
             OR (raw.list_pinned = $2 AND raw.list_sort_timestamp = $3 AND raw.list_tie_timestamp = $4 AND raw.list_group_id > $5)
             OR (raw.list_pinned = $2 AND raw.list_sort_timestamp = $3 AND raw.list_tie_timestamp = $4 AND raw.list_group_id = $5 AND raw.list_source_id > $6)`;
      }
      values.push(scanLimit + 1);

      const { rows: scannedRows } = await db.query<any>(
        `/* session-list-page-source */
         WITH raw AS (
           SELECT s.id, s.provider, s.model, s.session_type, s.mode, s.agent_role, s.created_by_session_id, s.title, s.workspace_id,
                  s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned,
                  s.branched_from_session_id, s.branch_point_message_id, s.branched_at, s.metadata,
                  (${archivePredicate}) AS list_visible,
                  ${pinned} AS list_pinned,
                  ${sortTimestamp} AS list_sort_timestamp,
                  ${tieTimestamp} AS list_tie_timestamp,
                  COALESCE(p.id, s.id) AS list_group_id,
                  s.id AS list_source_id
           FROM ai_sessions s
           LEFT JOIN ai_sessions p ON p.id = s.parent_session_id
           LEFT JOIN worktrees w ON w.id = s.worktree_id
           WHERE s.workspace_id = $1
             AND ${sourceEligibility}
         )
         SELECT *
         FROM raw
         ${cursorClause}
         ORDER BY list_pinned DESC, list_sort_timestamp DESC, list_tie_timestamp DESC, list_group_id ASC, list_source_id ASC
         LIMIT $${values.length}`,
        values,
      );

      // A logical page is 75 visible workstream/root groups, rather than 75
      // raw rows. We inspect at most two source windows because children can
      // collapse into their parent; cursor advancement stops at the first
      // source row after the requested group count, never using OFFSET.
      const sourceWindow = scannedRows.slice(0, scanLimit);
      const pageGroups = new Set<string>();
      const sourceRows: any[] = [];
      for (const row of sourceWindow) {
        const groupId = String(row.list_group_id);
        if (!pageGroups.has(groupId) && pageGroups.size >= pageSize) break;
        pageGroups.add(groupId);
        sourceRows.push(row);
      }
      const hasMore = scannedRows.length > sourceRows.length;
      if (sourceRows.length === 0) {
        return { sessions: [], nextCursor: null, hasMore: false, scannedCount: 0 };
      }
      // Updated-order source rows also include archived children so their
      // timestamp can position a visible parent exactly as legacy list() did.
      // Never expose those filtered child rows as list entries themselves.
      const visibleSourceRows = sourceRows.filter((row: any) => toBoolean(row.list_visible));

      const parentIds = Array.from(new Set(
        sourceRows
          .map((row: any) => row.parent_session_id)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
      ));
      const parentRows: any[] = [];
      if (parentIds.length > 0) {
        const { rows } = await db.query<any>(
          `/* session-list-page-parents */
           SELECT p.id, p.provider, p.model, p.session_type, p.mode, p.agent_role, p.created_by_session_id, p.title, p.workspace_id,
                  p.worktree_id, p.parent_session_id, p.created_at, p.updated_at, p.is_archived, p.is_pinned,
                  p.branched_from_session_id, p.branch_point_message_id, p.branched_at, p.metadata
           FROM ai_sessions p
           LEFT JOIN worktrees w ON w.id = p.worktree_id
           WHERE p.id = ANY($1::text[])
             AND p.workspace_id = $2
             AND ${buildSessionArchivePredicate(includeArchived, 'p', 'w')}`,
          [parentIds, workspaceId],
        );
        parentRows.push(...rows);
      }

      const candidateIds = Array.from(new Set([
        ...visibleSourceRows.map((row: any) => row.id),
        ...parentRows.map(row => row.id),
      ]));
      const childCounts = new Map<string, number>();
      if (candidateIds.length > 0) {
        const { rows } = await db.query<{ parent_session_id: string; child_count: number | string }>(
          `/* session-list-page-child-stats */
           SELECT parent_session_id, COUNT(*) AS child_count
           FROM ai_sessions
           WHERE workspace_id = $1
             AND parent_session_id = ANY($2::text[])
           GROUP BY parent_session_id`,
          [workspaceId, candidateIds],
        );
        for (const row of rows) {
          childCounts.set(row.parent_session_id, Number(row.child_count) || 0);
        }
      }

      const latestChildTimestamp = new Map<string, number>();
      for (const row of sourceRows) {
        if (!row.parent_session_id) continue;
        const timestamp = toMillis(row.updated_at)!;
        const current = latestChildTimestamp.get(row.parent_session_id);
        if (current === undefined || timestamp > current) {
          latestChildTimestamp.set(row.parent_session_id, timestamp);
        }
      }

      const sessions = new Map<string, SessionMeta>();
      const merge = (next: SessionMeta) => {
        const existing = sessions.get(next.id);
        if (!existing) {
          sessions.set(next.id, next);
          return;
        }
        sessions.set(next.id, {
          ...next,
          updatedAt: Math.max(existing.updatedAt, next.updatedAt),
          childCount: Math.max(existing.childCount, next.childCount),
        });
      };

      for (const row of visibleSourceRows) {
        merge(mapSessionMetaRow(row, { childCount: childCounts.get(row.id) ?? 0 }));
      }
      for (const row of parentRows) {
        const parentUpdatedAt = toMillis(row.updated_at)!;
        merge(mapSessionMetaRow(row, {
          childCount: childCounts.get(row.id) ?? 0,
          updatedAt: Math.max(parentUpdatedAt, latestChildTimestamp.get(row.id) ?? parentUpdatedAt),
        }));
      }

      const lastRow = sourceRows[sourceRows.length - 1];
      const nextCursor = hasMore
        ? encodeSessionListCursor({
          pinned: toBoolean(lastRow.list_pinned),
          sortTimestamp: toMillis(lastRow.list_sort_timestamp)!,
          tieTimestamp: toMillis(lastRow.list_tie_timestamp)!,
          groupId: lastRow.list_group_id,
          sourceId: lastRow.list_source_id,
          sortBy,
        })
        : null;

      return {
        sessions: Array.from(sessions.values()),
        nextCursor,
        hasMore,
        scannedCount: sourceRows.length,
      };
    },

    async list(workspaceId: string, options?: SessionListOptions): Promise<SessionMeta[]> {
      const startTime = performance.now();
      await ensureReady();
      const ensureTime = performance.now() - startTime;
      const includeArchived = options?.includeArchived ?? false;
      const archiveFilter = buildSessionArchiveFilter(includeArchived);

      const queryStart = performance.now();
      // Query includes parent_session_id and child_count for hierarchical session support
      // child_count and max child updated_at are pre-aggregated once per parent session
      // so list rendering does not pay for correlated subqueries on every row.
      // branched_from_session_id is separate from parent_session_id (branch vs hierarchy)
      // metadata is included for hasUnread state (transient UI state stored in DB for cross-device sync)
      // NOTE: message_count removed - it required an expensive LEFT JOIN on ai_agent_messages
      // that was slow with many sessions. The count is not essential for the list view.
      const { rows } = await db.query<any>(
        `SELECT s.id, s.provider, s.model, s.session_type, s.mode, s.agent_role, s.created_by_session_id, s.title, s.workspace_id,
                s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned,
                s.branched_from_session_id, s.branch_point_message_id, s.branched_at, s.metadata,
                COALESCE(child_stats.child_count, 0) as child_count,
                GREATEST(s.updated_at, COALESCE(child_stats.max_child_updated_at, s.updated_at)) as effective_updated_at
         FROM ai_sessions s
         LEFT JOIN worktrees w ON s.worktree_id = w.id
         LEFT JOIN (
           SELECT
             parent_session_id,
             COUNT(*) AS child_count,
             MAX(updated_at) AS max_child_updated_at
           FROM ai_sessions
           WHERE parent_session_id IS NOT NULL
             AND workspace_id = $1
           GROUP BY parent_session_id
         ) child_stats ON child_stats.parent_session_id = s.id
         WHERE s.workspace_id=$1 ${archiveFilter}
         ORDER BY effective_updated_at DESC`,
        [workspaceId]
      );
      const queryTime = performance.now() - queryStart;
      const totalTime = performance.now() - startTime;
      // console.log(`[PGLiteSessionStore] list() - ensureReady: ${ensureTime.toFixed(1)}ms, query: ${queryTime.toFixed(1)}ms, total: ${totalTime.toFixed(1)}ms, rows: ${rows.length}`);
      return rows.map(row => mapSessionMetaRow(row));
    },

    async search(workspaceId: string, query: string, options?: SessionSearchOptions): Promise<SessionMeta[]> {
      await ensureReady();

      // If query is empty, return all sessions (same as list)
      if (!query || query.trim().length === 0) {
        const sessions = await this.list(workspaceId, options);
        return options?.limit === undefined ? sessions : sessions.slice(0, options.limit);
      }

      const includeArchived = options?.includeArchived ?? false;
      const archiveFilter = buildSessionArchiveFilter(includeArchived);

      // Default to 30 days to reduce database load
      const timeRange = options?.timeRange ?? '30d';
      const direction = options?.direction ?? 'all';
      // IPC passes a one-row over-fetch (200 visible + 1) so it can report
      // whether the visible result set was truncated. Keep that cap in every
      // backend query; slicing only at the end would still read all matches.
      const requestedSearchLimit = options?.limit;
      const searchLimit = typeof requestedSearchLimit === 'number' && Number.isFinite(requestedSearchLimit)
        ? Math.max(1, Math.min(Math.floor(requestedSearchLimit), MAX_SESSION_SEARCH_CANDIDATE_LIMIT))
        : MAX_SESSION_SEARCH_CANDIDATE_LIMIT;

      const searchTerms = query.trim();

      // Calculate cutoff date for time range filter
      let cutoffDate: Date | null = null;
      if (timeRange !== 'all') {
        const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[timeRange];
        cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
      }

      // Hydrate ai_sessions rows for a set of session IDs. Used by both backends.
      const hydrateSessions = async (sessionIds: string[]): Promise<any[]> => {
        if (sessionIds.length === 0) return [];
        const { rows } = await db.query<any>(
          `SELECT
            s.id,
            s.provider,
            s.model,
            s.session_type,
            s.mode,
            s.agent_role,
            s.created_by_session_id,
            s.title,
            s.workspace_id,
            s.worktree_id,
            s.parent_session_id,
            s.created_at,
            s.updated_at,
            s.is_archived,
            s.is_pinned,
            s.branched_from_session_id,
            s.branch_point_message_id,
            s.branched_at,
            COALESCE(child_stats.child_count, 0) as child_count
          FROM ai_sessions s
          LEFT JOIN worktrees w ON s.worktree_id = w.id
          LEFT JOIN (
            SELECT parent_session_id, COUNT(*) AS child_count
            FROM ai_sessions
            WHERE parent_session_id = ANY($3::text[])
              AND workspace_id = $2
            GROUP BY parent_session_id
          ) child_stats ON child_stats.parent_session_id = s.id
          WHERE s.id = ANY($1)
            AND s.workspace_id = $2
            ${archiveFilter}`,
          // SQLite's PG-dialect adapter expands each ANY bind independently;
          // keep the child-stat array at a distinct positional index instead
          // of relying on one array placeholder twice.
          [sessionIds, workspaceId, sessionIds]
        );
        return rows;
      };

      // Build a map of session ID -> best rank from both sources
      const sessionRanks = new Map<string, number>();
      const sessionRows = new Map<string, any>();

      if (db.searchTranscriptEventSessions) {
        // SQLite path: use FTS5 helpers, then hydrate session rows.
        // bm25 returns lower-is-better; invert into "higher is better" rank
        // so the sort order below matches the PG ts_rank_cd semantics.
        const bm25ToRank = (bm25: number) => (bm25 === 0 ? 1 : 1 / (1 + bm25));

        const [titleHits, contentHits] = await Promise.all([
          db.searchSessionTitles!(workspaceId, searchTerms, { includeArchived, limit: searchLimit }),
          db.searchTranscriptEventSessions(searchTerms, {
            limit: searchLimit,
            workspaceId,
            cutoffDate,
            eventType: direction === 'input' ? 'user_message' : direction === 'output' ? 'assistant_message' : null,
          }),
        ]);

        // Title matches outweigh content matches, mirroring the PG `* 2` boost.
        const titleRanks = new Map<string, number>();
        for (const hit of titleHits) {
          titleRanks.set(hit.session_id, bm25ToRank(hit.rank) * 2);
        }
        const contentRanks = new Map<string, number>();
        for (const hit of contentHits) {
          contentRanks.set(hit.session_id, bm25ToRank(hit.rank));
        }

        const allIds = Array.from(new Set([...titleRanks.keys(), ...contentRanks.keys()]));
        const hydrated = await hydrateSessions(allIds);
        for (const row of hydrated) {
          const t = titleRanks.get(row.id) ?? 0;
          const c = contentRanks.get(row.id) ?? 0;
          const rank = Math.max(t, c);
          sessionRanks.set(row.id, rank);
          sessionRows.set(row.id, { ...row, rank });
        }
      } else {
        // PGLite path: inline to_tsvector / plainto_tsquery + ts_rank_cd.
        const titleQuery = db.query<any>(
        `SELECT s.id,
          ts_rank_cd(to_tsvector('english', COALESCE(s.title, '')), plainto_tsquery('english', $2)) * 2 AS rank
        FROM ai_sessions s
        LEFT JOIN worktrees w ON s.worktree_id = w.id
        WHERE s.workspace_id = $1
          AND to_tsvector('english', COALESCE(s.title, '')) @@ plainto_tsquery('english', $2)
          ${archiveFilter}
        ORDER BY rank DESC, s.updated_at DESC
        LIMIT $3`,
        [workspaceId, searchTerms, searchLimit]
      );

      const contentQuery = (() => {
        const contentQueryParams: any[] = [searchTerms, workspaceId];
        // Phase 2 of canonical-transcript-deprecation: search the raw
        // ai_agent_messages.searchable_text column directly. The legacy
        // ai_transcript_events index is being retired in Phase 4.
        let contentQuerySql = `SELECT DISTINCT t.session_id,
            MAX(ts_rank_cd(to_tsvector('english', COALESCE(t.searchable_text, '')), plainto_tsquery('english', $1))) as rank
          FROM ai_agent_messages t
          JOIN ai_sessions s ON s.id = t.session_id
          WHERE t.searchable_text IS NOT NULL
            AND s.workspace_id = $2
            AND t.message_kind IN ('user', 'assistant', 'system')
            AND to_tsvector('english', COALESCE(t.searchable_text, '')) @@ plainto_tsquery('english', $1)`;

        if (cutoffDate) {
          contentQueryParams.push(cutoffDate);
          contentQuerySql += ` AND t.created_at >= $${contentQueryParams.length}`;
        }

        if (direction === 'input') {
          contentQuerySql += ` AND t.message_kind = 'user'`;
        } else if (direction === 'output') {
          contentQuerySql += ` AND t.message_kind = 'assistant'`;
        }

        contentQuerySql += ' GROUP BY t.session_id ORDER BY rank DESC';
        contentQueryParams.push(searchLimit);
        contentQuerySql += ` LIMIT $${contentQueryParams.length}`;
        return db.query<any>(contentQuerySql, contentQueryParams);
      })();

      const [titleResult, contentResult] = await Promise.all([titleQuery, contentQuery]);

      // Both hit sources are capped, then their union is hydrated once. This
      // keeps child counts/grouping correct without reintroducing a global
      // child aggregation for every title-search candidate.
      for (const row of titleResult.rows) {
        sessionRanks.set(row.id, Number(row.rank ?? 0));
      }
      for (const contentRow of contentResult.rows) {
        const existingRank = sessionRanks.get(contentRow.session_id) || 0;
        sessionRanks.set(contentRow.session_id, Math.max(existingRank, Number(contentRow.rank ?? 0)));
      }
      const hydrated = await hydrateSessions(Array.from(sessionRanks.keys()));
      for (const row of hydrated) {
        sessionRows.set(row.id, { ...row, rank: sessionRanks.get(row.id) ?? 0 });
      }
      } // end PGLite branch

      // Convert to array and sort by rank DESC, updated_at DESC
      const rows = Array.from(sessionRows.values())
        .map(row => ({ ...row, max_rank: sessionRanks.get(row.id) || row.rank }))
        .sort((a, b) => {
          if (b.max_rank !== a.max_rank) return b.max_rank - a.max_rank;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });

      return rows.slice(0, searchLimit).map(row => {
        const createdAt = toMillis(row.created_at)!;
        const updatedAt = toMillis(row.updated_at)!;
        const branchedAt = toMillis(row.branched_at) ?? undefined;
        const childCount = parseInt(row.child_count) || 0;
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type || 'session',
          mode: row.mode ?? undefined,
          agentRole: row.agent_role ?? 'standard',
          title: row.title || 'Untitled Session',
          workspaceId: row.workspace_id,
          worktreeId: row.worktree_id ?? null,
          parentSessionId: row.parent_session_id ?? null,
          createdBySessionId: row.created_by_session_id ?? null,
          childCount,
          uncommittedCount: 0,
          createdAt,
          updatedAt,
          messageCount: 0,  // Not computed in search query for performance
          isArchived: row.is_archived ?? false,
          isPinned: row.is_pinned ?? false,
          branchedFromSessionId: row.branched_from_session_id ?? undefined,
          branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
          branchedAt,
        } satisfies SessionMeta;
      });
    },

    async getBranches(sessionId: string): Promise<SessionMeta[]> {
      await ensureReady();
      // Find all sessions that were branched FROM this session (not hierarchical children)
      const { rows } = await db.query<any>(
        `SELECT s.id, s.provider, s.model, s.session_type, s.mode, s.agent_role, s.created_by_session_id, s.title, s.workspace_id,
                s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned,
                s.branched_from_session_id, s.branch_point_message_id, s.branched_at
         FROM ai_sessions s
         WHERE s.branched_from_session_id=$1
         ORDER BY s.branched_at DESC`,
        [sessionId]
      );
      return rows.map(row => {
        const createdAt = toMillis(row.created_at)!;
        const updatedAt = toMillis(row.updated_at)!;
        const branchedAt = toMillis(row.branched_at) ?? undefined;
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type || 'session',
          mode: row.mode ?? undefined,
          agentRole: row.agent_role ?? 'standard',
          title: row.title || 'Untitled Session',
          workspaceId: row.workspace_id,
          worktreeId: row.worktree_id ?? null,
          parentSessionId: row.parent_session_id ?? null,
          createdBySessionId: row.created_by_session_id ?? null,
          childCount: 0,  // Not computed in branch query
          uncommittedCount: 0,
          createdAt,
          updatedAt,
          messageCount: 0,
          isArchived: row.is_archived ?? false,
          isPinned: row.is_pinned ?? false,
          branchedFromSessionId: row.branched_from_session_id ?? undefined,
          branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
          branchedAt,
        } satisfies SessionMeta;
      });
    },

    async delete(sessionId: string): Promise<void> {
      await ensureReady();
      await db.query('DELETE FROM ai_sessions WHERE id=$1', [sessionId]);
    },

    async updateTitleIfNotNamed(sessionId: string, title: string): Promise<boolean> {
      await ensureReady();
      // NOTE: We intentionally do NOT update updated_at here. The updated_at timestamp
      // should only change when messages are added, so session history sorting
      // accurately reflects the last message time.
      const { rows } = await db.query<{ affected_rows: number }>(
        `UPDATE ai_sessions
         SET title = $2, has_been_named = true
         WHERE id = $1 AND (has_been_named = false OR has_been_named IS NULL)
         RETURNING 1 as affected_rows`,
        [sessionId, title]
      );
      return rows.length > 0;
    },

    // Note: claimQueuedPrompt has been moved to the new queued_prompts table
    // See PGLiteQueuedPromptsStore.ts for the new implementation
  };
}

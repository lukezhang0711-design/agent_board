import { database as databaseWorker } from '../database/PGLiteDatabaseWorker';

export type DispatchQueueStatus =
  | 'queued'
  | 'dispatching'
  | 'dispatched'
  | 'cancelled'
  | 'failed';

export type DispatchRequestKind = 'create_session' | 'spawn_session';

export interface DispatchQueueRequestSnapshot {
  requestKind: DispatchRequestKind;
  metaSessionId: string;
  workspaceId: string;
  args: Record<string, unknown>;
}

export interface DispatchQueueItem {
  id: string;
  queueSequence: number;
  headSessionId: string;
  workspaceId: string;
  reservedSessionId: string;
  requestSnapshot: DispatchQueueRequestSnapshot;
  requestedAt: string;
  status: DispatchQueueStatus;
  errorMessage: string | null;
  sourceRef: string;
  dispatchedSessionId: string | null;
  dispatchedAt: string | null;
  updatedAt: string;
}

export interface EnqueueDispatchInput {
  id: string;
  headSessionId: string;
  workspaceId: string;
  reservedSessionId: string;
  requestSnapshot: DispatchQueueRequestSnapshot;
  requestedAt: string;
  sourceRef: string;
}

type DatabaseLike = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

interface DispatchQueueRow {
  id: string;
  queue_sequence: number | string;
  head_session_id: string;
  workspace_id: string;
  reserved_session_id: string;
  request_snapshot: unknown;
  requested_at: unknown;
  status: DispatchQueueStatus;
  error_message: string | null;
  source_ref: string;
  dispatched_session_id: string | null;
  dispatched_at: unknown | null;
  updated_at: unknown;
}

const RETURNING_COLUMNS = `
  id,
  queue_sequence,
  head_session_id,
  workspace_id,
  reserved_session_id,
  request_snapshot,
  requested_at,
  status,
  error_message,
  source_ref,
  dispatched_session_id,
  dispatched_at,
  updated_at
`;

function parseSnapshot(value: unknown): DispatchQueueRequestSnapshot {
  if (typeof value === 'string') {
    return JSON.parse(value) as DispatchQueueRequestSnapshot;
  }
  return value as DispatchQueueRequestSnapshot;
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRow(row: DispatchQueueRow): DispatchQueueItem {
  return {
    id: row.id,
    queueSequence: Number(row.queue_sequence),
    headSessionId: row.head_session_id,
    workspaceId: row.workspace_id,
    reservedSessionId: row.reserved_session_id,
    requestSnapshot: parseSnapshot(row.request_snapshot),
    requestedAt: normalizeTimestamp(row.requested_at),
    status: row.status,
    errorMessage: row.error_message ?? null,
    sourceRef: row.source_ref,
    dispatchedSessionId: row.dispatched_session_id ?? null,
    dispatchedAt: row.dispatched_at == null ? null : normalizeTimestamp(row.dispatched_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

export class PGLiteDispatchQueueStore {
  constructor(private readonly db: DatabaseLike) {}

  async enqueue(input: EnqueueDispatchInput): Promise<{ item: DispatchQueueItem; position: number }> {
    const { rows } = await this.db.query<DispatchQueueRow>(
      `INSERT INTO dispatch_queue (
         id,
         head_session_id,
         workspace_id,
         reserved_session_id,
         request_snapshot,
         requested_at,
         status,
         source_ref,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'queued', $7, $6)
       RETURNING ${RETURNING_COLUMNS}`,
      [
        input.id,
        input.headSessionId,
        input.workspaceId,
        input.reservedSessionId,
        JSON.stringify(input.requestSnapshot),
        input.requestedAt,
        input.sourceRef,
      ],
    );
    const item = mapRow(rows[0]);
    const { rows: positionRows } = await this.db.query<{ position: number | string }>(
      `SELECT COUNT(*) AS position
       FROM dispatch_queue
       WHERE head_session_id = $1
         AND status = 'queued'
         AND queue_sequence <= $2`,
      [input.headSessionId, item.queueSequence],
    );
    return {
      item,
      position: Number(positionRows[0]?.position ?? 1),
    };
  }

  async hasQueued(headSessionId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ count: number | string }>(
      `SELECT COUNT(*) AS count
       FROM dispatch_queue
       WHERE head_session_id = $1 AND status = 'queued'`,
      [headSessionId],
    );
    return Number(rows[0]?.count ?? 0) > 0;
  }

  async claimNext(headSessionId: string): Promise<DispatchQueueItem | null> {
    const { rows } = await this.db.query<DispatchQueueRow>(
      `UPDATE dispatch_queue
       SET status = 'dispatching', updated_at = CURRENT_TIMESTAMP, error_message = NULL
       WHERE id = (
         SELECT id
         FROM dispatch_queue
         WHERE head_session_id = $1 AND status = 'queued'
         ORDER BY queue_sequence ASC
         LIMIT 1
       )
         AND status = 'queued'
       RETURNING ${RETURNING_COLUMNS}`,
      [headSessionId],
    );
    const row = rows[0];
    return row?.id && row.request_snapshot ? mapRow(row) : null;
  }

  async requeue(id: string): Promise<void> {
    await this.db.query(
      `UPDATE dispatch_queue
       SET status = 'queued', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'dispatching'`,
      [id],
    );
  }

  async markDispatched(id: string, sessionId: string): Promise<void> {
    await this.db.query(
      `UPDATE dispatch_queue
       SET status = 'dispatched',
           dispatched_session_id = $2,
           dispatched_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           error_message = NULL
       WHERE id = $1 AND status = 'dispatching'`,
      [id, sessionId],
    );
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.db.query(
      `UPDATE dispatch_queue
       SET status = 'failed', error_message = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'dispatching'`,
      [id, errorMessage],
    );
  }

  async recoverDispatching(): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE dispatch_queue
       SET status = 'queued', error_message = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'dispatching'
       RETURNING id`,
    );
    return rows.length;
  }

  async listQueuedHeadSessionIds(): Promise<string[]> {
    const { rows } = await this.db.query<{ head_session_id: string }>(
      `SELECT head_session_id
       FROM dispatch_queue
       WHERE status = 'queued'
       GROUP BY head_session_id
       ORDER BY MIN(queue_sequence) ASC`,
    );
    return rows
      .map(({ head_session_id }) => head_session_id)
      .filter((headSessionId): headSessionId is string => typeof headSessionId === 'string' && headSessionId.length > 0);
  }

  async get(id: string): Promise<DispatchQueueItem | null> {
    const { rows } = await this.db.query<DispatchQueueRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM dispatch_queue
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row?.id && row.request_snapshot ? mapRow(row) : null;
  }
}

export function createPGLiteDispatchQueueStore(
  db: DatabaseLike = databaseWorker,
): PGLiteDispatchQueueStore {
  return new PGLiteDispatchQueueStore(db);
}

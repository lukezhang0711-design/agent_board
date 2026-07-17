import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../database/PGLiteDatabaseWorker', () => ({ database: {} }));

import { createPGLiteDispatchQueueStore } from '../PGLiteDispatchQueueStore';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-dispatch-queue-pglite-'));
  tempDirs.push(dir);
  return dir;
}

async function openDatabase(dataDir: string): Promise<PGlite> {
  const db = new PGlite({ dataDir });
  await (db as unknown as { waitReady: Promise<void> }).waitReady;
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('PGLiteDispatchQueueStore', () => {
  it('persists FIFO order and recovers dispatching work across a real PGLite restart', async () => {
    const dataDir = makeTempDir();
    let db = await openDatabase(dataDir);
    await db.exec(`
      CREATE TABLE ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL
      );
      CREATE TABLE dispatch_queue (
        queue_sequence BIGSERIAL PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        head_session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        reserved_session_id TEXT NOT NULL UNIQUE,
        request_snapshot JSONB NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'dispatching', 'dispatched', 'cancelled', 'failed')),
        error_message TEXT,
        source_ref TEXT NOT NULL UNIQUE,
        dispatched_session_id TEXT,
        dispatched_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await db.query(
      `INSERT INTO ai_sessions (id, workspace_id) VALUES ($1, $2)`,
      ['head-pglite', '/workspace/pglite'],
    );

    let store = createPGLiteDispatchQueueStore(db);
    const first = await store.enqueue({
      id: 'queue-first',
      headSessionId: 'head-pglite',
      workspaceId: '/workspace/pglite',
      reservedSessionId: 'session-first',
      requestSnapshot: {
        requestKind: 'create_session',
        metaSessionId: 'head-pglite',
        workspaceId: '/workspace/pglite',
        args: { title: 'First', prompt: 'Run first', intent: 'investigation' },
      },
      requestedAt: '2026-07-17T09:00:00.000Z',
      sourceRef: 'meta-agent-work-order:session-first',
    });
    const second = await store.enqueue({
      id: 'queue-second',
      headSessionId: 'head-pglite',
      workspaceId: '/workspace/pglite',
      reservedSessionId: 'session-second',
      requestSnapshot: {
        requestKind: 'spawn_session',
        metaSessionId: 'head-pglite',
        workspaceId: '/workspace/pglite',
        args: { title: 'Second', prompt: 'Run second', intent: 'investigation' },
      },
      requestedAt: '2026-07-17T09:00:00.000Z',
      sourceRef: 'meta-agent-work-order:session-second',
    });
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    await expect(store.claimNext('head-pglite')).resolves.toMatchObject({ id: 'queue-first' });
    await db.close();

    db = await openDatabase(dataDir);
    store = createPGLiteDispatchQueueStore(db);
    await expect(store.recoverDispatching()).resolves.toBe(1);
    const recovered = await store.claimNext('head-pglite');
    expect(recovered).toMatchObject({
      id: 'queue-first',
      status: 'dispatching',
      requestSnapshot: { args: { title: 'First' } },
    });
    await store.markFailed('queue-first', 'provider unavailable');
    const next = await store.claimNext('head-pglite');
    expect(next).toMatchObject({ id: 'queue-second', status: 'dispatching' });
    await store.markDispatched('queue-second', 'session-second');
    await expect(store.get('queue-first')).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'provider unavailable',
    });
    await expect(store.get('queue-second')).resolves.toMatchObject({
      status: 'dispatched',
      dispatchedSessionId: 'session-second',
    });
    await db.close();

    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../database/worker.js'),
      'utf8',
    );
    expect(workerSource).toContain('CREATE TABLE IF NOT EXISTS dispatch_queue');
    expect(workerSource).toContain('request_snapshot JSONB NOT NULL');
    expect(workerSource).toContain("'queued', 'dispatching', 'dispatched', 'cancelled', 'failed'");
  }, 30_000);
});

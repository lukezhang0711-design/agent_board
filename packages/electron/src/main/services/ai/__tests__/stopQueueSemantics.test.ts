import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { PGlite } from '@electric-sql/pglite';
import {
  cancelRequestWithQueueSemantics,
  createPGLiteQueuedPromptsStore,
  resumeQueuedPromptsWithDispatch,
  tryDispatchNextQueuedPromptUnlessPaused,
  type QueuedPromptsStore,
} from '../../PGLiteQueuedPromptsStore';

type WorkerResponse = {
  id: number;
  success: boolean;
  data?: any;
  error?: string;
};

let requestId = 0;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function requestWorker(worker: Worker, type: string, payload?: unknown): Promise<any> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const onMessage = (response: WorkerResponse) => {
      if (response.id !== id) return;
      worker.off('message', onMessage);
      if (response.success) resolve(response.data);
      else reject(new Error(response.error || `Worker request ${type} failed`));
    };
    worker.on('message', onMessage);
    worker.postMessage({ id, type, payload });
  });
}

function spawnPGLiteWorker(userDataPath: string): Worker {
  const workerPath = path.resolve(__dirname, '../../../database/worker.js');
  const worker = new Worker(workerPath, {
    workerData: { userDataPath },
    stdout: true,
    stderr: true,
  });
  worker.stdout?.resume();
  worker.stderr?.resume();
  return worker;
}

async function closeWorker(worker: Worker): Promise<void> {
  try {
    await requestWorker(worker, 'close');
  } finally {
    await worker.terminate();
  }
}

async function makeQueueDb(): Promise<{
  db: PGlite;
  dataDir: string;
  store: QueuedPromptsStore;
}> {
  const dataDir = makeTempDir('nim-queue-pause-pglite-');
  const db = new PGlite({ dataDir });
  await db.waitReady;
  await db.exec(`
    CREATE TABLE queued_prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'user'
        CHECK (origin IN ('user', 'child_session_event')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paused', 'executing', 'completed', 'failed')),
      attachments JSONB,
      document_context JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_message TEXT
    );
    CREATE TABLE ai_agent_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return {
    db,
    dataDir,
    store: createPGLiteQueuedPromptsStore(db),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('queued prompt pause persistence (PGLite)', () => {
  it('persists default user and child session event origins across a database restart', async () => {
    const { db, dataDir, store } = await makeQueueDb();
    await store.create({ id: 'p-origin-user', sessionId: 'session-origin-pg', prompt: 'user prompt' });
    await store.create({
      id: 'p-origin-child',
      sessionId: 'session-origin-pg',
      prompt: '[Child Session Update]\nEvent: session:completed',
      origin: 'child_session_event',
    });
    expect((await store.get('p-origin-user'))?.origin).toBe('user');
    expect((await store.get('p-origin-child'))?.origin).toBe('child_session_event');
    await db.close();

    const reopenedDb = new PGlite({ dataDir });
    await reopenedDb.waitReady;
    const reopenedStore = createPGLiteQueuedPromptsStore(reopenedDb);
    try {
      expect((await reopenedStore.get('p-origin-user'))?.origin).toBe('user');
      expect((await reopenedStore.get('p-origin-child'))?.origin).toBe('child_session_event');
    } finally {
      await reopenedDb.close();
    }
  }, 30_000);

  it('keeps paused rows unclaimable across sweeps and a database restart', async () => {
    const { db, dataDir, store } = await makeQueueDb();
    await store.create({ id: 'p-1', sessionId: 'session-pg', prompt: 'one' });
    await store.create({ id: 'p-2', sessionId: 'session-pg', prompt: 'two' });

    await expect(store.pauseSessionQueue('session-pg')).resolves.toBe(2);
    // A pending row created while paused must still be gated at the session
    // level until explicit resume.
    await store.create({ id: 'p-3', sessionId: 'session-pg', prompt: 'three' });
    await expect(store.listPending('session-pg')).resolves.toEqual([]);
    await expect(store.claim('p-1')).resolves.toBeNull();
    await expect(store.claim('p-3')).resolves.toBeNull();
    await expect(store.sweepExecutingOnBoot()).resolves.toEqual({ completed: 0, rolledBack: 0 });
    await expect(store.sweepExecutingForSession('session-pg')).resolves.toEqual({ completed: 0, rolledBack: 0 });
    expect((await store.listForSession('session-pg', { includeCompleted: true })).map(({ status }) => status))
      .toEqual(['paused', 'paused', 'pending']);
    await db.close();

    const reopenedDb = new PGlite({ dataDir });
    await reopenedDb.waitReady;
    const reopenedStore = createPGLiteQueuedPromptsStore(reopenedDb);
    try {
      await expect(reopenedStore.isSessionQueuePaused('session-pg')).resolves.toBe(true);
      await expect(reopenedStore.listPending('session-pg')).resolves.toEqual([]);
      expect((await reopenedStore.get('p-1'))?.status).toBe('paused');

      await expect(reopenedStore.resumeSessionQueue('session-pg')).resolves.toBe(2);
      expect((await reopenedStore.listPending('session-pg')).map(({ id }) => id)).toEqual(['p-1', 'p-2', 'p-3']);
    } finally {
      await reopenedDb.close();
    }
  }, 30_000);

  it('migrates an existing four-state worker schema and preserves queued rows', async () => {
    const userDataPath = makeTempDir('nim-worker-queue-pause-');
    const firstWorker = spawnPGLiteWorker(userDataPath);
    await requestWorker(firstWorker, 'init');
    await requestWorker(firstWorker, 'exec', {
      sql: `
        INSERT INTO ai_sessions (id, provider, title)
        VALUES ('session-worker', 'claude-code', 'Worker migration');
        INSERT INTO queued_prompts (id, session_id, prompt, status)
        VALUES ('prompt-worker', 'session-worker', 'preserve me', 'pending');
        DO $$
        DECLARE
          constraint_name TEXT;
        BEGIN
          SELECT con.conname INTO constraint_name
          FROM pg_constraint con
          JOIN pg_attribute att
            ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
          WHERE con.conrelid = 'queued_prompts'::regclass
            AND att.attname = 'status'
            AND con.contype = 'c'
          LIMIT 1;
          IF constraint_name IS NOT NULL THEN
            EXECUTE 'ALTER TABLE queued_prompts DROP CONSTRAINT ' || quote_ident(constraint_name);
          END IF;
          ALTER TABLE queued_prompts ADD CONSTRAINT queued_prompts_status_check
            CHECK (status IN ('pending', 'executing', 'completed', 'failed'));
        END $$;
      `,
    });
    await closeWorker(firstWorker);

    const upgradedWorker = spawnPGLiteWorker(userDataPath);
    try {
      await requestWorker(upgradedWorker, 'init');
      const updated = await requestWorker(upgradedWorker, 'query', {
        sql: `UPDATE queued_prompts SET status = 'paused' WHERE id = $1 RETURNING id, prompt, status`,
        params: ['prompt-worker'],
      });
      expect(updated.rows).toEqual([
        { id: 'prompt-worker', prompt: 'preserve me', status: 'paused' },
      ]);
    } finally {
      await closeWorker(upgradedWorker);
    }
  }, 60_000);

  it('adds origin to an existing worker queue and defaults preserved rows to user', async () => {
    const userDataPath = makeTempDir('nim-worker-queue-origin-');
    const firstWorker = spawnPGLiteWorker(userDataPath);
    await requestWorker(firstWorker, 'init');
    await requestWorker(firstWorker, 'exec', {
      sql: `
        INSERT INTO ai_sessions (id, provider, title)
        VALUES ('session-worker-origin', 'claude-code', 'Worker origin migration');
        INSERT INTO queued_prompts (id, session_id, prompt, status)
        VALUES ('prompt-worker-origin', 'session-worker-origin', 'preserve origin default', 'pending');
        ALTER TABLE queued_prompts DROP COLUMN IF EXISTS origin;
      `,
    });
    await closeWorker(firstWorker);

    const upgradedWorker = spawnPGLiteWorker(userDataPath);
    try {
      await requestWorker(upgradedWorker, 'init');
      const legacy = await requestWorker(upgradedWorker, 'query', {
        sql: `SELECT id, prompt, origin FROM queued_prompts WHERE id = $1`,
        params: ['prompt-worker-origin'],
      });
      expect(legacy.rows).toEqual([
        { id: 'prompt-worker-origin', prompt: 'preserve origin default', origin: 'user' },
      ]);

      const child = await requestWorker(upgradedWorker, 'query', {
        sql: `
          INSERT INTO queued_prompts (id, session_id, prompt, origin)
          VALUES ($1, $2, $3, $4)
          RETURNING id, origin
        `,
        params: [
          'prompt-worker-child-origin',
          'session-worker-origin',
          '[Child Session Update]',
          'child_session_event',
        ],
      });
      expect(child.rows).toEqual([
        { id: 'prompt-worker-child-origin', origin: 'child_session_event' },
      ]);
    } finally {
      await closeWorker(upgradedWorker);
    }
  }, 60_000);
});

describe('cancel and automatic dispatch queue semantics', () => {
  let db: PGlite;
  let store: QueuedPromptsStore;

  beforeEach(async () => {
    ({ db, store } = await makeQueueDb());
  });

  afterEach(async () => {
    await db.close();
  });

  it('pauses on cancel, blocks completion/error dispatch, then resumes explicitly', async () => {
    await store.create({ id: 'p-cancel-1', sessionId: 'session-cancel', prompt: 'continue first' });
    await store.create({ id: 'p-cancel-2', sessionId: 'session-cancel', prompt: 'continue second' });

    const cancelled: string[] = [];
    const processing = new Set(['session-cancel']);
    const result = await cancelRequestWithQueueSemantics({
      sessionId: 'session-cancel',
      queueAction: 'pause',
      queueStore: store,
      cancelCurrent: async () => {
        cancelled.push('current');
      },
      clearProcessing: () => processing.delete('session-cancel'),
    });

    expect(result).toEqual({ success: true, queue: 'paused', paused: 2 });
    expect(cancelled).toEqual(['current']);
    expect(processing.has('session-cancel')).toBe(false);
    expect((await store.get('p-cancel-1'))?.status).toBe('paused');
    expect((await store.get('p-cancel-2'))?.status).toBe('paused');

    const delivered: string[] = [];
    const dispatch = async () => {
      const [next] = await store.listPending('session-cancel');
      if (!next) return false;
      const claimed = await store.claim(next.id);
      if (!claimed) return false;
      delivered.push(claimed.prompt);
      return true;
    };
    const gate = (source: string) => tryDispatchNextQueuedPromptUnlessPaused({
      sessionId: 'session-cancel',
      source,
      isSessionQueuePaused: (sessionId: string) => store.isSessionQueuePaused(sessionId),
      dispatch,
      logInfo: vi.fn(),
    });

    await expect(gate('completion-handler queue')).resolves.toBe(false);
    await expect(gate('error-handler queue')).resolves.toBe(false);
    expect(delivered).toEqual([]);
    expect((await store.get('p-cancel-1'))?.status).toBe('paused');
    expect((await store.get('p-cancel-2'))?.status).toBe('paused');

    await expect(resumeQueuedPromptsWithDispatch({
      sessionId: 'session-cancel',
      queueStore: store,
      dispatch: () => gate('explicit resume'),
    })).resolves.toEqual({ success: true, resumed: 2 });
    expect(delivered).toEqual(['continue first']);
    expect((await store.get('p-cancel-1'))?.status).toBe('executing');
    expect((await store.get('p-cancel-2'))?.status).toBe('pending');
  }, 30_000);

  it('returns resume and dispatch failures with the number already resumed', async () => {
    const dispatchAfterResumeFailure = vi.fn(async () => {});
    await expect(resumeQueuedPromptsWithDispatch({
      sessionId: 'session-resume-failure',
      queueStore: {
        resumeSessionQueue: async () => {
          throw new Error('resume unavailable');
        },
      },
      dispatch: dispatchAfterResumeFailure,
    })).resolves.toEqual({
      success: false,
      resumed: 0,
      error: 'resume unavailable',
    });
    expect(dispatchAfterResumeFailure).not.toHaveBeenCalled();

    await store.create({
      id: 'p-dispatch-failure',
      sessionId: 'session-dispatch-failure',
      prompt: 'resume before dispatch fails',
    });
    await store.pauseSessionQueue('session-dispatch-failure');

    await expect(resumeQueuedPromptsWithDispatch({
      sessionId: 'session-dispatch-failure',
      queueStore: store,
      dispatch: async () => {
        throw new Error('dispatch unavailable');
      },
    })).resolves.toEqual({
      success: false,
      resumed: 1,
      error: 'dispatch unavailable',
    });
    expect((await store.get('p-dispatch-failure'))?.status).toBe('pending');
  }, 30_000);

  it('clears active queue rows and surfaces queue failures instead of cancelling anyway', async () => {
    await store.create({ id: 'p-clear-1', sessionId: 'session-clear', prompt: 'one' });
    await store.create({ id: 'p-clear-2', sessionId: 'session-clear', prompt: 'two' });

    const cancelCurrent = vi.fn(async () => {});
    await expect(cancelRequestWithQueueSemantics({
      sessionId: 'session-clear',
      queueAction: 'clear',
      queueStore: store,
      cancelCurrent,
      clearProcessing: vi.fn(),
    })).resolves.toEqual({ success: true, queue: 'cleared' });
    expect(await store.listForSession('session-clear', { includeCompleted: true })).toEqual([]);
    expect(cancelCurrent).toHaveBeenCalledOnce();

    const failedCancel = vi.fn(async () => {});
    const failingStore = {
      ...store,
      pauseSessionQueue: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    };
    const failed = await cancelRequestWithQueueSemantics({
      sessionId: 'session-fail',
      queueAction: 'pause',
      queueStore: failingStore,
      cancelCurrent: failedCancel,
      clearProcessing: vi.fn(),
    });
    expect(failed).toEqual({
      success: false,
      queue: 'unchanged',
      error: 'database unavailable',
    });
    expect(failedCancel).not.toHaveBeenCalled();
  }, 30_000);
});

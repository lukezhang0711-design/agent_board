import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SQLiteDatabase } from '../SQLiteDatabase';
import { getMigrations } from '../MigrationRunner';
import { createPGLiteQueuedPromptsStore } from '../../../services/PGLiteQueuedPromptsStore';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('0015 queued prompt pause migration (SQLite)', () => {
  it('upgrades a version-14 database without losing rows and enables pause/resume', async () => {
    const dbDir = makeTempDir('nim-queue-pause-sqlite-');
    const legacySchemaDir = makeTempDir('nim-queue-pause-schema-');
    const realSchemaDir = path.resolve(__dirname, '..', 'schemas');

    for (const file of fs.readdirSync(realSchemaDir)) {
      if (/^00(?:0[1-9]|1[0-4])_.*\.sql$/.test(file)) {
        fs.copyFileSync(path.join(realSchemaDir, file), path.join(legacySchemaDir, file));
      }
    }
    const legacy = new SQLiteDatabase({
      dbDir,
      schemaDir: legacySchemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await legacy.initialize();
    const legacyHandle = legacy.getRawHandle()!;
    legacyHandle.prepare(
      `INSERT INTO ai_sessions (id, provider, title) VALUES (?, ?, ?)`,
    ).run('session-sqlite', 'claude-code', 'SQLite pause migration');
    legacyHandle.prepare(
      `INSERT INTO queued_prompts (id, session_id, prompt, status) VALUES (?, ?, ?, 'pending')`,
    ).run('prompt-sqlite', 'session-sqlite', 'keep me');
    await legacy.close();

    const upgraded = new SQLiteDatabase({
      dbDir,
      schemaDir: realSchemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await upgraded.initialize();
    try {
      const versions = upgraded.getRawHandle()!
        .prepare('SELECT version FROM _migrations ORDER BY version')
        .all() as Array<{ version: number }>;
      expect(versions.map(({ version }) => version)).toContain(15);
      expect(getMigrations(realSchemaDir).find(({ version }) => version === 15)?.name)
        .toBe('queued_prompts_paused');

      const store = createPGLiteQueuedPromptsStore(upgraded);
      await expect(store.pauseSessionQueue('session-sqlite')).resolves.toBe(1);
      await store.create({
        id: 'prompt-sqlite-late',
        sessionId: 'session-sqlite',
        prompt: 'wait behind pause',
      });
      await expect(store.listPending('session-sqlite')).resolves.toEqual([]);
      await expect(store.claim('prompt-sqlite-late')).resolves.toBeNull();

      const [paused] = await store.listForSession('session-sqlite', { includeCompleted: true });
      expect(paused).toMatchObject({
        id: 'prompt-sqlite',
        prompt: 'keep me',
        status: 'paused',
      });

      await expect(store.sweepExecutingOnBoot()).resolves.toEqual({ completed: 0, rolledBack: 0 });
      await expect(store.sweepExecutingForSession('session-sqlite')).resolves.toEqual({
        completed: 0,
        rolledBack: 0,
      });
      expect((await store.get('prompt-sqlite'))?.status).toBe('paused');
    } finally {
      await upgraded.close();
    }

    const restarted = new SQLiteDatabase({
      dbDir,
      schemaDir: realSchemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await restarted.initialize();
    try {
      const restartedStore = createPGLiteQueuedPromptsStore(restarted);
      await expect(restartedStore.isSessionQueuePaused('session-sqlite')).resolves.toBe(true);
      await expect(restartedStore.listPending('session-sqlite')).resolves.toEqual([]);
      expect((await restartedStore.get('prompt-sqlite'))?.status).toBe('paused');

      await expect(restartedStore.resumeSessionQueue('session-sqlite')).resolves.toBe(1);
      expect((await restartedStore.listPending('session-sqlite')).map(({ id }) => id).sort()).toEqual([
        'prompt-sqlite',
        'prompt-sqlite-late',
      ]);
      await expect(restartedStore.clearSessionQueue('session-sqlite')).resolves.toBe(2);
      await expect(restartedStore.listForSession('session-sqlite', { includeCompleted: true }))
        .resolves.toEqual([]);
    } finally {
      await restarted.close();
    }
  }, 30_000);
});

describe('0016 queued prompt origin migration (SQLite)', () => {
  it('defaults legacy rows to user and persists child session event origins across restart', async () => {
    const dbDir = makeTempDir('nim-queue-origin-sqlite-');
    const legacySchemaDir = makeTempDir('nim-queue-origin-schema-');
    const realSchemaDir = path.resolve(__dirname, '..', 'schemas');

    for (const file of fs.readdirSync(realSchemaDir)) {
      if (/^00(?:0[1-9]|1[0-5])_.*\.sql$/.test(file)) {
        fs.copyFileSync(path.join(realSchemaDir, file), path.join(legacySchemaDir, file));
      }
    }

    const legacy = new SQLiteDatabase({
      dbDir,
      schemaDir: legacySchemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await legacy.initialize();
    const legacyHandle = legacy.getRawHandle()!;
    legacyHandle.prepare(
      `INSERT INTO ai_sessions (id, provider, title) VALUES (?, ?, ?)`,
    ).run('session-origin-sqlite', 'claude-code', 'SQLite origin migration');
    legacyHandle.prepare(
      `INSERT INTO queued_prompts (id, session_id, prompt, status) VALUES (?, ?, ?, 'pending')`,
    ).run('prompt-origin-legacy', 'session-origin-sqlite', 'legacy user prompt');
    await legacy.close();

    const upgraded = new SQLiteDatabase({
      dbDir,
      schemaDir: realSchemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await upgraded.initialize();
    try {
      const versions = upgraded.getRawHandle()!
        .prepare('SELECT version FROM _migrations ORDER BY version')
        .all() as Array<{ version: number }>;
      expect(versions.map(({ version }) => version)).toContain(16);
      expect(getMigrations(realSchemaDir).find(({ version }) => version === 16)?.name)
        .toBe('queued_prompts_origin');

      const store = createPGLiteQueuedPromptsStore(upgraded);
      expect((await store.get('prompt-origin-legacy'))?.origin).toBe('user');
      await store.create({
        id: 'prompt-origin-child',
        sessionId: 'session-origin-sqlite',
        prompt: '[Child Session Update]\nEvent: session:completed',
        origin: 'child_session_event',
      });
      expect((await store.get('prompt-origin-child'))?.origin).toBe('child_session_event');
    } finally {
      await upgraded.close();
    }

    const restarted = new SQLiteDatabase({
      dbDir,
      schemaDir: realSchemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await restarted.initialize();
    try {
      const store = createPGLiteQueuedPromptsStore(restarted);
      expect((await store.get('prompt-origin-legacy'))?.origin).toBe('user');
      expect((await store.get('prompt-origin-child'))?.origin).toBe('child_session_event');
    } finally {
      await restarted.close();
    }
  }, 30_000);
});

describe('0017 dispatch queue migration (SQLite)', () => {
  it('registers the durable queue schema and repairs a recorded migration whose table is missing', async () => {
    const dbDir = makeTempDir('nim-dispatch-queue-sqlite-');
    const schemaDir = path.resolve(__dirname, '..', 'schemas');
    const database = new SQLiteDatabase({
      dbDir,
      schemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await database.initialize();

    const handle = database.getRawHandle()!;
    expect(getMigrations(schemaDir).at(-1)).toMatchObject({
      version: 17,
      name: 'dispatch_queue',
    });
    const columns = handle
      .prepare('PRAGMA table_info(dispatch_queue)')
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'id',
      'queue_sequence',
      'head_session_id',
      'workspace_id',
      'reserved_session_id',
      'request_snapshot',
      'requested_at',
      'status',
      'error_message',
      'source_ref',
      'dispatched_session_id',
    ]));
    const tableSql = (
      handle
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'dispatch_queue'`)
        .get() as { sql: string }
    ).sql;
    for (const status of ['queued', 'dispatching', 'dispatched', 'cancelled', 'failed']) {
      expect(tableSql).toContain(`'${status}'`);
    }

    handle.exec('DROP TABLE dispatch_queue');
    await database.close();

    const restarted = new SQLiteDatabase({
      dbDir,
      schemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await restarted.initialize();
    try {
      const repaired = restarted.getRawHandle()!;
      expect(
        repaired
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dispatch_queue'`)
          .get(),
      ).toEqual({ name: 'dispatch_queue' });
      expect(
        repaired
          .prepare('SELECT name FROM _migrations WHERE version = 17')
          .get(),
      ).toEqual({ name: 'dispatch_queue' });
    } finally {
      await restarted.close();
    }
  }, 30_000);
});

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
    // Once version 15 is registered, the legacy fixture applies a no-op entry
    // and then removes its ledger row so the real upgrade can run below.
    fs.writeFileSync(
      path.join(legacySchemaDir, '0015_queued_prompts_paused.sql'),
      '-- deferred to the real schema directory\n',
    );

    const legacy = new SQLiteDatabase({
      dbDir,
      schemaDir: legacySchemaDir,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await legacy.initialize();
    const legacyHandle = legacy.getRawHandle()!;
    legacyHandle.prepare('DELETE FROM _migrations WHERE version = 15').run();
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
      expect(getMigrations(realSchemaDir).at(-1)?.name).toBe('queued_prompts_paused');

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

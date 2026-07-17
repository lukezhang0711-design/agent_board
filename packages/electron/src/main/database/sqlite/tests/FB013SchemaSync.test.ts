import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MigrationOrchestrator,
  type LivePgliteReader,
} from '../MigrationOrchestrator';
import { assertAppliedMigrationSchema, runMigrations } from '../MigrationRunner';
import {
  PGLiteToSQLiteMigrator,
  type PGLiteHandle,
} from '../PGLiteToSQLiteMigrator';
import { SQLiteDatabase } from '../SQLiteDatabase';

const SCHEMA_DIR = path.resolve(__dirname, '..', 'schemas');
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function openPgliteReader(dataDir: string): Promise<{
  reader: LivePgliteReader;
  close: () => Promise<void>;
}> {
  const db = new PGlite({ dataDir });
  await (db as unknown as { waitReady: Promise<void> }).waitReady;
  return {
    reader: {
      queryReadOnly: async <T,>(sql: string, params?: unknown[]) =>
        db.query<T>(sql, params) as Promise<{ rows: T[] }>,
    },
    close: () => db.close(),
  };
}

async function reopenPgliteHandle(dataDir: string): Promise<PGLiteHandle> {
  const db = new PGlite({ dataDir });
  await (db as unknown as { waitReady: Promise<void> }).waitReady;
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return db.query<T>(sql, params) as Promise<{ rows: T[] }>;
    },
    async exec(sql: string) {
      return db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

async function seedLegacyQueuedPromptsPglite(userDataPath: string): Promise<void> {
  const pgliteDir = path.join(userDataPath, 'pglite-db');
  fs.mkdirSync(pgliteDir, { recursive: true });
  const db = new PGlite({ dataDir: pgliteDir });
  await (db as unknown as { waitReady: Promise<void> }).waitReady;
  await db.exec(`
    CREATE TABLE ai_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      provider TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE queued_prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
      attachments JSONB,
      document_context JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error_message TEXT,
      CONSTRAINT fk_queued_prompts_session
        FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );
  `);
  await db.query(
    `INSERT INTO ai_sessions (id, provider, title) VALUES ($1, $2, $3)`,
    ['session-fb013-pglite', 'claude-code', 'FB-013 legacy source'],
  );
  await db.query(
    `INSERT INTO queued_prompts (id, session_id, prompt, status, attachments)
     VALUES ($1, $2, $3, 'pending', $4::jsonb)`,
    [
      'prompt-fb013-pglite',
      'session-fb013-pglite',
      'migrate from old PGLite shape',
      JSON.stringify([{ name: 'legacy.txt' }]),
    ],
  );
  await db.close();
}

function replaceQueuedPromptsWithLegacyShape(db: BetterSqliteDatabase): void {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE queued_prompts_legacy (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
      attachments TEXT,
      document_context TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      claimed_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      CONSTRAINT fk_queued_prompts_session
        FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );

    INSERT INTO queued_prompts_legacy (
      id,
      session_id,
      prompt,
      status,
      attachments,
      document_context,
      created_at,
      claimed_at,
      completed_at,
      error_message
    )
    SELECT
      id,
      session_id,
      prompt,
      status,
      attachments,
      document_context,
      created_at,
      claimed_at,
      completed_at,
      error_message
    FROM queued_prompts;

    DROP TABLE queued_prompts;
    ALTER TABLE queued_prompts_legacy RENAME TO queued_prompts;

    CREATE INDEX idx_queued_prompts_session ON queued_prompts(session_id);
    CREATE INDEX idx_queued_prompts_status ON queued_prompts(status);
    CREATE INDEX idx_queued_prompts_session_status
      ON queued_prompts(session_id, status);
    CREATE INDEX idx_queued_prompts_created ON queued_prompts(created_at);
  `);
  db.pragma('foreign_keys = ON');
}

function replaceQueuedPromptsWithLegacyStatusConstraint(
  db: BetterSqliteDatabase,
): void {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE queued_prompts_legacy_status (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
      attachments TEXT,
      document_context TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      claimed_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      origin TEXT NOT NULL DEFAULT 'user'
        CHECK (origin IN ('user', 'child_session_event')),
      CONSTRAINT fk_queued_prompts_session
        FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );

    INSERT INTO queued_prompts_legacy_status (
      id,
      session_id,
      prompt,
      status,
      attachments,
      document_context,
      created_at,
      claimed_at,
      completed_at,
      error_message,
      origin
    )
    SELECT
      id,
      session_id,
      prompt,
      status,
      attachments,
      document_context,
      created_at,
      claimed_at,
      completed_at,
      error_message,
      origin
    FROM queued_prompts;

    DROP TABLE queued_prompts;
    ALTER TABLE queued_prompts_legacy_status RENAME TO queued_prompts;

    CREATE INDEX idx_queued_prompts_session ON queued_prompts(session_id);
    CREATE INDEX idx_queued_prompts_status ON queued_prompts(status);
    CREATE INDEX idx_queued_prompts_session_status
      ON queued_prompts(session_id, status);
    CREATE INDEX idx_queued_prompts_created ON queued_prompts(created_at);
  `);
  db.pragma('foreign_keys = ON');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('FB-013 migration ledger and schema synchronization', () => {
  it('keeps the latest SQLite schema when migrating an old-shaped PGLite source', async () => {
    const userDataPath = makeTempDir('nim-fb013-old-pglite-');
    await seedLegacyQueuedPromptsPglite(userDataPath);
    const pgliteDir = path.join(userDataPath, 'pglite-db');
    const { reader, close } = await openPgliteReader(pgliteDir);
    const realMigrator = new PGLiteToSQLiteMigrator();
    let finalSnapshot:
      | {
          latestVersion: number;
          columns: string[];
          tableSql: string;
          row: Record<string, unknown>;
        }
      | undefined;
    const inspectingMigrator = {
      migrate: (opts: Parameters<PGLiteToSQLiteMigrator['migrate']>[0]) =>
        realMigrator.migrate(opts),
      catchUp: async (opts: Parameters<PGLiteToSQLiteMigrator['catchUp']>[0]) => {
        const result = await realMigrator.catchUp(opts);
        const handle = opts.sqlite.getRawHandle()!;
        finalSnapshot = {
          latestVersion: (
            handle
              .prepare('SELECT MAX(version) AS version FROM _migrations')
              .get() as { version: number }
          ).version,
          columns: (
            handle
              .prepare('PRAGMA table_info(queued_prompts)')
              .all() as Array<{ name: string }>
          ).map(({ name }) => name),
          tableSql: (
            handle
              .prepare(
                `SELECT sql
                 FROM sqlite_master
                 WHERE type = 'table' AND name = 'queued_prompts'`,
              )
              .get() as { sql: string }
          ).sql,
          row: handle
            .prepare(
              `SELECT id, session_id, prompt, status, attachments, origin
               FROM queued_prompts
               WHERE id = ?`,
            )
            .get('prompt-fb013-pglite') as Record<string, unknown>,
        };
        return result;
      },
    } as unknown as PGLiteToSQLiteMigrator;

    const orchestrator = new MigrationOrchestrator({
      userDataPath,
      schemaDir: SCHEMA_DIR,
      pglite: reader,
      closeRunningPglite: close,
      reopenPgliteAfterClose: reopenPgliteHandle,
      migrator: inspectingMigrator,
      log: () => undefined,
    });

    await orchestrator.run();

    expect(finalSnapshot).toBeDefined();
    expect(finalSnapshot!.latestVersion).toBe(17);
    expect(finalSnapshot!.columns).toContain('origin');
    expect(finalSnapshot!.tableSql).toContain("'paused'");
    expect(finalSnapshot!.row).toEqual({
      id: 'prompt-fb013-pglite',
      session_id: 'session-fb013-pglite',
      prompt: 'migrate from old PGLite shape',
      status: 'pending',
      attachments: JSON.stringify([{ name: 'legacy.txt' }]),
      origin: 'user',
    });
  }, 30_000);

  it('revalidates and repairs the target schema after the final migration copy', async () => {
    const userDataPath = makeTempDir('nim-fb013-post-copy-sync-');
    await seedLegacyQueuedPromptsPglite(userDataPath);
    const pgliteDir = path.join(userDataPath, 'pglite-db');
    const { reader, close } = await openPgliteReader(pgliteDir);
    const realMigrator = new PGLiteToSQLiteMigrator();
    const schemaDowngradingMigrator = {
      migrate: (opts: Parameters<PGLiteToSQLiteMigrator['migrate']>[0]) =>
        realMigrator.migrate(opts),
      catchUp: async (opts: Parameters<PGLiteToSQLiteMigrator['catchUp']>[0]) => {
        const result = await realMigrator.catchUp(opts);
        replaceQueuedPromptsWithLegacyShape(opts.sqlite.getRawHandle()!);
        return result;
      },
    } as unknown as PGLiteToSQLiteMigrator;

    const orchestrator = new MigrationOrchestrator({
      userDataPath,
      schemaDir: SCHEMA_DIR,
      pglite: reader,
      closeRunningPglite: close,
      reopenPgliteAfterClose: reopenPgliteHandle,
      migrator: schemaDowngradingMigrator,
      log: () => undefined,
    });
    await orchestrator.run();

    const startupLogs: string[] = [];
    const migrated = new SQLiteDatabase({
      dbDir: path.join(userDataPath, 'sqlite-db'),
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
      log: (_level, message) => startupLogs.push(message),
    });
    await migrated.initialize();
    try {
      const handle = migrated.getRawHandle()!;
      expect(() => assertAppliedMigrationSchema(handle)).not.toThrow();
      expect(startupLogs).toContain(
        '[SQLite] migrations: applied=none, skipped=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17',
      );
      expect(
        handle
          .prepare(
            `SELECT id, prompt, status, origin
             FROM queued_prompts
             WHERE id = ?`,
          )
          .get('prompt-fb013-pglite'),
      ).toEqual({
        id: 'prompt-fb013-pglite',
        prompt: 'migrate from old PGLite shape',
        status: 'pending',
        origin: 'user',
      });
    } finally {
      await migrated.close();
    }
  }, 30_000);

  it('repairs a latest-version ledger whose queued_prompts table is still legacy-shaped', async () => {
    const dbDir = makeTempDir('nim-fb013-ledger-repair-');
    const sqlite = new SQLiteDatabase({
      dbDir,
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await sqlite.initialize();

    try {
      const handle = sqlite.getRawHandle()!;
      handle.prepare(
        `INSERT INTO ai_sessions (id, provider, title) VALUES (?, ?, ?)`,
      ).run('session-fb013', 'claude-code', 'FB-013 repair');
      handle.prepare(
        `INSERT INTO queued_prompts (id, session_id, prompt, status, origin)
         VALUES (?, ?, ?, 'pending', 'user')`,
      ).run('prompt-fb013', 'session-fb013', 'preserve this prompt');

      replaceQueuedPromptsWithLegacyShape(handle);

      const latestVersion = handle
        .prepare('SELECT MAX(version) AS version FROM _migrations')
        .get() as { version: number };
      const legacyColumns = handle
        .prepare('PRAGMA table_info(queued_prompts)')
        .all() as Array<{ name: string }>;
      const legacyTable = handle
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'queued_prompts'`)
        .get() as { sql: string };

      expect(latestVersion.version).toBe(17);
      expect(legacyColumns.map(({ name }) => name)).not.toContain('origin');
      expect(legacyTable.sql).not.toContain("'paused'");

      const result = runMigrations(handle, SCHEMA_DIR);

      expect(result.applied).toEqual([15, 16, 17]);
      expect(result.skipped).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
      ]);

      const repairedColumns = handle
        .prepare('PRAGMA table_info(queued_prompts)')
        .all() as Array<{ name: string }>;
      const repairedTable = handle
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'queued_prompts'`)
        .get() as { sql: string };
      expect(repairedColumns.map(({ name }) => name)).toContain('origin');
      expect(repairedTable.sql).toContain("'paused'");

      const preserved = handle
        .prepare(
          `SELECT id, session_id, prompt, status, origin
           FROM queued_prompts WHERE id = ?`,
        )
        .get('prompt-fb013');
      expect(preserved).toEqual({
        id: 'prompt-fb013',
        session_id: 'session-fb013',
        prompt: 'preserve this prompt',
        status: 'pending',
        origin: 'user',
      });

      expect(() => {
        handle.prepare(
          `INSERT INTO queued_prompts (id, session_id, prompt, status, origin)
           VALUES (?, ?, ?, 'paused', 'child_session_event')`,
        ).run(
          'prompt-fb013-paused',
          'session-fb013',
          'paused prompt remains writable',
        );
      }).not.toThrow();
    } finally {
      await sqlite.close();
    }
  }, 30_000);

  it('strictly validates the real structure behind a latest-version migration ledger', async () => {
    const dbDir = makeTempDir('nim-fb013-schema-validation-');
    const sqlite = new SQLiteDatabase({
      dbDir,
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await sqlite.initialize();

    try {
      const handle = sqlite.getRawHandle()!;
      expect(() => assertAppliedMigrationSchema(handle)).not.toThrow();

      handle.prepare(
        `INSERT INTO ai_sessions (id, provider, title) VALUES (?, ?, ?)`,
      ).run('session-fb013-validation', 'claude-code', 'FB-013 validation');
      expect(() => {
        handle.prepare(
          `INSERT INTO queued_prompts (id, session_id, prompt, status, origin)
           VALUES (?, ?, ?, 'paused', 'child_session_event')`,
        ).run(
          'prompt-fb013-validation',
          'session-fb013-validation',
          'validate paused and origin',
        );
      }).not.toThrow();
      handle
        .prepare('DELETE FROM queued_prompts WHERE id = ?')
        .run('prompt-fb013-validation');

      replaceQueuedPromptsWithLegacyShape(handle);

      expect(() => assertAppliedMigrationSchema(handle)).toThrow(
        /15 \(queued_prompts_paused\): queued_prompts\.status does not allow paused; 16 \(queued_prompts_origin\): queued_prompts\.origin is missing/,
      );
    } finally {
      await sqlite.close();
    }
  }, 30_000);

  it('self-heals a desynchronized on-disk database on startup without losing queued prompts', async () => {
    const dbDir = makeTempDir('nim-fb013-startup-repair-');
    const original = new SQLiteDatabase({
      dbDir,
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await original.initialize();
    const originalHandle = original.getRawHandle()!;
    originalHandle.prepare(
      `INSERT INTO ai_sessions (id, provider, title) VALUES (?, ?, ?)`,
    ).run('session-fb013-startup', 'claude-code', 'FB-013 startup repair');
    originalHandle.prepare(
      `INSERT INTO queued_prompts (
         id,
         session_id,
         prompt,
         status,
         attachments,
         document_context,
         origin
       ) VALUES (?, ?, ?, 'pending', ?, ?, 'user')`,
    ).run(
      'prompt-fb013-startup',
      'session-fb013-startup',
      'survive startup repair',
      JSON.stringify([{ name: 'evidence.txt' }]),
      JSON.stringify({ file: 'src/main.ts', line: 42 }),
    );
    replaceQueuedPromptsWithLegacyShape(originalHandle);
    await original.close();

    const startupLogs: string[] = [];
    const restarted = new SQLiteDatabase({
      dbDir,
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
      log: (_level, message) => startupLogs.push(message),
    });
    await restarted.initialize();

    try {
      const repairedHandle = restarted.getRawHandle()!;
      expect(() => assertAppliedMigrationSchema(repairedHandle)).not.toThrow();

      const versions = repairedHandle
        .prepare('SELECT version FROM _migrations ORDER BY version')
        .all() as Array<{ version: number }>;
      expect(versions.map(({ version }) => version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
      ]);

      const preserved = repairedHandle
        .prepare(
          `SELECT
             id,
             session_id,
             prompt,
             status,
             attachments,
             document_context,
             origin
           FROM queued_prompts
           WHERE id = ?`,
        )
        .get('prompt-fb013-startup');
      expect(preserved).toEqual({
        id: 'prompt-fb013-startup',
        session_id: 'session-fb013-startup',
        prompt: 'survive startup repair',
        status: 'pending',
        attachments: JSON.stringify([{ name: 'evidence.txt' }]),
        document_context: JSON.stringify({ file: 'src/main.ts', line: 42 }),
        origin: 'user',
      });

      expect(() => {
        repairedHandle.prepare(
          `INSERT INTO queued_prompts (id, session_id, prompt, status, origin)
           VALUES (?, ?, ?, 'paused', 'child_session_event')`,
        ).run(
          'prompt-fb013-after-startup',
          'session-fb013-startup',
          'writable after repair',
        );
      }).not.toThrow();
      expect(startupLogs).toContain(
        '[SQLite] migrations: applied=15,16,17, skipped=1,2,3,4,5,6,7,8,9,10,11,12,13,14',
      );
    } finally {
      await restarted.close();
    }
  }, 30_000);

  it('preserves existing origin values when repairing a paused-only schema mismatch', async () => {
    const dbDir = makeTempDir('nim-fb013-partial-repair-');
    const original = new SQLiteDatabase({
      dbDir,
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await original.initialize();
    const originalHandle = original.getRawHandle()!;
    originalHandle.prepare(
      `INSERT INTO ai_sessions (id, provider, title) VALUES (?, ?, ?)`,
    ).run('session-fb013-partial', 'claude-code', 'FB-013 partial repair');
    originalHandle.prepare(
      `INSERT INTO queued_prompts (id, session_id, prompt, status, origin)
       VALUES (?, ?, ?, 'pending', 'child_session_event')`,
    ).run(
      'prompt-fb013-partial',
      'session-fb013-partial',
      'preserve child origin',
    );
    replaceQueuedPromptsWithLegacyStatusConstraint(originalHandle);
    await original.close();

    const restarted = new SQLiteDatabase({
      dbDir,
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await restarted.initialize();
    try {
      const repairedHandle = restarted.getRawHandle()!;
      expect(() => assertAppliedMigrationSchema(repairedHandle)).not.toThrow();
      expect(
        repairedHandle
          .prepare('SELECT id, prompt, status, origin FROM queued_prompts WHERE id = ?')
          .get('prompt-fb013-partial'),
      ).toEqual({
        id: 'prompt-fb013-partial',
        prompt: 'preserve child origin',
        status: 'pending',
        origin: 'child_session_event',
      });
    } finally {
      await restarted.close();
    }
  }, 30_000);
});

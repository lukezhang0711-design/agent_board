/**
 * Cache-ledger aggregation against PGLite JSONB. SQLite returns JSON text,
 * while PGLite returns objects; this pins both supported shapes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UsageAnalyticsService } from '../UsageAnalyticsService';

describe('UsageAnalyticsService on PGLite', () => {
  let dbDir: string;
  let db: PGlite;
  let svc: UsageAnalyticsService;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-analytics-pglite-'));
    db = new PGlite({ dataDir: dbDir });
    await (db as unknown as { waitReady: Promise<void> }).waitReady;
    await db.exec(`
      CREATE TABLE ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        metadata JSONB NOT NULL DEFAULT '{}',
        provider_session_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ai_agent_messages (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        source TEXT NOT NULL,
        direction TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    svc = new UsageAnalyticsService(db as any);
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it('aggregates cache tokens, hit rate, and timing from JSONB ledger rows', async () => {
    const timestamp = Date.UTC(2026, 5, 3, 12, 0, 0);
    await db.query(
      `INSERT INTO ai_sessions
         (id, workspace_id, provider, model, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($6 / 1000.0))`,
      ['s1', 'ws1', 'claude', 'claude-sonnet-4', JSON.stringify({
        tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      }), timestamp],
    );
    await db.query(
      `INSERT INTO ai_agent_messages
         (session_id, source, direction, content, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
      ['s1', 'claude', 'output', '{}', JSON.stringify({
        eventType: 'usage_ledger',
        engine: 'claude',
        model: 'claude-sonnet-4',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 80,
        cacheCreationInputTokens: 10,
        firstResponseMs: 120,
        totalDurationMs: 420,
      }), timestamp],
    );

    const overall = await svc.getOverallTokenUsage();
    expect(overall).toMatchObject({
      totalCacheReadInputTokens: 80,
      totalCacheCreationInputTokens: 10,
      cacheDataIncomplete: false,
    });
    expect(overall.cacheHitRate).toBeCloseTo(80 / 190);

    const [provider] = await svc.getUsageByProvider();
    expect(provider).toMatchObject({
      provider: 'claude',
      model: 'claude-sonnet-4',
      averageFirstResponseMs: 120,
      averageTotalDurationMs: 420,
      turnCount: 1,
    });

    const [point] = await svc.getTimeSeriesData(timestamp - 1, timestamp + 1, 'day');
    expect(point).toMatchObject({
      timestamp: Date.UTC(2026, 5, 3),
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 10,
    });
  });
});

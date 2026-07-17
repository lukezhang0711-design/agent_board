-- Durable Head Agent dispatch queue. A reserved_session_id is allocated when
-- the request is queued so the work-order can point at the same identity before
-- and after the real ai_sessions row is created.

CREATE TABLE IF NOT EXISTS dispatch_queue (
  queue_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  head_session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  reserved_session_id TEXT NOT NULL UNIQUE,
  request_snapshot TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'dispatching', 'dispatched', 'cancelled', 'failed')),
  error_message TEXT,
  source_ref TEXT NOT NULL UNIQUE,
  dispatched_session_id TEXT,
  dispatched_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT fk_dispatch_queue_head
    FOREIGN KEY (head_session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dispatch_queue_head_status_sequence
  ON dispatch_queue(head_session_id, status, queue_sequence);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_status_sequence
  ON dispatch_queue(status, queue_sequence);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_source_ref
  ON dispatch_queue(source_ref);

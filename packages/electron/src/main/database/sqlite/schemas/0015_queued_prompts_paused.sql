-- Add the persisted `paused` queue state. SQLite cannot alter a CHECK
-- constraint in place, so rebuild only queued_prompts and preserve every row.

CREATE TABLE queued_prompts_with_paused (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paused', 'executing', 'completed', 'failed')),
  attachments TEXT,
  document_context TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  claimed_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  CONSTRAINT fk_queued_prompts_session
    FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

INSERT INTO queued_prompts_with_paused (
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
ALTER TABLE queued_prompts_with_paused RENAME TO queued_prompts;

CREATE INDEX idx_queued_prompts_session ON queued_prompts(session_id);
CREATE INDEX idx_queued_prompts_status ON queued_prompts(status);
CREATE INDEX idx_queued_prompts_session_status
  ON queued_prompts(session_id, status);
CREATE INDEX idx_queued_prompts_created ON queued_prompts(created_at);

-- Distinguish user-authored queued prompts from hidden child-session events.
-- Existing rows predate the marker and therefore keep user semantics.

ALTER TABLE queued_prompts
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'
    CHECK (origin IN ('user', 'child_session_event'));

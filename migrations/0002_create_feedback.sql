-- Jayc V3 — user feedback with attached project snapshot (Cloudflare D1 / SQLite)
--
-- One row per feedback submission. `project` holds the user's workspace as a
-- JSON object of path → file content so the owner can reproduce bugs without
-- asking for a repo link. Capped on both client and server (~400KB).

CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  message    TEXT NOT NULL,
  email      TEXT,
  chat_id    TEXT,
  project    TEXT,                  -- JSON: { "relative/path.ts": "contents", … }
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- owner review: newest first
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);

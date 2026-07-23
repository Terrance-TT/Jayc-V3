-- Jayc V3 — server-side chat history (Cloudflare D1 / SQLite)
--
-- Chats are scoped per Clerk user. The client generates short numeric ids
-- ("1", "2", ...) per browser, so the same id can exist for different users —
-- the primary key is therefore (user_id, id), and every query filters by user.

CREATE TABLE IF NOT EXISTS chats (
  user_id     TEXT NOT NULL,
  id          TEXT NOT NULL,
  url_id      TEXT,
  description TEXT,
  messages    TEXT NOT NULL DEFAULT '[]', -- JSON array of `Message` from the `ai` package
  timestamp   TEXT NOT NULL,              -- client-side ISO timestamp (drives history binning)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, id)
);

-- look up a chat by its shareable url id (scoped to the owner)
CREATE INDEX IF NOT EXISTS idx_chats_user_url ON chats (user_id, url_id);

-- sidebar history listing, most recently active first
CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON chats (user_id, updated_at DESC);

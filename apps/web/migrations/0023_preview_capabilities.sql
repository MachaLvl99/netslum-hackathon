CREATE TABLE preview_capability (
  capability_hash TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  revision TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_preview_capability_expires ON preview_capability(expires_at);

-- Drop retired probe tables from migration 0018
DROP INDEX IF EXISTS oauth_probe_session_expires_idx;
DROP TABLE IF EXISTS oauth_probe_session;
DROP INDEX IF EXISTS phase2_probe_web_expires_idx;
DROP TABLE IF EXISTS phase2_probe_web;

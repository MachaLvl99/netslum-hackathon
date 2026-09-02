-- Phase 2 (plan §G): encrypted expiring message draft metadata (§D).
-- payload_enc is AES-256-GCM ciphertext (PRIVATE_DATA_KEY) containing only
-- the minimum recipient/conversation/revision metadata needed for the
-- prepare/send idempotency. Rows expire; Chat remains authoritative and no
-- message bodies are cached here beyond the pending send window.
CREATE TABLE IF NOT EXISTS dm_draft(
  revision TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  payload_enc BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_draft_expires ON dm_draft(expires_at);
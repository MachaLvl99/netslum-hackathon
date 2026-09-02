-- Phase 2 (plan §G): encrypted expiring media draft metadata.
-- payload_json/blob_json are AES-256-GCM ciphertext (PRIVATE_DATA_KEY);
-- only the minimum draft metadata needed for prepare/upload idempotency is
-- stored. Rows expire; AT repositories and the blob store stay authoritative.
CREATE TABLE IF NOT EXISTS media_draft(
  draft_id TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  payload_enc BLOB,
  blob_enc BLOB,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_draft_expires ON media_draft(expires_at);
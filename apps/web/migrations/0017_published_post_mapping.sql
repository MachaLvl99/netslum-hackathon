-- Idempotency mappings for PDS-assigned TID record keys (lexicon key:"tid"
-- collections: app.bsky.feed.post/like/repost). Replaces reliance on
-- deterministic netslum-<hex> rkeys, which Bluesky-hosted PDSes reject.
CREATE TABLE published_post(
  draft_revision TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  cid TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_published_post_created ON published_post(created_at);

CREATE TABLE published_reaction(
  actor_did TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('like','repost')),
  subject_uri TEXT NOT NULL,
  uri TEXT NOT NULL,
  cid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_did, kind, subject_uri)
);

CREATE TABLE oauth_state (
  key_hash TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_state_expires_idx ON oauth_state(expires_at);
CREATE TABLE oauth_session (
  did TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE web_session (
  id_hash TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX web_session_expires_idx ON web_session(expires_at);
CREATE TABLE post_draft (
  did TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  text TEXT NOT NULL,
  reply_to_uri TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE optimistic_post (
  draft_revision TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  did TEXT NOT NULL,
  cid TEXT NOT NULL,
  post_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX optimistic_post_expires_idx ON optimistic_post(expires_at);
CREATE TABLE feed_cache (
  cache_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX feed_cache_expires_idx ON feed_cache(expires_at);
CREATE TABLE site (
  did TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  draft_revision TEXT NOT NULL,
  active_revision TEXT,
  active_worker TEXT,
  kv_namespace_id TEXT,
  at_uri TEXT,
  at_cid TEXT,
  publishing_revision TEXT,
  publishing_started_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','suspended')),
  updated_at INTEGER NOT NULL
);
CREATE INDEX site_status_slug_idx ON site(status, slug);
CREATE INDEX site_publishing_started_idx ON site(publishing_started_at);
CREATE TABLE site_release (
  did TEXT NOT NULL,
  revision TEXT NOT NULL,
  worker_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('staged','active','superseded')),
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  PRIMARY KEY(did, revision)
);
CREATE TABLE site_admin_action (
  id TEXT PRIMARY KEY,
  site_did TEXT NOT NULL,
  operator_did TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('suspend','restore')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

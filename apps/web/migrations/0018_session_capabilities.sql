ALTER TABLE web_session ADD COLUMN granted_scope TEXT;
ALTER TABLE web_session ADD COLUMN scope_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE web_session ADD COLUMN dm_agent_enabled INTEGER NOT NULL DEFAULT 0 CHECK(dm_agent_enabled IN (0,1));

CREATE TABLE oauth_probe_session (
  did TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_probe_session_expires_idx ON oauth_probe_session(expires_at);

CREATE TABLE phase2_probe_web (
  id_hash TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX phase2_probe_web_expires_idx ON phase2_probe_web(expires_at);

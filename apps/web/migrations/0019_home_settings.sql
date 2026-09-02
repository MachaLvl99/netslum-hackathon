-- Phase 2 (plan §B6): private home settings for local-PDS users only.
-- External identities always receive standard mode and no site row.
CREATE TABLE IF NOT EXISTS home_settings (
  did TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard', 'authored')),
  active_home_path TEXT,
  updated_at INTEGER NOT NULL
);

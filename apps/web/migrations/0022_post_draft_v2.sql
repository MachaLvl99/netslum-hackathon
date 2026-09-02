-- Phase 2 (plan §C3): composer destinations, quotes, and prepared media.
-- destination: 'town' appends exactly one #netslum suffix at publish; 'bluesky'
-- does not. Existing drafts are legacy 'town'. media_draft_ids references the
-- encrypted media_draft rows attached at prepare time.
ALTER TABLE post_draft ADD COLUMN destination TEXT NOT NULL DEFAULT 'town' CHECK (destination IN ('town','bluesky'));
ALTER TABLE post_draft ADD COLUMN quote_uri TEXT;
ALTER TABLE post_draft ADD COLUMN quote_cid TEXT;
ALTER TABLE post_draft ADD COLUMN languages TEXT;
ALTER TABLE post_draft ADD COLUMN media_draft_ids TEXT;
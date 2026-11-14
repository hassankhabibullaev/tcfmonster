-- A report's status, told in the person's thread (docs/COCE.md §2c): marking a report done or open again leaves a row
-- from the owner with `event`, and with the owner's words in `body` when there are some (empty otherwise); the app
-- shows « Signalement n° 12 · Traité » above them, in the person's language.
ALTER TABLE messages ADD COLUMN event TEXT;            -- resolved · reopened · NULL for a plain message

-- the answers already sent with a report's closing (2026-11-12) were that closing
UPDATE messages SET event = 'resolved'
  WHERE from_owner = 1 AND dispute_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM disputes d WHERE d.id = messages.dispute_id AND d.status = 'resolved' AND d.resolved_at = messages.created_at);

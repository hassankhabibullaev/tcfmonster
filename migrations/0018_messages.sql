-- Messages (docs/COCE.md §2c): one thread a person, between them and the owner (« L'équipe tcf.monster »). A row is one
-- message. The person's reports on questions (disputes) show in the same thread by their date, each with its number
-- (« Signalement n° 12 »); a message that answers one carries its id, so a report and its answer stay tied together.
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_owner  INTEGER NOT NULL DEFAULT 0,       -- 1: the owner wrote it · 0: the person did
  body        TEXT NOT NULL,                    -- at most 2 000 characters
  dispute_id  INTEGER,                          -- the report it answers or follows, when there is one
  created_at  TEXT NOT NULL,
  read_at     TEXT                              -- when the other side opened the thread after it came
);
CREATE INDEX messages_user ON messages(user_id, id);
CREATE INDEX messages_unread ON messages(from_owner, user_id) WHERE read_at IS NULL;

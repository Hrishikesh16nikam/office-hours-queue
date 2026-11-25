-- Office Hours Queue schema.
-- Privacy: students are identified by an HMAC of their email (student_key),
-- never the email itself. Names, descriptions and seats are erased a day after
-- a session closes; anonymous timing and topic data stays for statistics.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE staff (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  pin_hash   TEXT,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE staff_invites (
  token_hash TEXT PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE login_attempts (
  id  INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  at  TEXT NOT NULL
);
CREATE INDEX login_attempts_key ON login_attempts (key, at);

CREATE TABLE oh_sessions (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('in_person', 'online', 'hybrid')),
  location    TEXT,
  online_link TEXT,
  join_code   TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL CHECK (status IN ('open', 'paused', 'closed')),
  opened_by   INTEGER NOT NULL REFERENCES staff(id),
  opened_at   TEXT NOT NULL,
  closes_at   TEXT NOT NULL,
  closed_at   TEXT,
  anonymized  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tickets (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES oh_sessions(id) ON DELETE CASCADE,
  student_key   TEXT,          -- HMAC of the email; NULL for students a TA added
  token_hash    TEXT UNIQUE,   -- the student's private link to this ticket
  name          TEXT,
  topic         TEXT NOT NULL,
  description   TEXT,
  mode          TEXT NOT NULL CHECK (mode IN ('in_person', 'online')),
  where_detail  TEXT,          -- seat in the room, or display name on the call
  status        TEXT NOT NULL CHECK (status IN ('waiting', 'helping', 'done', 'removed', 'left')),
  away          INTEGER NOT NULL DEFAULT 0,
  helped_before INTEGER NOT NULL DEFAULT 0,
  priority_at   TEXT NOT NULL, -- joined_at, pushed later for students already helped this week
  joined_at     TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  staff_id      INTEGER REFERENCES staff(id),
  group_id      INTEGER,
  added_by      INTEGER REFERENCES staff(id)
);
CREATE INDEX tickets_session ON tickets (session_id, status, priority_at);
CREATE INDEX tickets_student ON tickets (student_key, finished_at);

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('ticket', 'staff')),
  owner_id   INTEGER NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX push_owner ON push_subscriptions (owner_type, owner_id);

-- Every notification is recorded before sending, so a retry never sends it twice.
CREATE TABLE notifications (
  key     TEXT PRIMARY KEY,
  title   TEXT NOT NULL,
  body    TEXT NOT NULL,
  status  TEXT NOT NULL,
  error   TEXT,
  sent_at TEXT NOT NULL
);

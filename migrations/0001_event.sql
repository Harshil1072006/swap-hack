CREATE TABLE event_state (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  expires_at INTEGER
);
CREATE INDEX event_expiry ON event_state (expires_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  space TEXT NOT NULL,
  identity TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX session_expiry ON sessions (expires_at);

CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rate_buckets (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX bucket_expiry ON rate_buckets (expires_at);

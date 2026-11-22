ALTER TABLE event_state ADD COLUMN review_epoch INTEGER NOT NULL DEFAULT 0;

CREATE TABLE event_records (
  space TEXT NOT NULL REFERENCES event_state(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (space, kind, id)
);
CREATE INDEX event_records_order ON event_records(space, kind, position);
CREATE UNIQUE INDEX current_builder_assignment ON event_records(space,json_extract(body,'$.builder'))
  WHERE kind='matches' AND json_extract(body,'$.abandoned')=0;
CREATE UNIQUE INDEX current_problem_assignment ON event_records(space,json_extract(body,'$.problem'))
  WHERE kind='matches' AND json_extract(body,'$.abandoned')=0;

CREATE TABLE submission_records (
  space TEXT NOT NULL REFERENCES event_state(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (space, project, revision)
);
CREATE TABLE review_records (
  space TEXT NOT NULL,
  project TEXT NOT NULL,
  revision INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (space, project, revision, reviewer),
  FOREIGN KEY (space, project, revision) REFERENCES submission_records(space, project, revision) ON DELETE CASCADE
);
CREATE TABLE command_receipts (
  space TEXT NOT NULL REFERENCES event_state(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  command TEXT NOT NULL,
  digest TEXT NOT NULL,
  result TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (space, actor, command)
);
CREATE INDEX command_expiry ON command_receipts(expires_at);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  space TEXT NOT NULL REFERENCES event_state(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  revision INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX audits_event_time ON audit_events(space, created_at DESC);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL
);
CREATE INDEX outbox_due ON outbox(state,next_attempt);
CREATE TABLE staff_counters (
  identity TEXT PRIMARY KEY,
  counter INTEGER NOT NULL
);
CREATE TABLE write_assertions (accepted INTEGER CHECK(accepted = 1));

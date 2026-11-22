import { newEvent, RequestError } from './event.js';

const groups = ['people', 'problems', 'matches', 'judges', 'certificates', 'policies'];
const stringify = JSON.stringify;
const assertWrite = (db) => [
  db.prepare('INSERT INTO write_assertions VALUES (changes())'),
  db.prepare('DELETE FROM write_assertions'),
];
const retryable = (error) => String(error.message).includes('accepted = 1') ||
  String(error.message).includes('command_receipts.space');
export const digest = async (value) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

async function initialize(db, id) {
  if (id !== 'live') throw new RequestError('This demo has expired. Start a new walkthrough.', 401, 'SESSION_EXPIRED');
  await db.prepare('INSERT OR IGNORE INTO event_state (id,data) VALUES (?,?)').bind(id, stringify(newEvent())).run();
}

export async function readEvent(db, id) {
  const row = await db.prepare('SELECT data,version,review_epoch FROM event_state WHERE id=? AND (expires_at IS NULL OR expires_at>?)')
    .bind(id, Date.now()).first();
  if (row) return { ...row, event: JSON.parse(row.data) };
  await initialize(db, id);
  return readEvent(db, id);
}

async function snapshot(db, id) {
  const [state, records, submissions, reviews] = await db.batch([
    db.prepare('SELECT data,version,review_epoch FROM event_state WHERE id=? AND (expires_at IS NULL OR expires_at>?)').bind(id, Date.now()),
    db.prepare('SELECT kind,body FROM event_records WHERE space=? ORDER BY kind,position,id').bind(id),
    db.prepare(`SELECT s.project,s.body FROM submission_records s JOIN event_records m
      ON m.space=s.space AND m.kind='matches' AND m.id=s.project AND s.revision=json_extract(m.body,'$.activeRevision')
      WHERE s.space=?`).bind(id),
    db.prepare(`SELECT r.project,r.reviewer,r.body FROM review_records r JOIN event_records m
      ON m.space=r.space AND m.kind='matches' AND m.id=r.project AND r.revision=json_extract(m.body,'$.activeRevision')
      WHERE r.space=?`).bind(id),
  ]);
  const row = state.results[0];
  if (!row) {
    await initialize(db, id);
    return snapshot(db, id);
  }
  const event = JSON.parse(row.data);
  if (event.recordsVersion) {
    for (const group of groups) event[group] = [];
    for (const record of records.results) event[record.kind].push(JSON.parse(record.body));
    const projects = new Map(event.matches.map((match) => [match.id, match]));
    for (const entry of submissions.results) projects.get(entry.project).submission = JSON.parse(entry.body);
    for (const entry of reviews.results) projects.get(entry.project).reviews[entry.reviewer] = JSON.parse(entry.body);
  }
  return { event, version: row.version, epoch: row.review_epoch };
}
export const load = snapshot;

function shape(event) {
  const state = { ...event, recordsVersion: 1 };
  const rows = new Map();
  for (const kind of groups) {
    delete state[kind];
    for (const [position, entry] of (event[kind] ?? []).entries()) {
      let body = entry;
      if (kind === 'matches') {
        const { submission, reviews, submissionHistory, ...match } = entry;
        body = { ...match, submission: null, reviews: {}, activeRevision: submission ? (submission.revision ?? 1) : null };
      }
      rows.set(kind + ':' + entry.id, { kind, id: entry.id, position, body: stringify(body) });
    }
  }
  return { state, rows };
}

function changeRecords(db, space, before, after) {
  const added = [];
  const removed = [];
  for (const [key, row] of after) {
    const old = before.get(key);
    if (old?.body !== row.body || old.position !== row.position) added.push(row);
  }
  for (const [key, row] of before) {
    if (!after.has(key)) removed.push({ kind: row.kind, id: row.id });
  }
  const operations = [];
  if (added.length) operations.push(db.prepare(`INSERT INTO event_records(space,kind,id,position,body)
    SELECT ?, item->>'kind', item->>'id', item->>'position', item->>'body' FROM (SELECT value AS item FROM json_each(?)) WHERE 1
    ON CONFLICT(space,kind,id) DO UPDATE SET position=excluded.position,body=excluded.body`).bind(space, stringify(added)));
  if (removed.length) operations.push(db.prepare(`DELETE FROM event_records WHERE space=? AND EXISTS
    (SELECT 1 FROM json_each(?) WHERE value->>'kind'=event_records.kind AND value->>'id'=event_records.id)`).bind(space, stringify(removed)));
  return operations;
}

function projectWrites(db, space, event, before) {
  if (event.cleaned && !before.event.cleaned) {
    return [
      db.prepare('DELETE FROM submission_records WHERE space=?').bind(space),
      db.prepare("DELETE FROM sessions WHERE space=? AND identity NOT LIKE 'staff:%'").bind(space),
      db.prepare('DELETE FROM command_receipts WHERE space=?').bind(space),
      ...(space === 'live' ? [db.prepare('DELETE FROM outbox')] : []),
    ];
  }
  const previous = new Map(before.event.matches.map((match) => [match.id, match]));
  const submissions = [];
  const reviews = [];
  for (const match of event.matches) {
    if (!match.submission) continue;
    const older = previous.get(match.id)?.submission;
    const revision = match.submission.revision ?? 1;
    if (!before.event.recordsVersion || !older || (older.revision ?? 1) !== revision) {
      submissions.push({ id: match.id, revision, body: stringify(match.submission) });
    }
    if (!before.event.recordsVersion) {
      for (const [key, review] of Object.entries(match.reviews)) {
        reviews.push({ id: match.id, revision, key, version: review.version ?? 0, body: stringify(review) });
      }
    }
  }
  const operations = [];
  if (submissions.length) operations.push(db.prepare(`INSERT INTO submission_records(space,project,revision,body)
    SELECT ?,value->>'id',value->>'revision',value->>'body' FROM json_each(?)`).bind(space, stringify(submissions)));
  if (reviews.length) operations.push(db.prepare(`INSERT INTO review_records(space,project,revision,reviewer,version,body)
    SELECT ?,value->>'id',value->>'revision',value->>'key',value->>'version',value->>'body' FROM json_each(?)`).bind(space, stringify(reviews)));
  return operations;
}

async function receiptFor(db, space, command) {
  if (!command) return null;
  const row = await db.prepare('SELECT digest,result FROM command_receipts WHERE space=? AND actor=? AND command=?')
    .bind(space, command.actor, command.id).first();
  if (!row) return null;
  if (row.digest !== command.digest) throw new RequestError('This command ID was already used for different data.', 409, 'VERSION_CONFLICT');
  return { result: JSON.parse(row.result) };
}

function evidence(db, space, result, metadata) {
  const writes = [];
  const { command, audit, mail } = metadata;
  if (command) writes.push(db.prepare('INSERT INTO command_receipts VALUES (?,?,?,?,?,?)')
    .bind(space, command.actor, command.id, command.digest, stringify(result ?? null), Date.now() + 7 * 86400000));
  if (audit) writes.push(db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), space, audit.actor, audit.action, audit.target || result?.id || '', result?.revision ?? null, Date.now()));
  for (const message of mail ?? []) writes.push(db.prepare(`INSERT OR IGNORE INTO outbox (id,recipient,subject,body,next_attempt,created_at)
    VALUES (?,?,?,?,?,?)`).bind(message.id, message.email, message.subject, message.text, Date.now(), Date.now()));
  return writes;
}

function reviewWrite(db, space, before, event, result) {
  const { id, revision, version, reviewKey } = result;
  const review = event.matches.find((match) => match.id === id).reviews[reviewKey];
  return [
    db.prepare(`INSERT INTO review_records(space,project,revision,reviewer,version,body)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM event_state WHERE id=? AND version=?)
      ON CONFLICT(space,project,revision,reviewer) DO UPDATE SET version=excluded.version,body=excluded.body
      WHERE review_records.version=excluded.version-1`)
      .bind(space, id, revision, reviewKey, version, stringify(review), space, before.version),
    ...assertWrite(db),
    db.prepare('UPDATE event_state SET review_epoch=review_epoch+1 WHERE id=?').bind(space),
  ];
}

export async function mutate(db, space, callback, { command, audit, review = false, buildMail } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cached = await receiptFor(db, space, command);
    if (cached) return cached;
    const before = await snapshot(db, space);
    const event = structuredClone(before.event);
    const result = callback(event);
    const separateReview = review && event.recordsVersion;
    let writes;
    if (separateReview) {
      writes = reviewWrite(db, space, before, event, result);
    } else {
      const after = shape(event);
      const oldRows = before.event.recordsVersion ? shape(before.event).rows : new Map();
      writes = [
        db.prepare('UPDATE event_state SET data=?,version=version+1 WHERE id=? AND version=? AND review_epoch=?')
          .bind(stringify(after.state), space, before.version, before.epoch),
        ...assertWrite(db),
        ...changeRecords(db, space, oldRows, after.rows),
        ...projectWrites(db, space, event, before),
      ];
    }
    try {
      await db.batch([...writes, ...evidence(db, space, result, { command, audit, mail: buildMail?.(result, event) })]);
      return { result, event };
    } catch (error) {
      if (!retryable(error)) throw error;
    }
  }
  throw new RequestError('Someone else just made a change. Please try again.', 409, 'VERSION_CONFLICT');
}

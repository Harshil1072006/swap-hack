import { cleanPersonal, emailPattern, needsRetention, normalizeEmail, performAction, publicStatus, RequestError, workspace } from './event.js';
import { demoRoles, demonstration } from './demo.js';
import { digest, load, mutate, readEvent } from './storage.js';
import { authorizeStaff, localCodes, mayAct, staffConfig, staffView, verifyStaffFactor } from './access.js';
import { acknowledgement, codeMail, deliverOutbox, registrationMail, sendMail } from './mail.js';

const hour = 3600000;
const live = 'live';
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  } });
}
function cookies(request, name) {
  return (request.headers.get('Cookie') || '').split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(name + '='))?.slice(name.length + 1);
}
const cookieName = (demo) => demo ? 'swap_demo_session' : 'swap_session';
const demoContext = (request) => request.headers.get('X-Swap-Context') === 'demo' || new URL(request.url).searchParams.get('demo') === '1';
function cookie(request, token, seconds, demo) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(demo)}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Strict${secure}`;
}
async function auth(db, request, demo = demoContext(request)) {
  const token = cookies(request, cookieName(demo)) ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await digest(token);
  const session = await db.prepare('SELECT space, identity FROM sessions WHERE token_hash=? AND expires_at>?').bind(hash, Date.now()).first();
  return session && (session.space !== live) === demo ? session : null;
}
async function createSession(db, request, space, identity) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const hash = await digest(token);
  const demo = space !== live;
  const lifetime = demo ? 4 * hour : (identity === '@organizer' || identity.startsWith('staff:') ? 8 : 24) * hour;
  const create = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').bind(hash, space, identity, Date.now() + lifetime);
  const previous = cookies(request, cookieName(demo)) ?? '';
  if (/^[a-f0-9]{64}$/.test(previous)) {
    await db.batch([create, db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(previous))]);
  } else {
    await create.run();
  }
  return { 'Set-Cookie': cookie(request, token, lifetime / 1000, demo) };
}
async function body(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('Send a JSON object.');
  let count = 0;
  const decoder = new TextDecoder();
  let raw = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    count += value.length;
    if (count > 68000) {
      await reader.cancel();
      throw new RequestError('This request is too large.', 413);
    }
    raw += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(raw + decoder.decode());
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* Use the same error for invalid JSON and non-object input. */ }
  throw new RequestError('Send a JSON object.');
}
async function limit(db, request, name, max, duration, recipient) {
  const timestamp = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = await digest(name + ':' + (recipient ?? ip));
  const row = await db.prepare(`INSERT INTO rate_buckets(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(key, timestamp + duration, timestamp, timestamp).first();
  if (row.count > max) throw new RequestError('Too many attempts. Please try again later.', 429, 'RATE_LIMIT');
}
function emailOf(data) {
  const email = normalizeEmail(data.email);
  if (!emailPattern.test(email)) throw new RequestError('Enter a valid email address.');
  return email;
}
const mailReady = (env) => !env.LOCAL_AUTH_CODES && Boolean(env.RESEND_API_KEY && env.MAIL_FROM && env.OTP_SECRET?.length >= 32);
const otpKey = (env, request) => localCodes(env, request) ? 'local-swap-hack-only' : env.OTP_SECRET;
async function requestCode(db, request, env, data) {
  if (!localCodes(env, request) && !mailReady(env)) throw new RequestError('Email sign-in has not been configured. Explore the interactive demo in the meantime.', 503, 'MAIL_NOT_READY');
  await limit(db, request, 'email', 120, hour);
  const email = emailOf(data);
  await limit(db, request, 'recipient', 8, hour, email);
  const timestamp = Date.now();
  const code = String(10000000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90000000));
  const hash = await digest(otpKey(env, request) + ':' + email + ':' + code);
  const row = await db.prepare(`INSERT INTO email_codes VALUES (?,?,?,?,0) ON CONFLICT(email) DO UPDATE
    SET code_hash=excluded.code_hash, created_at=excluded.created_at, expires_at=excluded.expires_at, attempts=0
    WHERE email_codes.created_at < ? RETURNING email`).bind(email, hash, timestamp, timestamp + 10 * 60000, timestamp - 60000).first();
  if (!row) throw new RequestError('Wait a minute before requesting another code.', 429, 'RESEND_WAIT');
  if (localCodes(env, request)) return json({ ok: true, code });
  try {
    await sendMail(env, email, codeMail(data.locale, code));
  } catch (error) {
    await db.prepare('DELETE FROM email_codes WHERE email=? AND code_hash=?').bind(email, hash).run();
    console.error('Swap Hack sign-in email failed:', error.message);
    throw new RequestError('The code could not be sent. Please try again.', 502, 'MAIL_FAILED');
  }
  return json({ ok: true });
}
async function confirmCode(db, request, env, data) {
  if (!localCodes(env, request) && !mailReady(env)) throw new RequestError('Email sign-in has not been configured. Explore the interactive demo in the meantime.', 503, 'MAIL_NOT_READY');
  await limit(db, request, 'confirm', 240, hour);
  const email = emailOf(data);
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (!/^\d{8}$/.test(code)) throw new RequestError('Enter the eight-digit code.');
  const hash = await digest(otpKey(env, request) + ':' + email + ':' + code);
  const [deleted] = await db.batch([
    db.prepare('DELETE FROM email_codes WHERE email=? AND code_hash=? AND expires_at>? AND attempts<5 RETURNING email').bind(email, hash, Date.now()),
    db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE email=? AND attempts<5').bind(email),
  ]);
  if (!deleted.results.length) throw new RequestError('That code is invalid, expired or used. Request a new code.', 401, 'CODE_EXPIRED_OR_INVALID');
  return json({ ok: true }, 200, await createSession(db, request, live, email));
}
async function api(request, env, ctx, path) {
  const db = env.DB;
  if (request.method === 'GET' && path === '/api/status') return json(publicStatus((await readEvent(db, live)).event));
  if (request.method === 'GET' && path === '/api/results') {
    const showDemo = new URL(request.url).searchParams.has('demo');
    const session = showDemo ? await auth(db, request) : null;
    const space = session?.space ?? live;
    const results = (await readEvent(db, space)).event.published;
    return json(results ? { ...results, demo: space !== live } : null);
  }
  if (request.method === 'GET' && path.startsWith('/api/certificates/')) {
    const id = path.slice('/api/certificates/'.length).toUpperCase();
    if (id === 'DEMO-SWAP-26') return json({ id, kind: 'Builder', name: 'Avni Desai', date: '', demo: true });
    if (!/^SWAP-[A-F0-9]{18}$/.test(id)) throw new RequestError('No certificate matches that ID.', 404);
    const session = await auth(db, request);
    const { event } = await readEvent(db, live);
    const row = event.recordsVersion ? await db.prepare("SELECT body FROM event_records WHERE space=? AND kind='certificates' AND id=?")
      .bind(live, id).first() : null;
    const liveCert = row ? JSON.parse(row.body) : event.certificates?.find((record) => record.id === id);
    const demoCert = !liveCert && session?.space && session.space !== live ?
      (await load(db, session.space)).event.certificates.find((record) => record.id === id) : null;
    const cert = liveCert ?? demoCert;
    if (!cert) throw new RequestError('No certificate matches that ID.', 404);
    const { kind, name, date } = cert;
    return json({ id, kind, name, date, demo: Boolean(demoCert) });
  }
  if (request.method === 'GET' && path === '/api/workspace') {
    const session = await auth(db, request);
    if (!session) throw new RequestError('Sign in to open your workspace.', 401);
    const staff = session.space === live ? await authorizeStaff(env, session) : null;
    if (session.space === live && session.identity === '@organizer' && !localCodes(env, request)) throw new RequestError('Sign in with your staff account.', 401);
    const state = workspace((await load(db, session.space)).event, staff ? '@organizer' : session.identity, session.space !== live);
    state.settings.acknowledgements = acknowledgement;
    if (staff) {
      const projected = staffView(state, staff);
      if (staff.scope === 'admin' || staff.scope === 'publication') {
        const [audit, mail] = await db.batch([
          db.prepare('SELECT actor,action,target,revision,created_at FROM audit_events WHERE space=? ORDER BY created_at DESC LIMIT 25').bind(live),
          db.prepare('SELECT id,state,attempts,next_attempt FROM outbox ORDER BY created_at DESC LIMIT 25'),
        ]);
        projected.audit = audit.results;
        projected.mail = mail.results;
      }
      return json(projected);
    }
    if (session.space === live && staffConfig(env, session.identity)) state.staffEligible = true;
    return json(state);
  }
  if (request.method !== 'POST') throw new RequestError('Route not found.', 404);
  const origin = request.headers.get('Origin');
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || (origin && origin !== requestOrigin)) {
    throw new RequestError('Send this request from the Swap Hack website.', 403);
  }
  const data = await body(request);
  if (path === '/api/sign-in/request') return requestCode(db, request, env, data);
  if (path === '/api/sign-in/confirm') return confirmCode(db, request, env, data);
  if (path === '/api/admin/sign-in') {
    if (!localCodes(env, request)) throw new RequestError('Sign in with your staff account.', 401);
    await limit(db, request, 'organizer', 12, hour);
    const key = typeof data.key === 'string' ? data.key : '';
    const expected = env.ADMIN_KEY;
    if (!expected || key.length > 500 || !crypto.subtle.timingSafeEqual(encoder.encode(await digest(key)), encoder.encode(await digest(expected)))) {
      throw new RequestError('The organizer key did not match.', 401);
    }
    return json({ ok: true }, 200, await createSession(db, request, live, '@organizer'));
  }
  if (path === '/api/sign-out') {
    const demo = demoContext(request);
    const token = cookies(request, cookieName(demo));
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0, demo) });
  }
  const session = await auth(db, request, path === '/api/demo' || demoContext(request));
  if (path === '/api/staff/verify') {
    if (!session || session.space !== live || !emailPattern.test(session.identity)) throw new RequestError('Verify your email before continuing.', 401);
    await limit(db, request, 'staff', 12, hour, session.identity);
    const identity = await verifyStaffFactor(db, env, session.identity, data.code);
    if (!identity) throw new RequestError('The authenticator code is invalid or already used.', 401, 'STAFF_CODE_INVALID');
    return json({ ok: true }, 200, await createSession(db, request, live, identity));
  }
  if (path === '/api/demo') {
    const identity = Object.hasOwn(demoRoles, data.role) ? demoRoles[data.role] : '';
    if (!identity) throw new RequestError('Choose a demo role.');
    await limit(db, request, 'demo', 90, hour);
    let space = session?.space;
    if (!space || space === live) {
      space = 'demo-' + crypto.randomUUID();
      const initial = demonstration();
      if (data.start === 'registration') initial.settings.phase = 'registration';
      await db.prepare('INSERT INTO event_state (id,data,expires_at) VALUES (?,?,?)')
        .bind(space, JSON.stringify(initial), Date.now() + 4 * hour).run();
    }
    if (session?.space === space && data.start === 'registration') {
      await mutate(db, space, (event) => { event.settings.phase = 'registration'; event.published = null; });
    }
    return json({ ok: true }, 200, await createSession(db, request, space, identity));
  }
  if (path === '/api/action') {
    if (!session) throw new RequestError('Sign in before continuing.', 401);
    const demo = session.space !== live;
    if (typeof data.action !== 'string' || !data.payload || typeof data.payload !== 'object') throw new RequestError('Choose a valid workspace action.');
    const staff = demo ? null : await authorizeStaff(env, session);
    const localOrganizer = !demo && session.identity === '@organizer' && localCodes(env, request);
    if (!demo && session.identity === '@organizer' && !localOrganizer) throw new RequestError('Sign in with your staff account.', 401);
    if (staff && !mayAct(staff, data.action)) throw new RequestError('This action requires a different staff permission.', 403, 'FORBIDDEN');
    const actor = staff?.id ?? (localOrganizer ? 'local-organizer' : await digest((env.OTP_SECRET ?? session.space) + ':' + session.identity));
    const command = data.commandId && /^[a-z0-9-]{16,80}$/i.test(data.commandId) ? {
      id: data.commandId, actor, digest: await digest(JSON.stringify([data.action, data.payload])),
    } : null;
    const buildMail = !demo && data.action === 'register' && mailReady(env)
      ? (result, event) => registrationMail(session.identity, result, event, requestOrigin) : undefined;
    const audit = !demo ? { actor, action: data.action, target: /^[A-Z]+-[0-9A-F]{8,20}$/.test(data.payload.id ?? '') ? data.payload.id : '' } : undefined;
    if (audit && !/^[a-z-]{2,30}$/.test(audit.action)) throw new RequestError('Choose a valid workspace action.');
    const { result } = await mutate(db, session.space, (current) => {
      if (!demo && data.action === 'settings' && !['draft', 'cancelled'].includes(data.payload.phase) && !localCodes(env, request) && !mailReady(env)) {
        throw new RequestError('Configure the email provider before opening registration.');
      }
      return performAction(current, staff ? '@organizer' : session.identity, data.action, data.payload, demo);
    }, { command, audit, review: data.action === 'review', buildMail });
    if (buildMail) ctx.waitUntil(deliverOutbox(env));
    const { reviewKey: _internal, ...receipt } = result ?? {};
    return json({ ok: true, ...receipt });
  }
  throw new RequestError('Route not found.', 404);
}
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, ctx, pathname);
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message, code: error.code || 'INVALID_REQUEST', field: error.field || undefined }, error.status);
      console.error('Swap Hack request failed:', error.message);
      return json({ error: 'The event service is temporarily unavailable. Please try again.', code: 'UNAVAILABLE' }, 500);
    }
  },
  async scheduled(_event, env) {
    const db = env.DB;
    const now = Date.now();
    await db.batch([
      db.prepare('DELETE FROM event_state WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM rate_buckets WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM email_codes WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM command_receipts WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM outbox WHERE created_at<=?').bind(now - 7 * 86400000),
    ]);
    if (needsRetention((await readEvent(db, live)).event)) {
      await mutate(db, live, (event) => {
        if (needsRetention(event)) cleanPersonal(event);
      });
    } else if (!(await readEvent(db, live)).event.cleaned && mailReady(env)) {
      await deliverOutbox(env);
    }
  },
};

import { emailPattern, normalizeEmail, RequestError } from './event.js';
import { digest } from './storage.js';

const scopes = {
  intake: ['verify-person', 'screen-problem', 'shuffle', 'assign', 'withdraw', 'forward', 'answer'],
  judging: ['judge', 'panels', 'precheck', 'extra-judge', 'tiebreak', 'reopen-submission'],
  publication: ['publish', 'reopen-results', 'issue-cert', 'revoke-cert'],
};
export function staffConfig(env, email) {
  try {
    const all = JSON.parse(env.STAFF_ACCOUNTS ?? '{}');
    const account = Object.hasOwn(all, email) ? all[email] : null;
    if (account && /^[A-Za-z0-9_\-]{2,40}$/.test(account.id) &&
      /^[A-Z2-7]{32,64}$/.test(account.totp) &&
      (account.scope === 'admin' || Object.hasOwn(scopes, account.scope))) return account;
  } catch { /* An invalid deployment setting grants no privileges. */ }
  return null;
}
export function localCodes(env, request) {
  return env.SWAP_ENV === 'local' && env.LOCAL_AUTH_CODES === '1' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
}
export function staffIdentity(email, account) {
  return digest([account.id, account.totp, account.scope, account.revision ?? 1].join(':'))
    .then((fingerprint) => 'staff:' + email + ':' + fingerprint);
}
export async function authorizeStaff(env, session) {
  if (!session?.identity.startsWith('staff:')) return null;
  const [, email] = session.identity.split(':');
  const account = staffConfig(env, email);
  if (!account || session.identity !== await staffIdentity(email, account)) {
    throw new RequestError('Your staff session has expired. Sign in again.', 401, 'SESSION_EXPIRED');
  }
  return account;
}
export function mayAct(account, action) {
  return account.scope === 'admin' || scopes[account.scope].includes(action);
}
export function staffView(state, account) {
  if (account.scope === 'admin' || account.scope === 'intake') return { ...state, staff: account.id, scope: account.scope };
  return {
    ...state, staff: account.id, scope: account.scope,
    people: state.people.map(({ id, role, name, verified, publicName }) => ({ id, role, name, verified, publicName })),
    problems: state.problems.map(({ id, brief }) => ({ id, brief })),
  };
}
function secretBytes(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let pending = 0;
  let bits = 0;
  const bytes = [];
  for (const letter of secret) {
    pending = (pending << 5) | alphabet.indexOf(letter);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((pending >> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}
async function counterCode(key, counter) {
  const payload = new DataView(new ArrayBuffer(8));
  payload.setBigUint64(0, BigInt(counter));
  const result = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  const offset = result.at(-1) & 15;
  const number = new DataView(result.buffer).getUint32(offset) & 0x7fffffff;
  return String(number % 1000000).padStart(6, '0');
}
export async function verifyStaffFactor(db, env, email, otp) {
  const account = emailPattern.test(normalizeEmail(email)) && staffConfig(env, email);
  if (!account || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) return false;
  const start = Math.floor(Date.now() / 30000);
  const key = await crypto.subtle.importKey('raw', secretBytes(account.totp), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const candidates = [start, start - 1, start + 1];
  const codes = await Promise.all(candidates.map((counter) => counterCode(key, counter)));
  const encoder = new TextEncoder();
  const index = codes.findIndex((code) => crypto.subtle.timingSafeEqual(encoder.encode(code), encoder.encode(otp)));
  if (index === -1) return false;
  const identity = await staffIdentity(email, account);
  const saved = await db.prepare(`INSERT INTO staff_counters VALUES (?,?) ON CONFLICT(identity)
    DO UPDATE SET counter=excluded.counter WHERE staff_counters.counter<excluded.counter RETURNING counter`)
    .bind(await digest(identity), candidates[index]).first();
  return saved ? identity : false;
}

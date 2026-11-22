import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createTestHarness } from 'wrangler';
import { acknowledgement, codeMail } from '../src/mail.js';
import { authorizeStaff, staffIdentity } from '../src/access.js';
import { cleanPersonal, needsRetention, newEvent, publicStatus } from '../src/event.js';

const staff = {
  'ops@example.test': { id: 'screening-lead', scope: 'intake', totp: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' },
  'release@example.test': { id: 'release-lead', scope: 'publication', totp: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' },
};
const staffSecret = JSON.stringify(staff);
function authenticatorCode() {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', '12345678901234567890').update(counter).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

const harness = await createTestHarness({ root: process.cwd(), workers: [{
  configPath: 'wrangler.jsonc',
  vars: { SWAP_ENV: 'local', LOCAL_AUTH_CODES: '1' },
  secrets: { ADMIN_KEY: 'test-organizer-secret', STAFF_ACCOUNTS: staffSecret },
}] });
const worker = harness.getWorker();
function client() {
  const cookies = new Map();
  return async (path, payload, status = 200, demo = false) => {
    const headers = { Cookie: [...cookies.values()].join('; ') };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (demo) headers['X-Swap-Context'] = 'demo';
    const response = await worker.fetch('/api/' + path, {
      method: payload === undefined ? 'GET' : 'POST', headers, body: JSON.stringify(payload),
    });
    const result = await response.json();
    assert.equal(response.status, status, path + ': ' + JSON.stringify(result));
    const cookie = response.headers.get('Set-Cookie')?.split(';')[0];
    if (cookie) cookies.set(cookie.split('=')[0], cookie);
    return result;
  };
}
const action = (who, name, payload = {}, status = 200, commandId) => who('action', { action: name, payload, commandId }, status);
const organizer = client();
const anonymous = client();
const builder = client();
const finder = client();
const teammate = client();
const judges = Array.from({ length: 5 }, client);
const event = {
  start: '2027-01-01', finale: '2027-01-19', retention: '2027-02-19',
  venue: 'Sample town hall', organizer: 'Sample organizers', contact: 'hello@example.test',
  terms: 'Sample terms.', privacy: 'Sample notice.', terms_gu: 'પરીક્ષણ શરતો.', privacy_gu: 'પરીક્ષણ ગોપનીયતા.',
  approved_gu: true, finderLimit: 3, peerCount: 2, groupLimit: 5,
};
const phase = (value, status) => action(organizer, 'settings', { ...event, phase: value }, status);
async function signIn(who, email) {
  const { code } = await who('sign-in/request', { email, locale: 'gu' });
  assert.match(code, /^\d{8}$/);
  await who('sign-in/confirm', { email, code });
  const retry = await who('sign-in/confirm', { email, code }, 401);
  assert.equal(retry.code, 'CODE_EXPIRED_OR_INVALID');
}
const entry = {
  adult: true, role: 'builder', occupation: 'student', location: 'Nadiad, Kheda', course: 'IT', year: '2', college: 'Demo college',
  area: 'Education', language: 'Gujarati', description: 'વાંચવા માટે શાંત જગ્યા મળતી નથી.',
  affected: 'Students', outcome: 'Find an open desk in one minute.', workaround: 'Ask at the front desk.',
  experience: 'mine', privateSafe: true, consent: Array(6).fill(true),
};
const project = { website: 'https://example.test', repo: 'https://example.test/repo',
  video: 'https://youtu.be/sample-check', disclosure: 'No external libraries.', anonymous: true };

try {
  await harness.listen();
  await worker.applyD1Migrations('DB');
  for (const [path, copy] of [['/en/', /Real problems/], ['/hi/', /असली समस्याएँ/], ['/gu/', /સાચી સમસ્યાઓ/]]) {
    const response = await worker.fetch(path, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), copy);
  }
  assert.equal((await anonymous('status')).phase, 'draft');
  const intakeStaff = client();
  const releaseStaff = client();
  await signIn(intakeStaff, 'ops@example.test');
  await signIn(releaseStaff, 'release@example.test');
  assert.equal((await intakeStaff('workspace')).staffEligible, true);
  await intakeStaff('staff/verify', { code: authenticatorCode() });
  await releaseStaff('staff/verify', { code: authenticatorCode() });
  assert.equal((await intakeStaff('workspace')).staff, 'screening-lead');
  assert.equal((await releaseStaff('workspace')).staff, 'release-lead');
  await action(intakeStaff, 'publish', {}, 403);
  const identity = await staffIdentity('ops@example.test', staff['ops@example.test']);
  await assert.rejects(authorizeStaff({ STAFF_ACCOUNTS: '{}' }, { identity }), { code: 'SESSION_EXPIRED' });
  await organizer('admin/sign-in', { key: 'test-organizer-secret' });
  await phase('build', 409);
  await action(organizer, 'settings', { ...event, start: '2027-02-30', phase: 'registration' }, 400);
  await phase('registration');
  await Promise.all([signIn(builder, 'builder@example.test'), signIn(teammate, 'pair@example.test'), signIn(finder, 'finder@example.test')]);
  const one = await action(builder, 'register', { ...entry, title: 'Find open desks', name: 'Lead Participant', publicName: true,
    team: 'pair', teammateName: 'Pending Friend', teammateEmail: 'pair@example.test' });
  const invite = await teammate('workspace');
  assert.equal(invite.role, 'new');
  assert.equal(invite.problems.length, 0);
  await action(teammate, 'register', { ...entry, title: 'Another entry', name: 'Pending Friend' }, 409);
  const receipt = randomUUID();
  const finderPayload = { ...entry, title: 'અભ્યાસ માટે જગ્યા શોધવી', name: 'Finder Private', role: 'finder', locale: 'gu',
    policyRevision: (await anonymous('status')).policyRevision };
  const two = await action(finder, 'register', finderPayload, 200, receipt);
  assert.equal((await action(finder, 'register', finderPayload, 200, receipt)).id, two.id);
  await action(finder, 'register', { ...finderPayload, title: 'Changed brief' }, 409, receipt);
  await phase('screening');
  const current = await organizer('workspace');
  const lead = current.people.find((row) => row.role === 'builder');
  await action(organizer, 'verify-person', { id: lead.id, verified: true }, 409);
  await action(teammate, 'team-invitation', { id: invite.invitation.id, name: 'Pair Participant', college: 'Demo College',
    course: 'IT', adult: true, student: true, policy: true, locale: 'gu', policyRevision: invite.settings.policyRevision });
  assert.equal((await teammate('workspace')).role, 'builder');
  for (const person of current.people) await action(organizer, 'verify-person', { id: person.id, verified: true });
  for (const brief of current.problems) await action(organizer, 'screen-problem', { ...brief.brief, id: brief.id, status: 'accepted',
    screened: true, translation_hi: 'स्क्रीनिंग के बाद अनुमति प्राप्त विवरण।', translation_approved_hi: true });
  await action(organizer, 'assign', { person: lead.id, problem: one.id }, 400);
  const match = await action(organizer, 'assign', { person: lead.id, problem: two.id });
  await phase('build');
  const { assignment } = await builder('workspace');
  assert(assignment.problem.translations.hi.text);
  assert(!JSON.stringify(assignment).includes('Finder Private'));
  assert.equal((await action(builder, 'submit', { ...project, id: match.id })).revision, 1);
  await phase('review');
  await phase('build', 409);
  for (const [index, judge] of judges.entries()) {
    const email = 'judge' + index + '@example.test';
    await action(organizer, 'judge', { name: 'Judge ' + index, email });
    await signIn(judge, email);
  }
  await action(organizer, 'precheck', { id: match.id, state: 'passed' });
  await action(organizer, 'panels');
  assert.equal((await judges[0]('workspace')).assigned[0].submissionRevision, 1);
  const score = { id: match.id, kind: 'judge', submissionRevision: 1, expectedVersion: 0, ratings: [4, 4, 4, 3, 4], declaration: true };
  const scored = await Promise.all(judges.slice(0, 3).map((judge) => action(judge, 'review', score, 200, randomUUID())));
  assert(scored.every((item) => item.version === 1));
  const stale = await action(judges[0], 'review', score, 409);
  assert.equal(stale.code, 'VERSION_CONFLICT');
  assert.equal((await organizer('workspace')).standings[0].total, 78);
  await action(organizer, 'reopen-submission', { id: match.id, reason: 'Correct a broken demo link.' });
  assert.equal((await judges[0]('workspace')).assigned.length, 0);
  assert.equal((await action(builder, 'submit', { ...project, id: match.id, video: 'https://youtu.be/revised' })).revision, 2);
  await action(organizer, 'precheck', { id: match.id, state: 'passed' }, 409);
  await action(organizer, 'precheck', { id: match.id, state: 'passed', submissionRevision: 2 });
  await action(judges[0], 'review', score, 409);
  await action(judges[0], 'review', { ...score, submissionRevision: undefined }, 409);
  assert.equal((await organizer('workspace')).standings[0].total, null);
  const ratings = [[3,3,3,3,3], [3,4,3,5,3], [4,3,4,4,4], [4,4,4,5,5], [5,5,5,5,5]];
  await Promise.all(judges.map((judge, index) => action(judge, 'review', { ...score, submissionRevision: 2,
    ratings: ratings[index], comments: Array(5).fill('Fictional review evidence') })));
  await action(finder, 'review', { id: match.id, kind: 'finder', ratings: [4,4,4], submissionRevision: 2, expectedVersion: 0 });
  const standings = (await organizer('workspace')).standings[0];
  assert.equal(standings.judges, 5);
  assert.equal(standings.finder, 40);
  assert.equal(standings.total, 78);
  await action(organizer, 'publish');
  const result = await anonymous('results');
  assert.equal(result.top[0].builder, 'Lead Participant');
  assert.equal(result.top[0].teammate, '');
  assert.equal(result.top[0].score, Math.round(standings.total * 100) / 100);
  assert.deepEqual(result.bestProblem.authors, []);
  await action(organizer, 'issue-cert', { kind: 'Winner', person: lead.id, approved: true }, 409);
  await action(builder, 'certificate-consent', { approved: true });
  const cert = await action(organizer, 'issue-cert', { kind: 'Winner', person: lead.id, approved: true });
  assert.equal((await anonymous('certificates/' + cert.id)).name, 'Lead Participant');
  await builder('demo', { role: 'judge' });
  const demo = await builder('workspace', undefined, 200, true);
  assert.equal(demo.role, 'judge');
  const sample = demo.assigned[0];
  await builder('action', { action: 'review', payload: { ...score, id: sample.id, submissionRevision: sample.submissionRevision,
    expectedVersion: sample.saved?.version ?? 0 } }, 200, true);
  assert.equal((await builder('workspace')).role, 'builder');
  assert.equal((await anonymous('certificates/DEMO-SWAP-26')).demo, true);
  assert.equal(acknowledgement.gu.length, 6);
  assert.match(codeMail('hi', '12345678').text, /12345678/);
  const cancelled = newEvent();
  Object.assign(cancelled.settings, { phase: 'registration', retention: '2020-01-01' });
  assert.equal(publicStatus(cancelled).phase, 'closed');
  Object.assign(cancelled.settings, { phase: 'cancelled', retention: '2020-01-01' });
  assert(needsRetention(cancelled));
  cleanPersonal(cancelled);
  assert(!needsRetention(cancelled));
  console.log('Passed: migrations, locale routes, team consent, matching, idempotency, concurrent reviews, revision reset, ranking, certificates and session isolation.');
} finally {
  await harness.close();
}

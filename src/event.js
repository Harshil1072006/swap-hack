export const roles = ['builder', 'finder', 'evaluator'];
export const phases = ['draft', 'registration', 'screening', 'build', 'review', 'results', 'cancelled'];
const problemStates = ['new', 'accepted', 'reserve', 'rejected', 'merged'];
const areas = ['Agriculture', 'Education', 'Health', 'Trade and exports', 'Local business', 'Finance', 'Public services', 'Everyday life', 'Other'];
const languages = ['English', 'Gujarati', 'Hindi'];
export const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const normalizeEmail = (value) => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 ? email : '';
};
const uid = (prefix) => `${prefix}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
const now = () => new Date().toISOString();
const lookup = (rows, id) => rows.find((row) => row.id === id);
const userKey = (person) => `person:${person.id}`;
const judgeKey = (judge) => `judge:${judge.id}`;
const means = (values) => Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(5));

export class RequestError extends Error {
  constructor(message, status = 400, code = '', field = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}
function requireThat(condition, message, status) {
  if (!condition) throw new RequestError(message, status);
}
function value(input, label, max, { optional = false } = {}) {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  requireThat((trimmed || optional) && trimmed.length <= max, `${label} must ${optional ? 'have at most' : 'have between 1 and'} ${max} characters.`);
  return trimmed;
}
function choose(item, options, label) {
  requireThat(options.includes(item), `Choose a valid ${label}.`);
  return item;
}
function link(input, label, optional = false) {
  const url = value(input, label, 500, { optional });
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '') return parsed.href;
  } catch { /* Reuse the field error below. */ }
  throw new RequestError(`${label} must be an HTTPS link.`);
}
function get(rows, id, label) {
  const row = lookup(rows, id);
  requireThat(row, `${label} could not be found.`, 404);
  return row;
}
function newProblem(owner, brief) {
  return { id: uid('SH'), owner, status: 'new', group: '', brief, note: '', created: now() };
}
function newMatch(builder, problem) {
  return {
    id: uid('BUILD'), builder, problem, plan: '', prototype: '', submission: null,
    precheck: 'pending', precheckNote: '', reviewers: [], reviews: {}, questions: [],
    abandoned: false, scoreOverride: 0,
  };
}
export function newEvent() {
  return {
    settings: { phase: 'draft', start: '', finale: '', venue: '', organizer: '', contact: '', retention: '', terms: '', privacy: '', finderLimit: 3, peerCount: 2, groupLimit: 5, judgePoints: [20, 10, 10, 5, 5], updates: '' },
    people: [], problems: [], matches: [], judges: [], certificates: [], policies: [], published: null,
  };
}
export function publicStatus(event) {
  const { phase, start, finale, venue, updates, terms, privacy, organizer, contact, retention, finderLimit, peerCount, judgePoints } = event.settings;
  const expired = (event.cleaned || needsRetention(event)) && !['results', 'cancelled'].includes(phase);
  return { phase: expired ? 'closed' : phase, start, finale, venue, updates, terms, privacy, organizer, contact, retention, finderLimit, peerCount,
    judgePoints: judgePoints ?? [20, 10, 10, 5, 5], policyBundles: event.settings.policyBundles ?? {},
    policyRevision: event.settings.policyRevision ?? 'legacy' };
}
function personFor(event, identity) {
  return event.people.find((person) => person.email === identity || (person.teammateEmail === identity && person.invitation?.state === 'accepted'));
}
const reservedFor = (event, email) => event.people.find((person) => person.teammateEmail === email && invitationState(person) === 'pending');
const invitationState = (person) => {
  if (!person.teammateEmail) return '';
  const state = person.invitation?.state ?? 'pending';
  return state === 'pending' && person.invitation?.expires <= Date.now() ? 'expired' : state;
};
const readyTeam = (person) => !person.teammateEmail || person.invitation?.state === 'accepted';
const localeOf = (locale) => ['hi', 'gu'].includes(locale) ? locale : 'en';
function acceptedPolicy(event, data) {
  const locale = localeOf(data.locale);
  const settings = event.settings;
  if (data.policyRevision !== undefined && data.policyRevision !== (settings.policyRevision ?? 'legacy')) {
    throw new RequestError('The policy changed. Review it and confirm your choices again.', 409, 'POLICY_CHANGED');
  }
  const policy = locale === 'en' ? { terms: settings.terms, privacy: settings.privacy } : settings.policyBundles?.[locale];
  requireThat(policy || data.demo, 'Registration in this language is waiting for the reviewed policies.', 409);
  const { terms = '', privacy = '' } = policy ?? {};
  event.policies ??= [];
  let record = event.policies.find((item) => item.terms === terms && item.privacy === privacy && item.locale === locale &&
    item.revision === (settings.policyRevision ?? 'legacy'));
  if (!record) {
    record = { id: uid('POLICY'), terms, privacy, locale, revision: settings.policyRevision ?? 'legacy' };
    event.policies.push(record);
  }
  return { policy: record, locale };
}
function sameTeam(event, a, b) {
  const one = lookup(event.people, a);
  const two = lookup(event.people, b);
  return one && two && [one.email, one.teammateEmail].some((email) => email && [two.email, two.teammateEmail].includes(email));
}
function groupProblems(event, problemId) {
  return event.problems.filter((problem) => problem.id === problemId || (problem.status === 'merged' && problem.group === problemId));
}
function problemOwners(event, problemId) {
  const ids = [...new Set(groupProblems(event, problemId).map((problem) => problem.owner))];
  return ids.map((id) => lookup(event.people, id)).filter(Boolean);
}
function canAssign(event, person, problem) {
  return ['accepted', 'reserve'].includes(problem.status) && !problemOwners(event, problem.id).some((owner) => sameTeam(event, owner.id, person.id));
}
function judgeFor(event, identity) {
  return event.judges.find((judge) => judge.email === identity);
}
function briefFrom(data) {
  const title = value(data.title, 'Problem title', 100);
  requireThat(title.split(/\s+/u).length <= 10, 'Use at most ten words for the problem title.');
  return {
    title,
    area: choose(data.area, areas, 'area'),
    language: choose(data.language, languages, 'language'),
    description: value(data.description, 'Problem description', 1300),
    affected: value(data.affected, 'Who it affects', 220),
    outcome: value(data.outcome, 'Testable outcome', 750),
    workaround: value(data.workaround, 'Current workaround', 650),
  };
}
function register(event, identity, data, demo) {
  requireThat(event.settings.phase === 'registration', 'Registration is currently closed.', 409);
  requireThat(emailPattern.test(identity), 'Verify your email before registering.', 401);
  requireThat(!judgeFor(event, identity), 'Judges cannot register as participants.');
  requireThat(data.adult === true && Array.isArray(data.consent) && data.consent.length === 6 && data.consent.every((item) => item === true), 'Confirm your age and accept all six required statements.');
  requireThat(data.privateSafe === true, 'Confirm that the brief contains no personal or confidential data.');
  const experience = choose(data.experience, ['mine', 'known', 'no'], 'first-hand experience');
  requireThat(experience !== 'no', 'Share a problem that you or someone you know has experienced.');
  const role = choose(data.role, roles, 'role');
  const brief = briefFrom(data);
  const { policy, locale } = acceptedPolicy(event, { ...data, demo });
  const existing = personFor(event, identity);
  requireThat(existing || !reservedFor(event, identity), 'Resolve the pending team invitation before opening another entry.', 409);
  if (existing) {
    requireThat(existing.role === 'finder' && role === 'finder' && existing.email === identity, 'This email already belongs to an entry.', 409);
    requireThat(event.problems.filter((problem) => problem.owner === existing.id).length < event.settings.finderLimit, 'You have reached the limit for submitted problems.', 409);
    const problem = { ...newProblem(existing.id, { ...brief, experience }), consent: { policyId: policy.id, locale, at: now(), statements: [...data.consent] } };
    event.problems.push(problem);
    return { id: problem.id };
  }
  const occupation = choose(data.occupation, ['student', 'employed', 'business', 'farming', 'teacher', 'other'], 'occupation');
  requireThat(role === 'finder' || occupation === 'student', 'Builders and wildcard evaluators must be current students.');
  const student = occupation === 'student';
  const team = role === 'builder' && data.team === 'pair';
  const teammateEmail = team ? normalizeEmail(data.teammateEmail) : '';
  requireThat(!team || (emailPattern.test(teammateEmail) && teammateEmail !== identity), 'Enter a different, valid teammate email.');
  requireThat(!teammateEmail || (!personFor(event, teammateEmail) && !judgeFor(event, teammateEmail) && !reservedFor(event, teammateEmail)), 'Your teammate’s email already belongs to an entry.', 409);
  const person = {
    id: uid('ENTRY'), email: identity, role, occupation,
    name: value(data.name, 'Full name', 100),
    phone: value(data.phone, 'Phone', 35, { optional: true }),
    location: value(data.location, 'Town and district', 130),
    college: student ? value(data.college, 'College', 140) : '',
    course: student ? value(data.course, 'Course and branch', 130) : '',
    year: student ? choose(data.year, ['1', '2', '3', '4', '5', 'Diploma'], 'year of study') : '',
    teammateEmail, teammateName: team ? value(data.teammateName, 'Teammate name', 100) : '',
    invitation: team ? { state: 'pending', expires: Date.now() + 72 * 3600000 } : null,
    verified: false, verificationNote: '',
    internship: data.internship === true, future: data.future === true, publicName: data.publicName === true,
    consentAt: now(), policyId: policy.id, locale, consent: [...data.consent],
  };
  const problem = { ...newProblem(person.id, { ...brief, experience }), consent: { policyId: policy.id, locale, at: now(), statements: [...data.consent] } };
  event.people.push(person);
  event.problems.push(problem);
  return { id: problem.id };
}
function respondInvitation(event, identity, data, demo) {
  requirePhase(event, ['registration', 'screening']);
  const person = reservedFor(event, identity);
  requireThat(person && person.id === data.id && !personFor(event, identity) && !judgeFor(event, identity), 'The invitation is unavailable.', 409);
  if (data.accept === false) {
    person.invitation = { state: 'declined', at: now() };
    return { id: person.id };
  }
  requireThat(data.adult && data.student && data.policy, 'Confirm your age, student eligibility and consent.');
  const { policy, locale } = acceptedPolicy(event, { ...data, demo });
  person.teammateName = value(data.name, 'Full name', 100);
  person.invitation = { state: 'accepted', at: now(), policyId: policy.id, locale, publicName: data.publicName === true,
    college: value(data.college, 'College', 140), course: value(data.course, 'Course and branch', 130) };
  person.verified = false;
  return { id: person.id };
}
function shuffled(values) {
  const list = [...values];
  const entropy = crypto.getRandomValues(new Uint32Array(list.length));
  for (let i = list.length - 1; i > 0; i--) {
    const j = entropy[i] % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
function shuffle(event) {
  const active = event.matches.filter((match) => !match.abandoned);
  const builders = shuffled(event.people.filter((person) => person.role === 'builder' && person.verified && readyTeam(person) &&
    event.problems.some((problem) => problem.owner === person.id && ['accepted', 'reserve', 'merged'].includes(problem.status)) &&
    !active.some((match) => match.builder === person.id)));
  const problems = shuffled(event.problems.filter((problem) => problem.status === 'accepted' &&
    !active.some((match) => match.problem === problem.id)));
  const allocations = new Map();
  const eligible = new Map(builders.map((builder) => [builder.id, problems.filter((problem) => canAssign(event, builder, problem))]));

  function assign(builder, checked) {
    for (const problem of eligible.get(builder.id)) {
      if (checked.has(problem.id)) continue;
      checked.add(problem.id);
      const current = allocations.get(problem.id);
      if (!current || assign(current, checked)) {
        allocations.set(problem.id, builder);
        return true;
      }
    }
    return false;
  }

  for (const builder of builders) assign(builder, new Set());
  for (const [problem, builder] of allocations) event.matches.push(newMatch(builder.id, problem));
  return { count: allocations.size, unmatched: builders.length - allocations.size };
}
function queuePanels(event) {
  if (!event.judges.length && !event.settings.peerCount) return 0;
  const matches = shuffled(event.matches.filter((match) => !match.abandoned && match.submission && match.precheck === 'passed'));
  const peers = event.people.filter((person) => person.verified && ['builder', 'evaluator'].includes(person.role));
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const judges = event.judges.map((_, offset) => event.judges[(index + offset) % event.judges.length]);
    const assigned = match.reviewers.filter((key) => key.startsWith('judge:')).length;
    for (const judge of judges.filter((person) => !match.reviewers.includes(judgeKey(person))).slice(0, Math.max(0, Math.min(5, judges.length) - assigned))) {
      match.reviewers.push(judgeKey(judge));
    }
  }
  for (const person of peers) {
    const key = userKey(person);
    const assigned = matches.filter((match) => match.reviewers.includes(key)).length;
    const eligible = shuffled(matches.filter((match) => !match.reviewers.includes(key) && !sameTeam(event, person.id, match.builder) &&
      !problemOwners(event, match.problem).some((owner) => owner.id === person.id)));
    for (const match of eligible.slice(0, Math.max(0, event.settings.peerCount - assigned))) match.reviewers.push(key);
  }
  return matches.length;
}
function summarize(event, match) {
  const reviews = Object.values(match.reviews).filter((review) => !review.conflict);
  const judges = reviews.filter((review) => review.kind === 'judge').map((review) => review.total).sort((a, b) => a - b);
  const eligibleAuthors = new Set(problemOwners(event, match.problem)
    .filter((person) => person.verified || lookup(event.problems, match.problem)?.owner === person.id)
    .map(userKey));
  const finders = reviews.filter((review) => review.kind === 'finder' && eligibleAuthors.has(review.reviewer)).map((review) => review.total);
  const judge = judges.length >= 3 ? means(judges.length === 5 ? judges.slice(1, -1) : judges) : null;
  const finder = finders.length ? means(finders) : null;
  return {
    id: match.id, title: lookup(event.problems, match.problem)?.brief.title,
    builder: lookup(event.people, match.builder)?.name, judges: judges.length, finders: finders.length,
    judge, finder, total: judge === null ? null : Number((finder === null ? judge * 2 : judge + finder).toFixed(5)),
    tie: match.scoreOverride,
  };
}
function standings(event) {
  return event.matches.filter((match) => !match.abandoned && match.precheck === 'passed' && match.submission)
    .map((match) => summarize(event, match))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || (b.finder ?? 0) - (a.finder ?? 0) ||
      b.tie - a.tie || a.id.localeCompare(b.id));
}

function publish(event) {
  const ranks = standings(event).filter((row) => row.total !== null);
  requireThat(ranks.length > 0, 'At least one project needs three eligible judge scores.');
  const top = ranks.slice(0, 3);
  requireThat(!ranks.slice(0, 3).some((row, i) => ranks[i + 1] && ranks[i + 1].total === row.total &&
    (ranks[i + 1].finder ?? 0) === (row.finder ?? 0) && ranks[i + 1].tie === row.tie), 'Record the judges’ tiebreak vote before publishing.');
  const award = ranks.map((row) => {
    const match = get(event.matches, row.id, 'Entry');
    const finders = problemOwners(event, match.problem).filter((person) => person.role === 'finder' && person.verified);
    return { title: row.title, finders };
  }).find((item) => item.finders.length);
  if (event.published) {
    event.resultHistory ??= [];
    event.resultHistory.push(event.published);
  }
  event.published = {
    at: now(),
    revision: (event.published?.revision ?? (event.published ? 1 : 0)) + 1,
    correction: event.resultCorrection?.reason ?? '',
    bestProblem: award ? { title: award.title, authors: award.finders.filter((person) => person.publicName).map((owner) => owner.name) } : null,
    top: top.map((row, index) => {
      const match = get(event.matches, row.id, 'Entry');
      const person = get(event.people, match.builder, 'Builder');
      const authors = problemOwners(event, match.problem).filter((author) => author.publicName);
      return { rank: index + 1, id: row.id, title: row.title, score: Math.round(row.total * 100) / 100,
        builder: person.publicName ? person.name : '', teammate: person.invitation?.publicName ? person.teammateName : '',
        judge: row.judge, finder: row.finder, judges: row.judges, tie: row.tie,
        authors: authors.map((owner) => owner.name) };
    }),
  };
  event.resultCorrection = null;
  event.settings.phase = 'results';
}
const defaultJudgePoints = [20, 10, 10, 5, 5];
const finderPoints = [25, 15, 10];
function score(event, kind, data, reviewer) {
  if (kind === 'judge' && data.conflict === true) return { kind, reviewer, conflict: true, created: now() };
  const weights = kind === 'finder' ? finderPoints : (event.settings.judgePoints ?? defaultJudgePoints);
  const ratings = data.ratings;
  const comments = data.comments;
  requireThat(Array.isArray(ratings) && ratings.length === weights.length && ratings.every((n) => Number.isInteger(n) && n >= 1 && n <= 5), 'Choose a rating of 1 to 5 for each criterion.');
  const notes = weights.map((_, index) => value(comments?.[index], 'Reason', 450, {
    optional: kind !== 'peer' && !(kind === 'judge' && [1, 5].includes(ratings[index])),
  }));
  requireThat(kind !== 'judge' || data.declaration === true, 'Confirm that you have no conflict of interest.');
  return { kind, reviewer, ratings, notes, total: weights.reduce((sum, weight, index) => sum + weight * ratings[index], 0) / 5, created: now() };
}
function setSettings(event, data, demo) {
  const settings = { ...event.settings };
  settings.phase = choose(data.phase, phases, 'event phase');
  requireThat(settings.phase !== 'results' || event.published, 'Publish results from the scoring tab to open the results phase.');
  requireThat(!event.published || settings.phase === 'results', 'The event phase is locked after results publish.');
  if (!demo && settings.phase !== event.settings.phase) {
    requireThat(event.settings.phase !== 'cancelled' && (settings.phase === 'cancelled' ||
      phases.indexOf(settings.phase) === phases.indexOf(event.settings.phase) + 1),
    'Advance one phase at a time. Use a project correction to reopen a submission.', 409);
  }
  for (const field of ['start', 'finale', 'retention']) {
    settings[field] = value(data[field], field, 10, { optional: true });
    const date = new Date(settings[field] + 'T00:00:00Z');
    requireThat(!settings[field] || (/^\d{4}-\d{2}-\d{2}$/.test(settings[field]) && Number.isFinite(+date) &&
      date.toISOString().slice(0, 10) === settings[field]), 'Use a valid calendar date.');
  }
  settings.venue = value(data.venue, 'Venue', 180, { optional: true });
  settings.organizer = value(data.organizer, 'Organizer', 140, { optional: true });
  settings.contact = normalizeEmail(data.contact);
  requireThat(!settings.contact || emailPattern.test(settings.contact), 'Enter a valid organizer email.');
  settings.updates = value(data.updates, 'Event update', 1000, { optional: true });
  settings.terms = value(data.terms, 'Terms', 8000, { optional: true });
  settings.privacy = value(data.privacy, 'Privacy notice', 5500, { optional: true });
  settings.policyBundles = { ...event.settings.policyBundles };
  for (const locale of ['hi', 'gu']) {
    if (data['terms_' + locale] === undefined) continue;
    const terms = value(data['terms_' + locale], 'Terms', 8000, { optional: true });
    const privacy = value(data['privacy_' + locale], 'Privacy notice', 5500, { optional: true });
    if (terms && privacy && data['approved_' + locale] === true) settings.policyBundles[locale] = { terms, privacy };
    else delete settings.policyBundles[locale];
  }
  if (settings.terms !== event.settings.terms || settings.privacy !== event.settings.privacy ||
    JSON.stringify(settings.policyBundles) !== JSON.stringify(event.settings.policyBundles ?? {})) settings.policyRevision = uid('POLICY');
  if (!demo && !['draft', 'cancelled'].includes(settings.phase)) {
    requireThat(settings.start && settings.finale && settings.venue && settings.organizer && settings.contact && settings.retention &&
      settings.terms && settings.privacy, 'Set the dates, venue, organizer, retention date, terms and privacy notice before opening the event.');
    requireThat(settings.start <= settings.finale && settings.finale < settings.retention, 'Set a retention date after the finale.');
  }
  for (const [key, minimum, maximum] of [['finderLimit', 1, 5], ['peerCount', 0, 5], ['groupLimit', 2, 10]]) {
    const number = Number(data[key]);
    requireThat(Number.isInteger(number) && number >= minimum && number <= maximum, `Choose a value between ${minimum} and ${maximum}.`);
    settings[key] = number;
  }
  const currentPoints = event.settings.judgePoints ?? defaultJudgePoints;
  const points = currentPoints.map((current, index) => Number(data['judgePoint' + index] ?? current));
  requireThat(points.every((point) => Number.isInteger(point) && point > 0) && points.reduce((sum, point) => sum + point, 0) === 50, 'Judge criteria must have positive whole points and add up to 50.');
  requireThat(!event.rubricLocked || points.every((point, index) => point === currentPoints[index]), 'The rubric is locked because the review phase has opened.');
  settings.judgePoints = points;
  event.settings = settings;
  if (settings.phase === 'review') event.rubricLocked = true;
}
function reviewProblem(event, data) {
  const problem = get(event.problems, data.id, 'Problem');
  const status = choose(data.status, problemStates, 'problem status');
  const related = groupProblems(event, problem.id);
  const used = event.matches.filter((match) => !match.abandoned && match.problem === problem.id);
  requireThat(!used.length || ['accepted', 'reserve'].includes(status), 'Remove the active assignment before changing this problem’s status.');
  if (status === 'merged') {
    const parent = get(event.problems, data.group, 'Parent problem');
    requireThat(parent.id !== problem.id && ['accepted', 'reserve'].includes(parent.status), 'Merge into a different accepted or reserve problem.');
    requireThat(related.length === 1, 'Move the other problems out of this group before merging it.');
    const owners = problemOwners(event, parent.id).filter((owner) => owner.id !== problem.owner);
    requireThat(owners.length < event.settings.groupLimit, 'This group already has the maximum number of authors.');
    requireThat(!event.matches.some((match) => !match.abandoned && match.problem === parent.id && sameTeam(event, match.builder, problem.owner)), 'This would give the builder their own problem.');
    problem.group = parent.id;
  } else {
    requireThat(related.length === 1 || ['accepted', 'reserve'].includes(status), 'Move merged problems out of this group first.');
    problem.group = '';
  }
  if (['accepted', 'reserve'].includes(status)) requireThat(data.screened === true, 'Confirm the brief passed screening and contains no identifying details.');
  problem.status = status;
  problem.note = value(data.note, 'Screening note', 440, { optional: true });
  problem.original ??= { ...problem.brief };
  const screened = { ...briefFrom(data), experience: problem.brief.experience };
  if (JSON.stringify(screened) !== JSON.stringify(problem.brief)) problem.translations = {};
  problem.brief = screened;
  for (const locale of ['en', 'hi', 'gu']) {
    if (data['translation_' + locale] === undefined) continue;
    const handoff = value(data['translation_' + locale], 'Translated brief', 2600, { optional: true });
    problem.translations ??= {};
    if (handoff && data['translation_approved_' + locale] === true) {
      problem.translations[locale] = { text: handoff, approvedAt: now() };
    } else {
      delete problem.translations[locale];
    }
  }
}
function issue(event, data, demo) {
  const kind = choose(data.kind, ['Builder', 'Winner', 'Pain finder', 'Wildcard evaluator', 'Judge'], 'certificate type');
  const judge = kind === 'Judge';
  const person = get(judge ? event.judges : event.people, data.person, 'Recipient');
  const key = judge ? judgeKey(person) : userKey(person);
  const team = !judge && data.teammate === true;
  requireThat(demo || (team ? person.invitation?.certificateConsent : person.certificateConsent),
    'The recipient must consent to certificate verification in their own workspace.', 409);
  const match = event.matches.find((entry) => !entry.abandoned && entry.builder === person.id);
  const allPeerReviews = event.matches.filter((item) => item.reviewers.includes(key));
  const finishedPeer = allPeerReviews.every((item) => item.reviews['peer:' + key]);
  if (kind === 'Builder' || kind === 'Winner') {
    requireThat(person.role === 'builder' && person.verified && match?.precheck === 'passed' && finishedPeer, 'This builder has not completed the required checks and reviews.');
    if (kind === 'Winner') requireThat(event.published?.top.some((row) => row.id === match.id), 'Publish this builder’s winning result before issuing a winner certificate.');
  }
  if (kind === 'Pain finder') requireThat(person.role === 'finder' && event.matches.some((item) => item.reviews['finder:' + key]), 'This pain finder has not completed a review.');
  if (kind === 'Wildcard evaluator') requireThat(person.role === 'evaluator' && person.verified && allPeerReviews.length > 0 && finishedPeer, 'This evaluator has not completed their reviews.');
  if (kind === 'Judge') requireThat(event.matches.some((item) => item.reviews['judge:' + key] && !item.reviews['judge:' + key].conflict), 'This judge has not completed a scored review.');
  requireThat(!team || (person.teammateName && readyTeam(person)), 'This entry has no confirmed teammate.');
  requireThat(!event.certificates.some((cert) => cert.person === person.id && cert.kind === kind && cert.team === team), 'This certificate has already been issued.');
  const cert = { id: `SWAP-${crypto.randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`, kind,
    person: person.id, team, name: team ? person.teammateName : person.name, date: now().slice(0, 10) };
  event.certificates.push(cert);
  return { id: cert.id };
}
function dataDate(value) {
  return value ? Date.parse(value + 'T00:00:00+05:30') : NaN;
}
export function cleanPersonal(event) {
  for (const person of event.people) {
    person.email = '';
    person.teammateEmail = '';
    person.teammateName = '';
    person.name = '';
    person.phone = '';
    person.location = '';
    person.college = '';
    person.course = '';
    person.year = '';
    person.verificationNote = '';
    person.internship = false;
    person.future = false;
    person.invitation = null;
  }
  for (const judge of event.judges) {
    judge.email = '';
    judge.name = '';
  }
  for (const problem of event.problems) {
    problem.note = '';
    delete problem.original;
    delete problem.translations;
    delete problem.consent;
    problem.brief = { language: problem.brief.language, title: '', area: '', description: '', affected: '', outcome: '', workaround: '' };
  }
  for (const match of event.matches) {
    match.questions = [];
    match.precheckNote = '';
    match.plan = '';
    match.prototype = '';
    match.submission = null;
    match.reviews = {};
    delete match.submissionHistory;
  }
  event.cleaned = true;
}
export function needsRetention(event) {
  return !event.cleaned && dataDate(event.settings.retention) <= Date.now();
}

function requirePhase(event, allowed) {
  if (!allowed.includes(event.settings.phase) || event.cleaned || needsRetention(event)) {
    throw new RequestError('This action is unavailable in the current event phase.', 409, 'PHASE_CLOSED');
  }
}
function adminAction(event, action, data, demo) {
  requireThat(!event.cleaned || ['settings', 'revoke-cert'].includes(action), 'Participant data has reached the retention date.', 409);
  if (action === 'settings') return setSettings(event, data, demo);
  if (action === 'verify-person') {
    requirePhase(event, ['registration', 'screening', 'build', 'review']);
    const person = get(event.people, data.id, 'Participant');
    requireThat(!data.verified || readyTeam(person), 'Wait for the teammate to accept before verifying this team.', 409);
    requireThat(data.verified === true || !event.matches.some((match) => !match.abandoned && match.builder === person.id),
      'Withdraw the active assignment before un-verifying this builder.');
    person.verified = data.verified === true;
    person.verificationNote = value(data.note, 'Verification note', 450, { optional: true });
    return;
  }
  if (action === 'screen-problem') {
    requirePhase(event, ['registration', 'screening', 'build']);
    return reviewProblem(event, data);
  }
  if (action === 'shuffle') {
    requirePhase(event, ['screening', 'build']);
    return shuffle(event);
  }
  if (action === 'assign') {
    requirePhase(event, ['screening', 'build']);
    const person = get(event.people, data.person, 'Builder');
    const problem = get(event.problems, data.problem, 'Problem');
    requireThat(person.role === 'builder' && person.verified && readyTeam(person) && event.problems.some((item) => item.owner === person.id &&
      ['accepted', 'reserve', 'merged'].includes(item.status)) && canAssign(event, person, problem), 'Choose a verified builder with an approved brief and a different eligible problem.');
    requireThat(!event.matches.some((match) => !match.abandoned && (match.builder === person.id || match.problem === problem.id)), 'The builder or problem already has an active assignment.');
    const match = newMatch(person.id, problem.id);
    event.matches.push(match);
    return { id: match.id };
  }
  if (action === 'judge') {
    requirePhase(event, ['draft', 'registration', 'screening', 'build', 'review']);
    const email = normalizeEmail(data.email);
    requireThat(emailPattern.test(email), 'Enter a valid judge email.');
    requireThat(!judgeFor(event, email) && !personFor(event, email) && !reservedFor(event, email), 'This email is already assigned.');
    requireThat(event.judges.length < 20, 'The judge panel has reached its limit.');
    const id = uid('JUDGE');
    event.judges.push({ id, email, name: value(data.name, 'Judge name', 100) });
    return { id };
  }
  if (action === 'panels') {
    requirePhase(event, ['review']);
    return { count: queuePanels(event) };
  }
  if (action === 'publish') {
    requirePhase(event, ['review']);
    return publish(event);
  }
  if (action === 'reopen-results') {
    requirePhase(event, ['results']);
    requireThat(event.published, 'Publish the first results before making a correction.');
    event.resultCorrection = { reason: value(data.reason, 'Correction reason', 450), at: now() };
    event.settings.phase = 'review';
    return;
  }
  if (action === 'issue-cert') {
    requirePhase(event, ['results']);
    requireThat(data.approved === true, 'Confirm that the recipient agreed to certificate verification.');
    return issue(event, data, demo);
  }
  if (action === 'revoke-cert') {
    get(event.certificates, data.id, 'Certificate');
    event.certificates = event.certificates.filter((cert) => cert.id !== data.id);
    return;
  }
  const match = get(event.matches, data.id, 'Project');
  if (action === 'reopen-submission') {
    requirePhase(event, ['review']);
    requireThat(match.submission && !match.abandoned && !match.reopened, 'This project cannot be reopened.', 409);
    match.reopened = { reason: value(data.reason, 'Correction reason', 450), at: now() };
    match.precheck = 'pending';
    match.precheckNote = '';
    match.scoreOverride = 0;
  } else if (action === 'withdraw') {
    requirePhase(event, ['screening', 'build']);
    match.abandoned = true;
  } else if (action === 'precheck') {
    requirePhase(event, ['review']);
    requireThat(!match.abandoned && match.submission && !match.reopened, 'The project needs a final submission.');
    const revision = match.submission.revision ?? 1;
    if ((data.submissionRevision !== undefined && Number(data.submissionRevision) !== revision) ||
      (!demo && revision > 1 && data.submissionRevision === undefined)) {
      throw new RequestError('This submission changed. Open the latest revision before saving.', 409, 'VERSION_CONFLICT');
    }
    match.precheck = choose(data.state, ['pending', 'passed', 'failed'], 'precheck result');
    match.precheckNote = value(data.note, 'Precheck note', 500, { optional: true });
  } else if (action === 'extra-judge') {
    requirePhase(event, ['review']);
    requireThat(!match.abandoned && match.precheck === 'passed', 'Only passed projects can be queued for judging.');
    const key = judgeKey(get(event.judges, data.judge, 'Judge'));
    const assigned = match.reviewers.filter((reviewer) => reviewer.startsWith('judge:') && !match.reviews['judge:' + reviewer]?.conflict);
    requireThat(!match.reviewers.includes(key) && assigned.length < 5, 'Choose an unassigned judge. Up to five active judges can review each project.');
    match.reviewers.push(key);
  } else if (action === 'tiebreak') {
    requirePhase(event, ['review']);
    const count = Number(data.votes);
    requireThat(Number.isInteger(count) && count >= 0 && count <= event.judges.length, 'Enter the number of judges who voted for the project.');
    match.scoreOverride = count;
  } else if (action === 'forward') {
    requirePhase(event, ['build']);
    const question = get(match.questions, data.question, 'Question');
    question.forwarded = value(data.text, 'Anonymous question', 700);
    question.shared = true;
  } else if (action === 'answer') {
    requirePhase(event, ['build']);
    const question = get(match.questions, data.question, 'Question');
    question.answer = value(data.answer, 'Answer to publish', 1000);
  } else {
    throw new RequestError('Unknown organizer action.', 404);
  }
}
function reviewKind(event, match, identity, kind) {
  const person = personFor(event, identity);
  const judge = judgeFor(event, identity);
  if (kind === 'judge' && judge && match.reviewers.includes(judgeKey(judge))) return judgeKey(judge);
  if (kind === 'peer' && person?.verified && match.reviewers.includes(userKey(person))) return userKey(person);
  if (kind === 'finder' && person && problemOwners(event, match.problem).some((author) => author.id === person.id)) return userKey(person);
  return null;
}
function certificateConsent(event, identity, data) {
  const person = personFor(event, identity);
  const recipient = person ?? judgeFor(event, identity);
  requireThat(recipient, 'A confirmed event entry is required.', 403);
  const record = person?.teammateEmail === identity ? person.invitation : recipient;
  record.certificateConsent = data.approved === true ? { at: now(), locale: localeOf(data.locale) } : null;
  if (!record.certificateConsent) {
    const teammate = record !== recipient;
    event.certificates = event.certificates.filter((cert) => cert.person !== recipient.id || cert.team !== teammate);
  }
  return { id: recipient.id };
}
export function performAction(event, identity, action, data, demo = false) {
  if (identity === '@organizer') return adminAction(event, action, data, demo);
  requireThat(!event.cleaned && !needsRetention(event), 'Participant data has reached the retention date.', 409);
  if (action === 'register') return register(event, identity, data, demo);
  if (action === 'certificate-consent') return certificateConsent(event, identity, data);
  if (action === 'team-invitation') return respondInvitation(event, identity, data, demo);
  if (action === 'drop-teammate') {
    requirePhase(event, ['registration', 'screening']);
    const lead = personFor(event, identity);
    requireThat(lead?.email === identity && lead.teammateEmail && !lead.verified, 'This invitation cannot be removed.', 409);
    lead.teammateEmail = '';
    lead.teammateName = '';
    lead.invitation = null;
    return { id: lead.id };
  }
  const person = personFor(event, identity);
  const match = get(event.matches, data.id, 'Project');
  requireThat(!match.abandoned, 'The assignment is inactive.', 409);
  if (action === 'review') {
    requirePhase(event, ['review']);
    requireThat(match.precheck === 'passed' && match.submission, 'This entry has not passed precheck.', 409);
    const kind = choose(data.kind, ['judge', 'peer', 'finder'], 'review type');
    const key = reviewKind(event, match, identity, kind);
    requireThat(key, 'This project is outside your review queue.', 403);
    const reviewKey = kind + ':' + key;
    const submissionRevision = match.submission.revision ?? 1;
    const previous = match.reviews[reviewKey];
    const version = previous?.version ?? 0;
    if ((data.submissionRevision !== undefined && Number(data.submissionRevision) !== submissionRevision) ||
      (data.expectedVersion !== undefined && Number(data.expectedVersion) !== version) ||
      (!demo && submissionRevision > 1 && data.submissionRevision === undefined) ||
      (!demo && version > 0 && data.expectedVersion === undefined)) {
      throw new RequestError('This review changed. Reload it before saving again.', 409, 'VERSION_CONFLICT');
    }
    match.reviews[reviewKey] = { ...score(event, kind, data, key), submissionRevision, rubricRevision: 1, version: version + 1 };
    return { id: match.id, revision: submissionRevision, version: version + 1, reviewKey };
  }
  if (action === 'suggest-answer') {
    requirePhase(event, ['build']);
    requireThat(person && problemOwners(event, match.problem).some((owner) => owner.id === person.id), 'This question is outside your workspace.', 403);
    const question = get(match.questions, data.question, 'Question');
    requireThat(question.shared, 'This question has not been shared.', 403);
    question.suggested = value(data.answer, 'Suggested answer', 1000);
    return;
  }
  requirePhase(event, action === 'submit' && match.reopened ? ['build', 'review'] : ['build']);
  requireThat(person && person.id === match.builder && person.verified, 'This project is outside your workspace.', 403);
  if (action === 'plan') {
    match.plan = value(data.plan, 'Build plan', 1000);
  } else if (action === 'prototype') {
    match.prototype = link(data.prototype, 'Prototype');
  } else if (action === 'submit') {
    const video = link(data.video, 'Demo video');
    requireThat(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'].includes(new URL(video).hostname), 'Use a YouTube link for the demo video.');
    requireThat(data.anonymous === true, 'Confirm that the public website and video preserve anonymity and use safe demo data.');
    const revision = match.submission ? (match.submission.revision ?? 1) + 1 : 1;
    if (match.submission) {
      match.submissionHistory ??= [];
      match.submissionHistory.push({ submission: match.submission, reviews: match.reviews, correction: match.reopened ?? null });
    }
    match.submission = { website: link(data.website, 'Website'), repo: link(data.repo, 'Repository'), video,
      disclosure: value(data.disclosure, 'Tools and licences', 1800), at: now(), revision };
    match.reviews = {};
    match.scoreOverride = 0;
    match.reopened = null;
    match.precheck = 'pending';
    return { id: match.id, revision };
  } else if (action === 'question') {
    requireThat(match.questions.length < 3, 'You have used all three organizer questions.');
    match.questions.push({ id: uid('Q'), text: value(data.text, 'Question', 700), suggested: '', answer: '', shared: false });
  } else {
    throw new RequestError('Unknown action.', 404);
  }
}
function anonymousProject(event, match) {
  const problem = lookup(event.problems, match.problem);
  return { id: match.id, problem: { id: problem.id, ...problem.brief, translations: problem.translations ?? {} } };
}
export function workspace(event, identity, demo) {
  const state = { demo, settings: publicStatus(event) };
  if (identity === '@organizer') {
    const preview = {};
    if (event.settings.phase === 'review') {
      const draft = structuredClone(event);
      try { publish(draft); preview.top = draft.published.top; }
      catch (error) { if (!(error instanceof RequestError)) throw error; preview.blocker = error.message; }
    }
    return {
    ...state, role: 'organizer', settings: event.settings, people: event.people, problems: event.problems, matches: event.matches,
    judges: event.judges, certificates: event.certificates, standings: standings(event), published: event.published, rubricLocked: event.rubricLocked,
    preview, resultCorrection: event.resultCorrection,
    };
  }
  const person = personFor(event, identity);
  const invitation = reservedFor(event, identity);
  const judge = judgeFor(event, identity);
  const phase = event.settings.phase;
  const briefVisible = ['build', 'review', 'results'].includes(phase);
  const active = event.matches.filter((match) => !match.abandoned);
  const own = briefVisible && person ? active.find((match) => match.builder === person.id) : null;
  const assigned = ['review', 'results'].includes(phase) ? active
    .filter((match) => match.precheck === 'passed' && match.submission)
    .flatMap((match) => ['finder', 'peer', 'judge'].flatMap((kind) => {
      const reviewer = reviewKind(event, match, identity, kind);
      if (!reviewer) return [];
      const { website, video } = match.submission;
      return [{ ...anonymousProject(event, match), kind, website, video, submissionRevision: match.submission.revision ?? 1,
        saved: match.reviews[kind + ':' + reviewer] ?? null }];
    })) : [];
  const inbox = phase === 'build' && person ? active.filter((match) => problemOwners(event, match.problem).some((owner) => owner.id === person.id))
    .flatMap((match) => match.questions.filter((question) => question.shared).map((question) => ({
      id: match.id, problem: lookup(event.problems, match.problem).brief.title, question: { id: question.id, text: question.forwarded, suggested: question.suggested },
    }))) : [];
  return {
    ...state, role: judge ? 'judge' : (person?.role ?? 'new'), email: identity,
    name: judge?.name ?? (person ? (identity === person.teammateEmail ? person.teammateName : person.name) : ''),
    verified: person?.verified ?? false,
    invitation: invitation ? { id: invitation.id, lead: invitation.name, expires: invitation.invitation?.expires ?? null } : null,
    teamStatus: person ? invitationState(person) : '',
    isLead: person?.email === identity,
    certificateConsent: Boolean(person?.teammateEmail === identity ? person.invitation?.certificateConsent : (person ?? judge)?.certificateConsent),
    problems: person ? event.problems.filter((problem) => problem.owner === person.id).map(({ id, status, brief }) => ({ id, status, brief })) : [],
    assignment: own ? { ...anonymousProject(event, own), plan: own.plan, prototype: own.prototype, submission: own.submission,
      reopened: own.reopened ?? null, precheck: ['review', 'results'].includes(phase) ? own.precheck : '', feedback: phase === 'results' ?
        Object.values(own.reviews).filter((review) => review.kind === 'peer').map(({ notes }) => notes) : [],
      questions: own.questions.map(({ text, answer }) => ({ text, answer })) } : null,
    inbox, assigned, certificates: event.certificates.filter((cert) => cert.person === (judge?.id ?? person?.id) && cert.team === Boolean(person && identity === person.teammateEmail)),
  };
}

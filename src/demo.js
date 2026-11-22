import { newEvent, performAction } from './event.js';

export const demoRoles = {
  builder: 'avni@example.test',
  finder: 'mehul@example.test',
  evaluator: 'simran@example.test',
  judge: 'rhea@example.test',
  organizer: '@organizer',
  new: 'guest@example.test',
};

export function demonstration() {
  const event = newEvent();
  Object.assign(event.settings, { phase: 'registration', organizer: 'Swap Hack demo', updates: 'This workspace contains fictional entries for the hackathon walkthrough.' });
  const people = [
    ['avni', 'Avni Desai', 'builder', 'A quieter corner to study', 'Education', 'Students lose half an hour looking for a quiet study seat between lectures.', 'A student can find an available room and see its next free slot.'],
    ['mehul', 'Mehul Patel', 'finder', 'Market day without the guesswork', 'Agriculture', 'Small growers go to the market without knowing which produce buyers are looking for that morning.', 'A grower can see the day’s requests and filter by produce.'],
    ['simran', 'Simran Shah', 'evaluator', 'Repair shop handover notes', 'Local business', 'Workshop owners hand off repairs across shifts and lose track of which jobs are waiting on parts.', 'The next shift can see the job status and record a handover note.'],
    ['dev', 'Dev Patel', 'builder', 'Bus stops after dark', 'Public services', 'Students walking home after an evening class struggle to identify which nearby bus stops have lights.', 'A student can find a lit stop within walking distance.'],
    ['ira', 'Ira Bhatt', 'builder', 'A calendar for shared tools', 'Everyday life', 'People in a shared workshop reserve the same tools at overlapping times on paper.', 'A member can see availability and book an open slot.'],
  ];
  for (const [prefix, name, role, title, area, description, outcome] of people) {
    performAction(event, prefix + '@example.test', 'register', {
      role, name, title, area, description, outcome, language: 'English', affected: 'People who rely on the service each week',
      workaround: 'Ask in a group chat and wait for an answer.', experience: 'mine', adult: true, privateSafe: true,
      consent: Array(6).fill(true), publicName: prefix === 'avni', location: 'Nadiad, Kheda',
      occupation: role === 'finder' ? 'business' : 'student', college: 'Sample College', course: 'BCA', year: '2',
    }, true);
  }
  const admin = (action, data) => performAction(event, '@organizer', action, data, true);
  for (const person of event.people) admin('verify-person', { id: person.id, verified: true, note: 'Demo eligibility check complete.' });
  for (const problem of event.problems) admin('screen-problem', { ...problem.brief, id: problem.id, status: 'accepted', screened: true });
  for (const [name, email] of [['Rhea Trivedi', 'rhea'], ['Aman Dave', 'aman'], ['Nisha Vyas', 'nisha']]) admin('judge', { name, email: email + '@example.test' });
  event.settings.phase = 'screening';
  const assign = (builder, problem) => admin('assign', { person: event.people[builder].id, problem: event.problems[problem].id });
  assign(0, 1);
  assign(3, 2);
  assign(4, 0);
  event.settings.phase = 'build';
  for (const match of event.matches) {
    const owner = event.people.find((person) => person.id === match.builder);
    match.plan = 'Interview the organizer about the current workflow. Build a mobile-first list and put it in front of one tester.';
    performAction(event, owner.email, 'submit', {
      id: match.id, website: 'https://example.test', video: 'https://youtu.be/sample-demo', repo: 'https://example.test',
      disclosure: 'Fictional sample submission. The walkthrough includes an interactive project preview.', anonymous: true,
    }, true);
  }
  event.settings.phase = 'review';
  event.rubricLocked = true;
  for (const match of event.matches) admin('precheck', { id: match.id, state: 'passed', note: 'Sample project passes precheck.' });
  admin('panels', {});
  const lead = event.matches[0];
  for (let index = 0; index < event.judges.length; index++) {
    const judge = event.judges[index];
    if (judge.email === demoRoles.judge) continue;
    performAction(event, judge.email, 'review', { id: lead.id, kind: 'judge', ratings: [4, 4, 4, 3, 4],
      comments: [], declaration: true }, true);
  }
  return event;
}

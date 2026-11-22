import { api, button, dateLabel, el, esc, field, form, installValidation, notice, phases, roleOptions, roles, serialize, tag } from './ui.js';
import { appPath, installLanguageSwitcher, locale, localized, t, updateLinks } from './locale.js';

const route = el('#route');
const landing = el('#landing');
const path = appPath(location.pathname).replace(/\/$/, '') || '/';
const query = new URLSearchParams(location.search);
let role = ['builder', 'finder', 'evaluator'].includes(query.get('role')) ? query.get('role') : 'builder';
let eventStatus = null;
let statusFailed = false;
let verification;
let workspaceOpen = false;
const nav = el('#main-nav');
const menu = el('.menu-toggle');
menu.addEventListener('click', () => menu.setAttribute('aria-expanded', String(nav.classList.toggle('open'))));
nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    nav.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
  }
});

function shell(title, lead, body, label = 'SWAP HACK') {
  document.title = t(title) + ' | Swap Hack';
  route.innerHTML = `<div class="narrow"><p class="eyebrow">${esc(t(label))}</p><h1>${esc(t(title))}</h1><p class="lede">${esc(t(lead))}</p>${body}</div>`;
  updateLinks(route);
}
async function openDemo(role, start = '') {
  await api('demo', { role, start });
  location.href = localized('/workspace?demo=1');
}
function demo() {
  const cards = [
    ['builder', 'Open your anonymous brief, check milestones and see the final submission.'],
    ['finder', 'Try the sample project and rate how well it solves your problem.'],
    ['judge', 'Open the queue and score an anonymous entry.'],
    ['organizer', 'Inspect the entries, phase controls, assignments and standings.'],
    ['evaluator', 'Give feedback on assigned solutions with the peer rubric.'],
    ['new', 'Try the full registration form using fictional details.'],
  ];
  shell('Take it for a spin.', 'Choose a role to explore the same fictional event. You can switch roles and see how your changes carry across the workspace.', `
    <div class="demo-grid">${cards.map(([key, desc]) => `<form class="panel demo-option" data-demo="${key}"><h3>${t(roles[key])}</h3><p>${t(desc)}</p><div class="actions">${button(key === 'new' ? 'Try registration' : 'Open role')}</div><p class="notice" role="status"></p></form>`).join('')}</div>`, 'INTERACTIVE DEMO');
  for (const form of route.querySelectorAll('[data-demo]')) form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelector('button').disabled = true;
    try { await openDemo(form.dataset.demo, form.dataset.demo === 'new' ? 'registration' : ''); }
    catch (error) { notice(form, error.message, true); form.querySelector('button').disabled = false; }
  });
}
function signIn() {
  if (query.has('local-organizer')) {
    shell('Organizer access', 'Enter the key configured for this deployment.', '<div class="panel">' +
      form('admin-login', field('key', 'Organizer key', 'password', '', { max: 500, attributes: 'autocomplete="current-password"' }), 'Open organizer workspace') + '</div>');
    bindSignIn();
    return;
  }
  shell('Event workspace', 'Sign in with the email you used to enter or the one your organizer invited.', `
    <div class="panel">
      ${form('email-request', field('email', 'Email address', 'email', '', { max: 254, attributes: 'autocomplete="email"' }), 'Send sign-in code')}
      <div id="code-step" hidden></div>
    </div>
    <div class="actions spaced"><a class="text-link" href="/demo">${t('Explore the demo')}</a></div>`);
  bindSignIn();
}
function bindSignIn() {
  const request = el('[data-action=email-request]', route);
  const admin = el('[data-action=admin-login]', route);
  if (admin) onSubmit(admin, async (data) => {
    await api('admin/sign-in', data);
    location.href = localized('/workspace');
  });
  if (!request) return;
  function showCode(focus = true) {
    const codeStep = el('#code-step', route);
    request.hidden = true;
    codeStep.hidden = false;
    codeStep.classList.add('spaced');
    codeStep.innerHTML = form('email-confirm', field('code', 'Eight-digit code', 'text', '', {
      max: 8, attributes: 'inputmode="numeric" pattern="[0-9]{8}" autocomplete="one-time-code"',
    }), 'Confirm and continue', { email: verification.email }) + `<div class="actions spaced">
      <button class="button button-outline" type="button" data-edit-email>${t('Edit email')}</button>
      <button class="button button-outline" type="button" data-resend>${t('Send a new code')}</button></div>`;
    const confirm = el('form', codeStep);
    notice(confirm, verification.code ? 'Local development code ' + verification.code : t('Code sent. Check your inbox.'));
    if (focus) el('input[name=code]', confirm).focus();
    const resend = el('[data-resend]', codeStep);
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((verification?.after - Date.now()) / 1000));
      resend.disabled = seconds > 0;
      resend.textContent = t(seconds ? 'Send a new code in {seconds} s' : 'Send a new code', { seconds });
      if (seconds > 0 && resend.isConnected) setTimeout(tick, 1000);
    };
    tick();
    el('[data-edit-email]', codeStep).onclick = () => {
      const email = verification.email;
      verification = null;
      codeStep.hidden = true;
      codeStep.replaceChildren();
      request.hidden = false;
      request.elements.email.value = email;
      request.elements.email.focus();
    };
    resend.onclick = async () => {
      resend.disabled = true;
      try { await send(verification.email); }
      catch (error) { notice(confirm, error.message, true); resend.disabled = false; }
    };
    onSubmit(confirm, async (payload) => {
      await api('sign-in/confirm', payload);
      location.href = localized(path === '/join' ? '/workspace?role=' + encodeURIComponent(role) : '/workspace');
    });
  }
  async function send(email) {
    const response = await api('sign-in/request', { email });
    verification = { email, code: response.code, after: Date.now() + 60000 };
    showCode();
  }
  onSubmit(request, (data) => send(data.email));
  if (verification) showCode(false);
}
function join() {
  const open = eventStatus?.phase === 'registration';
  const localizedPolicy = locale === 'en' || eventStatus?.policyBundles?.[locale];
  shell('Join the swap.', 'Bring a real problem from your corner of Gujarat. Choose how you want to take part.', `
    <div class="panel">
      <div class="meta">${tag(statusFailed ? 'Registration status unavailable' : (phases[eventStatus?.phase] ?? 'Checking event status…'))}${eventStatus?.start ? `<span>${dateLabel(eventStatus.start)}</span>` : ''}</div>
      ${roleOptions(role)}
      <p class="spaced"><a href="/films/${locale}.html#write-a-brief" class="text-link">${t('Watch: Write a useful problem brief')}</a></p>
      ${open && localizedPolicy ? form('email-request', field('email', 'Email address', 'email', '', { max: 254, attributes: 'autocomplete="email"' }), 'Send verification code') + '<div id="code-step" hidden></div>' : `
        <p class="spaced" role="status">${t(statusFailed ? 'We could not check whether registration is open. Try again.' : (open ?
          'This language is waiting for reviewed event policies.' : (eventStatus ? 'Live registration is currently closed. Use the demo to try the same form with sample details.' : 'Checking event status…')))}</p>
        ${statusFailed ? `<button type="button" class="button button-outline spaced" data-retry>${t('Try again')}</button>` : ''}
        <form class="form" data-demo-join><div class="actions">${button('Try registration')}</div><p class="notice" role="status"></p></form>
      `}
    </div><p class="spaced"><a class="text-link" href="/workspace">${t('Already entered? Open your workspace')}</a></p>`, 'REGISTRATION');
  el('[data-retry]', route)?.addEventListener('click', async () => {
    statusFailed = false;
    join();
    await refreshStatus();
    join();
  });
  for (const input of route.querySelectorAll('[name=role]')) input.addEventListener('change', () => { role = input.value; });
  const demoForm = el('[data-demo-join]', route);
  if (demoForm) onSubmit(demoForm, async () => {
    await api('demo', { role: 'new', start: 'registration' });
    location.href = localized('/workspace?demo=1&role=' + encodeURIComponent(role));
  });
  bindSignIn();
}
function onSubmit(formElement, callback) {
  formElement.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = formElement.querySelector('button');
    button.disabled = true;
    notice(formElement, '');
    try { await callback(serialize(formElement)); }
    catch (error) { notice(formElement, error.message, true); }
    finally { button.disabled = false; }
  });
}
function verify() {
  const id = query.get('id')?.toUpperCase() || '';
  shell('Verify a certificate.', 'Enter the ID printed on a Swap Hack certificate to check who earned it and what they completed.', `
    <div class="panel">${form('verify', field('id', 'Certificate ID', 'text', id, { max: 40, attributes: 'placeholder="SWAP-…" autocapitalize="characters" autocomplete="off"' }), 'Verify certificate')}
    <div class="actions"><a class="text-link" href="/verify?id=DEMO-SWAP-26">${t('Try a sample certificate')}</a></div></div>
    <div id="certificate-result"></div>`, 'CERTIFICATE CHECK');
  const formElement = el('form', route);
  const output = el('#certificate-result', route);
  async function checkCertificate(data) {
    output.replaceChildren();
    const value = data.id.trim().toUpperCase();
    const result = await api('certificates/' + encodeURIComponent(value));
    history.replaceState({}, '', localized('/verify?id=' + encodeURIComponent(value) + (query.has('demo') ? '&demo=1' : '')));
    output.innerHTML = `<article class="panel certificate" role="status">
      ${tag(result.demo ? 'Sample certificate' : 'Verified certificate')}
      <h2 dir="auto">${esc(result.name)}</h2><p>${esc(t(result.kind))}${result.date ? ' · ' + dateLabel(result.date) : ''}</p>
      <p class="mono">${esc(result.id)}</p><button type="button" class="button button-outline spaced" data-print>${t('Print certificate')}</button></article>`;
    el('[data-print]', output).onclick = () => window.print();
  }
  onSubmit(formElement, checkCertificate);
  if (id) formElement.requestSubmit();
}
function legal(name) {
  const privacy = name === 'privacy';
  const policy = locale === 'en' ? eventStatus : eventStatus?.policyBundles?.[locale];
  const text = policy?.[name];
  const fallback = privacy
    ? 'Registration collects an email address, name, town and role, plus college details for students. Phone is optional. Organizers use these details to run the event. Builders and reviewers see anonymous briefs. The demo uses fictional sample data. Use fictional details while trying its forms.'
    : 'Swap Hack is open to adults aged 18 and older. Builders and wildcard evaluators must be current students. Each builder may enter once, solo or with one teammate. Creators keep ownership of their own work. Live registration requires the organizer’s published terms.';
  shell(privacy ? 'Privacy notice' : 'Event terms', text ? (eventStatus?.organizer ?? '') : '', `
    <article class="panel"><p class="brief-copy">${esc(text || (locale === 'en' ? fallback : t('This language is waiting for reviewed event policies.')))}</p>
      ${privacy && eventStatus?.contact ? `<p><a href="mailto:${esc(eventStatus.contact)}">${esc(eventStatus.contact)}</a>.</p>` : ''}
    </article>`);
}
async function results() {
  const data = await api(query.has('demo') ? 'results?demo=1' : 'results');
  shell('The results.', 'The top projects and their anonymous matches are revealed at the finale with participants’ permission.', data ? `
    ${data.demo ? '<p class="notice">Demo results from your fictional event.</p>' : ''}
    ${data.correction ? `<p class="notice brief-copy">${esc(data.correction)}</p>` : ''}
    <ol class="result-list">${data.top.map((entry) => `<li class="panel"><div class="meta">${tag(t('Place {rank}', entry))}${tag(entry.score + ' / 100')}</div>
      <h2>${esc(entry.title)}</h2>${entry.judge != null ? `<p>${t('Judge {score} / 50', { score: entry.judge })} · ${entry.finder == null ? t('Judge-only calculation') : t('Author {score} / 50', { score: entry.finder })}</p>` : ''}
      ${entry.builder || entry.teammate ? `<p>${esc(t('Built by {name}', { name: [entry.builder, entry.teammate].filter(Boolean).join(', ') }))}</p>` : ''}
      ${entry.authors.length ? `<p>${esc(t('Brief by {name}', { name: entry.authors.join(', ') }))}</p>` : ''}</li>`).join('')}</ol>
    ${data.bestProblem ? `<article class="panel panel-tint"><div class="meta">${tag('Best problem')}</div><h2>${esc(data.bestProblem.title)}</h2>
      ${data.bestProblem.authors.length ? `<p>Brief by ${esc(data.bestProblem.authors.join(', '))}</p>` : ''}</article>` : ''}` : `
    <div class="panel"><h2>Results are pending</h2><p>Check back after the finale. You can see the scoring workflow from the organizer view in the demo.</p><div class="actions"><a class="button button-ink" href="/demo">Try the demo</a></div></div>`, 'THE FINALE');
}
async function start() {
  if (path === '/demo') { demo(); return; }
  if (path === '/verify') { verify(); return; }
  if (path === '/workspace') {
    if (query.has('local-organizer')) { signIn(); return; }
    try {
      const { renderWorkspace } = await import('./workspace.js');
      await renderWorkspace(route, role);
      workspaceOpen = true;
    } catch (error) {
      if (error.status !== 401) throw error;
      signIn();
    }
    return;
  }
  if (['/', '/join', '/terms', '/privacy'].includes(path)) {
    if (path === '/join' && !eventStatus) join();
    await refreshStatus();
    if (path === '/') {
      paintHome();
      return;
    }
    if (path === '/join') join();
    else legal(path.slice(1));
    return;
  }
  if (path === '/results') { await results(); return; }
  shell('Page unavailable.', 'The requested page could not be found.', '<a class="button button-ink" href="/">Back to Swap Hack</a>');
}
async function refreshStatus() {
  try { eventStatus = await api('status'); statusFailed = false; }
  catch { statusFailed = true; }
}
function paintHome() {
  const active = ['screening', 'build', 'review', 'results'].includes(eventStatus?.phase);
  const action = el('#hero-action');
  action.href = localized(active ? '/workspace' : '/join');
  action.textContent = t(active ? 'Open my workspace' : 'Join the swap');
  el('#hero-phase').textContent = t(statusFailed ? 'Registration status unavailable' : (phases[eventStatus?.phase] ?? 'Checking event status…'));
  el('#home-film').href = '/films/' + locale + '.html#the-swap';
  const facts = [eventStatus?.start && dateLabel(eventStatus.start), eventStatus?.finale && dateLabel(eventStatus.finale), eventStatus?.venue].filter(Boolean);
  if (facts.length) el('#date-note').textContent = facts.join(' · ');
  if (eventStatus?.updates && !el('#event-update')) {
    const update = document.createElement('p');
    update.id = 'event-update';
    update.className = 'notice';
    update.textContent = eventStatus.updates;
    el('#date-note').after(update);
  }
}
if (path !== '/') {
  landing.hidden = true;
  route.hidden = false;
  route.innerHTML = `<p class="lede" role="status">${t('Loading…')}</p>`;
}
function tryStart() {
  return start().catch((error) => shell('Try again shortly.', 'The event service could not load this page.', `<div class="notice error">${esc(error.message)}</div><p class="spaced"><a class="text-link" href="/">Back to Swap Hack</a></p>`));
}
installLanguageSwitcher(() => {
  if (workspaceOpen) route.dispatchEvent(new Event('swap-locale'));
  else if (path === '/') paintHome();
  else if (path === '/join') join();
  else if (path === '/verify') verify();
  else if (path === '/workspace') signIn();
  else void tryStart();
});
installValidation(route);
void tryStart();

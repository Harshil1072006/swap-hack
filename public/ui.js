import { locale, localized, localeTag, t } from './locale.js';

export const roles = { builder: 'Builder', finder: 'Pain finder', evaluator: 'Wildcard evaluator', judge: 'Judge', organizer: 'Organizer', new: 'New participant' };
export const phases = { draft: 'Dates to be announced', registration: 'Registration open', screening: 'Screening and matching', build: 'Build week', review: 'Testing and judging', results: 'Results announced', cancelled: 'Event cancelled', closed: 'Event closed' };
export const rolesCopy = { builder: 'Build for someone else’s brief', finder: 'Share a real problem', evaluator: 'Share and review solutions' };
export const areas = ['Agriculture', 'Education', 'Health', 'Trade and exports', 'Local business', 'Finance', 'Public services', 'Everyday life', 'Other'];
export const languages = ['English', 'Gujarati', 'Hindi'];
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => entities[char]);
export const el = (selector, parent = document) => parent.querySelector(selector);
export async function api(path, data) {
  const headers = {};
  if (new URLSearchParams(location.search).get('demo') === '1') headers['X-Swap-Context'] = 'demo';
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch('/api/' + path, data === undefined ? { headers } : {
      method: 'POST', headers, body: JSON.stringify({ ...data, locale }),
    });
  } catch {
    throw Object.assign(new Error(t('The event service is temporarily unavailable. Please try again.')), { code: 'NETWORK' });
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(t(result?.error || 'Something went wrong. Try again.'));
    error.status = response.status;
    error.code = result?.code;
    error.field = result?.field;
    throw error;
  }
  return result;
}
export function dateLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return '';
  return new Intl.DateTimeFormat(localeTag(), { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(date + 'T00:00:00+05:30'));
}
export const button = (text, kind = 'ink') => `<button type="submit" class="button button-${kind}">${esc(t(text))}</button>`;
export const field = (name, label, type = 'text', current = '', { optional = false, max = 240, help = '', attributes = '' } = {}) =>
  `<label class="field">${esc(t(label))}${help ? `<small>${esc(t(help))}</small>` : ''}<input type="${type}" name="${name}" value="${esc(current)}" ${optional ? '' : 'required'} maxlength="${max}" ${attributes}></label>`;
export const textarea = (name, label, current = '', { optional = false, max = 1000, help = '' } = {}) =>
  `<label class="field">${esc(t(label))}${help ? `<small>${esc(t(help))}</small>` : ''}<textarea name="${name}" maxlength="${max}" ${optional ? '' : 'required'}>${esc(current)}</textarea></label>`;
export const choose = (name, label, choices, current = '', { optional = false } = {}) =>
  `<label class="field">${esc(t(label))}<select name="${name}" ${optional ? '' : 'required'}><option value="">${esc(t('Choose'))}</option>${choices.map((choice) => {
    const [id, title] = Array.isArray(choice) ? choice : [choice, choice];
    return `<option value="${esc(id)}" ${String(id) === String(current) ? 'selected' : ''}>${esc(t(title))}</option>`;
  }).join('')}</select></label>`;
export const check = (name, content, { required = false, checked = false } = {}) =>
  `<label class="check"><input type="checkbox" name="${name}" ${required ? 'required' : ''} ${checked ? 'checked' : ''}><span>${esc(t(content))}</span></label>`;
export const tag = (text) => `<span class="tag">${esc(t(text))}</span>`;
export function form(action, content, text, fields = {}) {
  return `<form class="form" data-action="${action}">${Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${name}" value="${esc(value)}">`).join('')}${content}
    <div class="actions">${button(text)}</div><p class="notice" role="status"></p></form>`;
}
export function notice(parent, text, error = false) {
  if (!parent) return;
  const feedback = el('.notice', parent);
  if (!feedback) return;
  feedback.textContent = text;
  feedback.classList.toggle('error', error);
  feedback.setAttribute('role', error ? 'alert' : 'status');
}
const validationId = 'swap-field-error';
export function installValidation(root) {
  root.addEventListener('invalid', (event) => {
    const input = event.target;
    const form = input.form;
    if (!form) return;
    event.preventDefault();
    const first = [...form.elements].find((field) => field.willValidate && !field.validity.valid);
    if (first !== input) return;
    const old = document.getElementById(validationId);
    old?.remove();
    const label = input.closest('label');
    const copy = t(input.validity.valueMissing ? 'Complete this field before continuing.' :
      (input.validity.typeMismatch ? 'Use the format shown for this field.' : 'Check the value in this field.'));
    if (label) {
      const help = document.createElement('span');
      help.id = validationId;
      help.className = 'field-error';
      help.textContent = copy;
      label.append(help);
      input.setAttribute('aria-describedby', validationId);
    }
    notice(form, copy, true);
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }, true);
  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.validity?.valid || !input.hasAttribute('aria-invalid')) return;
    input.removeAttribute('aria-invalid');
    if (input.getAttribute('aria-describedby') === validationId) input.removeAttribute('aria-describedby');
    document.getElementById(validationId)?.remove();
  });
}
export function serialize(formElement) {
  const data = Object.fromEntries(new FormData(formElement));
  for (const box of formElement.querySelectorAll('input[type=checkbox]')) data[box.name] = box.checked;
  if (formElement.dataset.action === 'register') data.consent = Array.from({ length: 6 }, (_, i) => data['consent' + i]);
  if (formElement.dataset.action === 'review') {
    data.ratings = [...formElement.querySelectorAll('[name^=rating]')].map((input) => Number(input.value));
    data.comments = [...formElement.querySelectorAll('[name^=comment]')].map((input) => input.value);
  }
  return data;
}
export function external(url, text) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer" class="text-link">${esc(t(text))}</a>`;
  } catch { /* Ignore malformed links. */ }
  return '';
}
export const row = (label, text, language) => `<dt>${esc(t(label))}</dt><dd class="brief-copy"${language && text ? ' lang="' + esc(language) + '"' : ''}>${esc(text || t('Pending'))}</dd>`;
export function briefFields(brief = {}) {
  return `${field('title', 'Problem title', 'text', brief.title, { max: 100, help: 'Use at most 10 words.' })}
    <div class="grid-2">${choose('area', 'Problem area', areas, brief.area)}${choose('language', 'Language', languages, brief.language ?? ({ en: 'English', hi: 'Hindi', gu: 'Gujarati' })[locale])}</div>
    ${textarea('description', 'What goes wrong, and how often?', brief.description, { max: 1300, help: 'Describe a real situation in about 100 words.' })}
    ${field('affected', 'Who is affected?', 'text', brief.affected, { max: 220 })}
    ${textarea('outcome', 'What would a working solution let someone do?', brief.outcome, { max: 750, help: 'Describe one result someone can test.' })}
    ${textarea('workaround', 'How do people handle it today?', brief.workaround, { max: 650 })}`;
}
export function roleOptions(selected, onlyFinder = false) {
  return `<fieldset><legend>${t('Choose your role')}</legend><div class="role-select">${Object.keys(rolesCopy).filter((role) => !onlyFinder || role === 'finder').map((role) =>
    `<label class="role-option"><input type="radio" name="role" value="${role}" ${selected === role ? 'checked' : ''}><span><strong>${t(roles[role])}</strong><small>${t(rolesCopy[role])}</small></span></label>`).join('')}</div></fieldset>`;
}
export const policyLinks = () => `<p>${t('Open these policies before confirming.')} <a href="${localized('/terms')}" target="_blank" rel="noopener">${t('Event terms')}</a> · <a href="${localized('/privacy')}" target="_blank" rel="noopener">${t('Privacy notice')}</a></p>`;
const occupations = [['student', 'Current college student'], ['employed', 'Employed'], ['business', 'Business owner'], ['farming', 'Farmer or self-employed'], ['teacher', 'Teacher or faculty'], ['other', 'Other']];
export function registrationForm(state, selected) {
  const finder = state.role === 'finder';
  if (finder) selected = 'finder';
  const finderStudent = selected === 'finder' && !finder;
  const student = selected !== 'finder' && !finder;
  if (!state.demo && locale !== 'en' && !state.settings.policyBundles?.[locale]) return `<p>${t('This language is waiting for reviewed event policies.')}</p>`;
  const statements = state.settings.acknowledgements[locale];
  return form('register', `
    <ol class="registration-track" aria-label="${t('Registration steps')}">
      <li>${t('Your details')}</li><li>${t('Your problem brief')}</li><li>${t('Consent')}</li>
    </ol>
    <section class="registration-stage" data-registration-stage="0">
    <p>${t(state.demo ? 'Demo email' : 'Verified email')} <strong>${esc(state.email)}</strong></p>
    ${finder ? '<input type="hidden" name="role" value="finder">' : roleOptions(selected)}
    ${check('adult', 'I am 18 or older.', { required: true })}
    ${finder ? '' : `
      <div class="grid-2">${field('name', 'Full name', 'text', '', { max: 100, attributes: 'autocomplete="name"' })}${field('location', 'Town or village and district', 'text', '', { max: 130 })}</div>
      <div class="grid-2">${field('phone', 'Phone or WhatsApp (optional)', 'tel', '', { optional: true, max: 35 })}${finderStudent ? choose('occupation', 'I am a…', occupations, 'other') : '<input type="hidden" name="occupation" value="student">'}</div>
      <fieldset class="grid-3" id="student-fields" ${student ? '' : 'hidden disabled'}>
        ${field('college', 'College', 'text', '', { max: 140 })}${field('course', 'Course and branch', 'text', '', { max: 130 })}${choose('year', 'Year', ['1', '2', '3', '4', '5', 'Diploma'])}
      </fieldset>
      ${selected === 'builder' ? `${choose('team', 'Team size', [['solo', 'Solo'], ['pair', 'Two people']], 'solo')}
        <fieldset id="team-fields" hidden disabled><div class="grid-2">${field('teammateName', 'Teammate name', 'text', '', { max: 100 })}${field('teammateEmail', 'Teammate email', 'email', '', { max: 254 })}</div>
        <p class="spaced">${t('Your teammate will confirm their own eligibility and consent after signing in.')}</p></fieldset>` : ''}
    `}
    </section>
    <section class="registration-stage" data-registration-stage="1" hidden>
    <h3>${t('Your problem brief')}</h3><a class="text-link" href="/films/${locale}.html#write-a-brief" target="_blank" rel="noopener">${t('Watch: Write a useful problem brief')}</a>
    ${briefFields()}
    ${choose('experience', 'Has this happened to you or someone you know?', [['mine', 'Yes, to me'], ['known', 'Yes, to someone I know'], ['no', 'No']])}
    ${check('privateSafe', 'My brief contains no personal, financial or confidential information.', { required: true })}
    </section>
    <section class="registration-stage" data-registration-stage="2" hidden>
    <fieldset class="checks"><legend>${t('Required acknowledgements')}</legend>${policyLinks()}${statements.map((text, i) => check('consent' + i, text, { required: true })).join('')}</fieldset>
    ${finder ? '' : `<fieldset class="checks"><legend>${t('Optional permissions')}</legend>
      ${check('internship', 'Contact me about possible internships.')}${check('future', 'Contact me about future events.')}${check('publicName', 'Credit me by name in the public results.')}</fieldset>`}
    </section>
    <div class="registration-controls actions">
      <button type="button" class="button button-outline" data-registration-back hidden>${t('Back')}</button>
      <button type="button" class="button button-ink" data-registration-next>${t('Continue')}</button>
    </div>
  `, 'Submit problem', { policyRevision: state.settings.policyRevision });
}

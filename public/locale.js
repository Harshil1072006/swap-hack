import { translations } from './catalog.js';
import { workspaceCopy } from './workspace-copy.js';

export const supportedLocales = ['en', 'hi', 'gu'];
const dictionary = new Map([...translations, ...workspaceCopy].map(([source, hi, gu]) => [source, { hi, gu }]));
const urlLocale = () => location.pathname.match(/^\/(en|hi|gu)(?=\/|$)/)?.[1];
const selectLocale = () => {
  let saved;
  try { saved = localStorage.getItem('swap-locale'); } catch { /* Storage can be blocked on shared devices. */ }
  const requested = (navigator.languages ?? []).map((item) => item.split('-')[0]).find((item) => supportedLocales.includes(item));
  return urlLocale() || (supportedLocales.includes(saved) ? saved : requested) || 'en';
};
export let locale = typeof window === 'undefined' ? 'en' : selectLocale();
export function t(source, data = {}, language = locale) {
  const text = dictionary.get(source)?.[language] ?? source;
  return typeof text === 'string' ? text.replace(/\{(\w+)\}/g, (token, key) => data[key] ?? token) : text;
}
export const appPath = (path) => path.replace(/^\/(en|hi|gu)(?=\/|$)/, '') || '/';
export function localized(path, language = locale) {
  const bare = appPath(path);
  return /^\/(media|assets|films|api)\//.test(bare) ? bare : '/' + language + (bare.startsWith('/') ? bare : '/' + bare);
}
export const localeTag = () => locale + '-IN';
export const briefLocale = (language) => ({ English: 'en', Hindi: 'hi', Gujarati: 'gu' })[language] ?? 'en';
export function updateLinks(root) {
  for (const link of root.querySelectorAll('a[href^="/"]')) {
    const href = link.getAttribute('href');
    if (!href.startsWith('//')) link.setAttribute('href', localized(href));
  }
}
export function installLanguageSwitcher(change) {
  const controls = document.querySelector('.locale-control');
  const shell = [...document.querySelectorAll('.site-header,.site-footer,#landing,.skip')];
  const original = new Map();
  const initial = document.documentElement.lang;
  const sourceText = new Map([...dictionary].map(([source, copy]) => [copy[initial] ?? source, source]));
  for (const root of shell) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('.locale-control')) continue;
      const source = node.textContent.replace(/\s+/g, ' ').trim();
      if (dictionary.has(source) || sourceText.has(source)) original.set(node, sourceText.get(source) ?? source);
    }
  }
  function paint() {
    document.documentElement.lang = locale;
    for (const [node, source] of original) node.textContent = t(source);
    for (const button of controls.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.value === locale));
    for (const root of shell) updateLinks(root);
  }
  paint();
  controls.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.value === locale) return;
    locale = button.value;
    try { localStorage.setItem('swap-locale', locale); } catch { /* The locale URL still persists. */ }
    history.pushState({}, '', localized(appPath(location.pathname)) + location.search + location.hash);
    paint();
    change();
  });
  window.addEventListener('popstate', () => {
    const next = selectLocale();
    if (next === locale) return;
    locale = next;
    paint();
    change();
  });
}

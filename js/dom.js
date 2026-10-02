import { CONFIG } from './config.js';
import { tr } from './i18n.js';

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function makeElement(tag, { className = '', text = null, attrs = {}, children = [] } = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null && text !== undefined) element.textContent = String(text);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (key === 'dataset') Object.entries(value).forEach(([name, data]) => { element.dataset[name] = String(data); });
    else element.setAttribute(key, String(value));
  });
  children.forEach(child => { if (child) element.append(child); });
  return element;
}

export function safeHttpUrl(value, allowedHosts = null) {
  try {
    const url = new URL(String(value), location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (Array.isArray(allowedHosts) && allowedHosts.length && !allowedHosts.includes(url.hostname.toLowerCase())) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function formatDate(value, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const options = withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' };
  try { return new Intl.DateTimeFormat(tr('locale'), options).format(date); } catch { return date.toISOString().slice(0, 10); }
}

export function formatCompactNumber(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  try { return new Intl.NumberFormat(tr('locale'), { notation: 'compact', maximumFractionDigits: 1 }).format(amount); } catch { return String(Math.round(amount)); }
}

export function cacheVersionedUrl(value, version = 1) {
  const clean = safeHttpUrl(value);
  if (!clean) return '';
  try {
    const url = new URL(clean);
    url.searchParams.set('v', String(version));
    return url.href;
  } catch {
    return '';
  }
}

export function setBusy(button, busy, labelKey = '') {
  if (!button) return;
  button.disabled = Boolean(busy);
  button.setAttribute('aria-busy', String(Boolean(busy)));
  const label = button.querySelector('[data-busy-label]') || button.querySelector('span');
  if (!label) return;
  if (busy) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = label.textContent;
    if (labelKey) label.textContent = tr(labelKey);
  } else if (button.dataset.idleLabel) {
    label.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
  }
}

export function initTheme() {
  let theme = '';
  try { theme = localStorage.getItem(CONFIG.storage.theme) || localStorage.getItem(CONFIG.storage.legacyTheme) || ''; } catch {}
  setTheme(theme || 'dark', false);
}

export function setTheme(theme, persist = true) {
  const value = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#000000' : '#f2f3f4');
  if (persist) {
    try { localStorage.setItem(CONFIG.storage.theme, value); } catch {}
  }
}

export function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

export function setupMobileMenu() {
  const button = $('#menuToggle');
  const nav = $('#primaryNav');
  if (!button || !nav) return;
  const close = () => {
    nav.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  });
  $$('.nav-link').forEach(link => link.addEventListener('click', close));
  window.addEventListener('resize', () => { if (window.innerWidth > 860) close(); }, { passive: true });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
}

export function setupHeader() {
  const topbar = $('#topbar');
  if (!topbar) return;
  const update = () => topbar.classList.toggle('is-scrolled', window.scrollY > 16);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

const SVG_ICON_NAMES = new Set([
  'comments','reaction-picker','star-full','star-half','star-empty','plus-one','minus-one','laugh','confused','heart','hooray','rocket','eyes'
]);

export function createSvgIcon(path, { className = '', label = '', width = 18, height = 18 } = {}) {
  const raw = String(path || '').split('/').pop()?.split('?')[0] || '';
  const name = raw.replace(/\.svg$/i, '').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  const safeName = SVG_ICON_NAMES.has(name) ? name : 'reaction-picker';
  const sizeClass = width === height ? `icon-size-${Number(width) || 18}` : '';
  return makeElement('span', {
    className: `svg-icon icon-${safeName} ${sizeClass} ${className}`.trim(),
    attrs: { role: label ? 'img' : 'presentation', 'aria-label': label || null, 'aria-hidden': label ? null : 'true' }
  });
}

export function renderUserIdentity(user, { compact = false, label = '' } = {}) {
  const login = String(user?.login || 'GitHub');
  const root = makeElement('div', { className: compact ? 'user-identity compact' : 'user-identity' });
  const avatar = makeElement('img', {
    className: compact ? 'user-avatar compact' : 'user-avatar',
    attrs: {
      src: cacheVersionedUrl(user?.avatar_url || './SVGs/ui/fallback.svg'),
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer'
    }
  });
  avatar.addEventListener('error', () => {
    if (avatar.dataset.fallbackApplied) return;
    avatar.dataset.fallbackApplied = '1';
    avatar.src = './SVGs/ui/fallback.svg?v=1';
  }, { once: true });
  const info = makeElement('span', { className: 'user-identity-text' });
  if (label) info.append(makeElement('span', { className: 'user-identity-label', text: label }));
  const line = makeElement('span', { className: 'user-identity-line' });
  const link = makeElement('a', { text: login, attrs: { href: safeHttpUrl(user?.html_url) || 'https://github.com', target: '_blank', rel: 'noreferrer noopener' } });
  line.append(link);
  if (login === 'MyNullSpire') line.append(makeElement('img', { className: 'verified-badge', attrs: { src: './SVGs/badges/verified.svg?v=1', alt: tr('verified'), width: 18, height: 18, title: tr('verified') } }));
  info.append(line);
  root.append(avatar, info);
  return root;
}

export function renderLabels(labels = [], className = '') {
  const root = makeElement('div', { className: `post-labels ${className}`.trim() });
  labels.filter(Boolean).slice(0, 12).forEach(label => root.append(makeElement('span', { text: String(label) })));
  return root;
}

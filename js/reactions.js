import { createSvgIcon } from './dom.js';
import { getReactionSummary } from './github.js';
import { tr } from './i18n.js';

function starKinds(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  const out = [];
  for (let i = 0; i < 5; i += 1) out.push(i < full ? 'full' : i === full && half ? 'half' : 'empty');
  return out;
}

function starIcon(kind, size = 16) {
  const map = { full: 'star-full.svg', half: 'star-half.svg', empty: 'star-empty.svg' };
  return createSvgIcon(`./SVGs/ui/${map[kind]}?v=1`, { className: 'rating-star', width: size, height: size });
}

export function renderRating(counts = {}, { compact = false, showLabel = false } = {}) {
  const summary = getReactionSummary(counts);
  const root = document.createElement('span');
  root.className = `card-rating${compact ? ' compact' : ''}`;
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', `${summary.stars} / 5`);
  starKinds(summary.stars).forEach(kind => root.append(starIcon(kind, compact ? 14 : 16)));
  if (showLabel) root.append(document.createElement('span')).textContent = `${summary.stars}/5`;
  return root;
}

const ACTIONS = [
  { key: '+1', labelKey: 'like', icon: 'plus-one.svg' },
  { key: '-1', labelKey: 'dislike', icon: 'minus-one.svg' }
];

export function renderReactionWidget(root, { counts = {}, selected = new Map(), busy = false, onSelect = null, compact = false } = {}) {
  root.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = `reaction-widget${compact ? ' compact' : ''}`;
  ACTIONS.forEach(action => {
    const count = Math.max(0, Number(counts?.[action.key] || 0));
    const active = selected.has(action.key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `reaction-action${active ? ' is-selected' : ''}`;
    button.disabled = Boolean(busy) || !onSelect;
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${tr(action.labelKey)}: ${count}`);
    button.title = `${tr(action.labelKey)} ${count}`;
    button.append(createSvgIcon(`./SVGs/reactions/${action.icon}?v=1`, { className: 'reaction-action-icon', width: compact ? 17 : 19, height: compact ? 17 : 19 }), Object.assign(document.createElement('b'), { textContent: String(count) }));
    if (onSelect) button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onSelect(action.key); });
    wrapper.append(button);
  });
  root.append(wrapper);
}

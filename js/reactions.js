import { makeElement, createSvgIcon } from './dom.js';
import { getReactionSummary, reactionTypes } from './github.js';
import { tr } from './i18n.js';

let openMenu = null;
const CLOSE_EVENT = 'nullspire-close-reaction-menus';

function closeMenu(menu = openMenu) {
  if (!menu) return;
  menu.classList.remove('is-open', 'opens-up', 'opens-start');
  const trigger = menu.querySelector('.reaction-trigger');
  const picker = menu.querySelector('.reaction-picker-grid');
  trigger?.setAttribute('aria-expanded', 'false');
  if (picker) picker.hidden = true;
  if (openMenu === menu) openMenu = null;
}

document.addEventListener(CLOSE_EVENT, () => closeMenu());
document.addEventListener('click', event => {
  if (openMenu && !event.target.closest('.reaction-menu')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu();
});

export function calculateReactionMenuPlacement(triggerRect, pickerRect, viewportWidth, viewportHeight, rtl = false, margin = 10, gap = 8) {
  const width = Math.min(Math.max(0, Number(pickerRect?.width) || 0), Math.max(0, viewportWidth - margin * 2));
  const height = Math.max(0, Number(pickerRect?.height) || 0);
  const defaultLeft = rtl ? triggerRect.left : triggerRect.right - width;
  const alternateLeft = rtl ? triggerRect.right - width : triggerRect.left;
  const fitsDefault = defaultLeft >= 0 && defaultLeft + width <= viewportWidth;
  const fitsAlternate = alternateLeft >= 0 && alternateLeft + width <= viewportWidth;
  const downSpace = Math.max(0, viewportHeight - margin - triggerRect.bottom - gap);
  const upSpace = Math.max(0, triggerRect.top - margin - gap);
  const opensUp = (triggerRect.bottom + gap + height > viewportHeight - margin && upSpace >= height) || (upSpace > downSpace && !fitsDefault);
  return {
    opensStart: !fitsDefault && fitsAlternate,
    opensUp,
    left: !fitsDefault && fitsAlternate ? alternateLeft : defaultLeft,
    width,
    height
  };
}

function openReactionMenu(menu, trigger) {
  if (openMenu && openMenu !== menu) closeMenu();
  const picker = menu.querySelector('.reaction-picker-grid');
  if (!picker) return;
  const rect = trigger.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  menu.classList.add('is-open');
  picker.hidden = false;
  const placement = calculateReactionMenuPlacement(rect, picker.getBoundingClientRect(), window.innerWidth, window.innerHeight, rtl);
  menu.classList.toggle('opens-start', placement.opensStart);
  menu.classList.toggle('opens-up', placement.opensUp);
  trigger.setAttribute('aria-expanded', 'true');
  openMenu = menu;
}

function starIcon(kind) {
  return createSvgIcon(`star-${kind}.svg`, { className: `rating-star rating-${kind}`, width: 17, height: 17 });
}

function starKinds(value) {
  const out = [];
  for (let i = 1; i <= 5; i += 1) {
    if (value >= i) out.push('full');
    else if (value >= i - 0.5) out.push('half');
    else out.push('empty');
  }
  return out;
}

function glyphForReaction(type, selected) {
  const glyph = createSvgIcon(type.icon, { className: `reaction-glyph${selected ? ' selected' : ''}`, width: 20, height: 20, label: type.label });
  return glyph;
}

export function renderReactionWidget(root, {
  counts = {}, selected = new Map(), busy = false, onOpen = null, onSelect = null,
  compact = false, comments = null, ariaLabel = tr('reactionPicker')
} = {}) {
  closeMenu(root.querySelector?.('.reaction-menu') || null);
  root.replaceChildren();
  const summary = getReactionSummary(counts);
  const wrapper = makeElement('div', { className: 'reaction-widget' });
  const metrics = makeElement('div', { className: compact ? 'reaction-summary compact' : 'reaction-summary' });
  if (comments != null) {
    const commentMetric = makeElement('span', { className: 'reaction-metric' });
    commentMetric.append(createSvgIcon('comments.svg', { className: 'metric-icon', width: 16, height: 16, label: tr('comments') }));
    commentMetric.append(makeElement('b', { text: String(comments) }));
    metrics.append(commentMetric, makeElement('span', { className: 'reaction-separator', text: '·', attrs: { 'aria-hidden': 'true' } }));
  }
  metrics.append(makeElement('span', { className: 'reaction-ratio', text: `${summary.total} / ${summary.positive}` }));
  const stars = makeElement('span', { className: 'star-rating', attrs: { role: 'img', 'aria-label': `${summary.stars} / 5` } });
  starKinds(summary.stars).forEach(kind => stars.append(starIcon(kind)));
  metrics.append(stars);

  const menu = makeElement('div', { className: 'reaction-menu' });
  const trigger = makeElement('button', { className: 'reaction-trigger', attrs: { type: 'button', title: ariaLabel, 'aria-label': ariaLabel, 'aria-expanded': 'false' } });
  trigger.append(createSvgIcon('reaction-picker.svg', { className: 'reaction-picker-icon', width: 20, height: 20 }));
  const picker = makeElement('div', { className: 'reaction-picker-grid', attrs: { hidden: '' } });
  reactionTypes().forEach(type => {
    const selectedId = selected.get(type.key);
    const button = makeElement('button', {
      className: `reaction-option${selectedId ? ' is-selected' : ''}`,
      attrs: { type: 'button', 'aria-pressed': String(Boolean(selectedId)), title: `${type.label} ${type.key}` }
    });
    button.append(glyphForReaction(type, Boolean(selectedId)), makeElement('span', { className: 'sr-only', text: type.key }));
    button.disabled = Boolean(busy);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(menu);
      onSelect?.(type.key);
    });
    picker.append(button);
  });
  trigger.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('is-open')) closeMenu(menu);
    else { openReactionMenu(menu, trigger); onOpen?.(menu); }
  });
  menu.append(trigger, picker);
  wrapper.append(metrics, menu);
  root.append(wrapper);
}

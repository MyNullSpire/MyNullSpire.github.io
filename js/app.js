import { CONFIG } from './config.js';
import { $, makeElement, formatDate, cacheVersionedUrl, initTheme, toggleTheme, setupHeader, setupMobileMenu, dismissSiteLoader, renderUserIdentity, renderLabels } from './dom.js';
import { applyLanguage, getLanguage, initI18n, tr } from './i18n.js';
import { fetchPostsInitial, fetchRemainingPosts, getCachedPostsSnapshot, getRateLabel, issueRoute, repoUrl, toUserError } from './github.js';
import { renderRating } from './reactions.js';
import { requireFreshSession, restoreUser, initAuth, getCurrentUser, handleAuthFailure, resumeTargetMatches } from './auth.js';

const PAGE_SIZE = 5;
const state = { posts: [], sort: 'created', query: '', expanded: false, serverComplete: true, nextPage: null, loading: false, loadingAll: false, feedStatus: 'loading' };
let searchTimer = null;

function setAuthAwareStatus() {
  const user = getCurrentUser();
  const node = $('#authTopButton');
  if (node) node.title = user ? `${tr('connectedAs')} ${user.login}` : tr('loginRequired');
}

// Index cards only need a small, fast-loading preview, so route it through a
// read-only resize proxy (no data stored, just an on-the-fly thumbnail) instead
// of downloading the post's full-size original image. post.html always keeps
// the original resolution, this thumbnailing is index-only.
function thumbnailUrl(url, width = 640) {
  const clean = cacheVersionedUrl(url, 1);
  if (!clean) return '';
  try {
    return `https://images.weserv.nl/?url=${encodeURIComponent(clean.replace(/^https?:\/\//, ''))}&w=${width}&q=70&output=webp&fit=cover&a=attention`;
  } catch { return clean; }
}

function cardImage(url, title, post) {
  const wrapper = makeElement('div', { className: `post-image-wrap${url ? '' : ' is-fallback'}` });
  const original = cacheVersionedUrl(url, 1);
  const source = (url ? thumbnailUrl(url, 640) : '') || original || './SVGs/ui/fallback.svg?v=1';
  const img = makeElement('img', {
    className: `post-image${url ? '' : ' post-image-fallback'}`,
    attrs: { src: source, alt: title || tr('imageAlt'), loading: 'lazy', decoding: 'async', fetchpriority: 'low', referrerpolicy: 'no-referrer', width: 640, height: 360, sizes: '(max-width: 720px) calc(100vw - 22px), 640px' }
  });
  img.addEventListener('error', () => {
    if (!img.dataset.fallbackStage) {
      img.dataset.fallbackStage = 'original';
      if (original && img.src !== original) { img.src = original; return; }
    }
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = 'true';
    img.src = './SVGs/ui/fallback.svg?v=1';
    wrapper.classList.add('is-image-error');
    img.classList.add('post-image-fallback');
  });
  const mask = makeElement('div', { className: 'post-image-mask', attrs: { 'aria-hidden': 'true' } });
  const info = makeElement('div', { className: 'post-image-info' });
  const avatar = makeElement('img', { className: 'post-image-author-avatar', attrs: { src: cacheVersionedUrl(post?.authorAvatar || './SVGs/ui/fallback.svg', 1), alt: '', width: 40, height: 40, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' } });
  avatar.addEventListener('error', () => { if (!avatar.dataset.fallback) { avatar.dataset.fallback = '1'; avatar.src = './SVGs/ui/fallback.svg?v=1'; } }, { once: true });
  const copy = makeElement('div', { className: 'post-image-info-copy' });
  copy.append(
    makeElement('strong', { text: post?.author || 'GitHub' }),
    makeElement('span', { text: `${tr('created')}: ${formatDate(post?.createdAt)}` }),
    makeElement('span', { text: `${tr('updated')}: ${formatDate(post?.updatedAt)}` })
  );
  info.append(avatar, copy);
  wrapper.append(img, mask, info);
  return wrapper;
}

function buildCard(post) {
  const article = makeElement('article', { className: 'post-card' });
  const link = makeElement('a', { className: 'post-card-link', attrs: { href: issueRoute(post.number), 'aria-label': post.title || tr('postTitle') } });
  link.append(cardImage(post.image, post.title, post));

  const body = makeElement('div', { className: 'post-body' });
  const top = makeElement('div', { className: 'post-top' });
  const topRight = makeElement('div', { className: 'post-top-right' });
  topRight.append(makeElement('span', { className: 'post-number', text: `#${post.number}` }), renderRating(post.reactions, { compact: true }));
  const comments = makeElement('span', { className: 'post-top-comments' });
  comments.append(makeElement('span', { className: 'post-top-comments-icon', attrs: { 'aria-hidden': 'true' } }), makeElement('b', { text: String(post.comments || 0) }));
  topRight.append(comments);
  top.append(topRight, makeElement('span', { className: `status-chip status-${post.state}`, text: post.locked ? tr('locked') : post.state === 'closed' ? tr('closed') : tr('open') }));
  body.append(top);
  body.append(renderLabels(post.labels));
  body.append(makeElement('h3', { text: post.title || tr('postTitle') }));
  const excerpt = makeElement('p', { text: post.excerpt || tr('noBody') });
  excerpt.dir = 'auto';
  body.append(excerpt);
  link.append(body);
  article.append(link);
  return article;
}
function renderSkeletons() {
  const grid = $('#postGrid');
  grid.replaceChildren();
  for (let index = 0; index < PAGE_SIZE; index += 1) {
    const card = makeElement('article', { className: 'post-skeleton' });
    card.append(makeElement('div', { className: 'skeleton-image' }));
    const body = makeElement('div', { className: 'skeleton-body' });
    ['','', '', '', ''].forEach(() => body.append(makeElement('span')));
    card.append(body); grid.append(card);
  }
  grid.setAttribute('aria-busy', 'true');
}

function filterPosts() {
  const needle = state.query.trim().toLowerCase();
  const posts = needle ? state.posts.filter(post => [post.title, post.body, post.excerpt, post.author, ...(post.labels || [])].join('\n').toLowerCase().includes(needle)) : [...state.posts];
  const value = state.sort;
  posts.sort((a, b) => {
    if (value === 'comments') return b.comments - a.comments || b.number - a.number;
    if (value === 'updated') return new Date(b.updatedAt) - new Date(a.updatedAt) || b.number - a.number;
    return new Date(b.createdAt) - new Date(a.createdAt) || b.number - a.number;
  });
  return posts;
}

function renderPosts() {
  const visiblePosts = filterPosts();
  const visible = visiblePosts.slice(0, state.expanded ? visiblePosts.length : PAGE_SIZE);
  const grid = $('#postGrid');
  const cards = visible.map(buildCard);
  cards.forEach((card, index) => card.style.setProperty('--post-card-delay', `${Math.min(index, 9) * 190}ms`));
  grid.replaceChildren(...cards);
  grid.setAttribute('aria-busy', 'false');
  const total = visiblePosts.length;
  $('#postsCount').textContent = `${visible.length} / ${total} ${tr('postsCount')}`;
  const hasAny = state.posts.length > 0;
  const showError = state.feedStatus === 'error' && !hasAny;
  const showEmpty = !showError && state.feedStatus !== 'loading' && total === 0;
  $('#postsEmpty').hidden = !showEmpty;
  $('#postsError').hidden = !showError;
  if (showEmpty) $('#postsEmptyText').textContent = hasAny ? tr('noResults') : tr('emptyFeed');
  let status = tr('ready');
  if (state.feedStatus === 'refresh-error' && hasAny) status = tr('refreshFailed');
  else if (showEmpty) status = hasAny ? tr('noResults') : tr('noPosts');
  else if (state.loadingAll) status = tr('loadingAll');
  else if (state.feedStatus === 'loading') status = tr('loading');
  $('#postsState').textContent = status;
  const more = $('#loadMorePosts');
  more.hidden = state.serverComplete && total <= PAGE_SIZE;
  more.disabled = state.loadingAll;
  more.setAttribute('aria-busy', String(state.loadingAll));
  const label = more.querySelector('[data-load-label]');
  if (label) label.textContent = state.expanded ? tr('collapsePosts') : tr('loadMorePosts');
}

function showFeedError(message = '') {
  const node = $('#postsError');
  if (!node) return;
  node.hidden = false;
  const detail = $('#postsErrorDetail');
  if (detail) detail.textContent = message;
}

async function loadPosts({ refresh = true } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.feedStatus = 'loading';
  const cached = getCachedPostsSnapshot();
  if (cached && !state.posts.length) {
    state.posts = cached.posts;
    state.serverComplete = cached.complete !== false;
    state.nextPage = cached.nextPage || null;
    state.feedStatus = 'ready';
    renderPosts();
  } else if (!state.posts.length) {
    renderSkeletons();
  }
  if (!refresh && state.posts.length) { state.loading = false; return; }
  try {
    const result = await fetchPostsInitial({ sort: 'created', direction: 'desc' });
    state.posts = result.posts;
    state.serverComplete = result.complete;
    state.nextPage = result.nextPage;
    state.feedStatus = result.stale ? 'refresh-error' : 'ready';
    $('#rateBadge').hidden = !result.rate;
    $('#rateBadge').textContent = result.rate ? `${tr('rate')}: ${getRateLabel(result.rate)}` : '';
    renderPosts();
  } catch (error) {
    state.feedStatus = 'error';
    renderPosts();
    showFeedError(toUserError(error));
  } finally {
    state.loading = false;
  }
}

async function loadAllPosts() {
  if (state.loadingAll || state.serverComplete || !state.nextPage) { state.expanded = !state.expanded; renderPosts(); return; }
  state.loadingAll = true; renderPosts();
  try {
    const result = await fetchRemainingPosts(state.nextPage, state.posts, () => {}, { sort: 'created', direction: 'desc' });
    state.posts = result.posts; state.serverComplete = true; state.nextPage = null; state.expanded = true; state.feedStatus = 'ready'; renderPosts();
  } catch (error) {
    state.feedStatus = 'refresh-error'; showFeedError(toUserError(error)); renderPosts();
  } finally { state.loadingAll = false; renderPosts(); }
}


function setupLinks() {
  ['#heroRepoLink', '#repoLink', '#footerRepoLink'].forEach(selector => { const link = $(selector); if (link) link.href = repoUrl(); });
  const telegrams = ['#heroTelegramLink', '#telegramLink'];
  telegrams.forEach(selector => { const link = $(selector); if (link) link.href = CONFIG.site.telegram; });
}

function setupEvents() {
  $('#themeToggle')?.addEventListener('click', toggleTheme);
  $('#refreshPosts')?.addEventListener('click', () => loadPosts({ refresh: true }));
  $('#retryPosts')?.addEventListener('click', () => loadPosts({ refresh: true }));
  $('#loadMorePosts')?.addEventListener('click', loadAllPosts);
  $('#postSearch')?.addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = event.target.value; state.expanded = false; renderPosts(); }, 100);
  });
  $('#postSort')?.addEventListener('change', event => { state.sort = event.target.value; state.expanded = false; renderPosts(); });
  document.addEventListener('github-auth-changed', event => {
    setAuthAwareStatus();
    renderPosts();
  });
}


async function init() {
  initTheme();
  initI18n(() => { applyLanguage(getLanguage()); renderPosts(); setAuthAwareStatus(); });
  initAuth();
  setupHeader();
  setupMobileMenu();
  setupLinks();
  setupEvents();
  $('#year').textContent = String(new Date().getFullYear());
  $('#backTop')?.addEventListener('click', event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#postGrid').setAttribute('aria-busy', 'true');
  await restoreUser();
  setAuthAwareStatus();
  await loadPosts({ refresh: true });
  dismissSiteLoader();
}

init().catch(error => {
  dismissSiteLoader();
  const detail = $('#postsErrorDetail');
  const errorBox = $('#postsError');
  if (detail) detail.textContent = toUserError(error);
  if (errorBox) errorBox.hidden = false;
});

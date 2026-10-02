import { CONFIG } from './config.js';
import { $, makeElement, formatDate, cacheVersionedUrl, initTheme, toggleTheme, setupHeader, setupMobileMenu, renderUserIdentity, renderLabels } from './dom.js';
import { applyLanguage, getLanguage, initI18n, tr } from './i18n.js';
import { fetchAllIssueReactions, fetchPostsInitial, fetchRemainingPosts, getCachedPostsSnapshot, getRateLabel, issueRoute, reactionCountsFromList, currentUserReactionIds, currentUserReactionIdList, createIssueReaction, deleteIssueReaction, repoUrl, toUserError } from './github.js';
import { renderReactionWidget } from './reactions.js';
import { requireFreshSession, restoreUser, initAuth, getCurrentUser, handleAuthFailure } from './auth.js';

const PAGE_SIZE = 5;
const state = { posts: [], sort: 'created', query: '', expanded: false, serverComplete: true, nextPage: null, loading: false, loadingAll: false, feedStatus: 'loading', reactionLists: new Map() };
let searchTimer = null;

function setAuthAwareStatus() {
  const user = getCurrentUser();
  const node = $('#authTopButton');
  if (node) node.title = user ? `${tr('connectedAs')} ${user.login}` : tr('loginRequired');
}

function cardImage(url, title) {
  const wrapper = makeElement('div', { className: `post-image-wrap${url ? '' : ' is-fallback'}` });
  const source = cacheVersionedUrl(url, 1) || './SVGs/ui/fallback.svg?v=1';
  const img = makeElement('img', {
    className: `post-image${url ? '' : ' post-image-fallback'}`,
    attrs: { src: source, alt: title || tr('imageAlt'), loading: 'lazy', decoding: 'async', fetchpriority: 'low', referrerpolicy: 'no-referrer', width: 640, height: 360, sizes: '(max-width: 720px) calc(100vw - 44px), 640px' }
  });
  img.addEventListener('error', () => {
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = 'true';
    img.src = './SVGs/ui/fallback.svg?v=1';
    wrapper.classList.add('is-image-error');
    img.classList.add('post-image-fallback');
  }, { once: true });
  wrapper.append(img);
  return wrapper;
}

function buildCard(post) {
  const article = makeElement('article', { className: 'post-card' });
  article.append(makeElement('a', { className: 'post-card-link', attrs: { href: issueRoute(post.number), 'aria-label': post.title || tr('postTitle') }, children: [cardImage(post.image, post.title)] }));

  const body = makeElement('div', { className: 'post-body' });
  const top = makeElement('div', { className: 'post-top' });
  top.append(makeElement('a', { className: 'post-number', text: `#${post.number}`, attrs: { href: issueRoute(post.number) } }));
  top.append(makeElement('span', { className: `status-chip status-${post.state}`, text: post.locked ? tr('locked') : post.state === 'closed' ? tr('closed') : tr('open') }));
  body.append(top);
  body.append(renderLabels(post.labels));

  const titleLink = makeElement('a', { attrs: { href: issueRoute(post.number) } });
  titleLink.append(makeElement('h3', { text: post.title || tr('postTitle') }));
  body.append(titleLink);

  const excerpt = makeElement('p', { text: post.excerpt || tr('noBody') });
  excerpt.dir = 'auto';
  body.append(excerpt);

  const authorRow = makeElement('div', { className: 'post-author-row' });
  authorRow.append(renderUserIdentity({ login: post.author, avatar_url: post.authorAvatar, html_url: post.authorUrl }, { compact: true }));
  const dates = makeElement('div', { className: 'post-dates' });
  dates.append(makeElement('span', { text: `${tr('created')}: ${formatDate(post.createdAt)}` }));
  dates.append(makeElement('span', { text: `${tr('updated')}: ${formatDate(post.updatedAt)}` }));
  authorRow.append(dates);
  body.append(authorRow);

  const facts = makeElement('div', { className: 'post-facts' });
  facts.append(makeElement('a', { text: tr('directGithub'), attrs: { href: post.url, target: '_blank', rel: 'noreferrer noopener' } }));
  body.append(facts);

  const reactionRoot = makeElement('div', { className: 'post-card-reactions' });
  const selected = state.reactionLists.get(post.number)?.selected || new Map();
  renderReactionWidget(reactionRoot, {
    counts: post.reactions,
    comments: post.comments,
    selected,
    compact: true,
    onOpen: () => {},
    onSelect: key => togglePostReaction(post.number, key),
    busy: Boolean(state.reactionLists.get(post.number)?.busy)
  });
  body.append(reactionRoot);
  article.append(body);
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
  grid.replaceChildren(...visible.map(buildCard));
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

async function togglePostReaction(number, key) {
  const existing = state.reactionLists.get(number) || { selected: new Map(), list: [], loaded: false, busy: false };
  if (existing.busy) return;
  existing.busy = true;
  state.reactionLists.set(number, existing);
  renderPosts();
  const session = await requireFreshSession();
  if (!session.ok) {
    existing.busy = false;
    state.reactionLists.set(number, existing);
    renderPosts();
    return;
  }
  const target = { owner: CONFIG.github.owner, repo: CONFIG.github.repo, number };
  try {
    let entry = state.reactionLists.get(number) || existing;
    if (!entry.loaded) {
      const current = await fetchAllIssueReactions(target);
      const selected = currentUserReactionIds(current.reactions, session.user.login);
      entry = { ...entry, loaded: true, list: current.reactions, selected };
      state.reactionLists.set(number, entry);
    }
    const duplicateIds = currentUserReactionIdList(entry.list, session.user.login, key);
    if (duplicateIds.length) await Promise.all(duplicateIds.map(id => deleteIssueReaction(target, id)));
    else await createIssueReaction(target, key);
    const latest = await fetchAllIssueReactions(target);
    const post = state.posts.find(item => item.number === number);
    if (post) post.reactions = reactionCountsFromList(latest.reactions);
    const selected = currentUserReactionIds(latest.reactions, session.user.login);
    state.reactionLists.set(number, { loaded: true, selected, list: latest.reactions, busy: false });
    renderPosts();
  } catch (error) {
    state.reactionLists.set(number, { ...(state.reactionLists.get(number) || existing), busy: false });
    renderPosts();
    if (error.status === 401) handleAuthFailure(error); else showAuthReactionError(error);
  }
}
function showAuthReactionError(error) {
  const status = $('#postsState');
  if (status) status.textContent = toUserError(error);
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
  document.addEventListener('github-auth-changed', () => { setAuthAwareStatus(); renderPosts(); });
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
  $('#backTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'auto' }));
  $('#postGrid').setAttribute('aria-busy', 'true');
  await restoreUser();
  setAuthAwareStatus();
  await loadPosts({ refresh: true });
  $('#siteLoader')?.remove();
}

init().catch(error => {
  $('#siteLoader')?.remove();
  const detail = $('#postsErrorDetail');
  const errorBox = $('#postsError');
  if (detail) detail.textContent = toUserError(error);
  if (errorBox) errorBox.hidden = false;
});

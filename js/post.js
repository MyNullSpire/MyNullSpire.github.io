import { CONFIG } from './config.js';
import { $, makeElement, formatDate, initTheme, toggleTheme, setupHeader, setupMobileMenu, setBusy, dismissSiteLoader, renderUserIdentity, renderLabels } from './dom.js';
import { applyLanguage, getLanguage, initI18n, tr } from './i18n.js';
import { fetchIssue, fetchIssueComments, fetchAllIssueReactions, fetchAllIssueCommentReactions, createIssueReaction, deleteIssueReaction, createIssueCommentReaction, deleteIssueCommentReaction, createIssueComment, updateIssueComment, deleteIssueComment, parseIssueUrl, reactionCountsFromList, currentUserReactionIds, currentUserReactionIdList, getRateLabel, issueRoute, readCommentOperation, markCommentOperation, toUserError } from './github.js';
import { renderMarkdown } from './security.js';
import { renderReactionWidget } from './reactions.js';
import { restoreUser, initAuth, getCurrentUser, requireFreshSession, handleAuthFailure, resumeTargetMatches } from './auth.js';

const state = { target: null, issue: null, comments: [], commentsPage: 1, commentsHasMore: false, commentSort: 'asc', commentsLoading: false, commentsController: null, issueReactions: [], issueReactionsLoaded: false, commentReactionLists: new Map(), reactionLock: false, commentLocks: new Map(), commentSubmitting: false, editingComment: null };

function setSeo(issue) {
  document.title = `#${issue.number} — ${issue.title || tr('postTitle')}`;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = (issue.excerpt || issue.title || tr('metaPost')).slice(0, 160);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = issue.title || `#${issue.number}`;
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription) ogDescription.content = description?.content || '';
}

function setError(title, text) {
  $('#readerError').hidden = false;
  $('#postReader').hidden = true;
  $('#errorTitle').textContent = title;
  $('#errorText').textContent = text;
}

function renderKeepingScroll(render) {
  const left = window.scrollX;
  const top = window.scrollY;
  const active = document.activeElement;
  const activeId = active?.id || '';
  const selectionStart = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
  const selectionEnd = typeof active?.selectionEnd === 'number' ? active.selectionEnd : null;
  render();
  const restore = () => {
    window.scrollTo({ left, top, behavior: 'auto' });
    if (!activeId) return;
    const next = document.getElementById(activeId);
    if (!next) return;
    if (next !== document.activeElement) {
      try { next.focus({ preventScroll: true }); } catch { next.focus(); }
    }
    if (selectionStart !== null && 'selectionStart' in next) {
      try { next.setSelectionRange(selectionStart, selectionEnd ?? selectionStart); } catch {}
    }
  };
  restore();
  requestAnimationFrame(restore);
}

function renderIssue() {
  const issue = state.issue;
  if (!issue) return;
  $('#readerError').hidden = true;
  $('#postReader').hidden = false;
  $('#postNumber').textContent = `#${issue.number}`;
  $('#postNumber').href = issueRoute(issue.number);
  $('#postCreatedAt').textContent = `${tr('created')}: ${formatDate(issue.createdAt, true)}`;
  $('#postUpdatedAt').textContent = `${tr('updated')}: ${formatDate(issue.updatedAt, true)}`;
  $('#postState').textContent = issue.locked ? tr('locked') : issue.state === 'closed' ? tr('closed') : tr('open');
  $('#postTitle').textContent = issue.title || tr('postTitle');
  $('#postByline').replaceChildren(renderUserIdentity({ login: issue.author, avatar_url: issue.authorAvatar, html_url: issue.authorUrl }, { compact: false, label: tr('authorLabel') }));
  $('#postLabels').replaceChildren(...renderLabels(issue.labels, 'reader-labels').childNodes);
  $('#commentCount').textContent = String(issue.comments || 0);
  $('#issueLinkLabel').textContent = `#${issue.number}`;
  $('#rateLabel').textContent = state.issue?.rate ? getRateLabel(state.issue.rate) : '—';
  renderMarkdown($('#postContent'), issue.body, { imageMode: 'post', emptyText: tr('noBody') });
  const reactionRoot = $('#postReactions');
  renderReactionWidget(reactionRoot, {
    counts: issue.reactions,
    comments: issue.comments,
    selected: getSelectedIssueReactions(),
    busy: state.reactionLock,
    onOpen: () => {},
    onSelect: toggleIssueReaction,
    showBreakdown: true
  });
  const hero = $('#postHero');
  if (hero) {
    const cleanImage = String(issue.image || '').replace(/"/g, '%22');
    hero.classList.toggle('has-bg', Boolean(cleanImage));
    hero.style.setProperty('--hero-image', cleanImage ? `url("${cleanImage}")` : 'none');
  }
  setSeo(issue);
}

function getSelectedIssueReactions() {
  const login = getCurrentUser()?.login || '';
  const ids = currentUserReactionIds(state.issueReactions, login);
  return new Map([...ids.entries()].filter(([key]) => key === '+1' || key === '-1'));
}

function userReactionContent(list, login) {
  const normalized = String(login || '').toLowerCase();
  const found = (Array.isArray(list) ? list : [])
    .filter(item => String(item?.user?.login || '').toLowerCase() === normalized && (item?.content === '+1' || item?.content === '-1'))
    .map(item => item.content);
  return found.includes('+1') ? '+1' : found.includes('-1') ? '-1' : null;
}

function optimisticCounts(previous, oldKey, nextKey) {
  const counts = { '+1': Math.max(0, Number(previous?.['+1'] || 0)), '-1': Math.max(0, Number(previous?.['-1'] || 0)) };
  if (oldKey) counts[oldKey] = Math.max(0, counts[oldKey] - 1);
  if (nextKey) counts[nextKey] += 1;
  return counts;
}

async function deleteIdsSafely(ids, remover) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).filter(id => id && !String(id).startsWith('optimistic-')).map(id => String(id)))];
  await Promise.all(unique.map(async id => {
    try { await remover(id); } catch (error) { if (Number(error?.status) !== 404) throw error; }
  }));
}

async function toggleIssueReaction(key) {
  if (!['+1', '-1'].includes(key) || state.reactionLock) return;
  const session = await requireFreshSession({ pending: { type: 'issue-reaction', target: state.target, key } });
  if (!session.ok) return;
  state.reactionLock = true;
  let beforeList = [];
  let beforeCounts = {};
  try {
    if (!state.issueReactionsLoaded) {
      const loaded = await fetchAllIssueReactions(state.target);
      state.issueReactions = loaded.reactions;
      state.issueReactionsLoaded = true;
    }
    beforeList = state.issueReactions.slice();
    beforeCounts = { ...(state.issue.reactions || {}) };
    const mine = beforeList.filter(item => String(item?.user?.login || '').toLowerCase() === String(session.user.login).toLowerCase() && (item?.content === '+1' || item?.content === '-1'));
    const current = mine[0]?.content || null;
    const next = current === key ? null : key;
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const optimisticList = beforeList.filter(item => !mine.includes(item)).concat(next ? [{ id: optimisticId, content: next, user: { login: session.user.login } }] : []);
    state.issueReactions = optimisticList;
    state.issue.reactions = optimisticCounts(beforeCounts, current, next);
    renderKeepingScroll(renderIssue);
    for (const item of mine) {
      if (!item?.id || String(item.id).startsWith('optimistic-')) continue;
      try { await deleteIssueReaction(state.target, item.id); } catch (error) { if (Number(error?.status) !== 404) throw error; }
    }
    if (next) {
      const created = await createIssueReaction(state.target, next);
      state.issueReactions = optimisticList.map(item => item.id === optimisticId ? { ...(created || item), id: created?.id || optimisticId } : item);
    }
    state.issue.reactions = reactionCountsFromList(state.issueReactions);
  } catch (error) {
    if (error?.status === 401) handleAuthFailure(error);
    state.issueReactions = beforeList;
    state.issue.reactions = beforeCounts;
    $('#postStatus')?.replaceChildren(document.createTextNode(toUserError(error)));
  } finally {
    state.reactionLock = false;
    renderKeepingScroll(renderIssue);
  }
}

async function loadComments({ reset = false, force = false } = {}) {
  if (state.commentsLoading && !force) return null;
  state.commentsController?.abort();
  const controller = new AbortController();
  state.commentsController = controller;
  state.commentsLoading = true;
  $('#loadMoreComments').disabled = true;
  const page = reset ? 1 : state.commentsPage + 1;
  if (reset) { state.comments = []; state.commentsPage = 1; state.commentsHasMore = false; }
  $('#commentsStatus').textContent = tr('commentsLoading');
  try {
    const result = await fetchIssueComments(state.target, page, CONFIG.github.initialCommentsPerPage, state.commentSort, controller.signal);
    if (controller.signal.aborted || state.commentsController !== controller) return null;
    state.comments = reset ? result.comments : [...state.comments, ...result.comments];
    state.commentsPage = page;
    state.commentsHasMore = result.hasMore;
    renderComments();
    return result;
  } catch (error) {
    if (error?.name === 'AbortError' || controller.signal.aborted) return null;
    $('#commentsStatus').textContent = toUserError(error);
    throw error;
  } finally {
    if (state.commentsController === controller) {
      state.commentsController = null;
      state.commentsLoading = false;
      $('#loadMoreComments').disabled = !state.commentsHasMore;
    }
  }
}

function reactionRootForComment(comment) {
  const root = makeElement('div', { className: 'comment-reactions-root' });
  const entry = state.commentReactionLists.get(comment.id);
  renderReactionWidget(root, {
    counts: comment.reactions || {},
    selected: entry?.selected || new Map(),
    compact: true,
    onSelect: key => toggleCommentReaction(comment.id, key),
    busy: Boolean(entry?.busy)
  });
  return root;
}

function renderComments() {
  const root = $('#commentsList');
  root.replaceChildren();
  if (!state.comments.length) root.append(makeElement('div', { className: 'comments-empty', text: tr('noComments') }));
  for (const comment of state.comments) {
    const card = makeElement('article', { className: 'comment-card', attrs: { 'data-comment-id': String(comment.id) } });
    const head = makeElement('div', { className: 'comment-head' });
    const user = comment.user || { login: 'GitHub', avatar_url: './SVGs/ui/fallback.svg', html_url: 'https://github.com' };
    head.append(renderUserIdentity(user, { compact: true }));
    const time = makeElement('div', { className: 'comment-time' });
    time.append(makeElement('span', { text: formatDate(comment.created_at, true) }));
    if (comment.updated_at && comment.updated_at !== comment.created_at) time.append(makeElement('span', { text: tr('edited') }));
    head.append(time);
    card.append(head);
    const body = makeElement('div', { className: 'comment-body' });
    renderMarkdown(body, comment.body, { imageMode: 'post', emptyText: tr('noBody') });
    card.append(body);
    const actions = makeElement('div', { className: 'comment-actions' });
    actions.append(reactionRootForComment(comment));
    const userArea = makeElement('div', { className: 'comment-actions-right' });
    if (getCurrentUser()?.login && getCurrentUser().login === user.login) {
      const edit = makeElement('button', { className: 'tiny-action', text: tr('edit'), attrs: { type: 'button' } });
      edit.addEventListener('click', () => startEdit(comment.id));
      const del = makeElement('button', { className: 'tiny-action', text: tr('delete'), attrs: { type: 'button' } });
      del.addEventListener('click', () => deleteComment(comment.id));
      userArea.append(edit, del);
    }
    actions.append(userArea);
    card.append(actions);
    root.append(card);
  }
  $('#commentsStatus').textContent = `${state.comments.length}${state.issue?.comments != null ? ` / ${state.issue.comments}` : ''} ${tr('comments')}`;
  $('#loadMoreComments').hidden = !state.commentsHasMore;
  $('#loadMoreComments').disabled = state.commentsLoading;
  restoreCommentOperationStatus();
}

async function toggleCommentReaction(commentId, key) {
  if (!['+1', '-1'].includes(key)) return;
  const comment = state.comments.find(item => Number(item.id) === Number(commentId));
  if (!comment || state.commentLocks.get(commentId)) return;
  const session = await requireFreshSession({ pending: { type: 'comment-reaction', target: state.target, commentId, key } });
  if (!session.ok) return;
  state.commentLocks.set(commentId, true);
  let beforeList = [];
  let beforeCounts = {};
  try {
    let entry = state.commentReactionLists.get(commentId);
    if (!entry?.loaded) {
      const loaded = await fetchAllIssueCommentReactions(state.target, commentId);
      entry = { list: loaded, selected: currentUserReactionIds(loaded, session.user.login), loaded: true };
      state.commentReactionLists.set(commentId, entry);
    }
    beforeList = entry.list.slice();
    beforeCounts = { ...(comment.reactions || {}) };
    const mine = beforeList.filter(item => String(item?.user?.login || '').toLowerCase() === String(session.user.login).toLowerCase() && (item?.content === '+1' || item?.content === '-1'));
    const current = mine[0]?.content || null;
    const next = current === key ? null : key;
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const optimisticList = beforeList.filter(item => !mine.includes(item)).concat(next ? [{ id: optimisticId, content: next, user: { login: session.user.login } }] : []);
    comment.reactions = optimisticCounts(beforeCounts, current, next);
    state.commentReactionLists.set(commentId, { list: optimisticList, selected: next ? new Map([[next, optimisticId]]) : new Map(), loaded: true, busy: true });
    renderKeepingScroll(renderComments);
    for (const item of mine) {
      if (!item?.id || String(item.id).startsWith('optimistic-')) continue;
      try { await deleteIssueCommentReaction(state.target, commentId, item.id); } catch (error) { if (Number(error?.status) !== 404) throw error; }
    }
    if (next) {
      const created = await createIssueCommentReaction(state.target, commentId, next);
      const saved = state.commentReactionLists.get(commentId)?.list || optimisticList;
      state.commentReactionLists.set(commentId, { list: saved.map(item => item.id === optimisticId ? { ...(created || item), id: created?.id || optimisticId } : item), selected: new Map([[next, created?.id || optimisticId]]), loaded: true, busy: false });
    } else {
      state.commentReactionLists.set(commentId, { list: optimisticList, selected: new Map(), loaded: true, busy: false });
    }
    comment.reactions = reactionCountsFromList(state.commentReactionLists.get(commentId).list);
    renderKeepingScroll(renderComments);
  } catch (error) {
    if (error?.status === 401) handleAuthFailure(error);
    state.commentReactionLists.set(commentId, { list: beforeList, selected: currentUserReactionIds(beforeList, session.user.login), loaded: true, busy: false });
    comment.reactions = beforeCounts;
    renderKeepingScroll(renderComments);
    $('#commentsStatus').textContent = toUserError(error);
  } finally { state.commentLocks.delete(commentId); }
}

function updateComposer() {
  const input = $('#commentInput');
  const counter = $('#commentCounter');
  if (counter) counter.textContent = `${input.value.length} / 65536`;
  const submitText = $('#submitComment span:first-child');
  if (submitText) submitText.textContent = state.editingComment ? tr('updateComment') : tr('publish');
  const user = getCurrentUser();
  $('#composerUser').textContent = user ? `${tr('commentAs')} ${user.login}` : tr('connectFirst');
}

function startEdit(commentId) {
  const comment = state.comments.find(item => Number(item.id) === Number(commentId));
  if (!comment || getCurrentUser()?.login !== comment.user?.login) return;
  state.editingComment = comment.id;
  $('#commentInput').value = comment.body || '';
  $('#cancelEdit').hidden = false;
  $('#composerStatus').textContent = '';
  updateComposer();
  $('#commentInput').focus({ preventScroll: true });
}
function cancelEdit() {
  state.editingComment = null;
  $('#commentInput').value = '';
  $('#cancelEdit').hidden = true;
  $('#composerStatus').textContent = '';
  updateComposer();
}

async function submitComment() {
  if (state.commentSubmitting) return;
  const body = $('#commentInput').value.trim();
  if (!body || body.length > 65536) { $('#composerStatus').textContent = tr('invalidComment'); return; }
  const session = await requireFreshSession({ pending: { type: 'comment', target: state.target, body, editId: state.editingComment || null } });
  if (!session.ok) return;
  state.commentSubmitting = true;
  const button = $('#submitComment');
  setBusy(button, true, state.editingComment ? 'editing' : 'publishing');
  $('#composerStatus').textContent = tr('registeringComment');
  const editId = state.editingComment;
  try {
    if (editId) {
      const updated = await updateIssueComment(state.target, editId, body);
      const index = state.comments.findIndex(item => Number(item.id) === Number(editId));
      if (index >= 0) state.comments[index] = updated;
      state.editingComment = null;
      $('#cancelEdit').hidden = true;
      $('#commentInput').value = '';
      updateComposer();
      renderKeepingScroll(renderComments);
      requestAnimationFrame(() => { $('#composerStatus').textContent = document.querySelector(`[data-comment-id="${Number(editId)}"]`) ? tr('edited') : tr('registeringComment'); });
      markCommentOperation('update', state.target.number, editId);
    } else {
      const created = await createIssueComment(state.target, body);
      state.comments = state.commentSort === 'desc' ? [created, ...state.comments] : [...state.comments, created];
      state.issue.comments = Math.max(0, Number(state.issue.comments || 0) + 1);
      $('#commentInput').value = '';
      state.editingComment = null;
      $('#cancelEdit').hidden = true;
      updateComposer();
      renderKeepingScroll(renderIssue);
      renderKeepingScroll(renderComments);
      markCommentOperation('create', state.target.number, created?.id || 0);
      requestAnimationFrame(() => { $('#composerStatus').textContent = document.querySelector(`[data-comment-id="${Number(created?.id || 0)}"]`) ? tr('published') : tr('registeringComment'); });
    }
  } catch (error) {
    if (error?.status === 401) handleAuthFailure(error);
    $('#composerStatus').textContent = toUserError(error);
  } finally {
    state.commentSubmitting = false;
    setBusy(button, false, editId ? 'updateComment' : 'publish');
    updateComposer();
  }
}

async function deleteComment(commentId) {
  const session = await requireFreshSession();
  if (!session.ok) return;
  const comment = state.comments.find(item => Number(item.id) === Number(commentId));
  if (!comment || comment.user?.login !== session.user.login || !window.confirm(tr('confirmDelete'))) return;
  $('#composerStatus').textContent = tr('deleting');
  try {
    await deleteIssueComment(state.target, commentId);
    state.comments = state.comments.filter(item => Number(item.id) !== Number(commentId));
    state.issue.comments = Math.max(0, Number(state.issue.comments || 0) - 1);
    markCommentOperation('delete', state.target.number, commentId);
    renderKeepingScroll(renderIssue);
    renderKeepingScroll(renderComments);
    requestAnimationFrame(() => { $('#composerStatus').textContent = tr('deleted'); });
  } catch (error) {
    if (error.status === 401) handleAuthFailure(error);
    $('#composerStatus').textContent = toUserError(error);
  }
}

async function refreshAfterCommentMutation() {
  const [issue, comments] = await Promise.all([
    fetchIssue(state.target),
    fetchIssueComments(state.target, 1, CONFIG.github.initialCommentsPerPage, state.commentSort)
  ]);
  state.issue = issue.data;
  state.issue.rate = issue.rate;
  state.comments = comments.comments;
  state.commentsPage = 1;
  state.commentsHasMore = comments.hasMore;
  state.issueReactions = [];
  state.issueReactionsLoaded = false;
  state.commentReactionLists.clear();
  renderIssue();
  renderComments();
}

function restoreCommentOperationStatus() {
  const operation = readCommentOperation();
  if (!operation || Number(operation.issue) !== Number(state.target?.number)) return;
  const node = $('#composerStatus');
  if (node) node.textContent = tr('commentOperationRecent');
}

async function checkLoginState() {
  await restoreUser();
  updateComposer();
  renderIssue();
  renderComments();
}

function setupEvents() {
  $('#themeToggle')?.addEventListener('click', toggleTheme);
  $('#checkLoginButton')?.addEventListener('click', checkLoginState);
  $('#refreshComments')?.addEventListener('click', async () => { await loadComments({ reset: true, force: true }).catch(error => { $('#commentsStatus').textContent = toUserError(error); }); });
  $('#commentSort')?.addEventListener('change', async event => { state.commentSort = event.target.value; await loadComments({ reset: true, force: true }).catch(error => { $('#commentsStatus').textContent = toUserError(error); }); });
  $('#loadMoreComments')?.addEventListener('click', async () => { await loadComments({ reset: false }).catch(error => { $('#commentsStatus').textContent = toUserError(error); }); });
  $('#commentInput')?.addEventListener('input', updateComposer);
  $('#commentInput')?.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitComment(); });
  $('#submitComment')?.addEventListener('click', submitComment);
  $('#cancelEdit')?.addEventListener('click', cancelEdit);
  document.addEventListener('github-auth-changed', event => {
    state.commentReactionLists.clear(); state.editingComment = null; if ($('#cancelEdit')) $('#cancelEdit').hidden = true;
    updateComposer(); renderIssue(); renderComments();
    resumePendingAction(event.detail?.resume || null);
  });
}

// Resumes a reaction or comment the user started before the GitHub login finished,
// so it is applied automatically once and never twice (the stored action is removed
// from localStorage the moment it is read, in auth.js's consumePendingAction).
async function resumePendingAction(action) {
  if (!action || !state.target || !resumeTargetMatches(action.target, state.target)) return;
  if (action.type === 'issue-reaction' && action.key) {
    await toggleIssueReaction(action.key);
  } else if (action.type === 'comment-reaction' && action.commentId && action.key) {
    await toggleCommentReaction(action.commentId, action.key);
  } else if (action.type === 'comment' && action.body) {
    state.editingComment = action.editId || null;
    $('#commentInput').value = action.body;
    if ($('#cancelEdit')) $('#cancelEdit').hidden = !state.editingComment;
    updateComposer();
    await submitComment();
  }
}

async function loadAll() {
  try {
    const issueResult = await fetchIssue(state.target);
    state.issue = issueResult.data;
    state.issue.rate = issueResult.rate;
    renderIssue();
  } catch (error) {
    setError(tr('unavailable'), toUserError(error));
    return;
  }

  await restoreUser();
  updateComposer();

  const [reactionResult, commentResult] = await Promise.allSettled([
    fetchAllIssueReactions(state.target),
    loadComments({ reset: true })
  ]);

  if (reactionResult.status === 'fulfilled') {
    state.issueReactions = reactionResult.value.reactions;
    state.issueReactionsLoaded = true;
    state.issue.reactions = reactionCountsFromList(reactionResult.value.reactions);
    renderIssue();
  }

  if (commentResult.status === 'rejected') {
    const commentsStatus = $('#commentsStatus');
    if (commentsStatus) commentsStatus.textContent = toUserError(commentResult.reason);
  }
}

async function init() {
  initTheme();
  initI18n(() => { applyLanguage(getLanguage()); if (state.issue) renderIssue(); renderComments(); updateComposer(); });
  initAuth();
  setupHeader();
  setupMobileMenu();
  setupEvents();
  $('#year').textContent = String(new Date().getFullYear());
  const search = new URLSearchParams(location.search).get('post');
  const raw = location.hash ? location.hash.slice(1) : (search || '');
  state.target = parseIssueUrl(raw);
  if (!state.target) { setError(tr('invalidPost'), tr('unavailableText')); dismissSiteLoader(); return; }
  await loadAll();
  updateComposer();
  dismissSiteLoader();
}

init().catch(error => { dismissSiteLoader(); setError(tr('unavailable'), toUserError(error)); });

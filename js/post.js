import { CONFIG } from './config.js';
import { $, makeElement, formatDate, initTheme, toggleTheme, setupHeader, setupMobileMenu, setBusy, renderUserIdentity, renderLabels } from './dom.js';
import { applyLanguage, getLanguage, initI18n, tr } from './i18n.js';
import { fetchIssue, fetchIssueComments, fetchAllIssueReactions, fetchAllIssueCommentReactions, createIssueReaction, deleteIssueReaction, createIssueCommentReaction, deleteIssueCommentReaction, createIssueComment, updateIssueComment, deleteIssueComment, parseIssueUrl, reactionCountsFromList, currentUserReactionIds, currentUserReactionIdList, getRateLabel, issueRoute, readCommentOperation, markCommentOperation, toUserError } from './github.js';
import { renderMarkdown } from './security.js';
import { renderReactionWidget } from './reactions.js';
import { restoreUser, initAuth, getCurrentUser, requireFreshSession, handleAuthFailure } from './auth.js';

const state = { target: null, issue: null, comments: [], commentsPage: 1, commentsHasMore: false, commentSort: 'asc', commentsLoading: false, commentsController: null, issueReactions: [], issueReactionsLoaded: false, commentReactionLists: new Map(), busy: false, editingComment: null };

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
  $('#openGithub').href = issue.url;
  $('#issueLinkLabel').parentElement?.querySelector('span')?.replaceChildren(document.createTextNode(tr('directGithub')));
  renderMarkdown($('#postContent'), issue.body, { imageMode: 'post', emptyText: tr('noBody') });
  const reactionRoot = $('#postReactions');
  renderReactionWidget(reactionRoot, {
    counts: issue.reactions,
    comments: issue.comments,
    selected: getSelectedIssueReactions(),
    busy: state.busy,
    onOpen: () => {},
    onSelect: toggleIssueReaction
  });
  setSeo(issue);
}

function getSelectedIssueReactions() {
  return currentUserReactionIds(state.issueReactions, getCurrentUser()?.login || '');
}

async function refreshIssueReactionList({ render = true } = {}) {
  const result = await fetchAllIssueReactions(state.target);
  state.issueReactions = result.reactions;
  state.issueReactionsLoaded = true;
  state.issue.reactions = reactionCountsFromList(result.reactions);
  if (render) renderIssue();
  return result;
}

async function toggleIssueReaction(key) {
  if (state.busy) return;
  state.busy = true;
  renderIssue();
  const session = await requireFreshSession();
  if (!session.ok) {
    state.busy = false;
    renderIssue();
    return;
  }
  try {
    if (!state.issueReactionsLoaded) await refreshIssueReactionList({ render: false });
    const duplicateIds = currentUserReactionIdList(state.issueReactions, session.user.login, key);
    if (duplicateIds.length) await Promise.all(duplicateIds.map(id => deleteIssueReaction(state.target, id)));
    else await createIssueReaction(state.target, key);
    const result = await fetchAllIssueReactions(state.target);
    state.issueReactions = result.reactions;
    state.issueReactionsLoaded = true;
    state.issue.reactions = reactionCountsFromList(result.reactions);
  } catch (error) {
    if (error.status === 401) handleAuthFailure(error); else $('#postStatus')?.replaceChildren(document.createTextNode(toUserError(error)));
  } finally {
    state.busy = false;
    renderIssue();
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
    onOpen: async () => {
      const session = await requireFreshSession({ openLogin: false });
      if (!session.ok) return;
      if (entry?.loaded) return;
      try {
        const list = await fetchAllIssueCommentReactions(state.target, comment.id);
        const selected = currentUserReactionIds(list, session.user.login);
        state.commentReactionLists.set(comment.id, { list, selected, loaded: true });
        comment.reactions = reactionCountsFromList(list);
      } catch (error) {
        if (error.status === 401) handleAuthFailure(error); else $('#commentsStatus').textContent = toUserError(error);
      }
    },
    onSelect: key => toggleCommentReaction(comment.id, key),
    comments: null,
    busy: Boolean(entry?.busy)
  });
  return root;
}

function renderComments() {
  const root = $('#commentsList');
  root.replaceChildren();
  if (!state.comments.length) root.append(makeElement('div', { className: 'comments-empty', text: tr('noComments') }));
  for (const comment of state.comments) {
    const card = makeElement('article', { className: 'comment-card' });
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
  const comment = state.comments.find(item => Number(item.id) === Number(commentId));
  if (!comment) return;
  const entry = state.commentReactionLists.get(commentId) || { selected: new Map(), list: [], loaded: false, busy: false };
  if (entry.busy) return;
  entry.busy = true; state.commentReactionLists.set(commentId, entry); renderComments();
  const session = await requireFreshSession();
  if (!session.ok) {
    entry.busy = false; state.commentReactionLists.set(commentId, entry); renderComments(); return;
  }
  try {
    let currentEntry = state.commentReactionLists.get(commentId) || entry;
    if (!currentEntry.loaded) {
      const loaded = await fetchAllIssueCommentReactions(state.target, commentId);
      const selected = currentUserReactionIds(loaded, session.user.login);
      currentEntry = { ...currentEntry, list: loaded, selected, loaded: true, busy: true };
      state.commentReactionLists.set(commentId, currentEntry);
    }
    const duplicateIds = currentUserReactionIdList(currentEntry.list, session.user.login, key);
    if (duplicateIds.length) await Promise.all(duplicateIds.map(id => deleteIssueCommentReaction(state.target, commentId, id)));
    else await createIssueCommentReaction(state.target, commentId, key);
    const list = await fetchAllIssueCommentReactions(state.target, commentId);
    const selected = currentUserReactionIds(list, session.user.login);
    comment.reactions = reactionCountsFromList(list);
    state.commentReactionLists.set(commentId, { list, selected, loaded: true, busy: false });
    renderComments();
  } catch (error) {
    state.commentReactionLists.set(commentId, { ...(state.commentReactionLists.get(commentId) || entry), busy: false });
    renderComments();
    if (error.status === 401) handleAuthFailure(error); else $('#commentsStatus').textContent = toUserError(error);
  }
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
  $('#commentInput').focus();
}
function cancelEdit() {
  state.editingComment = null;
  $('#commentInput').value = '';
  $('#cancelEdit').hidden = true;
  $('#composerStatus').textContent = '';
  updateComposer();
}

async function submitComment() {
  if (state.busy) return;
  const body = $('#commentInput').value.trim();
  if (!body || body.length > 65536) { $('#composerStatus').textContent = tr('invalidComment'); return; }
  const session = await requireFreshSession();
  if (!session.ok) return;
  state.busy = true;
  const button = $('#submitComment');
  setBusy(button, true, state.editingComment ? 'editing' : 'publishing');
  $('#composerStatus').textContent = state.editingComment ? tr('editing') : tr('publishing');
  const editId = state.editingComment;
  const busyLabel = editId ? 'updateComment' : 'publish';
  try {
    if (editId) {
      await updateIssueComment(state.target, editId, body);
      markCommentOperation('update', state.target.number, editId);
      $('#composerStatus').textContent = tr('edited');
    } else {
      const created = await createIssueComment(state.target, body);
      markCommentOperation('create', state.target.number, created?.id || 0);
      $('#composerStatus').textContent = tr('published');
    }
    cancelEdit();
    await refreshAfterCommentMutation();
  } catch (error) {
    if (error.status === 401) handleAuthFailure(error);
    $('#composerStatus').textContent = toUserError(error);
  } finally {
    state.busy = false;
    setBusy(button, false, busyLabel);
    updateComposer();
  }
}

async function deleteComment(commentId) {
  const session = await requireFreshSession();
  if (!session.ok) return;
  const comment = state.comments.find(item => Number(item.id) === Number(commentId));
  if (!comment || comment.user?.login !== session.user.login || !window.confirm(tr('confirmDelete'))) return;
  state.busy = true;
  $('#composerStatus').textContent = tr('deleting');
  try {
    await deleteIssueComment(state.target, commentId);
    markCommentOperation('delete', state.target.number, commentId);
    await refreshAfterCommentMutation();
    $('#composerStatus').textContent = tr('deleted');
  } catch (error) {
    if (error.status === 401) handleAuthFailure(error);
    $('#composerStatus').textContent = toUserError(error);
  } finally { state.busy = false; }
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
  document.addEventListener('github-auth-changed', () => { state.commentReactionLists.clear(); state.editingComment = null; if ($('#cancelEdit')) $('#cancelEdit').hidden = true; updateComposer(); renderIssue(); renderComments(); });
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
  if (!state.target) { setError(tr('invalidPost'), tr('unavailableText')); $('#siteLoader')?.remove(); return; }
  await loadAll();
  updateComposer();
  $('#siteLoader')?.remove();
}

init().catch(error => { $('#siteLoader')?.remove(); setError(tr('unavailable'), toUserError(error)); });

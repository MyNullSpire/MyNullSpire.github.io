import { CONFIG } from './config.js';
import { $, $$, safeHttpUrl, setBusy } from './dom.js';
import { applyLanguage, tr } from './i18n.js';
import { beginDeviceFlow, checkSession, clearPendingDeviceFlow, fetchCurrentUser, followUser, getAuthState, getCachedUser, getPendingDeviceFlow, getRateLabel, isLoggedIn, pollDeviceFlow, signOut, starRepository, toUserError, loginActionTargets } from './github.js';

let state = { user: null, abort: null };
let toastTimer = null;

const PENDING_TTL = 10 * 60 * 1000;

export function savePendingAction(action) {
  if (!action) return;
  try { localStorage.setItem(CONFIG.storage.pendingAction, JSON.stringify({ ...action, ts: Date.now() })); } catch {}
}

function peekPendingAction() {
  try {
    const raw = localStorage.getItem(CONFIG.storage.pendingAction);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || Date.now() - Number(data.ts || 0) > PENDING_TTL) { localStorage.removeItem(CONFIG.storage.pendingAction); return null; }
    return data;
  } catch { return null; }
}

export function consumePendingAction() {
  const action = peekPendingAction();
  try { localStorage.removeItem(CONFIG.storage.pendingAction); } catch {}
  return action;
}

function toastElement() { return $('#authToast'); }
function openDialog() {
  const dialog = $('#connectDialog');
  if (!dialog) return;
  const pending = getPendingDeviceFlow();
  if (pending) setPendingView(pending);
  else resetStartView();
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  clearInterval(countdownTimer);
  countdownTimer = null;
  const dialog = $('#connectDialog');
  if (dialog?.open) dialog.close();
  if (state.abort) state.abort.abort();
  state.abort = null;
}

export function showAuthToast(message, duration = 3000) {
  const toast = toastElement();
  if (!toast) return;
  const messageNode = $('#authToastMessage', toast);
  if (messageNode) messageNode.textContent = String(message);
  // Native <dialog>.show() is never promoted to the browser's top layer, so it
  // renders beneath any open showModal() dialog regardless of z-index. Using
  // showModal() here puts the toast in the same top layer, above the login
  // dialog, so errors are always visible even while another dialog is open.
  try { if (toast.open) toast.close(); } catch {}
  try { toast.showModal(); } catch { try { toast.show(); } catch {} }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { try { if (toast.open) toast.close(); } catch {} }, duration);
}

function setTopAuthButton() {
  const user = state.user;
  $$('[data-auth-label]').forEach(label => { label.textContent = user ? `${tr('connectedAs')} ${user.login}` : tr('navConnect'); });
  const top = $('#authTopButton');
  if (top) {
    top.classList.toggle('is-connected', Boolean(user));
    top.dataset.profileState = user ? 'connected' : 'login';
    top.setAttribute('aria-pressed', String(Boolean(user)));
    top.title = user ? `${tr('profile')}: ${user.login}` : tr('navConnect');
  }
  updateProfileDialog(user);
  const authButton = $('#authButton');
  if (authButton) authButton.hidden = Boolean(user);
  const logout = $('#logoutButton');
  if (logout) logout.hidden = !user;
  const composerUser = $('#composerUser');
  if (composerUser) composerUser.textContent = user ? `${tr('commentAs')} ${user.login}` : tr('connectFirst');
}

function resetActionStatus() {
  document.querySelectorAll('[data-login-action]').forEach(node => {
    node.textContent = tr('loginActionReady');
    node.dataset.status = 'idle';
  });
}

function updateProfileDialog(user) {
  const avatar = $('#profileAvatar');
  const name = $('#profileName');
  const login = $('#profileLogin');
  const github = $('#profileGithubLink');
  if (!avatar && !name && !login && !github) return;
  const cleanLogin = String(user?.login || 'GitHub');
  const avatarUrl = safeHttpUrl(user?.avatar_url) || './SVGs/ui/fallback.svg?v=1';
  if (avatar) {
    avatar.src = avatarUrl;
    if (!avatar.dataset.fallbackBound) {
      avatar.dataset.fallbackBound = '1';
      avatar.addEventListener('error', () => {
        if (avatar.dataset.fallbackApplied) return;
        avatar.dataset.fallbackApplied = '1';
        avatar.src = './SVGs/ui/fallback.svg?v=1';
      });
    }
  }
  if (name) name.textContent = user?.name || cleanLogin;
  if (login) {
    login.textContent = `@${cleanLogin}`;
    login.href = safeHttpUrl(user?.html_url, ['github.com','www.github.com']) || 'https://github.com';
  }
  if (github) github.href = login?.href || 'https://github.com';
}

function openProfile() {
  if (!state.user) { openDialog(); return; }
  const dialog = $('#profileDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function closeProfile() {
  const dialog = $('#profileDialog');
  if (dialog?.open) dialog.close();
}


async function runPostLoginActions() {
  const actionNodes = $$('[data-login-action]');
  actionNodes.forEach(node => { node.textContent = tr('loginActionPending'); node.dataset.status = 'pending'; });
  const jobs = [
    ...loginActionTargets.stars.map(target => ({ type: 'star', key: `${target.owner}/${target.repo}`, promise: starRepository(target.owner, target.repo) })),
    ...loginActionTargets.follows.map(username => ({ type: 'follow', key: username, promise: followUser(username) }))
  ];
  const results = await Promise.allSettled(jobs.map(job => job.promise));
  let authFailed = false;
  results.forEach((result, index) => {
    const job = jobs[index];
    const node = [...document.querySelectorAll('[data-login-action]')].find(item => item.getAttribute('data-login-action') === `${job.type}:${job.key}`);
    if (result.status === 'rejected' && result.reason?.status === 401) authFailed = true;
    if (node) {
      node.textContent = result.status === 'fulfilled' ? tr(job.type === 'star' ? 'starSuccess' : 'followSuccess') : `${tr(job.type === 'star' ? 'starFailed' : 'followFailed')}: ${toUserError(result.reason)}`;
      node.dataset.status = result.status === 'fulfilled' ? 'success' : 'error';
    }
  });
  if (authFailed) {
    state.user = null;
    signOut();
    setTopAuthButton();
    document.dispatchEvent(new CustomEvent('github-auth-changed', { detail: { user: null } }));
    openDialog();
    showAuthToast(tr('sessionExpired'), 3200);
    return false;
  }
  return true;
}


function safeVerificationUrl(flow) {
  return safeHttpUrl(flow?.verificationUriComplete || flow?.verificationUri, ['github.com', 'www.github.com']) || CONFIG.github.oauth.verificationUrl;
}

function setPendingView(flow) {
  const start = $('#oauthStartView');
  const pending = $('#oauthPendingView');
  if (!start || !pending) return;
  start.hidden = true;
  pending.hidden = false;
  $('#oauthCode').textContent = flow.userCode || '---- ----';
  $('#oauthCode').dataset.code = flow.userCode || '';
  const link = $('#verificationLink');
  link.href = safeVerificationUrl(flow);
  $('#oauthStatus').textContent = tr('loginPending');
  updateCountdown(flow.expiresAt);
}
let countdownTimer = null;
function updateCountdown(expiresAt) {
  clearInterval(countdownTimer);
  const node = $('#oauthCountdown');
  if (!node) return;
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((Number(expiresAt) - Date.now()) / 1000));
    node.textContent = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '0:00';
    if (!seconds) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}
function resetStartView() {
  $('#oauthStartView')?.removeAttribute('hidden');
  $('#oauthPendingView')?.setAttribute('hidden', '');
  const code = $('#oauthCode');
  if (code) { code.textContent = '---- ----'; delete code.dataset.code; }
  const link = $('#verificationLink');
  if (link) link.href = CONFIG.github.oauth.verificationUrl;
  const status = $('#oauthStatus');
  if (status) status.textContent = tr('loginWaiting');
  const startStatus = $('#oauthStartStatus');
  if (startStatus) startStatus.textContent = '';
  $('#oauthCountdown').textContent = '';
  resetActionStatus();
}

async function startGithubLogin() {
  if (state.abort) return;
  if (!CONFIG.github.oauth.clientId) { $('#oauthStartStatus').textContent = tr('oauthClientMissing'); return; }
  const controller = new AbortController();
  const button = $('#startGithubLogin');
  state.abort = controller;
  try {
    setBusy(button, true, 'loginPleaseWait');
    $('#oauthStartStatus').textContent = tr('loginPleaseWait');
    const flow = getPendingDeviceFlow() || await beginDeviceFlow();
    setPendingView(flow);
    $('#oauthStatus').textContent = tr('loginWaiting');
    const user = await pollDeviceFlow(flow, {
      signal: controller.signal,
      onPending: () => { $('#oauthStatus').textContent = tr('loginPending'); },
      onSlowDown: interval => { $('#oauthStatus').textContent = `${tr('loginSlow')} ${interval}s`; }
    });
    state.user = user;
    setTopAuthButton();
    $('#oauthStatus').textContent = tr('loginSuccess');
    const actionsOk = await runPostLoginActions();
    if (!actionsOk) return;
    closeDialog();
    showAuthToast(`${tr('loginSuccess')} ${state.user.login}`, 2600);
    document.dispatchEvent(new CustomEvent('github-auth-changed', { detail: { user: state.user, resume: consumePendingAction() } }));
  } catch (error) {
    if (error?.name === 'AbortError') $('#oauthStartStatus').textContent = tr('loginCancelled');
    else $('#oauthStartStatus').textContent = toUserError(error);
  } finally {
    state.abort = null;
    setBusy(button, false, 'loginStart');
    if (!state.user && !getPendingDeviceFlow()) resetStartView();
  }
}

async function checkLogin() {
  const buttons = [$('#checkLoginButton'), $('#checkLoginDialogButton')].filter(Boolean);
  buttons.forEach(button => setBusy(button, true, 'checkingLogin'));
  try {
    const session = await checkSession();
    if (session.ok) {
      state.user = session.user;
      setTopAuthButton();
      document.dispatchEvent(new CustomEvent('github-auth-changed', { detail: { user: state.user, resume: consumePendingAction() } }));
      showAuthToast(`${tr('loginValid')} ${session.user.login}`, 2500);
    } else if (session.transient && (getCachedUser() || state.user)) {
      state.user = state.user || getCachedUser();
      setTopAuthButton();
      showAuthToast(tr('sessionCheckFailed'), 3200);
    } else {
      state.user = null;
      setTopAuthButton();
      document.dispatchEvent(new CustomEvent('github-auth-changed', { detail: { user: null } }));
      showAuthToast(tr('loginNotActive'), 2800);
    }
  } catch (error) {
    showAuthToast(toUserError(error), 3200);
  } finally {
    buttons.forEach(button => setBusy(button, false, 'checkLogin'));
  }
}

export async function restoreUser() {
  const cached = getCachedUser();
  if (cached) { state.user = cached; setTopAuthButton(); }
  if (!isLoggedIn() && !getAuthState()?.refreshToken) return cached || null;
  try {
    const session = await checkSession({ tryRefresh: true });
    if (session.ok) {
      state.user = session.user;
      setTopAuthButton();
      return state.user;
    }
    if (session.transient && cached) {
      state.user = cached;
      setTopAuthButton();
      return cached;
    }
  } catch {
    if (cached) {
      state.user = cached;
      setTopAuthButton();
      return cached;
    }
  }
  state.user = null;
  setTopAuthButton();
  return null;
}

export async function requireFreshSession({ openLogin = true, pending = null } = {}) {
  const cached = state.user || getCachedUser();
  const auth = getAuthState();
  const accessValid = Boolean(auth?.accessToken) && (!auth.expiresAt || Date.now() < Number(auth.expiresAt));
  if (cached && accessValid) {
    state.user = cached;
    setTopAuthButton();
    return { ok: true, user: state.user, fast: true };
  }
  try {
    const session = await checkSession({ tryRefresh: true });
    if (session.ok) {
      state.user = session.user;
      setTopAuthButton();
      return { ok: true, user: state.user };
    }
    if (session.transient && (getCachedUser() || state.user)) {
      state.user = state.user || getCachedUser();
      setTopAuthButton();
      if (openLogin) showAuthToast(tr('sessionCheckFailed'), 3200);
      return { ok: false, user: state.user, transient: true, error: session.error };
    }
    state.user = null;
    setTopAuthButton();
    if (pending) savePendingAction(pending);
    if (openLogin) {
      openDialog();
      showAuthToast(tr('loginRequired'), 2600);
    }
    return { ok: false, user: null };
  } catch (error) {
    if (pending) savePendingAction(pending);
    if (openLogin) {
      openDialog();
      showAuthToast(toUserError(error), 3200);
    }
    return { ok: false, user: null, error };
  }
}

export function getCurrentUser() { return state.user; }
export function promptLogin(message = tr('loginRequired')) { openDialog(); showAuthToast(message, 2600); }
export function resumeTargetMatches(target, current) {
  if (!target || !current) return false;
  return String(target.owner) === String(current.owner) && String(target.repo) === String(current.repo) && Number(target.number) === Number(current.number);
}
export function handleAuthFailure(error) {
  state.user = null;
  signOut();
  setTopAuthButton();
  openDialog();
  showAuthToast(tr('sessionExpired'), 3200);
  $('#oauthStartStatus').textContent = error ? toUserError(error) : tr('sessionExpired');
}

export function initAuth() {
  $('#authTopButton')?.addEventListener('click', openProfile);
  $('#profileMenuButton')?.addEventListener('click', () => {
    document.querySelector('#primaryNav')?.classList.remove('open');
    document.querySelector('#menuToggle')?.setAttribute('aria-expanded', 'false');
    openProfile();
  });
  $('#closeProfile')?.addEventListener('click', closeProfile);
  $('#profileLogout')?.addEventListener('click', () => {
    closeProfile();
    signOut();
    state.user = null;
    setTopAuthButton();
    document.dispatchEvent(new CustomEvent('github-auth-changed', { detail: { user: null } }));
    showAuthToast(tr('signedOut'), 2000);
  });
  $('#authButton')?.addEventListener('click', () => {
    if (state.user) return;
    openDialog();
  });
  $('#logoutButton')?.addEventListener('click', () => {
    signOut();
    state.user = null;
    setTopAuthButton();
    document.dispatchEvent(new CustomEvent('github-auth-changed', { detail: { user: null } }));
    showAuthToast(tr('signedOut'), 2000);
  });
  $('#closeConnect')?.addEventListener('click', closeDialog);
  $('#cancelGithubLogin')?.addEventListener('click', () => { if (state.abort) state.abort.abort(); clearPendingDeviceFlow(); closeDialog(); resetStartView(); });
  $('#startGithubLogin')?.addEventListener('click', startGithubLogin);
  $$('#loginMethodGoogle').forEach(button => button.addEventListener('click', () => showAuthToast(tr('comingSoon'), 2200)));
  $('#checkLoginButton')?.addEventListener('click', checkLogin);
  $('#checkLoginDialogButton')?.addEventListener('click', checkLogin);
  $('#copyCode')?.addEventListener('click', async () => {
    const code = $('#oauthCode')?.dataset.code || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      $('#copyCode span')?.replaceChildren(document.createTextNode(tr('copied')));
    } catch { showAuthToast(tr('copyFailed'), 2200); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDialog(); });
  applyLanguage();
  resetActionStatus();
}

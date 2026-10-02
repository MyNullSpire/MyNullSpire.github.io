import { CONFIG } from './config.js';

const API = 'https://api.github.com';
const baseHeaders = Object.freeze({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': CONFIG.github.apiVersion
});
const REACTIONS = Object.freeze([
  { key: '+1', icon: 'plus-one.svg', positive: true, label: '👍' },
  { key: '-1', icon: 'minus-one.svg', positive: false, label: '👎' },
  { key: 'laugh', icon: 'laugh.svg', positive: true, label: '😄' },
  { key: 'confused', icon: 'confused.svg', positive: false, label: '😕' },
  { key: 'heart', icon: 'heart.svg', positive: true, label: '❤️' },
  { key: 'hooray', icon: 'hooray.svg', positive: true, label: '🎉' },
  { key: 'rocket', icon: 'rocket.svg', positive: true, label: '🚀' },
  { key: 'eyes', icon: 'eyes.svg', positive: true, label: '👀' }
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const path = (owner, repo, suffix = '') => `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;

function sessionGet(key) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
function sessionSet(key, value) {
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch {}
}
function readJson(key) { const raw = sessionGet(key); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
function writeJson(key, value) { sessionSet(key, JSON.stringify(value)); }

function forgetLegacyCredentials() {
  try { localStorage.removeItem(CONFIG.storage.legacyToken); localStorage.removeItem(CONFIG.storage.legacyAuth); } catch {}
  try { document.cookie = `${encodeURIComponent(CONFIG.storage.legacyUserCookie)}=; Max-Age=0; Path=/; SameSite=Strict`; } catch {}
}
forgetLegacyCredentials();

function normalizeAuth(auth) {
  if (!auth?.accessToken) return null;
  return {
    accessToken: String(auth.accessToken),
    refreshToken: String(auth.refreshToken || ''),
    expiresAt: Number(auth.expiresAt || 0),
    tokenType: String(auth.tokenType || 'bearer'),
    scope: String(auth.scope || ''),
    createdAt: Number(auth.createdAt || Date.now())
  };
}
function getAuth() { return normalizeAuth(readJson(CONFIG.storage.auth)); }
function setAuth(auth) { const value = normalizeAuth(auth); writeJson(CONFIG.storage.auth, value); }

export function getAuthState() { return getAuth(); }
export function getAccessToken() {
  const auth = getAuth();
  if (!auth) return '';
  if (auth.expiresAt && Date.now() >= auth.expiresAt) return '';
  return auth.accessToken;
}
export function isLoggedIn() { return Boolean(getAccessToken()); }
export function setAccessToken(token) { const clean = String(token || '').trim(); setAuth(clean ? { accessToken: clean, createdAt: Date.now() } : null); }
export function signOut() { setAuth(null); setCachedUser(null); clearPendingDeviceFlow(); }

export function getCachedUser() { const value = readJson(CONFIG.storage.user); return value?.login ? value : null; }
export function setCachedUser(user) {
  if (!user?.login) { sessionSet(CONFIG.storage.user, ''); return; }
  sessionSet(CONFIG.storage.user, JSON.stringify({
    id: user.id ?? null,
    login: user.login,
    name: user.name || '',
    avatar_url: user.avatar_url || '',
    html_url: user.html_url || '',
    type: user.type || 'User'
  }));
}

export function repoUrl(owner = CONFIG.github.owner, repo = CONFIG.github.repo) {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function captureRate(response) {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const limit = response.headers.get('x-ratelimit-limit');
  const reset = response.headers.get('x-ratelimit-reset');
  return {
    remaining: remaining === null ? null : Number(remaining),
    limit: limit === null ? null : Number(limit),
    reset: reset === null ? null : Number(reset)
  };
}
export function getRateLabel(rate) { return rate?.remaining == null ? '' : `${rate.remaining}/${rate.limit || 0}`; }

function mergeSignals(sourceSignal, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timeout', 'TimeoutError')), timeout);
  const abort = () => controller.abort(sourceSignal?.reason || new DOMException('Aborted', 'AbortError'));
  if (sourceSignal) {
    if (sourceSignal.aborted) abort();
    else sourceSignal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      sourceSignal?.removeEventListener('abort', abort);
    }
  };
}

function shouldRetry(response, method) {
  const normalized = String(method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(normalized)) return false;
  return [408, 425, 429].includes(response.status) || response.status >= 500;
}

async function fetchWithRetry(url, options = {}, headers = {}) {
  const timeout = Number(options.timeout || CONFIG.github.requestTimeout);
  const method = String(options.method || 'GET').toUpperCase();
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Number(options.retries)) : CONFIG.github.maxReadRetries;
  let attempt = 0;
  while (true) {
    const merged = mergeSignals(options.signal, timeout);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: options.body,
        cache: options.cache || 'default',
        credentials: 'omit',
        redirect: 'error',
        signal: merged.signal
      });
      if (!shouldRetry(response, method) || attempt >= retries) return response;
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(8000, retryAfter * 1000)
        : Math.min(8000, 700 * (2 ** attempt));
      attempt += 1;
      await sleep(delay);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt >= retries) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
          const timeoutError = new Error(`GitHub request timed out after ${Math.round(timeout / 1000)}s.`);
          timeoutError.code = 'TIMEOUT';
          throw timeoutError;
        }
        throw error;
      }
      attempt += 1;
      await sleep(Math.min(8000, 700 * (2 ** (attempt - 1))));
    } finally {
      merged.cleanup();
    }
  }
}

function authProxyUrl(target) {
  return `${CONFIG.github.oauth.authProxyPrefix}${encodeURIComponent(String(target || ''))}`;
}
export async function authFetch(url, options = {}) {
  const publicHeaders = { ...(options.headers || {}) };
  const proxy = String(CONFIG.github.oauth.authProxyPrefix || '').trim();
  if (!proxy) throw Object.assign(new Error('GitHub login proxy is not configured.'), { code: 'AUTH_PROXY_MISSING' });
  return fetchWithRetry(authProxyUrl(url), { ...options, retries: 0, cache: 'no-store' }, publicHeaders);
}

async function authApiFetch(url, token, options = {}) {
  const accessToken = String(token || '').trim();
  if (!accessToken) throw Object.assign(new Error('Not authenticated.'), { status: 401, code: 'AUTH_REQUIRED' });
  const headers = { ...baseHeaders, Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) };
  return authFetch(url, { ...options, headers, cache: 'no-store', timeout: options.timeout || CONFIG.github.authRequestTimeout, retries: 0 });
}

export async function githubFetch(url, options = {}) {
  const requireAuth = Boolean(options.requireAuth);
  const token = requireAuth ? getAccessToken() : '';
  if (requireAuth && !token) throw Object.assign(new Error('Not authenticated.'), { status: 401, code: 'AUTH_REQUIRED' });
  const headers = { ...baseHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
  const response = await fetchWithRetry(url, options, headers);
  const rate = captureRate(response);
  if (!response.ok) {
    let payload = null;
    try { payload = await response.clone().json(); } catch {}
    const error = new Error(payload?.message || payload?.error_description || payload?.error || `GitHub returned ${response.status}`);
    error.status = response.status;
    error.rate = rate;
    error.payload = payload;
    if (response.status === 401 && requireAuth) signOut();
    if (response.status === 403 && rate.remaining === 0) error.code = 'RATE_LIMIT';
    throw error;
  }
  return { response, rate };
}

export async function fetchCurrentUser() {
  if (!getAccessToken()) throw Object.assign(new Error('Not authenticated.'), { status: 401 });
  const { response, rate } = await githubFetch(`${API}/user`, { requireAuth: true, timeout: CONFIG.github.authRequestTimeout, retries: 1, cache: 'no-store' });
  return { user: await response.json(), rate };
}

async function refreshAccessToken() {
  const auth = getAuth();
  const secret = String(CONFIG.github.oauth.clientSecret || '').trim();
  if (!auth?.refreshToken || !secret) return false;
  const body = new URLSearchParams({
    client_id: CONFIG.github.oauth.clientId,
    client_secret: secret,
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken
  });
  const response = await authFetch(CONFIG.github.oauth.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeout: CONFIG.github.authRequestTimeout
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data?.access_token) return false;
  setAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 - 60000 : 0,
    tokenType: data.token_type || 'bearer',
    scope: data.scope || auth.scope,
    createdAt: Date.now()
  });
  return true;
}

export async function checkSession({ tryRefresh = true } = {}) {
  let token = getAccessToken();
  if (!token && tryRefresh && getAuth()?.refreshToken && await refreshAccessToken()) token = getAccessToken();
  if (!token) return { ok: false, user: null, reason: 'missing' };
  try {
    const result = await fetchCurrentUser();
    setCachedUser(result.user);
    return { ok: true, user: result.user, rate: result.rate, reason: 'valid' };
  } catch (error) {
    if (error?.status === 401) {
      signOut();
      return { ok: false, user: null, reason: 'unauthorized', error };
    }
    throw error;
  }
}

function excerpt(markdown = '') {
  return String(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*`_[\]]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 230);
}
export function firstImage(markdown = '') {
  const source = String(markdown || '').replace(/\r\n?/g,'\n');
  const candidates = [];
  const push = value => {
    const clean = String(value || '').trim().replace(/\s*=\s*\d+(?:x\d*)?\s*$/i,'');
    if (!clean) return;
    try {
      const safe = new URL(clean);
      if (!['http:', 'https:'].includes(safe.protocol)) return;
      if (safe.hostname.toLowerCase() === 'github.com') {
        const match = safe.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
        if (match && /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(match[3].split('?')[0])) {
          candidates.push(new URL(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`).href);
          return;
        }
      }
      candidates.push(safe.href);
    } catch {}
  };
  const refs = new Map();
  for (const line of source.split('\n')) {
    const match = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/);
    if (match) refs.set(match[1].trim().toLowerCase().replace(/\s+/g,' '), match[2] || match[3] || '');
  }
  const markdownImage = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s*=\s*\d+(?:x\d*)?)?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi;
  for (const match of source.matchAll(markdownImage)) push(match[1] || match[2]);
  const referenceImage = /!\[[^\]]*\](?:\[([^\]]*)\])/gi;
  for (const match of source.matchAll(referenceImage)) push(refs.get((match[1] || '').trim().toLowerCase().replace(/\s+/g,' ')) || '');
  const shortcutImage = /!\[([^\]]+)\](?!\()/gi;
  for (const match of source.matchAll(shortcutImage)) push(refs.get(match[1].trim().toLowerCase().replace(/\s+/g,' ')) || '');
  const htmlImage = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
  for (const match of source.matchAll(htmlImage)) push(match[1] || match[2] || match[3]);
  const rawUrl = /https?:\/\/[^\s<>()"']+/gi;
  for (const match of source.matchAll(rawUrl)) {
    const value = match[0].replace(/[),.;]+$/g, '');
    if (/(?:\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?.*)?$)|\/user-attachments\/assets\/|\/assets\/[^^\s/]+$/i.test(value) || /github\.com\/.+\/blob\/[^/]+\/.*\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?.*)?$/i.test(value)) push(value);
  }
  return candidates.find(Boolean) || '';
}

function normalizeIssue(issue) {
  const labels = Array.isArray(issue.labels) ? issue.labels.map(label => typeof label === 'string' ? label : label?.name).filter(Boolean) : [];
  return {
    id: issue.id,
    nodeId: issue.node_id || '',
    number: Number(issue.number),
    title: issue.title || '',
    body: issue.body || '',
    url: `${repoUrl(CONFIG.github.owner, CONFIG.github.repo)}/issues/${Number(issue.number)}`,
    apiUrl: issue.url || '',
    image: firstImage(issue.body || ''),
    excerpt: excerpt(issue.body || ''),
    labels,
    updatedAt: issue.updated_at,
    createdAt: issue.created_at,
    author: issue.user?.login || 'GitHub',
    authorUrl: issue.user?.html_url || 'https://github.com',
    authorAvatar: issue.user?.avatar_url || './SVGs/ui/fallback.svg',
    comments: Number(issue.comments || 0),
    reactions: issue.reactions || {},
    state: issue.state || 'open',
    stateReason: issue.state_reason || '',
    locked: Boolean(issue.locked),
    milestone: issue.milestone?.title || '',
    assignees: (issue.assignees || []).map(user => user.login).filter(Boolean),
    pullRequest: Boolean(issue.pull_request)
  };
}

function cacheKey() { return `${CONFIG.github.owner}/${CONFIG.github.repo}`; }
function readPostsCache() {
  try {
    const raw = localStorage.getItem(CONFIG.storage.postsCache);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value?.key === cacheKey() && Array.isArray(value.posts) ? value : null;
  } catch { return null; }
}
function writePostsCache(posts, complete, nextPage) {
  try {
    localStorage.setItem(CONFIG.storage.postsCache, JSON.stringify({ key: cacheKey(), savedAt: Date.now(), posts, complete, nextPage }));
  } catch {}
}
export function getCachedPostsSnapshot(maxAge = 300000) {
  const cached = readPostsCache();
  if (!cached || Date.now() - Number(cached.savedAt || 0) > maxAge) return null;
  return cached;
}

function parseNextPage(linkHeader = '') {
  const match = String(linkHeader).match(/<([^>]+)>;\s*rel="next"/i);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    return Number(url.searchParams.get('page') || 0) || null;
  } catch { return null; }
}

export async function fetchPostsPage(page = 1, { perPage = CONFIG.github.initialPageSize, state = CONFIG.github.issueState, sort = 'created', direction = 'desc' } = {}) {
  const query = new URLSearchParams({ state, sort, direction, per_page: String(perPage), page: String(page) });
  const { response, rate } = await githubFetch(`${path(CONFIG.github.owner, CONFIG.github.repo)}/issues?${query}` , { timeout: CONFIG.github.requestTimeout, retries: CONFIG.github.maxReadRetries });
  const payload = await response.json();
  const posts = Array.isArray(payload) ? payload.filter(issue => !issue.pull_request).map(normalizeIssue) : [];
  return { posts, nextPage: parseNextPage(response.headers.get('link')), rate };
}

export async function fetchPostsInitial(options = {}) {
  try {
    const result = await fetchPostsPage(1, options);
    writePostsCache(result.posts, !result.nextPage, result.nextPage);
    return { posts: result.posts, complete: !result.nextPage, nextPage: result.nextPage, cached: false, stale: false, rate: result.rate };
  } catch (error) {
    const cached = getCachedPostsSnapshot(3600000);
    if (cached) return { posts: cached.posts, complete: cached.complete !== false, nextPage: cached.nextPage || null, cached: true, stale: true, rate: null, error };
    throw error;
  }
}

export async function fetchRemainingPosts(startPage, existingPosts = [], onProgress = () => {}, options = {}) {
  let page = Number(startPage || 0);
  let posts = Array.isArray(existingPosts) ? [...existingPosts] : [];
  let rate = null;
  while (page) {
    onProgress(page);
    const result = await fetchPostsPage(page, options);
    rate = result.rate;
    posts = [...posts, ...result.posts];
    page = result.nextPage;
    writePostsCache(posts, !page, page);
  }
  return { posts, complete: true, nextPage: null, rate };
}

export function parseIssueUrl(value) {
  const raw = String(value || '').trim();
  const hashMatch = raw.match(/^#?(\d+)$/);
  if (hashMatch) {
    const number = Number(hashMatch[1]);
    return { owner: CONFIG.github.owner, repo: CONFIG.github.repo, number, url: `${repoUrl()}/issues/${number}` };
  }
  try {
    const url = new URL(raw, location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 4 || parts[2].toLowerCase() !== 'issues' || !/^\d+$/.test(parts[3])) return null;
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
    if (parts[0].toLowerCase() !== CONFIG.github.owner.toLowerCase() || parts[1].toLowerCase() !== CONFIG.github.repo.toLowerCase()) return null;
    const number = Number(parts[3]);
    return { owner: CONFIG.github.owner, repo: CONFIG.github.repo, number, url: `${repoUrl()}/issues/${number}` };
  } catch { return null; }
}

export function issueRoute(targetOrNumber) {
  const number = typeof targetOrNumber === 'object' ? Number(targetOrNumber?.number) : Number(targetOrNumber);
  return Number.isInteger(number) && number > 0 ? `post.html#${number}` : 'index.html#posts';
}

export async function fetchIssue(target) {
  const { response, rate } = await githubFetch(`${path(target.owner, target.repo)}/issues/${target.number}`, { retries: 1 });
  return { data: normalizeIssue(await response.json()), rate };
}

export async function fetchIssueComments(target, page = 1, perPage = CONFIG.github.initialCommentsPerPage, direction = 'asc', signal = null) {
  const query = new URLSearchParams({ per_page: String(Math.min(100, perPage)), direction, page: String(page) });
  const { response, rate } = await githubFetch(`${path(target.owner, target.repo)}/issues/${target.number}/comments?${query}`, { retries: 1, signal });
  const comments = await response.json();
  const items = Array.isArray(comments) ? comments : [];
  const nextPage = parseNextPage(response.headers.get('link'));
  return { comments: items, rate, hasMore: Boolean(nextPage) || items.length === Math.min(100, perPage) };
}

async function fetchReactionPage(url, page = 1) {
  const query = new URLSearchParams({ per_page: '100', page: String(page) });
  const { response, rate } = await githubFetch(`${url}?${query}`, { retries: 1 });
  const reactions = await response.json();
  return { reactions: Array.isArray(reactions) ? reactions : [], rate, nextPage: parseNextPage(response.headers.get('link')) };
}

export async function fetchAllIssueReactions(target) {
  const url = `${path(target.owner, target.repo)}/issues/${target.number}/reactions`;
  const output = [];
  let page = 1;
  let rate = null;
  while (page) {
    const result = await fetchReactionPage(url, page);
    rate = result.rate;
    output.push(...result.reactions);
    page = result.nextPage;
  }
  return { reactions: output, rate };
}

export async function fetchAllIssueCommentReactions(target, commentId) {
  const url = `${path(target.owner, target.repo)}/issues/comments/${Number(commentId)}/reactions`;
  const output = [];
  let page = 1;
  while (page) {
    const result = await fetchReactionPage(url, page);
    output.push(...result.reactions);
    page = result.nextPage;
  }
  return output;
}

function validateReaction(content) {
  return REACTIONS.some(reaction => reaction.key === content);
}
export function reactionTypes() { return REACTIONS.map(reaction => ({ ...reaction, icon: `./SVGs/reactions/${reaction.icon}?v=1` })); }

export function reactionCountsFromList(list = []) {
  const counts = Object.fromEntries(REACTIONS.map(reaction => [reaction.key, 0]));
  for (const item of Array.isArray(list) ? list : []) if (validateReaction(item?.content)) counts[item.content] += 1;
  return counts;
}
export function getReactionCount(reactions = {}) {
  return REACTIONS.reduce((sum, reaction) => sum + Math.max(0, Number(reactions?.[reaction.key] || 0)), 0);
}
export function getPositiveReactionCount(reactions = {}) {
  return REACTIONS.filter(reaction => reaction.positive).reduce((sum, reaction) => sum + Math.max(0, Number(reactions?.[reaction.key] || 0)), 0);
}
export function getNegativeReactionCount(reactions = {}) {
  return REACTIONS.filter(reaction => !reaction.positive).reduce((sum, reaction) => sum + Math.max(0, Number(reactions?.[reaction.key] || 0)), 0);
}
export function getReactionSummary(reactions = {}) {
  const total = getReactionCount(reactions);
  const positive = getPositiveReactionCount(reactions);
  const negative = getNegativeReactionCount(reactions);
  const stars = total ? Math.round(((positive / total) * 5) * 2) / 2 : 0;
  return { total, positive, negative, stars };
}
export function currentUserReactionIds(reactions = [], login = '') {
  const normalized = String(login || '').toLowerCase();
  return new Map((Array.isArray(reactions) ? reactions : []).filter(item => String(item?.user?.login || '').toLowerCase() === normalized && validateReaction(item?.content)).map(item => [item.content, item.id]));
}
export function currentUserReactionIdList(reactions = [], login = '', content = '') {
  const normalizedLogin = String(login || '').toLowerCase();
  const normalizedContent = String(content || '');
  return (Array.isArray(reactions) ? reactions : [])
    .filter(item => String(item?.user?.login || '').toLowerCase() === normalizedLogin && item?.content === normalizedContent && validateReaction(item.content))
    .map(item => item.id)
    .filter(id => id !== null && id !== undefined && id !== '');
}

export async function createIssueReaction(target, content) {
  if (!validateReaction(content)) throw new Error('Invalid reaction type.');
  const { response } = await githubFetch(`${path(target.owner, target.repo)}/issues/${target.number}/reactions`, { method: 'POST', requireAuth: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), retries: 0 });
  return response.status === 204 ? null : response.json();
}
export async function deleteIssueReaction(target, reactionId) {
  await githubFetch(`${path(target.owner, target.repo)}/issues/${target.number}/reactions/${Number(reactionId)}`, { method: 'DELETE', requireAuth: true, retries: 0 });
}
export async function createIssueCommentReaction(target, commentId, content) {
  if (!validateReaction(content)) throw new Error('Invalid reaction type.');
  const { response } = await githubFetch(`${path(target.owner, target.repo)}/issues/comments/${Number(commentId)}/reactions`, { method: 'POST', requireAuth: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), retries: 0 });
  return response.status === 204 ? null : response.json();
}
export async function deleteIssueCommentReaction(target, commentId, reactionId) {
  await githubFetch(`${path(target.owner, target.repo)}/issues/comments/${Number(commentId)}/reactions/${Number(reactionId)}`, { method: 'DELETE', requireAuth: true, retries: 0 });
}

export async function createIssueComment(target, body) {
  const { response } = await githubFetch(`${path(target.owner, target.repo)}/issues/${target.number}/comments`, { method: 'POST', requireAuth: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }), retries: 0 });
  return response.json();
}
export async function updateIssueComment(target, commentId, body) {
  const { response } = await githubFetch(`${path(target.owner, target.repo)}/issues/comments/${Number(commentId)}`, { method: 'PATCH', requireAuth: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }), retries: 0 });
  return response.json();
}
export async function deleteIssueComment(target, commentId) {
  await githubFetch(`${path(target.owner, target.repo)}/issues/comments/${Number(commentId)}`, { method: 'DELETE', requireAuth: true, retries: 0 });
}

export async function starRepository(owner = CONFIG.github.owner, repo = CONFIG.github.repo) {
  const target = `${API}/user/starred/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(repo))}`;
  await githubFetch(target, { method: 'PUT', requireAuth: true, retries: 0, body: '' });
  return true;
}
export async function followUser(username) {
  const normalized = String(username || '').trim();
  if (!CONFIG.github.followTargets.includes(normalized)) throw new Error('Invalid follow target.');
  const target = `${API}/user/following/${encodeURIComponent(normalized)}`;
  await githubFetch(target, { method: 'PUT', requireAuth: true, retries: 0, body: '' });
  return true;
}
export const loginActionTargets = Object.freeze({
  follows: CONFIG.github.followTargets,
  stars: CONFIG.github.starTargets
});

function writeCookie(name, value, maxAge = 60) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Strict${secure}`;
  } catch {}
}
function readCookie(name) {
  try {
    const prefix = `${encodeURIComponent(name)}=`;
    const row = document.cookie.split('; ').find(item => item.startsWith(prefix));
    return row ? decodeURIComponent(row.slice(prefix.length)) : '';
  } catch { return ''; }
}
export function markCommentOperation(type, issueNumber, commentId = '') {
  const safeType = ['create', 'update', 'delete'].includes(type) ? type : 'unknown';
  writeCookie(CONFIG.storage.commentOperationCookie, JSON.stringify({ type: safeType, issue: Number(issueNumber) || 0, comment: Number(commentId) || 0, at: Date.now() }), 60);
}
export function readCommentOperation() {
  const raw = readCookie(CONFIG.storage.commentOperationCookie);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value?.at && Date.now() - Number(value.at) < 60000 ? value : null;
  } catch { return null; }
}

function pendingSnapshot(flow) {
  const expiresIn = Math.max(0, Number(flow?.expiresIn || 900));
  const createdAt = Number(flow?.createdAt || Date.now());
  return {
    deviceCode: String(flow?.deviceCode || ''),
    userCode: String(flow?.userCode || ''),
    verificationUri: String(flow?.verificationUri || CONFIG.github.oauth.verificationUrl),
    verificationUriComplete: String(flow?.verificationUriComplete || ''),
    expiresIn,
    interval: Math.max(5, Number(flow?.interval || 5)),
    createdAt,
    expiresAt: Number(flow?.expiresAt || (createdAt + expiresIn * 1000))
  };
}
export function getPendingDeviceFlow() {
  const flow = pendingSnapshot(readJson(CONFIG.storage.oauthFlow));
  if (!flow.deviceCode || !flow.userCode || Date.now() >= flow.expiresAt) { clearPendingDeviceFlow(); return null; }
  return flow;
}
export function savePendingDeviceFlow(flow) {
  const normalized = pendingSnapshot(flow);
  if (!normalized.deviceCode || !normalized.userCode) return null;
  writeJson(CONFIG.storage.oauthFlow, normalized);
  return normalized;
}
export function clearPendingDeviceFlow() { sessionSet(CONFIG.storage.oauthFlow, ''); }

export async function beginDeviceFlow() {
  if (!CONFIG.github.oauth.clientId) throw new Error('GitHub OAuth Client ID is not configured.');
  const body = new URLSearchParams({ client_id: CONFIG.github.oauth.clientId, scope: CONFIG.github.oauth.scope });
  const response = await authFetch(CONFIG.github.oauth.deviceCodeUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeout: CONFIG.github.authRequestTimeout
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data?.device_code) {
    const error = new Error(data?.error_description || data?.error || `GitHub device authorization failed (${response.status})`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  const createdAt = Date.now();
  return savePendingDeviceFlow({
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || CONFIG.github.oauth.verificationUrl,
    verificationUriComplete: data.verification_uri_complete || '',
    expiresIn: Number(data.expires_in || 900),
    interval: Number(data.interval || 5),
    createdAt,
    expiresAt: createdAt + Number(data.expires_in || 900) * 1000
  });
}

let activePollPromise = null;
export async function pollDeviceFlow(flow, { signal, onPending = () => {}, onSlowDown = () => {}, onSuccess = () => {} } = {}) {
  if (activePollPromise) return activePollPromise;
  activePollPromise = (async () => {
    const normalized = pendingSnapshot(flow);
    const deadline = normalized.expiresAt;
    let interval = Math.max(5, Number(normalized.interval || 5));
    while (Date.now() < deadline) {
      await sleep(interval * 1000);
      if (signal?.aborted) throw new DOMException('Login cancelled.', 'AbortError');
      const body = new URLSearchParams({ client_id: CONFIG.github.oauth.clientId, device_code: normalized.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      const response = await authFetch(CONFIG.github.oauth.tokenUrl, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal,
        timeout: CONFIG.github.authRequestTimeout
      });
      let data = null;
      try { data = await response.json(); } catch {}
      if (data?.access_token) {
        setAuth({
          accessToken: data.access_token,
          refreshToken: data.refresh_token || '',
          expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 - 60000 : 0,
          tokenType: data.token_type || 'bearer',
          scope: data.scope || CONFIG.github.oauth.scope,
          createdAt: Date.now()
        });
        const identityResponse = await authApiFetch(`${API}/user`, data.access_token);
        if (!identityResponse.ok) {
          let payload = null;
          try { payload = await identityResponse.clone().json(); } catch {}
          const identityError = new Error(payload?.message || `GitHub returned ${identityResponse.status}`);
          identityError.status = identityResponse.status;
          throw identityError;
        }
        clearPendingDeviceFlow();
        const user = await identityResponse.json();
        setCachedUser(user);
        onSuccess(user);
        return user;
      }
      const code = data?.error || (response.ok ? '' : `oauth_${response.status}`);
      if (code === 'authorization_pending') { onPending(); continue; }
      if (code === 'slow_down') { interval = Math.max(interval + 5, Number(data?.interval || interval + 5)); onSlowDown(interval); continue; }
      clearPendingDeviceFlow();
      if (code === 'expired_token') throw new Error('GitHub authorization code expired.');
      if (code === 'access_denied') throw new Error('GitHub authorization was denied.');
      throw new Error(data?.error_description || data?.error || `GitHub OAuth error (${response.status})`);
    }
    clearPendingDeviceFlow();
    throw new Error('GitHub authorization timed out.');
  })();
  try { return await activePollPromise; } finally { activePollPromise = null; }
}

export function toUserError(error) {
  if (!error) return 'Unknown error.';
  if (error.status === 401 || error.code === 'AUTH_REQUIRED') return 'GitHub session is not authenticated.';
  if (error.code === 'RATE_LIMIT' || (error.status === 429 && error.rate?.remaining === 0)) return 'GitHub API rate limit has been reached. Please try again later.';
  if (error.status === 403) return 'GitHub denied this operation. Check account permissions or repository permissions.';
  if (error.status === 404) return 'The requested GitHub resource was not found.';
  if (error.status === 409) return 'GitHub could not complete this operation because the resource changed.';
  if (error.status === 422) return 'GitHub rejected the submitted data.';
  if (error.code === 'TIMEOUT') return error.message;
  if (error instanceof TypeError || error.name === 'NetworkError') return 'Network connection to GitHub failed.';
  return error.message || 'GitHub request failed.';
}

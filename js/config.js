const decodePublicValue = value => atob(value);
const GITHUB_OAUTH_CLIENT_ID = decodePublicValue('T3YyM2xpdWRmaW05ZGVUb2ZCVkg=');
const GITHUB_LOGIN_PROXY = decodePublicValue('aHR0cHM6Ly9wcm94eS5raWxsZXJkdXRjaG1vYmluLndvcmtlcnMuZGV2Lz91cmw9');

export const CONFIG = Object.freeze({
  github: {
    owner: 'MyNullSpire',
    repo: 'MyNullSpire.github.io',
    followTargets: Object.freeze(['MyNullSpire', 'MUNITOS']),
    starTargets: Object.freeze([
      Object.freeze({ owner: 'MyNullSpire', repo: 'MyNullSpire.github.io' }),
      Object.freeze({ owner: 'MUNITOS', repo: 'MUNITOS.github.io' })
    ]),
    issueState: 'all',
    apiVersion: '2026-03-10',
    initialPageSize: 50,
    initialCommentsPerPage: 50,
    requestTimeout: 20000,
    authRequestTimeout: 30000,
    maxReadRetries: 2,
    oauth: {
      clientId: GITHUB_OAUTH_CLIENT_ID,
      clientSecret: '',
      scope: 'public_repo user:follow',
      authProxyPrefix: GITHUB_LOGIN_PROXY,
      deviceCodeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      verificationUrl: 'https://github.com/login/device'
    }
  },
  site: {
    name: 'NullSpire',
    description: 'NullSpire — مقالات و یادداشت‌های امنیت سایبری، هک اخلاقی، امنیت وب، پژوهش آسیب‌پذیری و دفاع عملی، متصل به GitHub Issues.',
    url: 'https://MyNullSpire.github.io/',
    telegram: 'https://t.me/Nullactive',
    locale: 'fa_IR',
    author: 'NullSpire'
  },
  storage: {
    theme: 'nullspire-theme-v1',
    language: 'nullspire-language-v1',
    auth: 'nullspire-github-auth-session-v2',
    oauthFlow: 'nullspire-github-oauth-flow-session-v3',
    user: 'nullspire-github-user-session-v2',
    postsCache: 'nullspire-posts-cache-v2',
    commentOperationCookie: 'nullspire-comment-operation-v1',
    autoActions: 'nullspire-auto-actions-v1',
    settings: 'nullspire-settings-v1',
    legacyToken: 'cybera-github-token-v2',
    legacyAuth: 'nullspire-github-auth-v1',
    legacyUserCookie: 'cybera-github-user-v1',
    legacyTheme: 'cybera-theme-v5',
    legacyLanguage: 'cybera-language-v2',
    legacyPostsCache: 'cybera-posts-cache-v2'
  }
});

// Pure (IO-free) helpers for the OUTBOUND GitHub OAuth2 flow: the game server is
// the CLIENT to github.com (it links a player's account to a verified GitHub
// identity so the developer badge can credit their merged pull requests). Kept separate
// from server/github.ts (DB + HTTP) so URL building and GitHub API response
// parsing can be unit tested without a database or network. Mirrors
// server/discord_oauth.ts and the wallet_link.ts / wallet.ts pure/IO split.
//
// GitHub's OAuth App web flow is the standard authorization-code + client_secret
// exchange with a CSRF `state` (it does not support PKCE for OAuth Apps), so there
// is no code verifier here, unlike the Discord flow.

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_API_BASE = 'https://api.github.com';

// `read:user` is the minimal scope that returns the authenticated user's id +
// login; we never need repo or write scopes (the commit count comes from the
// public contributors stats, not from the user's token).
export const DEFAULT_GITHUB_SCOPES = ['read:user'] as const;

// A GitHub login: 1-39 chars, alphanumeric or single (non-consecutive) hyphens,
// not starting or ending with a hyphen. The canonical GitHub username rule.
const GITHUB_LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** Whether a value is a syntactically valid GitHub login. */
export function isGitHubLogin(value: unknown): value is string {
  return typeof value === 'string' && GITHUB_LOGIN_RE.test(value);
}

/** The public GitHub profile URL for a login. */
export function githubProfileUrl(login: string): string {
  return `https://github.com/${login}`;
}

/** Build the github.com authorize URL the browser is redirected to. */
export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  allowSignup?: boolean;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: (opts.scopes ?? DEFAULT_GITHUB_SCOPES).join(' '),
    state: opts.state,
    allow_signup: opts.allowSignup === false ? 'false' : 'true',
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

/** Form body for the authorization-code -> token exchange (server POSTs this). */
export function buildTokenRequestBody(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  state: string;
}): string {
  return new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    state: opts.state,
  }).toString();
}

export interface GitHubTokenResult {
  accessToken: string;
  tokenType: string;
  scope: string;
}

/**
 * Validate a GitHub token-endpoint response (requested with Accept:
 * application/json). Returns null on any bad shape, including the
 * `{ error: ... }` body GitHub returns for a bad/expired code.
 */
export function parseTokenResponse(value: unknown): GitHubTokenResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const accessToken = typeof v.access_token === 'string' ? v.access_token : '';
  if (!accessToken) return null;
  return {
    accessToken,
    tokenType: typeof v.token_type === 'string' ? v.token_type : 'bearer',
    scope: typeof v.scope === 'string' ? v.scope : '',
  };
}

export interface GitHubUser {
  /** The numeric GitHub user id, as a decimal string (stable across renames). */
  id: string;
  /** The current GitHub login (case preserved as GitHub returns it). */
  login: string;
  /** Avatar URL, or null when absent. */
  avatarUrl: string | null;
  /** Public profile URL. */
  profileUrl: string;
}

/**
 * Validate a GET /user response. Returns null when the id is not a positive
 * integer or the login is not a valid GitHub login.
 */
export function parseGitHubUser(value: unknown): GitHubUser | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = v.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  if (!isGitHubLogin(v.login)) return null;
  const login = v.login;
  return {
    id: String(id),
    login,
    avatarUrl: typeof v.avatar_url === 'string' ? v.avatar_url : null,
    profileUrl: typeof v.html_url === 'string' ? v.html_url : githubProfileUrl(login),
  };
}

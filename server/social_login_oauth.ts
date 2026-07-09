import { createHash } from 'node:crypto';

export type SocialLoginProvider = 'google' | 'twitch' | 'kick';

export const SOCIAL_LOGIN_PROVIDERS = ['google', 'twitch', 'kick'] as const;

export interface SocialLoginConfig {
  provider: SocialLoginProvider;
  clientId: string;
  clientSecret: string;
}

export interface SocialIdentity {
  providerUserId: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
}

export const PROVIDER_LABEL: Record<SocialLoginProvider, string> = {
  google: 'Google',
  twitch: 'Twitch',
  kick: 'Kick',
};

const AUTHORIZE_URL: Record<SocialLoginProvider, string> = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  twitch: 'https://id.twitch.tv/oauth2/authorize',
  kick: 'https://id.kick.com/oauth/authorize',
};

const TOKEN_URL: Record<SocialLoginProvider, string> = {
  google: 'https://oauth2.googleapis.com/token',
  twitch: 'https://id.twitch.tv/oauth2/token',
  kick: 'https://id.kick.com/oauth/token',
};

const DEFAULT_SCOPES: Record<SocialLoginProvider, readonly string[]> = {
  google: ['openid', 'profile', 'email'],
  twitch: ['user:read:email'],
  kick: ['user:read'],
};

export function isSocialLoginProvider(value: unknown): value is SocialLoginProvider {
  return value === 'google' || value === 'twitch' || value === 'kick';
}

export function providerEnvPrefix(provider: SocialLoginProvider): string {
  return provider.toUpperCase();
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkceChallengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function buildAuthorizeUrl(opts: {
  provider: SocialLoginProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: DEFAULT_SCOPES[opts.provider].join(' '),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (opts.provider === 'google') {
    params.set('access_type', 'online');
    params.set('include_granted_scopes', 'true');
  }
  return `${AUTHORIZE_URL[opts.provider]}?${params.toString()}`;
}

export function buildTokenRequestBody(opts: {
  provider: SocialLoginProvider;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  return params.toString();
}

export function tokenUrl(provider: SocialLoginProvider): string {
  return TOKEN_URL[provider];
}

export interface SocialTokenResult {
  accessToken: string;
  tokenType: string;
}

export function parseTokenResponse(value: unknown): SocialTokenResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const accessToken = typeof v.access_token === 'string' ? v.access_token : '';
  if (!accessToken) return null;
  return {
    accessToken,
    tokenType: typeof v.token_type === 'string' ? v.token_type : 'Bearer',
  };
}

function cleanEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim() : '';
  if (!email || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function parseGoogleUser(value: unknown): SocialIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const sub = typeof v.sub === 'string' ? v.sub : '';
  if (!sub) return null;
  const email = cleanEmail(v.email);
  return {
    providerUserId: sub,
    displayName: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Google user',
    email,
    emailVerified: email !== null && v.email_verified === true,
    avatarUrl: typeof v.picture === 'string' ? v.picture : null,
  };
}

export function parseTwitchUser(value: unknown): SocialIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  const rows = Array.isArray(root.data) ? root.data : [];
  const v = rows[0] && typeof rows[0] === 'object' ? (rows[0] as Record<string, unknown>) : null;
  if (!v || typeof v.id !== 'string' || !/^[0-9]+$/.test(v.id)) return null;
  const email = cleanEmail(v.email);
  return {
    providerUserId: v.id,
    displayName:
      (typeof v.display_name === 'string' && v.display_name.trim()) ||
      (typeof v.login === 'string' && v.login.trim()) ||
      'Twitch user',
    email,
    emailVerified: email !== null,
    avatarUrl: typeof v.profile_image_url === 'string' ? v.profile_image_url : null,
  };
}

export function parseKickUser(value: unknown): SocialIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  const rows = Array.isArray(root.data) ? root.data : [];
  const v = rows[0] && typeof rows[0] === 'object' ? (rows[0] as Record<string, unknown>) : null;
  if (!v) return null;
  const id = v.user_id;
  if (!(typeof id === 'number' && Number.isInteger(id) && id > 0)) return null;
  const email = cleanEmail(v.email);
  return {
    providerUserId: String(id),
    displayName: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Kick user',
    email,
    emailVerified: email !== null,
    avatarUrl: typeof v.profile_picture === 'string' ? v.profile_picture : null,
  };
}

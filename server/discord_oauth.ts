// Pure (IO-free) helpers for the OUTBOUND Discord OAuth2 flow: where the game
// server is the CLIENT to discord.com (the opposite direction of server/oauth.ts,
// which is our own authorization SERVER). Kept separate from server/discord.ts
// (DB + HTTP) so the URL building, PKCE, and Discord API response parsing can be
// unit tested without a database or network. Mirrors the wallet_link.ts /
// wallet.ts pure/IO split.
import { createHash } from 'node:crypto';

export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
export const DISCORD_API_BASE = 'https://discord.com/api/v10';
export const DISCORD_CDN_BASE = 'https://cdn.discordapp.com';

// `identify` gives us the user id + name; `email` gives us the verified account
// email we capture as a recovery address; `guilds` lets us verify membership of
// the official server (for the member reward) without any privileged intent.
// `email` and `identify` are standard OAuth2 scopes (no Developer Portal toggle
// or app verification needed). Adding `email` here means every existing linked
// user re-consents on their next Discord sign-in, because the authorize call
// always sends prompt=consent and the new scope was not previously granted.
export const DEFAULT_DISCORD_SCOPES = ['identify', 'email', 'guilds'] as const;

// The OAuth2 scope that lets us ADD the user to a guild for them via
// PUT /guilds/{id}/members/{id}. When a bot token + guild id are configured the
// server requests this too, so Discord's consent screen shows "join servers" and
// the callback can auto-join the player in one flow.
export const GUILD_JOIN_SCOPE = 'guilds.join';
export const DISCORD_SCOPES_WITH_JOIN = ['identify', 'email', 'guilds', GUILD_JOIN_SCOPE] as const;

/** The scopes to request: with `guilds.join` only when auto-join is configured. */
export function discordScopes(opts: { autoJoin: boolean }): readonly string[] {
  return opts.autoJoin ? DISCORD_SCOPES_WITH_JOIN : DEFAULT_DISCORD_SCOPES;
}

/**
 * Whether a granted-scope string (space separated, as Discord returns it on the
 * token response) actually contains a scope. The user could in theory strip a
 * scope, so we verify `guilds.join` was granted before attempting the join.
 */
export function grantedScope(granted: string, want: string): boolean {
  return granted.split(/\s+/).filter(Boolean).includes(want);
}

/** Discord ids are 64-bit snowflakes serialized as decimal strings. */
export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{15,21}$/.test(value);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE S256 challenge for a verifier (deterministic; plain is never used). */
export function pkceChallengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** Build the discord.com authorize URL the browser is redirected to. */
export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
  prompt?: 'consent' | 'none';
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: (opts.scopes ?? DEFAULT_DISCORD_SCOPES).join(' '),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    prompt: opts.prompt ?? 'consent',
  });
  return `${DISCORD_AUTHORIZE_URL}?${params.toString()}`;
}

/** Form body for the authorization-code -> token exchange (server POSTs this). */
export function buildTokenRequestBody(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): string {
  return new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  }).toString();
}

export interface GuildJoinRequest {
  url: string;
  body: string;
}

/**
 * Build the `PUT /guilds/{guildId}/members/{userId}` request that adds a consenting
 * user to the guild. The caller supplies the `Authorization: Bot <token>` header;
 * the body carries the user's OAuth access token (which must have been granted the
 * `guilds.join` scope). Returns null when either id is not a snowflake, so a
 * malformed id never reaches the API. A 201 means added, a 204 already a member.
 */
export function buildGuildJoinRequest(opts: {
  apiBase: string;
  guildId: string;
  userId: string;
  accessToken: string;
}): GuildJoinRequest | null {
  if (!isDiscordSnowflake(opts.guildId) || !isDiscordSnowflake(opts.userId)) return null;
  return {
    url: `${opts.apiBase}/guilds/${opts.guildId}/members/${opts.userId}`,
    body: JSON.stringify({ access_token: opts.accessToken }),
  };
}

export interface DiscordTokenResult {
  accessToken: string;
  tokenType: string;
  scope: string;
  expiresIn: number;
}

/** Validate a Discord token-endpoint response. Returns null on any bad shape. */
export function parseTokenResponse(value: unknown): DiscordTokenResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const accessToken = typeof v.access_token === 'string' ? v.access_token : '';
  if (!accessToken) return null;
  return {
    accessToken,
    tokenType: typeof v.token_type === 'string' ? v.token_type : 'Bearer',
    scope: typeof v.scope === 'string' ? v.scope : '',
    expiresIn: typeof v.expires_in === 'number' ? v.expires_in : 0,
  };
}

export interface DiscordUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  // Present only when the `email` scope was granted. `email` is Discord's account
  // email; `emailVerified` is Discord's own `verified` flag for that address, so a
  // captured address is only treated as a VERIFIED recovery email when both hold.
  email: string | null;
  emailVerified: boolean;
}

/** Validate a GET /users/@me response. Returns null when the id is not a snowflake. */
export function parseDiscordUser(value: unknown): DiscordUser | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isDiscordSnowflake(v.id)) return null;
  // Only accept a well-shaped, length-bounded address; Discord sends null when the
  // email scope was not granted. Mirrors the account email validator (shape + the
  // 254-char RFC 5321 cap) without importing it into this pure module.
  const rawEmail = typeof v.email === 'string' ? v.email.trim() : '';
  const email =
    rawEmail && rawEmail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)
      ? rawEmail
      : null;
  return {
    id: v.id,
    username: typeof v.username === 'string' ? v.username : '',
    globalName: typeof v.global_name === 'string' ? v.global_name : null,
    avatar: typeof v.avatar === 'string' ? v.avatar : null,
    email,
    emailVerified: email !== null && v.verified === true,
  };
}

/** Preferred display name: the global (display) name, else the legacy username. */
export function discordDisplayName(user: Pick<DiscordUser, 'username' | 'globalName'>): string {
  return user.globalName?.trim() || user.username || 'Discord user';
}

/** CDN avatar URL for a user, or null when they use a default avatar. */
export function discordAvatarUrl(userId: string, avatar: string | null, size = 64): string | null {
  if (!avatar || !isDiscordSnowflake(userId)) return null;
  const ext = avatar.startsWith('a_') ? 'gif' : 'png';
  return `${DISCORD_CDN_BASE}/avatars/${userId}/${avatar}.${ext}?size=${size}`;
}

/**
 * Extract the guild ids from a GET /users/@me/guilds response so the caller can
 * check membership of the official server. Tolerant of junk: non-array or
 * malformed entries yield an empty list rather than throwing.
 */
export function parseGuildIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const g of value) {
    if (g && typeof g === 'object' && isDiscordSnowflake((g as Record<string, unknown>).id)) {
      ids.push((g as Record<string, unknown>).id as string);
    }
  }
  return ids;
}

/** Whether the official guild id appears in a parsed guilds list. */
export function isMemberOfGuild(guildIds: readonly string[], officialGuildId: string): boolean {
  return isDiscordSnowflake(officialGuildId) && guildIds.includes(officialGuildId);
}

// The two link modes carried through the OAuth `state` row. `login` may provision
// a new account; `link` attaches Discord to the already-authenticated account.
export type DiscordLinkMode = 'login' | 'link';

export function isDiscordLinkMode(value: unknown): value is DiscordLinkMode {
  return value === 'login' || value === 'link';
}

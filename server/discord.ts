// Discord integration HTTP shell (DB + network IO). The pure URL/PKCE/parse
// helpers live in server/discord_oauth.ts and all SQL in server/discord_db.ts;
// this module is the OAuth-client flow (we are the CLIENT to discord.com), the
// link/status/unlink + reward/swag endpoints, and a process-local presence cache
// the bot pushes into. Mirrors the wallet.ts shell shape (each account-scoped
// handler takes a pre-resolved accountId from the route).

import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import {
  canClaimSwag,
  DISCORD_REWARD_GRANTS,
  discordStatusIndexForPoints,
  swagById,
} from '../src/sim/discord_tier';
import { verifyLoginTwoFactor } from './account';
import { hashPassword, newToken, offensiveName, validPassword, verifyPassword } from './auth';
import {
  type AccountRow,
  accountById,
  backfillAccountEmailIfEmpty,
  createAccount,
  findAccount,
  highestCharacterForAccount,
  moderationStatusForAccount,
  pool,
  saveToken,
  touchLogin,
  updatePasswordHash,
} from './db';
import {
  accountForDiscord,
  claimSwag,
  consumeDiscordOAuthState,
  consumeDiscordPendingLogin,
  createDiscordOAuthState,
  createDiscordPendingLogin,
  discordForAccount,
  grantRewardPoints,
  linkDiscordToAccount,
  listSwagClaims,
  loadRewardState,
  peekDiscordPendingLogin,
  setDiscordGuildMember,
  setDiscordLinkEmail,
  unlinkDiscord,
} from './discord_db';
import {
  buildAuthorizeUrl,
  buildGuildJoinRequest,
  buildTokenRequestBody,
  DISCORD_API_BASE,
  DISCORD_TOKEN_URL,
  type DiscordLinkMode,
  type DiscordUser,
  discordAvatarUrl,
  discordDisplayName,
  discordScopes,
  GUILD_JOIN_SCOPE,
  grantedScope,
  isDiscordLinkMode,
  isDiscordSnowflake,
  isMemberOfGuild,
  parseDiscordUser,
  parseGuildIds,
  parseTokenResponse,
  pkceChallengeFromVerifier,
} from './discord_oauth';
import { isUniqueViolation, json } from './http_util';
import {
  authThrottled,
  clearAuthFailures,
  discordRateLimited,
  recordAuthFailure,
  requestIp,
} from './ratelimit';
import { publicOriginFromRequest, REALM_PUBLIC_ORIGIN } from './realm';

const STATE_TTL_MINUTES = 10;
// A first-time login's "create new or link existing?" choice is parked this long
// (the player may also type a password / 2FA code on the link path), a bit longer
// than the OAuth state TTL since a human decision sits in the middle.
const PENDING_LOGIN_TTL_MINUTES = 15;
const DEFAULT_INVITE = 'https://discord.gg/GjhnUsBtw';

// Lightweight local instrumentation hook. Admin-dashboard usage metrics require a
// registered typed key + per-locale label, which is more coupling than this
// optional telemetry warrants; the call sites stay as documentation and a future
// wiring point.
function note(_metric: string): void {}

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  guildId: string;
  inviteUrl: string;
  // The bot token (also used by the standalone bot process). Present in the game
  // server env only when auto-join is wanted: it lets the OAuth callback add the
  // player to the guild for them. Empty string when unset (auto-join off).
  botToken: string;
}

/** Resolve Discord OAuth config from env, or null when not configured (feature off). */
export function discordConfig(): DiscordConfig | null {
  const clientId = process.env.DISCORD_CLIENT_ID ?? '';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    guildId: process.env.DISCORD_GUILD_ID ?? '',
    inviteUrl: process.env.DISCORD_GUILD_INVITE || DEFAULT_INVITE,
    botToken: process.env.DISCORD_BOT_TOKEN ?? '',
  };
}

/**
 * Whether the server can add a consenting player to the guild on link/login. Needs
 * a real guild id and the bot token in THIS process's env (the bot must be in the
 * guild with the Create Invite permission). Off by default: without a bot token the
 * flow behaves exactly as before (verify membership only, invite link to join).
 */
export function autoJoinEnabled(cfg: DiscordConfig): boolean {
  return cfg.botToken !== '' && isDiscordSnowflake(cfg.guildId);
}

/** Whether the feature is configured. Read by the route table + client UI gate. */
export function discordEnabled(): boolean {
  return discordConfig() !== null;
}

export function discordInviteUrl(): string {
  return process.env.DISCORD_GUILD_INVITE || DEFAULT_INVITE;
}

function redirectUriFor(req: http.IncomingMessage): string {
  return `${publicOriginFromRequest(req)}/api/auth/discord/callback`;
}

// ── Process-local Discord presence (bot pushes via /internal/discord/presence) ──
export interface DiscordPresenceSnapshot {
  onlineCount: number;
  memberTotal: number;
  voiceChannelName: string | null;
  voice: { id: string; name: string; speaking: boolean; selfMute: boolean }[];
  updatedAt: number;
}

let presenceCache: DiscordPresenceSnapshot = {
  onlineCount: 0,
  memberTotal: 0,
  voiceChannelName: null,
  voice: [],
  updatedAt: 0,
};

export function setDiscordPresenceCache(
  snapshot: Omit<DiscordPresenceSnapshot, 'updatedAt'>,
): void {
  presenceCache = { ...snapshot, updatedAt: Date.now() };
}

export function discordPresenceCache(): DiscordPresenceSnapshot {
  // Stale presence (no bot push in 5 minutes) reads as empty so the HUD doesn't
  // show a frozen voice roster after the bot disconnects.
  if (presenceCache.updatedAt && Date.now() - presenceCache.updatedAt > 5 * 60_000) {
    return {
      onlineCount: 0,
      memberTotal: presenceCache.memberTotal,
      voiceChannelName: presenceCache.voiceChannelName,
      voice: [],
      updatedAt: 0,
    };
  }
  return presenceCache;
}

// ── OAuth start: returns the discord.com authorize URL the browser navigates to ─
// POST /api/auth/discord/start?mode=login|link[&returnTo=...]
// For 'link', the route resolves the caller's account first (accountId set); for
// 'login', accountId is null and the callback may provision a new account.
export async function handleDiscordStart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: { mode: DiscordLinkMode; accountId: number | null },
): Promise<void> {
  note('discord.start.request');
  const cfg = discordConfig();
  if (!cfg) return json(res, 503, { error: 'Discord integration is not configured' });
  if (discordRateLimited(req, opts.accountId ?? 0)) {
    note('discord.start.rate_limited');
    return json(res, 429, { error: 'rate limited' });
  }
  const state = newToken();
  const codeVerifier = newToken();
  const codeChallenge = pkceChallengeFromVerifier(codeVerifier);
  await createDiscordOAuthState(pool, {
    state,
    codeVerifier,
    mode: opts.mode,
    accountId: opts.accountId,
    redirectTo: null,
    ttlMinutes: STATE_TTL_MINUTES,
  });
  const url = buildAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri: redirectUriFor(req),
    state,
    codeChallenge,
    // Ask for `guilds.join` (so we can add them to the server) only when the server
    // is actually configured to do it; otherwise the consent screen would show a
    // "join servers" permission we can't act on.
    scopes: discordScopes({ autoJoin: autoJoinEnabled(cfg) }),
  });
  return json(res, 200, { url });
}

// ── OAuth callback (top-level browser redirect from discord.com) ───────────────
// GET /api/auth/discord/callback?code=&state=
// No Authorization header and no browser Origin (it is a discord.com redirect), so
// this route is exempt from the web-login Origin guard. Renders an HTML bounce
// page that hands a freshly minted session token to the SPA (login) or signals the
// opener to refresh link status (link).
export async function handleDiscordCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  note('discord.callback.request');
  const cfg = discordConfig();
  if (!cfg) return bouncePage(res, 503, { ok: false, mode: 'login', error: 'not_configured' });
  const u = new URL(req.url ?? '/', 'http://localhost');
  const code = u.searchParams.get('code') ?? '';
  const state = u.searchParams.get('state') ?? '';
  if (u.searchParams.get('error')) {
    // User clicked "Cancel" on Discord's consent screen.
    return bouncePage(res, 200, { ok: false, mode: 'login', error: 'cancelled' });
  }
  if (!code || !state)
    return bouncePage(res, 400, { ok: false, mode: 'login', error: 'bad_request' });

  const stateRow = await consumeDiscordOAuthState(pool, state);
  if (!stateRow) {
    note('discord.callback.bad_state');
    return bouncePage(res, 400, { ok: false, mode: 'login', error: 'expired' });
  }
  const mode: DiscordLinkMode = isDiscordLinkMode(stateRow.mode) ? stateRow.mode : 'login';

  const identity = await exchangeCodeForIdentity(
    code,
    redirectUriFor(req),
    stateRow.code_verifier,
    cfg,
  );
  if (!identity) {
    note('discord.callback.exchange_failed');
    return bouncePage(res, 502, { ok: false, mode, error: 'discord_error' });
  }
  const { user, guildMember } = identity;

  try {
    if (mode === 'link') {
      return await completeLink(res, stateRow.account_id, user, guildMember, mode);
    }
    return await completeLogin(req, res, user, guildMember);
  } catch (err) {
    console.error('discord callback error:', err);
    return bouncePage(res, 500, { ok: false, mode, error: 'server_error' });
  }
}

// Seed the account's recovery email from a Discord grant, but only when the
// account has none yet (never clobbering an owner-set address). A no-op when the
// grant carried no email. email_verified_at is stamped only for a Discord-verified
// address. Best-effort: shared by every Discord link/login path.
async function captureDiscordEmail(
  accountId: number,
  email: string | null,
  verified: boolean,
): Promise<void> {
  if (email) await backfillAccountEmailIfEmpty(accountId, email, verified);
}

// Link an authenticated session's account to the Discord identity.
async function completeLink(
  res: http.ServerResponse,
  accountId: number | null,
  user: DiscordUser,
  guildMember: boolean,
  mode: DiscordLinkMode,
): Promise<void> {
  if (accountId === null) return bouncePage(res, 400, { ok: false, mode, error: 'no_session' });
  const linked = await linkDiscordToAccount(pool, accountId, {
    discordUserId: user.id,
    username: discordDisplayName(user),
    avatar: user.avatar,
    email: user.email,
    guildMember,
  });
  if (!linked) {
    note('discord.link.conflict');
    return bouncePage(res, 409, { ok: false, mode, error: 'already_linked' });
  }
  await captureDiscordEmail(accountId, user.email, user.emailVerified);
  await grantLinkRewards(accountId, guildMember);
  note('discord.link.success');
  return bouncePage(res, 200, { ok: true, mode, username: discordDisplayName(user) });
}

// Log in the account that owns this Discord identity, OR (first time) hand the
// browser a one-time link token so the player can CHOOSE to create a new account
// or link an existing one. We never auto-provision or auto-link to an existing
// account by email/username (Discord's email is not verified to us, so that would
// be an account-takeover vector).
async function completeLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  user: DiscordUser,
  guildMember: boolean,
): Promise<void> {
  const meta = { ip: requestIp(req), userAgent: String(req.headers['user-agent'] ?? '') };
  const accountId = await accountForDiscord(pool, user.id);
  if (accountId === null) {
    // First-time Discord login: the identity is verified, but the player has not
    // chosen what to do with it. Park it under a single-use token and let the SPA
    // offer "create new account" / "link an existing account" (the chooser then
    // calls /api/auth/discord/login/new or /login/link).
    const linkToken = newToken();
    await createDiscordPendingLogin(pool, {
      token: linkToken,
      discordUserId: user.id,
      username: discordDisplayName(user),
      avatar: user.avatar,
      email: user.email,
      emailVerified: user.emailVerified,
      guildMember,
      ttlMinutes: PENDING_LOGIN_TTL_MINUTES,
    });
    note('discord.login.choose');
    return bouncePage(res, 200, {
      ok: true,
      mode: 'login',
      choose: true,
      linkToken,
      username: discordDisplayName(user),
    });
  }
  // Returning Discord user: keep membership + reward fresh, then mint a session.
  const acct = await accountById(accountId);
  await setDiscordGuildMember(pool, accountId, guildMember);
  // Re-consent may have just granted the email scope for the first time: capture
  // it onto the link and seed the account's recovery email if it still has none.
  await setDiscordLinkEmail(pool, accountId, user.email);
  await captureDiscordEmail(accountId, user.email, user.emailVerified);
  if (guildMember) await grantGuildReward(accountId);
  note('discord.login.returning');
  const status = await moderationStatusForAccount(accountId);
  if (status.locked) return bouncePage(res, 403, { ok: false, mode: 'login', error: 'locked' });
  const token = await issueDiscordSession(accountId, meta);
  return bouncePage(res, 200, {
    ok: true,
    mode: 'login',
    token,
    username: acct?.username ?? 'player',
  });
}

// Touch last-login + mint a fresh full session token labelled 'discord'. Shared by
// the returning-login bounce and the create-new / link-existing chooser endpoints.
async function issueDiscordSession(
  accountId: number,
  meta: { ip: string; userAgent: string },
): Promise<string> {
  await touchLogin(accountId, meta);
  const token = newToken();
  await saveToken(token, accountId, undefined, 'full', 'discord');
  return token;
}

function requestMeta(req: http.IncomingMessage): { ip: string; userAgent: string } {
  return { ip: requestIp(req), userAgent: String(req.headers['user-agent'] ?? '') };
}

// ── POST /api/auth/discord/login/new { linkToken } ─────────────────────────────
// "Create a new account" from the first-time chooser: consume the parked identity,
// provision a fresh (password-less) account, link it, and mint a session.
export async function handleDiscordLoginNew(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  isIpBlocked: (ip: string) => boolean,
): Promise<void> {
  if (discordRateLimited(req, 0)) return json(res, 429, { error: 'rate limited' });
  // A blocked IP must not mint a fresh account + session through Discord, exactly as
  // /api/register and /api/login refuse one. Reuse the rate-limit response so the block
  // stays invisible (matches the throttle bucket above; the client already localizes it).
  if (isIpBlocked(requestIp(req))) return json(res, 429, { error: 'rate limited' });
  const body = await readJsonBody(req);
  const linkToken = typeof body.linkToken === 'string' ? body.linkToken : '';
  const pending = await consumeDiscordPendingLogin(pool, linkToken);
  if (!pending) return json(res, 400, { error: 'expired' });
  const meta = requestMeta(req);
  const user: DiscordUser = {
    id: pending.discord_user_id,
    username: pending.discord_username ?? '',
    globalName: pending.discord_username,
    avatar: pending.discord_avatar,
    email: pending.discord_email,
    emailVerified: pending.discord_email_verified,
  };
  try {
    // Defensive: if this Discord id is already linked (a rare double-submit / two-tab
    // race), log into the OWNING account instead of provisioning a duplicate.
    let accountId = await accountForDiscord(pool, user.id);
    let username: string;
    if (accountId === null) {
      const account = await provisionDiscordAccount(user, meta);
      const linked = await linkDiscordToAccount(pool, account.id, {
        discordUserId: user.id,
        username: discordDisplayName(user),
        avatar: user.avatar,
        email: user.email,
        guildMember: pending.guild_member,
      });
      if (!linked) {
        // Lost the race: another account grabbed this Discord id between our check
        // and the insert. Fall back to logging into the real owner.
        const ownerId = await accountForDiscord(pool, user.id);
        if (ownerId === null) return json(res, 409, { error: 'already_linked' });
        accountId = ownerId;
        username = (await accountById(ownerId))?.username ?? 'player';
      } else {
        accountId = account.id;
        username = account.username;
        await grantLinkRewards(accountId, pending.guild_member);
        note('discord.login.provisioned');
      }
    } else {
      username = (await accountById(accountId))?.username ?? 'player';
      await setDiscordGuildMember(pool, accountId, pending.guild_member);
      await setDiscordLinkEmail(pool, accountId, user.email);
      if (pending.guild_member) await grantGuildReward(accountId);
    }
    // Seed the recovery email from the captured Discord address (both a freshly
    // provisioned account and the race-fallback owner). No-op when it has one.
    await captureDiscordEmail(accountId, user.email, user.emailVerified);
    const status = await moderationStatusForAccount(accountId);
    if (status.locked) return json(res, 403, { error: status.message });
    const token = await issueDiscordSession(accountId, meta);
    return json(res, 200, { token, username });
  } catch (err) {
    console.error('discord login/new error:', err);
    return json(res, 500, { error: 'server_error' });
  }
}

// ── POST /api/auth/discord/login/link { linkToken, username, password, code? } ─
// "Link an existing account" from the first-time chooser: verify the account's
// password (and 2FA / moderation, exactly like /api/login), then attach the parked
// Discord identity and mint a session. The pending token is only consumed on the
// final commit, so a wrong password or a 2FA challenge leaves it reusable.
export async function handleDiscordLoginLink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  isIpBlocked: (ip: string) => boolean,
): Promise<void> {
  if (discordRateLimited(req, 0)) return json(res, 429, { error: 'rate limited' });
  // A blocked IP must not log into (and link Discord onto) an account through this
  // unauthenticated path either, mirroring the /api/login IP gate. Same opaque 429.
  if (isIpBlocked(requestIp(req))) return json(res, 429, { error: 'rate limited' });
  const body = await readJsonBody(req);
  const linkToken = typeof body.linkToken === 'string' ? body.linkToken : '';
  const pending = await peekDiscordPendingLogin(pool, linkToken);
  if (!pending) return json(res, 400, { error: 'expired' });
  const username = typeof body.username === 'string' ? body.username : '';
  // Per-account brute-force throttle, message identical to a bad password so it
  // never reveals whether the account exists (mirrors /api/login).
  if (username && authThrottled(username)) {
    return json(res, 429, { error: 'too many failed attempts, wait a few minutes and try again' });
  }
  const account = username ? await findAccount(username) : null;
  const password = typeof body.password === 'string' ? body.password : '';
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    if (username) recordAuthFailure(username);
    return json(res, 401, { error: 'invalid username or password' });
  }
  const status = await moderationStatusForAccount(account.id);
  if (status.locked) return json(res, 403, { error: status.message });
  // Second factor: like /api/login, a 2FA account needs a code. With none supplied
  // we return the challenge (token NOT consumed) so the chooser can ask for it.
  if (account.totp_enabled_at) {
    const code = typeof body.code === 'string' ? body.code : '';
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';
    if (!code && !recoveryCode) return json(res, 200, { twoFactorRequired: true });
    if (!(await verifyLoginTwoFactor(account, code, recoveryCode))) {
      // Feed the per-account brute-force lockout on a bad second factor, exactly like
      // /api/login: the password is already correct here, so without this a known
      // password could brute-force TOTP codes throttled only per-IP.
      recordAuthFailure(username);
      return json(res, 401, { error: 'that code is not valid, try again' });
    }
  }
  clearAuthFailures(username);
  // Commit: consume the token (single-use guard) only now, then link + mint.
  const consumed = await consumeDiscordPendingLogin(pool, linkToken);
  if (!consumed) return json(res, 400, { error: 'expired' });
  const linked = await linkDiscordToAccount(pool, account.id, {
    discordUserId: consumed.discord_user_id,
    username: consumed.discord_username,
    avatar: consumed.discord_avatar,
    email: consumed.discord_email,
    guildMember: consumed.guild_member,
  });
  if (!linked) return json(res, 409, { error: 'already_linked' });
  // Seed the existing account's recovery email from the captured Discord address
  // if it still has none (never overwrites an owner-set one).
  await captureDiscordEmail(account.id, consumed.discord_email, consumed.discord_email_verified);
  await grantLinkRewards(account.id, consumed.guild_member);
  note('discord.login.linked_existing');
  const token = await issueDiscordSession(account.id, requestMeta(req));
  return json(res, 200, { token, username: account.username });
}

async function grantLinkRewards(accountId: number, guildMember: boolean): Promise<void> {
  const g = DISCORD_REWARD_GRANTS.link;
  await grantRewardPoints(pool, accountId, g.points, g.reason, `${g.reason}:${accountId}`);
  if (guildMember) await grantGuildReward(accountId);
}

async function grantGuildReward(accountId: number): Promise<void> {
  const g = DISCORD_REWARD_GRANTS.guildMember;
  await grantRewardPoints(pool, accountId, g.points, g.reason, `${g.reason}:${accountId}`);
}

// Exchange the auth code for a token, then fetch the user identity + guild
// membership. Returns null on any network/parse failure (handled as discord_error).
async function exchangeCodeForIdentity(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  cfg: DiscordConfig,
): Promise<{ user: DiscordUser; guildMember: boolean } | null> {
  const tokenJson = await postForm(
    DISCORD_TOKEN_URL,
    buildTokenRequestBody({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      redirectUri,
      codeVerifier,
    }),
  );
  const token = parseTokenResponse(tokenJson);
  if (!token) return null;
  const user = parseDiscordUser(await getJson(`${DISCORD_API_BASE}/users/@me`, token.accessToken));
  if (!user) return null;
  let guildMember = false;
  if (cfg.guildId) {
    const guilds = parseGuildIds(
      await getJson(`${DISCORD_API_BASE}/users/@me/guilds`, token.accessToken),
    );
    guildMember = isMemberOfGuild(guilds, cfg.guildId);
  }
  // Seamless join: if they consented to `guilds.join` and are not already in, add
  // them to the official guild for a single-flow experience (no separate invite
  // click). Best-effort; a failure just leaves them not-joined. On success they are
  // now a member, so downstream link/login persists membership + grants the reward,
  // and the bot's GUILD_MEMBER_ADD welcome fires for free.
  if (!guildMember && autoJoinEnabled(cfg) && grantedScope(token.scope, GUILD_JOIN_SCOPE)) {
    if (await joinGuild(cfg, user.id, token.accessToken)) guildMember = true;
  }
  return { user, guildMember };
}

// Add a consenting user to the official guild via PUT /guilds/{id}/members/{id}
// (Bot-authed; the user's access token rides in the body). 201 = added, 204 =
// already a member; both mean "in". Best-effort with a timeout: any network/HTTP
// failure returns false so it never blocks the login/link, and never throws.
async function joinGuild(
  cfg: DiscordConfig,
  userId: string,
  accessToken: string,
): Promise<boolean> {
  const request = buildGuildJoinRequest({
    apiBase: DISCORD_API_BASE,
    guildId: cfg.guildId,
    userId,
    accessToken,
  });
  if (!request) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(request.url, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${cfg.botToken}`,
        'Content-Type': 'application/json',
      },
      body: request.body,
      signal: controller.signal,
    });
    if (!resp.ok) {
      note('discord.join.failed');
      return false;
    }
    note('discord.join.success');
    return true;
  } catch {
    note('discord.join.error');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function postForm(url: string, body: string): Promise<unknown> {
  return fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

async function getJson(url: string, accessToken: string): Promise<unknown> {
  return fetchJsonWithTimeout(url, { headers: { Authorization: `Bearer ${accessToken}` } });
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeBaseUsername(name: string): string {
  let s = name.replace(/[^A-Za-z0-9_]/g, '');
  if (s.length > 18) s = s.slice(0, 18);
  if (s.length < 3 || offensiveName(s)) s = `disc${randomBytes(3).toString('hex')}`;
  return s;
}

async function provisionDiscordAccount(
  user: DiscordUser,
  meta: { ip: string; userAgent: string },
): Promise<AccountRow> {
  const base = sanitizeBaseUsername(discordDisplayName(user));
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 18)}${randomBytes(2).toString('hex')}`;
    if (candidate.length < 3 || candidate.length > 24 || offensiveName(candidate)) continue;
    if (await findAccount(candidate)) continue;
    try {
      // Random unguessable password so the row satisfies NOT NULL password_hash
      // while staying password-unusable. passwordSet:false records that the owner
      // never chose it, so the account is reachable only through Discord until a
      // real password is set (which is what the unlink flow requires first).
      return await createAccount(candidate, await hashPassword(newToken()), meta, {
        passwordSet: false,
      });
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  const fallback = `disc${randomBytes(8).toString('hex').slice(0, 18)}`;
  return createAccount(fallback, await hashPassword(newToken()), meta, { passwordSet: false });
}

// ── GET /api/discord (status + presence for the HUD widget) ────────────────────
export async function handleDiscordStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  return json(res, 200, await discordStatusPayload(accountId));
}

export async function discordStatusPayload(accountId: number): Promise<Record<string, unknown>> {
  const [link, reward, claimedSwagIds, acct] = await Promise.all([
    discordForAccount(pool, accountId),
    loadRewardState(pool, accountId),
    listSwagClaims(pool, accountId),
    accountById(accountId),
  ]);
  const presence = discordPresenceCache();
  const cfg = discordConfig();
  return {
    enabled: cfg !== null,
    // Discord's embeddable server widget (live presence + voice rooms), shown in
    // the HUD when the guild has its widget enabled. Read-only; "join voice" opens
    // Discord. Null when no guild is configured.
    widgetUrl: cfg?.guildId ? `https://discord.com/widget?id=${cfg.guildId}&theme=dark` : null,
    linked: link !== null,
    // Whether the account has a real (owner-chosen) password. The client reads this
    // to decide whether unlinking must first set one (a Discord-only account with no
    // usable password would otherwise be stranded). Defaults true if the account row
    // is somehow missing, so we never wrongly demand a password.
    passwordSet: acct?.password_set ?? true,
    username: link?.discord_username ?? null,
    // Discord profile picture (CDN), shown in the HUD widget. Null for a default
    // (avatar-less) Discord account.
    avatar: link ? discordAvatarUrl(link.discord_user_id, link.discord_avatar, 64) : null,
    guildMember: link?.guild_member ?? false,
    points: reward.points,
    lifetimePoints: reward.lifetimePoints,
    // Unlinked accounts are unranked (tier 0); only a linked account climbs rungs.
    statusTier: link ? discordStatusIndexForPoints(reward.lifetimePoints) : 0,
    claimedSwagIds,
    inviteUrl: discordInviteUrl(),
    presence: {
      onlineCount: presence.onlineCount,
      memberTotal: presence.memberTotal,
      voiceChannelName: presence.voiceChannelName,
      voice: presence.voice,
    },
  };
}

// ── DELETE /api/discord (unlink) ───────────────────────────────────────────────
// A Discord-provisioned account (password_set = false) is reachable ONLY through
// Discord, so unlinking it as-is would strand it forever. For those accounts the
// unlink requires a `password` in the body: we set it (which makes the existing
// username + password a working login) BEFORE removing the link, so even a failure
// after this point leaves the account reachable. Accounts that already have a real
// password unlink with no extra input, exactly as before.
export async function handleDiscordUnlink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const acct = await accountById(accountId);
  if (!acct) return json(res, 404, { error: 'account not found' });
  if (!acct.password_set) {
    const body = await readJsonBody(req);
    const next = typeof body.password === 'string' ? body.password : '';
    if (!validPassword(next)) {
      // The client opens the "set a password to keep your account" modal off the 400
      // status alone (it pre-fills the read-only username locally), so the response
      // needs only the error code.
      note('discord.unlink.password_required');
      return json(res, 400, { error: 'password_required' });
    }
    // Set the real password first (this also flips password_set = TRUE), so the
    // account survives even if the unlink below were to fail (a benign retry).
    await updatePasswordHash(accountId, await hashPassword(next));
    note('discord.unlink.set_password');
  }
  await unlinkDiscord(pool, accountId);
  note('discord.unlink');
  return json(res, 200, { unlinked: true });
}

// ── POST /api/discord/swag/claim { swagId } ────────────────────────────────────
// Server-authoritative: re-checks link + tier + points + not-already-claimed.
// `grantCosmetic` lets the caller apply a live in-world cosmetic grant (mech
// chroma) for cosmetic-kind swag, mirroring the card-upload live-update pattern.
export async function handleSwagClaim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  grantCosmetic: (chromaId: string) => void,
): Promise<void> {
  note('discord.swag.claim.request');
  if (discordRateLimited(req, accountId)) {
    note('discord.swag.claim.rate_limited');
    return json(res, 429, { error: 'rate limited' });
  }
  const body = await readJsonBody(req);
  const swagId = typeof body.swagId === 'string' ? body.swagId : '';
  const swag = swagById(swagId);
  if (!swag) return json(res, 400, { error: 'unknown swag item' });

  const link = await discordForAccount(pool, accountId);
  if (!link) return json(res, 403, { error: 'link your Discord account first' });

  const reward = await loadRewardState(pool, accountId);
  const statusTier = discordStatusIndexForPoints(reward.lifetimePoints);
  const claimedIds = await listSwagClaims(pool, accountId);
  const verdict = canClaimSwag({ swag, spendablePoints: reward.points, statusTier, claimedIds });
  if (!verdict.ok) return json(res, 409, { error: verdict.reason });

  const result = await claimSwag(pool, accountId, swag.id, swag.cost);
  if (!result.ok) return json(res, 409, { error: result.reason });

  // Apply the real in-game effect for cosmetic swag (titles/physical are recorded
  // claims fulfilled by the bot/admin). Best-effort; the claim is already durable.
  if (swag.kind === 'cosmetic') {
    try {
      grantCosmetic(swag.grantId);
    } catch (err) {
      console.error('discord swag cosmetic grant failed:', err);
    }
  }
  note('discord.swag.claim.success');
  const claimed = [...claimedIds, swag.id];
  return json(res, 200, { claimed, swagId: swag.id, points: result.points, kind: swag.kind });
}

// The Discord flex: the account's top character + status, for the bot embed.
export interface DiscordFlex {
  found: boolean;
  username: string | null;
  statusTier: number;
  points: number;
  character: { name: string; class: string; level: number; profileUrl: string } | null;
}

export async function discordFlexForAccount(accountId: number): Promise<DiscordFlex> {
  const [ch, reward, link] = await Promise.all([
    highestCharacterForAccount(accountId),
    loadRewardState(pool, accountId),
    discordForAccount(pool, accountId),
  ]);
  const statusTier = link ? discordStatusIndexForPoints(reward.lifetimePoints) : 0;
  const origin = REALM_PUBLIC_ORIGIN || '';
  return {
    found: ch !== null,
    username: link?.discord_username ?? null,
    statusTier,
    points: reward.points,
    character: ch
      ? {
          name: ch.name,
          class: ch.class,
          level: ch.state?.level ?? ch.level,
          profileUrl: `${origin}/c/${encodeURIComponent(ch.name)}`,
        }
      : null,
  };
}

// ── small local helpers ────────────────────────────────────────────────────────

// readBody is re-implemented narrowly here to avoid importing the wallet shell's
// heavier reader; the swag claim body is tiny.
async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return {};
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface BouncePayload {
  ok: boolean;
  mode: DiscordLinkMode;
  token?: string;
  username?: string;
  error?: string;
  // First-time login: no session yet. The verified identity is parked server-side
  // under `linkToken`; the SPA shows the create-new / link-existing chooser.
  choose?: boolean;
  linkToken?: string;
}

// Render the callback result as an HTML page that messages the SPA. Works whether
// the OAuth flow ran in a popup (postMessage to the opener + close) or as a
// top-level redirect (store the session + go to the app).
function bouncePage(res: http.ServerResponse, status: number, payload: BouncePayload): void {
  // Escape '<'/'>' (blocks </script> + <!-- breakout) and the JS line separators
  // U+2028/U+2029 (legal in JSON, illegal in a pre-ES2019 JS string) inside the
  // inlined JSON so a value can never break out of or corrupt the <script>.
  const data = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>World of ClaudeCraft</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{background:#14100a;color:#fff6df;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{text-align:center;padding:24px}</style>
</head><body><main><p id="m">Connecting Discord...</p></main><script>
(function(){
  var p = ${data};
  try {
    if (p.ok && p.mode === 'login' && p.token) {
      localStorage.setItem('woc_session', JSON.stringify({ token: p.token, username: p.username }));
    } else if (p.ok && p.mode === 'login' && p.choose && p.linkToken) {
      // First-time login: stash the one-time link token + Discord name so the SPA
      // can show the "create new / link existing" chooser after the redirect.
      localStorage.setItem('woc_discord_choice', JSON.stringify({ linkToken: p.linkToken, username: p.username || '', ts: Date.now() }));
    }
  } catch (e) {}
  var msg = { source: 'woc-discord', ok: p.ok, mode: p.mode, error: p.error || null };
  if (window.opener) {
    try { window.opener.postMessage(msg, location.origin); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch (e) {} location.replace('/'); }, 200);
  } else {
    location.replace('/');
  }
})();
</script></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

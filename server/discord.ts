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
import { hashPassword, newToken, offensiveName } from './auth';
import {
  type AccountRow,
  accountById,
  createAccount,
  findAccount,
  highestCharacterForAccount,
  moderationStatusForAccount,
  pool,
  saveToken,
  touchLogin,
} from './db';
import {
  accountForDiscord,
  claimSwag,
  consumeDiscordOAuthState,
  createDiscordOAuthState,
  discordForAccount,
  grantRewardPoints,
  linkDiscordToAccount,
  listSwagClaims,
  loadRewardState,
  setDiscordGuildMember,
  unlinkDiscord,
} from './discord_db';
import {
  buildAuthorizeUrl,
  buildTokenRequestBody,
  DISCORD_API_BASE,
  DISCORD_TOKEN_URL,
  type DiscordLinkMode,
  type DiscordUser,
  discordAvatarUrl,
  discordDisplayName,
  isDiscordLinkMode,
  isMemberOfGuild,
  parseDiscordUser,
  parseGuildIds,
  parseTokenResponse,
  pkceChallengeFromVerifier,
} from './discord_oauth';
import { isUniqueViolation, json } from './http_util';
import { discordRateLimited, requestIp } from './ratelimit';
import { publicOriginFromRequest, REALM_PUBLIC_ORIGIN } from './realm';

const STATE_TTL_MINUTES = 10;
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
  };
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
    guildMember,
  });
  if (!linked) {
    note('discord.link.conflict');
    return bouncePage(res, 409, { ok: false, mode, error: 'already_linked' });
  }
  await grantLinkRewards(accountId, guildMember);
  note('discord.link.success');
  return bouncePage(res, 200, { ok: true, mode, username: discordDisplayName(user) });
}

// Log in (or provision) the account that owns this Discord identity.
async function completeLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  user: DiscordUser,
  guildMember: boolean,
): Promise<void> {
  const meta = { ip: requestIp(req), userAgent: String(req.headers['user-agent'] ?? '') };
  let accountId = await accountForDiscord(pool, user.id);
  let username: string;
  if (accountId === null) {
    // First-time Discord login: provision a fresh, password-less account and link
    // it. Never auto-link to an existing account by email/username (Discord's email
    // is not verified to us, so that would be an account-takeover vector).
    const account = await provisionDiscordAccount(user, meta);
    accountId = account.id;
    username = account.username;
    await linkDiscordToAccount(pool, accountId, {
      discordUserId: user.id,
      username: discordDisplayName(user),
      avatar: user.avatar,
      guildMember,
    });
    await grantLinkRewards(accountId, guildMember);
    note('discord.login.provisioned');
  } else {
    const acct = await accountById(accountId);
    username = acct?.username ?? 'player';
    // Keep the membership flag + reward fresh on every login.
    await setDiscordGuildMember(pool, accountId, guildMember);
    if (guildMember) await grantGuildReward(accountId);
    note('discord.login.returning');
  }
  const status = await moderationStatusForAccount(accountId);
  if (status.locked) return bouncePage(res, 403, { ok: false, mode: 'login', error: 'locked' });
  await touchLogin(accountId, meta);
  const token = newToken();
  await saveToken(token, accountId, undefined, 'full', 'discord');
  return bouncePage(res, 200, { ok: true, mode: 'login', token, username });
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
  return { user, guildMember };
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
      // while staying password-unusable until the user sets one in the portal.
      return await createAccount(candidate, await hashPassword(newToken()), meta);
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  const fallback = `disc${randomBytes(8).toString('hex').slice(0, 18)}`;
  return createAccount(fallback, await hashPassword(newToken()), meta);
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
  const [link, reward, claimedSwagIds] = await Promise.all([
    discordForAccount(pool, accountId),
    loadRewardState(pool, accountId),
    listSwagClaims(pool, accountId),
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
export async function handleDiscordUnlink(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
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

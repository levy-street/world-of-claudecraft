import { timingSafeEqual } from 'node:crypto';
import type * as http from 'node:http';
import { specialRoleByKey } from '../src/sim/discord_roles';
import { DISCORD_REWARD_GRANTS, discordStatusIndexForPoints } from '../src/sim/discord_tier';
import { dailyRewardService } from './daily_rewards';
import { pool } from './db';
import { discordFlexForAccount, setDiscordPresenceCache } from './discord';
import { drainActivity } from './discord_activity';
import {
  accountForDiscord,
  discordForAccount,
  grantRewardPoints,
  loadRewardState,
  setDiscordGuildMember,
  setDiscordMemberMeta,
} from './discord_db';
import { drainRelay } from './discord_relay';
import type { GameServer } from './game';
import { json, readBody } from './http_util';

// Season ops are INJECTED (not imported) so this module stays free of the DB
// layer — server/db throws at import without DATABASE_URL, and this module is
// unit-tested without one. main.ts passes the real flow_ledger_db functions.
export interface SeasonOps {
  openSeason(p: { seasonId: number; label?: string; endsAt?: string | null }): Promise<void>;
  closeSeason(seasonId: number): Promise<void>;
}

// LP staking ops, injected the same way (absent when the LP flag is off, so the
// endpoint 404s exactly like an unconfigured secret).
export interface LpOps {
  runEpoch(): Promise<unknown>;
}

function ok(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}

function fail(res: http.ServerResponse, status: number, error: string, data: unknown = null): void {
  json(res, status, { success: false, data, error });
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

// Gate on a per-endpoint secret. Returns true only when the configured secret is
// present AND the request's header matches it (constant-time). An UNSET secret is
// a hard 404 — an op nobody enabled is indistinguishable from one that does not
// exist, so it can't be probed.
function authorize(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  envVar: string,
  header: string,
): boolean {
  const expected = process.env[envVar] ?? '';
  if (!expected) {
    fail(res, 404, 'unknown endpoint');
    return false;
  }
  const actual = String(req.headers[header] ?? '');
  if (!secretsMatch(actual, expected)) {
    fail(res, 401, 'not authenticated');
    return false;
  }
  return true;
}

// Normalize a caller-supplied season end time: absent/null → open-ended; a string
// → validated ISO; anything else → invalid.
function normalizeEndsAt(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d.toISOString() };
}

export async function handleInternalApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: GameServer,
  seasonOps?: SeasonOps,
  lpOps?: LpOps,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/internal/restart-countdown') {
    if (req.method !== 'POST') return fail(res, 404, 'unknown endpoint');
    const expected = process.env.RESTART_COUNTDOWN_SECRET ?? '';
    if (!expected) return fail(res, 404, 'unknown endpoint');
    const actual = String(req.headers['x-woc-deploy-secret'] ?? '');
    if (!secretsMatch(actual, expected)) return fail(res, 401, 'not authenticated');
    const status = game.startRestartCountdown();
    if (!status.started) return fail(res, 409, 'restart countdown already active', status);
    return ok(res, status);
  }

  // $WOC season ops (the #479/#480 season-roll jobs call these): open/re-open a
  // reward season with an optional end time, or close one. Gated by WOC_OPS_SECRET;
  // a 404 when season ops are not wired in (e.g. unit tests / a build without them).
  if (url.pathname === '/internal/woc/season/open') {
    if (!seasonOps) return fail(res, 404, 'unknown endpoint');
    if (!authorize(req, res, 'WOC_OPS_SECRET', 'x-woc-ops-secret')) return;
    const body = await readBody(req);
    const seasonId = Number(body?.seasonId);
    if (!Number.isInteger(seasonId)) return fail(res, 400, 'seasonId must be an integer');
    const label = typeof body?.label === 'string' ? body.label.slice(0, 120) : '';
    const endsAt = normalizeEndsAt(body?.endsAt);
    if (!endsAt.ok) return fail(res, 400, 'endsAt must be an ISO timestamp or omitted');
    await seasonOps.openSeason({ seasonId, label, endsAt: endsAt.value });
    return ok(res, { seasonId, label, endsAt: endsAt.value });
  }

  if (url.pathname === '/internal/woc/season/close') {
    if (!seasonOps) return fail(res, 404, 'unknown endpoint');
    if (!authorize(req, res, 'WOC_OPS_SECRET', 'x-woc-ops-secret')) return;
    const body = await readBody(req);
    const seasonId = Number(body?.seasonId);
    if (!Number.isInteger(seasonId)) return fail(res, 400, 'seasonId must be an integer');
    await seasonOps.closeSeason(seasonId);
    return ok(res, { seasonId, closed: true });
  }

  // Force one LP staking epoch cycle (ops/debug; the interval runner is the
  // normal path). Result is whatever the runner reports (ran/reason/emission).
  // POST-only, like the season ops above (v0.21.0 moved method checks
  // per-endpoint, so this one carries its own).
  if (url.pathname === '/internal/woc/lp/epoch') {
    if (req.method !== 'POST') return fail(res, 404, 'unknown endpoint');
    if (!lpOps) return fail(res, 404, 'unknown endpoint');
    if (!authorize(req, res, 'WOC_OPS_SECRET', 'x-woc-ops-secret')) return;
    const result = await lpOps.runEpoch();
    return ok(res, result ?? { skipped: 'another process holds the epoch lock' });
  }

  if (url.pathname.startsWith('/internal/discord/')) {
    return handleDiscordInternal(req, res, url);
  }

  return fail(res, 404, 'unknown endpoint');
}

// Secret-gated server<->bot channel. The Discord bot (a separate process) reads
// flex/role data and pushes presence + reward grants here. A bot token is NOT a
// user bearer, so these never touch the user-auth path; they authenticate with a
// shared DISCORD_BOT_SECRET and are still defensively validated.
async function handleDiscordInternal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const expected = process.env.DISCORD_BOT_SECRET ?? '';
  if (!expected) return fail(res, 404, 'unknown endpoint'); // feature off
  const actual = String(req.headers['x-woc-discord-secret'] ?? '');
  if (!secretsMatch(actual, expected)) return fail(res, 401, 'not authenticated');

  // GET /internal/discord/flex?discord_user_id=... -> top character + status.
  if (req.method === 'GET' && url.pathname === '/internal/discord/flex') {
    const discordUserId = url.searchParams.get('discord_user_id') ?? '';
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return ok(res, { linked: false });
    return ok(res, { linked: true, ...(await discordFlexForAccount(accountId)) });
  }

  // GET /internal/discord/roles?discord_user_id=... -> status tier for role sync.
  if (req.method === 'GET' && url.pathname === '/internal/discord/roles') {
    const discordUserId = url.searchParams.get('discord_user_id') ?? '';
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return ok(res, { linked: false, statusTier: 0, points: 0 });
    const reward = await loadRewardState(pool, accountId);
    return ok(res, {
      linked: true,
      statusTier: discordStatusIndexForPoints(reward.lifetimePoints),
      points: reward.points,
      lifetimePoints: reward.lifetimePoints,
    });
  }

  // POST /internal/discord/presence -> cache who is online / in the voice room.
  if (req.method === 'POST' && url.pathname === '/internal/discord/presence') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const onlineCount = clampInt(body.onlineCount, 0, 1_000_000);
    const memberTotal = clampInt(body.memberTotal, 0, 100_000_000);
    const voiceChannelName =
      typeof body.voiceChannelName === 'string' ? body.voiceChannelName.slice(0, 80) : null;
    const voice = Array.isArray(body.voice)
      ? body.voice.slice(0, 50).map((m: unknown) => sanitizeVoiceMember(m))
      : [];
    setDiscordPresenceCache({ onlineCount, memberTotal, voiceChannelName, voice });
    return ok(res, { received: true });
  }

  // POST /internal/discord/grant -> award reward points (booster, daily active...).
  if (req.method === 'POST' && url.pathname === '/internal/discord/grant') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 64) : '';
    const points = clampInt(body.points, -100_000, 100_000);
    const dedupeKey = typeof body.dedupeKey === 'string' ? body.dedupeKey.slice(0, 128) : null;
    if (!reason || points === 0) return fail(res, 400, 'reason and non-zero points required');
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return fail(res, 404, 'discord id not linked');
    const state = await grantRewardPoints(pool, accountId, points, reason, dedupeKey);
    return ok(res, {
      points: state.points,
      lifetimePoints: state.lifetimePoints,
      statusTier: discordStatusIndexForPoints(state.lifetimePoints),
    });
  }

  // POST /internal/discord/member -> sync guild membership + grant the member reward.
  if (req.method === 'POST' && url.pathname === '/internal/discord/member') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
    const guildMember = body.guildMember === true;
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return fail(res, 404, 'discord id not linked');
    await setDiscordGuildMember(pool, accountId, guildMember);
    if (guildMember) {
      const g = DISCORD_REWARD_GRANTS.guildMember;
      await grantRewardPoints(pool, accountId, g.points, g.reason, `${g.reason}:${accountId}`);
    }
    return ok(res, { updated: true });
  }

  // GET /internal/discord/relay -> drain queued "!" community posts, each enriched
  // with the issuer's Discord identity so the bot can mention them + show avatar.
  if (req.method === 'GET' && url.pathname === '/internal/discord/relay') {
    const items = drainRelay();
    const enriched = await Promise.all(
      items.map(async (it) => {
        const link = await discordForAccount(pool, it.accountId);
        return {
          ...it,
          discordUserId: link?.discord_user_id ?? null,
          discordUsername: link?.discord_username ?? null,
          discordAvatar: link?.discord_avatar ?? null,
        };
      }),
    );
    return ok(res, { items: enriched });
  }

  // GET /internal/discord/activity -> drain the significant-activity feed, each
  // item enriched with its participants' Discord identities (to mention + show
  // avatar). Items with NO linked participant are dropped (the feed only
  // celebrates players who linked Discord).
  if (req.method === 'GET' && url.pathname === '/internal/discord/activity') {
    const items = drainActivity();
    const out: unknown[] = [];
    for (const it of items) {
      const participants = await Promise.all(
        it.accountIds.map(async (accountId, i) => {
          const link = await discordForAccount(pool, accountId);
          return {
            name: it.names[i] ?? '',
            discordUserId: link?.discord_user_id ?? null,
            discordAvatar: link?.discord_avatar ?? null,
          };
        }),
      );
      if (!participants.some((p) => p.discordUserId)) continue; // nobody linked
      const { accountIds: _a, names: _n, ...rest } = it;
      out.push({ ...rest, participants });
    }
    return ok(res, { items: out });
  }

  if (req.method === 'GET' && url.pathname === '/internal/discord/daily-rewards-winners') {
    const limit = clampInt(Number(url.searchParams.get('limit')) || 1, 1, 5);
    return ok(res, await dailyRewardService.discordWinnerAnnouncements(limit));
  }

  if (req.method === 'POST' && url.pathname === '/internal/discord/daily-rewards-winners/mark') {
    const result = await dailyRewardService.markDiscordWinnersAnnounced(
      await readBody(req).catch(() => ({})),
    );
    if ('error' in result) return fail(res, result.status, result.error);
    return ok(res, result);
  }

  // POST /internal/discord/members-meta -> the bot pushes guild join dates + top
  // staff/special role for members; we store it on the matching linked accounts.
  if (req.method === 'POST' && url.pathname === '/internal/discord/members-meta') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const members = Array.isArray(body.members) ? body.members.slice(0, 1000) : [];
    let updated = 0;
    for (const m of members) {
      const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
      const id = typeof o.discord_user_id === 'string' ? o.discord_user_id.slice(0, 32) : '';
      if (!id) continue;
      const name = typeof o.name === 'string' ? o.name.slice(0, 64) : null;
      const joinedAtMs =
        typeof o.joinedAtMs === 'number' && Number.isFinite(o.joinedAtMs) ? o.joinedAtMs : null;
      // Only accept a known special-role key; anything else clears the role.
      const roleKey = typeof o.role === 'string' && specialRoleByKey(o.role) ? o.role : null;
      await setDiscordMemberMeta(pool, id, name, joinedAtMs, roleKey);
      updated++;
    }
    return ok(res, { updated });
  }

  return fail(res, 404, 'unknown endpoint');
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(min, Math.min(max, n));
}

function sanitizeVoiceMember(m: unknown): {
  id: string;
  name: string;
  speaking: boolean;
  selfMute: boolean;
} {
  const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
  return {
    id: typeof o.id === 'string' ? o.id.slice(0, 32) : '',
    name: typeof o.name === 'string' ? o.name.slice(0, 48) : '',
    speaking: o.speaking === true,
    selfMute: o.selfMute === true,
  };
}

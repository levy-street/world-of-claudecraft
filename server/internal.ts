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
  discordIdsWithGuildFlair,
  grantRewardPoints,
  loadRewardState,
  setDiscordGuildMember,
  setDiscordMemberMeta,
} from './discord_db';
import { drainRelay } from './discord_relay';
import type { GameServer } from './game';
import {
  DEPLOY_SECRET_ENV,
  DEPLOY_SECRET_HEADER,
  DISCORD_SECRET_ENV,
  DISCORD_SECRET_HEADER,
  requireInternalSecret,
} from './http/middleware/require_internal_secret';
import type { RouteDef, RouteMeta } from './http/types';
import { json, readBody } from './http_util';

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

export async function handleInternalApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: GameServer,
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

  // GET /internal/discord/flaired-ids -> the discord ids whose stored link still
  // carries guild membership or a special-role key. The bot diffs this against a
  // COMPLETE live roster to clear flair for members who left while it was offline
  // (clears go back through the member + members-meta endpoints, so this stays a
  // pure read and a truncated request body can never mass-clear anything).
  if (req.method === 'GET' && url.pathname === '/internal/discord/flaired-ids') {
    return ok(res, { ids: await discordIdsWithGuildFlair(pool) });
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

// ── Route table ────────────────────────────
// All 12 handleInternalApi endpoints as RouteDefs for the shared dispatcher:
// the deploy-gated restart-countdown plus the 11 Discord-bot-gated routes
// (including the two daily-rewards-winners routes added after the original
// count of 9, and flaired-ids, added after the migration on BOTH arms per the
// dual-edit rule). PARITY-FIRST: each thin handler REPRODUCES its frozen
// legacy branch above byte-for-byte (same imported data cores, same clamps and
// truncations, same ok()/fail() envelope bodies), and the secret gates move to
// the requireInternalSecret middleware, which writes the SAME legacy bodies
// (feature-off 404 'unknown endpoint', mismatch 401 'not authenticated'). The
// legacy handleInternalApi ladder stays intact as the flag-off rollback path
// (and as the dispatcher's delegate for unknown paths, wrong methods, and
// HEAD, which therefore keep the legacy 404 'unknown endpoint' behavior: the
// wrong-method restart-countdown stays 404, never the table router's 405).
//
// The separate /internal/daily-rewards/* ops family (handleDailyRewardInternalApi,
// server/daily_rewards.ts) was never part of this ladder and stays entirely on
// the delegate, unchanged.
//
// The one divergence is an UNEXPECTED handler/DB throw
// (internalBodyValidationRemap, tests/server/http/known_deviations.ts): the
// legacy ladder has NO outer catch (a throw becomes an unhandled rejection in
// main.ts's fire-and-forget arm and the request hangs), while the new path's
// withErrors serializes it through the admin-shape serializer as 500
// { success: false, data: null, error: 'internal.error' }. The internal
// envelope IS the admin { success, data, error } shape, so the routes carry
// meta.envelope 'admin' (EnvelopeKind is a frozen server/http/types.ts contract
// with no separate 'internal' member; serializeAdmin already emits this exact shape).

// The game-loop side effect the restart-countdown handler needs, injected at
// boot by main.ts (configureInternalRuntime(game)) so this module never
// imports the live GameServer instance.
export type InternalRuntime = Pick<GameServer, 'startRestartCountdown'>;

let internalRuntime: InternalRuntime | null = null;

export function configureInternalRuntime(runtime: InternalRuntime): void {
  internalRuntime = runtime;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetInternalRuntimeForTests(): void {
  internalRuntime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useInternalRuntime(): InternalRuntime {
  if (internalRuntime === null) {
    throw new Error('internal runtime is not configured; call configureInternalRuntime');
  }
  return internalRuntime;
}

const INTERNAL_META: RouteMeta = { envelope: 'admin' };

// One gate instance per (header, env var) pair, shared across the routes that
// carry it, mirroring the two legacy gate blocks exactly.
const deployGate = requireInternalSecret({
  header: DEPLOY_SECRET_HEADER,
  envVar: DEPLOY_SECRET_ENV,
});
const discordGate = requireInternalSecret({
  header: DISCORD_SECRET_HEADER,
  envVar: DISCORD_SECRET_ENV,
});

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/internal/restart-countdown',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [deployGate],
    handler: async (ctx) => {
      const status = useInternalRuntime().startRestartCountdown();
      if (!status.started) {
        return fail(ctx.res, 409, 'restart countdown already active', status);
      }
      return ok(ctx.res, status);
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/flex',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const discordUserId = ctx.url.searchParams.get('discord_user_id') ?? '';
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return ok(ctx.res, { linked: false });
      return ok(ctx.res, { linked: true, ...(await discordFlexForAccount(accountId)) });
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/roles',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const discordUserId = ctx.url.searchParams.get('discord_user_id') ?? '';
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return ok(ctx.res, { linked: false, statusTier: 0, points: 0 });
      const reward = await loadRewardState(pool, accountId);
      return ok(ctx.res, {
        linked: true,
        statusTier: discordStatusIndexForPoints(reward.lifetimePoints),
        points: reward.points,
        lifetimePoints: reward.lifetimePoints,
      });
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/presence',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
      const onlineCount = clampInt(body.onlineCount, 0, 1_000_000);
      const memberTotal = clampInt(body.memberTotal, 0, 100_000_000);
      const voiceChannelName =
        typeof body.voiceChannelName === 'string' ? body.voiceChannelName.slice(0, 80) : null;
      const voice = Array.isArray(body.voice)
        ? body.voice.slice(0, 50).map((m: unknown) => sanitizeVoiceMember(m))
        : [];
      setDiscordPresenceCache({ onlineCount, memberTotal, voiceChannelName, voice });
      return ok(ctx.res, { received: true });
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/grant',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
      const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 64) : '';
      const points = clampInt(body.points, -100_000, 100_000);
      const dedupeKey = typeof body.dedupeKey === 'string' ? body.dedupeKey.slice(0, 128) : null;
      if (!reason || points === 0) {
        return fail(ctx.res, 400, 'reason and non-zero points required');
      }
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return fail(ctx.res, 404, 'discord id not linked');
      const state = await grantRewardPoints(pool, accountId, points, reason, dedupeKey);
      return ok(ctx.res, {
        points: state.points,
        lifetimePoints: state.lifetimePoints,
        statusTier: discordStatusIndexForPoints(state.lifetimePoints),
      });
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/member',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
      const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
      const guildMember = body.guildMember === true;
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return fail(ctx.res, 404, 'discord id not linked');
      await setDiscordGuildMember(pool, accountId, guildMember);
      if (guildMember) {
        const g = DISCORD_REWARD_GRANTS.guildMember;
        await grantRewardPoints(pool, accountId, g.points, g.reason, `${g.reason}:${accountId}`);
      }
      return ok(ctx.res, { updated: true });
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/relay',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
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
      return ok(ctx.res, { items: enriched });
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/activity',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
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
      return ok(ctx.res, { items: out });
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/daily-rewards-winners',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const limit = clampInt(Number(ctx.url.searchParams.get('limit')) || 1, 1, 5);
      return ok(ctx.res, await dailyRewardService.discordWinnerAnnouncements(limit));
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/daily-rewards-winners/mark',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const result = await dailyRewardService.markDiscordWinnersAnnounced(
        await readBody(ctx.req).catch(() => ({})),
      );
      if ('error' in result) return fail(ctx.res, result.status, result.error);
      return ok(ctx.res, result);
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/members-meta',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
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
      return ok(ctx.res, { updated });
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/flaired-ids',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      return ok(ctx.res, { ids: await discordIdsWithGuildFlair(pool) });
    },
  },
];

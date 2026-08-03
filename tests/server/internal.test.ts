// Unit coverage for the internal route layer (server/internal.ts).
//
// The migration moved all 11 /internal endpoints (the deploy-gated restart-countdown
// plus the 10 Discord-bot-gated routes) off the inline handleInternalApi ladder
// onto RouteDefs the shared dispatcher serves under API_DISPATCH 'new'. It is a
// PARITY-FIRST migration: each thin handler REPRODUCES its frozen legacy branch
// byte-for-byte, writing the SAME { success, data, error } envelope via the
// module's ok()/fail() helpers (the internal envelope IS the admin shape, so the
// routes carry surface 'internal' + meta.envelope 'admin'). The secret gates move
// to the requireInternalSecret middleware.
//
// POST /internal/discord/flex-batch is the exception and is NOT part of that
// migration: it was born afterwards, so it is RouteDef-ONLY with no legacy ladder
// arm and nothing to keep byte-identical (the new-route rule in
// server/http/CLAUDE.md). Its "no legacy twin" shape is pinned below rather than
// assumed.
//
// This file pins HANDLER behavior behind a PASSING gate (the exhaustive
// unset-env-404 / wrong-secret-401 gate sweep lives in
// tests/server/http/ownership_coverage.test.ts, so only one representative gate
// case per family is repeated here to prove the gates ride the RouteDef
// middleware). It also pins the frozen { success, data, error } envelope, the
// game.startRestartCountdown injection seam (configureInternalRuntime), and the
// internalBodyValidationRemap 500 (a handler/DB throw serializes through
// withErrors/serializeAdmin as { success:false, data:null, error:'internal.error' }).
//
// server/db builds a pg Pool at module load and throws when DATABASE_URL is unset;
// it is fully mocked here (a bare pool token), so the real db never loads. A dummy
// URL is set defensively before the module graph evaluates all the same.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5433/wocc_phase18_internal';
});

// Hoisted module mocks. The real server/db and the Discord persistence/IO layers
// never load: internal.ts touches them only through these fakes. src/sim stays
// REAL (discordStatusIndexForPoints, DISCORD_REWARD_GRANTS, specialRoleByKey).
vi.mock('../../server/db', () => ({ pool: { __fake: 'internal-pool' } }));
vi.mock('../../server/discord_db', () => ({
  accountForDiscord: vi.fn(),
  discordForAccount: vi.fn(),
  discordIdsWithGuildFlair: vi.fn(),
  discordLinksForAccounts: vi.fn(),
  grantRewardPoints: vi.fn(),
  loadRewardState: vi.fn(),
  setDiscordGuildMember: vi.fn(),
  setDiscordMemberMetaBulk: vi.fn(),
}));
vi.mock('../../server/discord', () => ({
  discordFlexForAccount: vi.fn(),
  discordFlexForAccounts: vi.fn(),
  setDiscordPresenceCache: vi.fn(),
}));
// Only the cache WRITE is faked: the real module supplies the fixed breaker-state
// list the sanitizer validates against, so a change to that list is felt here.
vi.mock('../../server/discord_bot_counters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/discord_bot_counters')>()),
  setDiscordBotCounters: vi.fn(),
}));
vi.mock('../../server/discord_activity', () => ({
  drainActivity: vi.fn(),
  requeueActivity: vi.fn(),
}));
vi.mock('../../server/discord_relay', () => ({ drainRelay: vi.fn(), requeueRelay: vi.fn() }));
vi.mock('../../server/daily_rewards', () => ({
  dailyRewardService: {
    discordWinnerAnnouncements: vi.fn(),
    markDiscordWinnersAnnounced: vi.fn(),
  },
}));

import type * as http from 'node:http';
import { MEMBERS_META_BATCH } from '../../bot/logic';
import { dailyRewardService } from '../../server/daily_rewards';
import { pool } from '../../server/db';
import {
  type DiscordFlex,
  type DiscordFlexBatchEntry,
  discordFlexForAccount,
  discordFlexForAccounts,
  setDiscordPresenceCache,
} from '../../server/discord';
import type { QueuedActivity } from '../../server/discord_activity';
import { drainActivity, requeueActivity } from '../../server/discord_activity';
import {
  type DiscordBotCountersSnapshot,
  setDiscordBotCounters,
} from '../../server/discord_bot_counters';
import type { DiscordLinkRow, DiscordMemberMetaRecord } from '../../server/discord_db';
import {
  accountForDiscord,
  discordForAccount,
  discordIdsWithGuildFlair,
  discordLinksForAccounts,
  grantRewardPoints,
  loadRewardState,
  setDiscordGuildMember,
  setDiscordMemberMetaBulk,
} from '../../server/discord_db';
// The change feed itself is pure and dependency-free, so the REAL module runs
// here: tests enqueue into it and the outbox handler drains it, which exercises
// the actual FIFO rather than a fake standing in for it.
import { drainLinkChanges, enqueueLinkChange } from '../../server/discord_link_changes';
import type { QueuedRelay } from '../../server/discord_relay';
import { drainRelay, requeueRelay } from '../../server/discord_relay';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import {
  configureInternalRuntime,
  handleInternalApi,
  type InternalRuntime,
  resetInternalRuntimeForTests,
  routes,
} from '../../server/internal';
import { FakeRes, fakeCtx, makeReq } from './helpers';

// The two shared secrets and their matching headers. The gate reads the env var
// PER REQUEST, so each test sets the one it needs and passes the header.
const DEPLOY_SECRET = 'deploy-secret';
const DISCORD_SECRET = 'discord-secret';
const DEPLOY_HEADERS = { 'x-woc-deploy-secret': DEPLOY_SECRET };
const DISCORD_HEADERS = { 'x-woc-discord-secret': DISCORD_SECRET };

// The 14 routes as [method, path]: the legacy handleInternalApi ladder order
// (the 11 migrated routes plus flaired-ids, added after the migration on both
// arms per the dual-edit rule), then flex-batch and outbox, which are
// RouteDef-ONLY and have no legacy arm by design (a route born after the
// migration never gets one).
const EXPECTED_ROUTES: ReadonlyArray<readonly [Method, string]> = [
  ['POST', '/internal/restart-countdown'],
  ['GET', '/internal/discord/flex'],
  ['GET', '/internal/discord/roles'],
  ['POST', '/internal/discord/presence'],
  ['POST', '/internal/discord/grant'],
  ['POST', '/internal/discord/member'],
  ['GET', '/internal/discord/relay'],
  ['GET', '/internal/discord/activity'],
  ['GET', '/internal/discord/daily-rewards-winners'],
  ['POST', '/internal/discord/daily-rewards-winners/mark'],
  ['POST', '/internal/discord/members-meta'],
  ['GET', '/internal/discord/flaired-ids'],
  ['POST', '/internal/discord/flex-batch'],
  ['GET', '/internal/discord/outbox'],
];

/** Read status/body/content-type/headers off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
  headers: Record<string, string | number | string[]>;
} {
  const fake = res as unknown as FakeRes;
  const raw = fake.body;
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: fake.statusCode,
    body,
    raw,
    contentType: fake.headers['content-type'] as string | undefined,
    headers: fake.headers,
  };
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Drive a full route chain (its real gate middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: { url?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({
    method,
    url: opts.url ?? path,
    headers: opts.headers,
    body: opts.body,
  });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

/**
 * A full DiscordLinkRow for a linked account id (du<id>/un<id>/av<id>).
 * Deliberately WIDER than the DiscordOutboxLinkRow contract (which is four
 * fields): the mock hands the handler more than production would, and the
 * shape pins below prove none of the extra fields, discord_email above all,
 * can leak into a response.
 */
function linkRow(accountId: number): DiscordLinkRow {
  return {
    account_id: accountId,
    discord_user_id: `du${accountId}`,
    discord_username: `un${accountId}`,
    discord_avatar: `av${accountId}`,
    discord_email: null,
    guild_member: false,
    linked_at: 'x',
  };
}

/** A full QueuedRelay item (the handler spreads it, so every field flows through). */
function relayItem(accountId: number, message: string): QueuedRelay {
  return {
    commandId: 'lfg',
    tag: 'LFG',
    label: 'Looking for Group',
    color: 1,
    accountId,
    characterName: 'Char',
    level: 10,
    className: 'Hunter',
    realm: 'R',
    zone: 'Z',
    message,
    profileUrl: null,
  };
}

/** A QueuedActivity item with one participant account id and a parallel name. */
function activityItem(accountId: number, name: string): QueuedActivity {
  return {
    kind: 'levelup',
    accountIds: [accountId],
    names: [name],
    realm: 'R',
    profileUrl: null,
    level: 10,
  };
}

const ORIGINAL_DEPLOY_SECRET = process.env.RESTART_COUNTDOWN_SECRET;
const ORIGINAL_DISCORD_SECRET = process.env.DISCORD_BOT_SECRET;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.RESTART_COUNTDOWN_SECRET;
  delete process.env.DISCORD_BOT_SECRET;
  resetInternalRuntimeForTests();
  // The change feed is a module-global singleton and its drain is destructive,
  // so emptying it here is the reset: no test can inherit another's items.
  drainLinkChanges();
});

afterEach(() => {
  restoreEnv('RESTART_COUNTDOWN_SECRET', ORIGINAL_DEPLOY_SECRET);
  restoreEnv('DISCORD_BOT_SECRET', ORIGINAL_DISCORD_SECRET);
  resetInternalRuntimeForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Registration shape.
// ---------------------------------------------------------------------------

describe('internal route registration', () => {
  it('registers exactly 14 routes matching the legacy ladder plus the RouteDef-only pair', () => {
    expect(routes).toHaveLength(14);
    const actual = routes.map((r) => `${r.method} ${r.path}`).sort();
    const expected = EXPECTED_ROUTES.map(([m, p]) => `${m} ${p}`).sort();
    expect(actual).toEqual(expected);
  });

  it('every route is surface internal, envelope admin, with a non-empty gate middleware', () => {
    for (const r of routes) {
      expect(r.surface, r.path).toBe('internal');
      expect(r.meta?.envelope, r.path).toBe('admin');
      expect(Array.isArray(r.middleware) && r.middleware.length > 0, r.path).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. restart-countdown (deploy gate + injected runtime).
// ---------------------------------------------------------------------------

describe('restart-countdown', () => {
  it('200s with the status payload when the countdown starts', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = DEPLOY_SECRET;
    const status = { started: true, active: true, totalSeconds: 600, remainingSeconds: 600 };
    const startRestartCountdown = vi.fn(() => status);
    configureInternalRuntime({ startRestartCountdown } as unknown as InternalRuntime);

    const r = await runRoute('POST', '/internal/restart-countdown', { headers: DEPLOY_HEADERS });

    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: status, error: null });
    expect(startRestartCountdown).toHaveBeenCalledTimes(1);
  });

  it('409s carrying the status payload when a countdown is already active', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = DEPLOY_SECRET;
    const status = { started: false, active: true, totalSeconds: 600, remainingSeconds: 540 };
    configureInternalRuntime({
      startRestartCountdown: vi.fn(() => status),
    } as unknown as InternalRuntime);

    const r = await runRoute('POST', '/internal/restart-countdown', { headers: DEPLOY_HEADERS });

    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      success: false,
      data: status,
      error: 'restart countdown already active',
    });
  });

  it('500s internal.error when the runtime was never configured', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = DEPLOY_SECRET;
    resetInternalRuntimeForTests();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await runRoute('POST', '/internal/restart-countdown', { headers: DEPLOY_HEADERS });

    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, data: null, error: 'internal.error' });
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. discord/flex (link lookup + flex merge).
// ---------------------------------------------------------------------------

describe('discord/flex', () => {
  it('returns { linked: false } for an unlinked discord id', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(null);

    const r = await runRoute('GET', '/internal/discord/flex', {
      url: '/internal/discord/flex?discord_user_id=u1',
      headers: DISCORD_HEADERS,
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { linked: false }, error: null });
    expect(vi.mocked(accountForDiscord)).toHaveBeenCalledWith(pool, 'u1');
    expect(vi.mocked(discordFlexForAccount)).not.toHaveBeenCalled();
  });

  it('merges the flex payload for a linked account and reads the id from the query', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const flex: DiscordFlex = {
      found: true,
      username: 'coolguy',
      statusTier: 3,
      points: 500,
      character: { name: 'Hero', class: 'Warrior', level: 40, profileUrl: 'https://x/p' },
    };
    vi.mocked(accountForDiscord).mockResolvedValue(77);
    vi.mocked(discordFlexForAccount).mockResolvedValue(flex);

    const r = await runRoute('GET', '/internal/discord/flex', {
      url: '/internal/discord/flex?discord_user_id=u1',
      headers: DISCORD_HEADERS,
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { linked: true, ...flex }, error: null });
    expect(vi.mocked(accountForDiscord)).toHaveBeenCalledWith(pool, 'u1');
    expect(vi.mocked(discordFlexForAccount)).toHaveBeenCalledWith(77);
  });
});

// ---------------------------------------------------------------------------
// 4. discord/roles (status tier via the REAL discordStatusIndexForPoints).
// ---------------------------------------------------------------------------

describe('discord/roles', () => {
  it('returns { linked: false, statusTier: 0, points: 0 } for an unlinked id', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(null);

    const r = await runRoute('GET', '/internal/discord/roles', {
      url: '/internal/discord/roles?discord_user_id=u1',
      headers: DISCORD_HEADERS,
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { linked: false, statusTier: 0, points: 0 },
      error: null,
    });
    expect(vi.mocked(loadRewardState)).not.toHaveBeenCalled();
  });

  it('computes the status tier from lifetime points for a linked account', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(42);
    // 2000 lifetime points is exactly the "knight" rung (index 4).
    vi.mocked(loadRewardState).mockResolvedValue({ points: 1500, lifetimePoints: 2000 });

    const r = await runRoute('GET', '/internal/discord/roles', {
      url: '/internal/discord/roles?discord_user_id=u1',
      headers: DISCORD_HEADERS,
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { linked: true, statusTier: 4, points: 1500, lifetimePoints: 2000 },
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 5. discord/presence (clamp + truncate + sanitize).
// ---------------------------------------------------------------------------

describe('discord/presence', () => {
  it('trunc/clamps counts, truncates the channel name, and sanitizes the voice roster', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const voice: unknown[] = [
      'malformed',
      { id: 'v1', name: 'Voice One', speaking: true, selfMute: true },
    ];
    for (let i = 2; i < 51; i++) {
      voice.push({ id: `v${i}`, name: `Name ${i}`, speaking: false, selfMute: false });
    }

    const r = await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body: {
        onlineCount: 5.7,
        memberTotal: -3,
        voiceChannelName: 'a'.repeat(81),
        voice,
      },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { received: true }, error: null });
    expect(vi.mocked(setDiscordPresenceCache)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(setDiscordPresenceCache).mock.calls[0][0];
    expect(arg.onlineCount).toBe(5);
    expect(arg.memberTotal).toBe(0);
    expect(arg.voiceChannelName).toBe('a'.repeat(80));
    expect(arg.voice).toHaveLength(50);
    expect(arg.voice[0]).toEqual({ id: '', name: '', speaking: false, selfMute: false });
    expect(arg.voice[1]).toEqual({ id: 'v1', name: 'Voice One', speaking: true, selfMute: true });
  });
});

// ---------------------------------------------------------------------------
// 5b. discord/presence bot counters: the OPTIONAL block the bot rides in on the
// same push. Sanitized into a fixed 14-field shape (every number clamped, the
// scope record rebuilt from exactly four keys, the breaker state allowlisted),
// then handed to the process-local counters cache. Both presence arms carry the
// identical two lines, so the dual-arm case below pins them together.
// ---------------------------------------------------------------------------

/** What a healthy bot pushes: a distinct value per field, so no pin is ambiguous. */
const BOT_COUNTERS = {
  requests: 1000,
  rateLimited: 30,
  rateLimitedByScope: { user: 11, global: 7, shared: 9, unknown: 3 },
  globalPauses: 4,
  banPauses: 2,
  breakerState: 'open',
  breakerOpens: 5,
  queueDepth: 12,
  trackedBuckets: 40,
  trackedRoutes: 60,
  activeQueues: 6,
  forbiddenEntries: 8,
  forbiddenBlocks: 21,
  breakerBlocks: 13,
  queueFullBlocks: 17,
};

/** The 15 stored fields, in the order the wire contract declares them. */
const BOT_COUNTER_FIELDS = [
  'requests',
  'rateLimited',
  'rateLimitedByScope',
  'globalPauses',
  'banPauses',
  'breakerState',
  'breakerOpens',
  'queueDepth',
  'trackedBuckets',
  'trackedRoutes',
  'activeQueues',
  'forbiddenEntries',
  'forbiddenBlocks',
  'breakerBlocks',
  'queueFullBlocks',
];

/** The snapshot the arm stored on call `index`, or a loud failure if it stored none. */
function storedCounters(index = 0): DiscordBotCountersSnapshot {
  const calls = vi.mocked(setDiscordBotCounters).mock.calls;
  if (calls.length <= index) throw new Error(`no counters push at index ${index}`);
  return calls[index][0];
}

describe('discord/presence bot counters', () => {
  it('stores a fresh fixed-shape snapshot, dropping every unknown field', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    const r = await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body: {
        onlineCount: 3,
        counters: {
          ...BOT_COUNTERS,
          // A scope the fixed four does not carry, and a top-level field the
          // contract does not carry: neither may reach the cache (and so neither
          // can ever become a Prometheus label or series).
          rateLimitedByScope: { ...BOT_COUNTERS.rateLimitedByScope, evil: 5 },
          somethingNew: 'x',
          voice: ['nope'],
        },
      },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { received: true }, error: null });
    expect(vi.mocked(setDiscordBotCounters)).toHaveBeenCalledTimes(1);

    const stored = storedCounters();
    expect(Object.keys(stored)).toEqual(BOT_COUNTER_FIELDS);
    expect(Object.keys(stored.rateLimitedByScope)).toEqual(['user', 'global', 'shared', 'unknown']);
    expect(stored).toEqual({
      requests: 1000,
      rateLimited: 30,
      rateLimitedByScope: { user: 11, global: 7, shared: 9, unknown: 3 },
      globalPauses: 4,
      banPauses: 2,
      breakerState: 'open',
      breakerOpens: 5,
      queueDepth: 12,
      trackedBuckets: 40,
      trackedRoutes: 60,
      activeQueues: 6,
      forbiddenEntries: 8,
      forbiddenBlocks: 21,
      breakerBlocks: 13,
      queueFullBlocks: 17,
    });
    // Stamped with the REAL push time, so the cache can age it out. A bounded
    // window rather than a typeof: a handler stamping 0 (or any fixed literal)
    // would park every push permanently stale, with all five live gauges
    // reading 0 in production while a typeof pin stayed green.
    const stamp = vi.mocked(setDiscordBotCounters).mock.calls[0][1];
    expect(stamp).toBeGreaterThan(Date.now() - 5000);
    expect(stamp).toBeLessThanOrEqual(Date.now());
  });

  it('clamps every numeric field and zeroes anything that is not a finite number', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body: {
        counters: {
          requests: 2e9,
          rateLimited: -5,
          rateLimitedByScope: { user: 2e9, global: '3', shared: true },
          globalPauses: '7',
          banPauses: null,
          breakerState: 'weird',
          breakerOpens: 12.9,
          queueDepth: [4],
          trackedBuckets: { n: 1 },
          // trackedRoutes, activeQueues, forbiddenEntries, forbiddenBlocks,
          // breakerBlocks and queueFullBlocks are absent entirely.
        },
      },
    });

    expect(storedCounters()).toEqual({
      requests: 1_000_000_000,
      rateLimited: 0,
      rateLimitedByScope: { user: 1_000_000_000, global: 0, shared: 0, unknown: 0 },
      globalPauses: 0,
      banPauses: 0,
      breakerState: null,
      breakerOpens: 12,
      queueDepth: 0,
      trackedBuckets: 0,
      trackedRoutes: 0,
      activeQueues: 0,
      forbiddenEntries: 0,
      forbiddenBlocks: 0,
      breakerBlocks: 0,
      queueFullBlocks: 0,
    });
  });

  it('caps EVERY numeric slot independently, not just the two the mixed case hits', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    // 2e9 in all seventeen numeric slots at once. Per-field, because the clamp is
    // one `count` closure today but nothing stops a later edit from unrolling a
    // single field ("trackedRoutes: Math.trunc(Number(v) || 0)") and quietly
    // shipping it uncapped while the two-field case above stayed green.
    await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body: {
        counters: {
          requests: 2e9,
          rateLimited: 2e9,
          rateLimitedByScope: { user: 2e9, global: 2e9, shared: 2e9, unknown: 2e9 },
          globalPauses: 2e9,
          banPauses: 2e9,
          breakerState: 'open',
          breakerOpens: 2e9,
          queueDepth: 2e9,
          trackedBuckets: 2e9,
          trackedRoutes: 2e9,
          activeQueues: 2e9,
          forbiddenEntries: 2e9,
          forbiddenBlocks: 2e9,
          breakerBlocks: 2e9,
          queueFullBlocks: 2e9,
        },
      },
    });

    const cap = 1_000_000_000;
    expect(storedCounters()).toEqual({
      requests: cap,
      rateLimited: cap,
      rateLimitedByScope: { user: cap, global: cap, shared: cap, unknown: cap },
      globalPauses: cap,
      banPauses: cap,
      breakerState: 'open',
      breakerOpens: cap,
      queueDepth: cap,
      trackedBuckets: cap,
      trackedRoutes: cap,
      activeQueues: cap,
      forbiddenEntries: cap,
      forbiddenBlocks: cap,
      breakerBlocks: cap,
      queueFullBlocks: cap,
    });
  });

  it('stores all four scopes as zero when the scope record is an array', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    // An array is typeof 'object'; without its own guard it would slide past the
    // record check and index as undefined. The top-level counters block already
    // rejects an array, and the nested record must be symmetric.
    await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body: { counters: { requests: 5, rateLimitedByScope: [7, 8, 9] } },
    });

    expect(storedCounters().requests).toBe(5);
    expect(storedCounters().rateLimitedByScope).toEqual({
      user: 0,
      global: 0,
      shared: 0,
      unknown: 0,
    });
  });

  it('stores all four scopes as zero when the scope record is absent entirely', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    // A block with no rateLimitedByScope at all must not throw inside the
    // handler: a malformed telemetry block turning the presence push into a
    // 500 is exactly the coupling the optional counters design forbids.
    const r = await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body: { counters: { requests: 5 } },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { received: true }, error: null });
    expect(storedCounters().requests).toBe(5);
    expect(storedCounters().rateLimitedByScope).toEqual({
      user: 0,
      global: 0,
      shared: 0,
      unknown: 0,
    });
  });

  it('passes through each of the three allowed breaker states verbatim', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    for (const state of ['closed', 'open', 'half-open']) {
      await runRoute('POST', '/internal/discord/presence', {
        headers: DISCORD_HEADERS,
        body: { counters: { ...BOT_COUNTERS, breakerState: state } },
      });
    }

    expect(vi.mocked(setDiscordBotCounters)).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((i) => storedCounters(i).breakerState)).toEqual([
      'closed',
      'open',
      'half-open',
    ]);
  });

  it('stores NULL for a breaker state outside the allowlist, never an invented closed', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    // A corrupted state field must render as NO claim (all three one-hot series
    // 0), the same shape staleness takes. Mapping garbage to 'closed' would
    // paint a breaker that may in fact be open as healthy, which suppresses the
    // exact 2am signal this phase exists to carry.
    const hostiles = ['OPEN', 'tripped', '', 7, { state: 'open' }, ['open']];
    for (const breakerState of hostiles) {
      await runRoute('POST', '/internal/discord/presence', {
        headers: DISCORD_HEADERS,
        body: { counters: { ...BOT_COUNTERS, breakerState } },
      });
    }

    expect(vi.mocked(setDiscordBotCounters)).toHaveBeenCalledTimes(hostiles.length);
    for (let i = 0; i < hostiles.length; i++) {
      expect(storedCounters(i).breakerState).toBe(null);
      // The rest of the push survives: refusing the one field is not refusing
      // the block.
      expect(storedCounters(i).requests).toBe(1000);
    }
  });

  it('leaves the counters cache alone when the block is absent or not an object', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    for (const counters of [undefined, null, 'nope', 7, [BOT_COUNTERS]]) {
      const r = await runRoute('POST', '/internal/discord/presence', {
        headers: DISCORD_HEADERS,
        body: { onlineCount: 4, memberTotal: 9, counters },
      });
      expect(r.body).toEqual({ success: true, data: { received: true }, error: null });
    }

    // An older bot that pushes no counters keeps working: its presence still
    // lands, and the counters cache is left to age out on its own rather than
    // being overwritten with zeroes.
    expect(vi.mocked(setDiscordBotCounters)).not.toHaveBeenCalled();
    expect(vi.mocked(setDiscordPresenceCache)).toHaveBeenCalledTimes(5);
    expect(vi.mocked(setDiscordPresenceCache).mock.calls[0][0]).toEqual({
      onlineCount: 4,
      memberTotal: 9,
      voiceChannelName: null,
      voice: [],
    });
  });

  it('leaves the counters cache alone on the LEGACY arm too for an absent or non-object block', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    // The skip-the-cache guard is two independent code paths (the RouteDef
    // handler and the frozen ladder), so the loop above pins only one of them:
    // a legacy arm that stored a null-coalesced snapshot would overwrite live
    // counters with zeroes on every old-bot push while every RouteDef case
    // stayed green.
    for (const counters of [undefined, 'nope', [BOT_COUNTERS]]) {
      const req = makeReq({
        method: 'POST',
        url: '/internal/discord/presence',
        headers: DISCORD_HEADERS,
        body: { onlineCount: 4, memberTotal: 9, counters },
      });
      const res = new FakeRes();
      await handleInternalApi(req, res as unknown as http.ServerResponse, null as never);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        success: true,
        data: { received: true },
        error: null,
      });
    }

    expect(vi.mocked(setDiscordBotCounters)).not.toHaveBeenCalled();
    expect(vi.mocked(setDiscordPresenceCache)).toHaveBeenCalledTimes(3);
  });

  it('does not disturb the presence fields when counters ride along', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body: {
        onlineCount: 12,
        memberTotal: 400,
        voiceChannelName: 'General',
        voice: [{ id: 'v1', name: 'Voice One', speaking: true, selfMute: false }],
        counters: BOT_COUNTERS,
      },
    });

    expect(vi.mocked(setDiscordPresenceCache)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setDiscordPresenceCache).mock.calls[0][0]).toEqual({
      onlineCount: 12,
      memberTotal: 400,
      voiceChannelName: 'General',
      voice: [{ id: 'v1', name: 'Voice One', speaking: true, selfMute: false }],
    });
    expect(vi.mocked(setDiscordBotCounters)).toHaveBeenCalledTimes(1);
  });

  it('sanitizes identically on the legacy ladder arm and the RouteDef arm', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const body = {
      onlineCount: 12,
      counters: {
        ...BOT_COUNTERS,
        requests: 2e9,
        breakerState: 'nonsense',
        rateLimitedByScope: { ...BOT_COUNTERS.rateLimitedByScope, evil: 5 },
        somethingNew: 'x',
      },
    };

    const viaRouteDef = await runRoute('POST', '/internal/discord/presence', {
      headers: DISCORD_HEADERS,
      body,
    });

    const req = makeReq({
      method: 'POST',
      url: '/internal/discord/presence',
      headers: DISCORD_HEADERS,
      body,
    });
    const res = new FakeRes();
    await handleInternalApi(req, res as unknown as http.ServerResponse, null as never);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(viaRouteDef.body);
    expect(vi.mocked(setDiscordBotCounters)).toHaveBeenCalledTimes(2);

    // Both arms stored the same snapshot AS each other, and both match the one
    // expected literal (comparing the two calls alone would pass for two arms
    // that are identically wrong).
    const expected = {
      requests: 1_000_000_000,
      rateLimited: 30,
      rateLimitedByScope: { user: 11, global: 7, shared: 9, unknown: 3 },
      globalPauses: 4,
      banPauses: 2,
      breakerState: null,
      breakerOpens: 5,
      queueDepth: 12,
      trackedBuckets: 40,
      trackedRoutes: 60,
      activeQueues: 6,
      forbiddenEntries: 8,
      forbiddenBlocks: 21,
      breakerBlocks: 13,
      queueFullBlocks: 17,
    };
    expect(storedCounters(0)).toEqual(expected);
    expect(storedCounters(1)).toEqual(storedCounters(0));
    expect(Object.keys(storedCounters(1))).toEqual(BOT_COUNTER_FIELDS);

    // BOTH arms stamp the real push time. The snapshots matching says nothing
    // about the stamps: a legacy arm passing 0 would park every one of its
    // pushes permanently stale (all five live gauges 0 in production) while the
    // snapshot comparison above stayed green.
    for (const call of [0, 1]) {
      const stamp = vi.mocked(setDiscordBotCounters).mock.calls[call][1];
      expect(stamp).toBeGreaterThan(Date.now() - 5000);
      expect(stamp).toBeLessThanOrEqual(Date.now());
    }
  });
});

// ---------------------------------------------------------------------------
// 6. discord/grant (validation + clamp + reason truncation + tier).
// ---------------------------------------------------------------------------

describe('discord/grant', () => {
  it('400s when the reason is missing or the points are zero', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    const missingReason = await runRoute('POST', '/internal/discord/grant', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1', points: 5 },
    });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body).toEqual({
      success: false,
      data: null,
      error: 'reason and non-zero points required',
    });

    const zeroPoints = await runRoute('POST', '/internal/discord/grant', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1', reason: 'daily', points: 0 },
    });
    expect(zeroPoints.status).toBe(400);
    expect(zeroPoints.body).toEqual({
      success: false,
      data: null,
      error: 'reason and non-zero points required',
    });
    expect(vi.mocked(grantRewardPoints)).not.toHaveBeenCalled();
  });

  it('404s when the discord id is not linked', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(null);

    const r = await runRoute('POST', '/internal/discord/grant', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1', reason: 'daily', points: 5 },
    });

    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'discord id not linked' });
  });

  it('grants clamped points with a 64-char reason and returns the derived tier', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(42);
    vi.mocked(grantRewardPoints).mockResolvedValue({ points: 1234, lifetimePoints: 5000 });

    const r = await runRoute('POST', '/internal/discord/grant', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1', reason: 'r'.repeat(70), points: 200_000, dedupeKey: 'dk' },
    });

    expect(r.status).toBe(200);
    // 5000 lifetime points is exactly the "champion" rung (index 5).
    expect(r.body).toEqual({
      success: true,
      data: { points: 1234, lifetimePoints: 5000, statusTier: 5 },
      error: null,
    });
    expect(vi.mocked(grantRewardPoints)).toHaveBeenCalledWith(
      pool,
      42,
      100_000,
      'r'.repeat(64),
      'dk',
    );
  });
});

// ---------------------------------------------------------------------------
// 7. discord/member (guild-membership sync + the guild-member reward grant).
// ---------------------------------------------------------------------------

describe('discord/member', () => {
  it('404s when the discord id is not linked', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(null);

    const r = await runRoute('POST', '/internal/discord/member', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1', guildMember: true },
    });

    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'discord id not linked' });
    expect(vi.mocked(setDiscordGuildMember)).not.toHaveBeenCalled();
  });

  it('sets membership true and grants the guild-member reward with a keyed dedupe', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(42);
    vi.mocked(grantRewardPoints).mockResolvedValue({ points: 250, lifetimePoints: 250 });

    const r = await runRoute('POST', '/internal/discord/member', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1', guildMember: true },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { updated: true }, error: null });
    expect(vi.mocked(setDiscordGuildMember)).toHaveBeenCalledWith(pool, 42, true);
    // DISCORD_REWARD_GRANTS.guildMember: reason 'guild_member', 250 points; dedupe `${reason}:${id}`.
    expect(vi.mocked(grantRewardPoints)).toHaveBeenCalledWith(
      pool,
      42,
      250,
      'guild_member',
      'guild_member:42',
    );
  });

  it('sets membership false and grants nothing when guildMember is absent', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(accountForDiscord).mockResolvedValue(42);

    const r = await runRoute('POST', '/internal/discord/member', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1' },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { updated: true }, error: null });
    expect(vi.mocked(setDiscordGuildMember)).toHaveBeenCalledWith(pool, 42, false);
    expect(vi.mocked(grantRewardPoints)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. discord/relay (drain + per-item Discord-identity enrichment).
// ---------------------------------------------------------------------------

describe('discord/relay', () => {
  it('enriches each drained item, leaving nulls for an unlinked issuer', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(drainRelay).mockReturnValue([relayItem(1, 'a'), relayItem(2, 'b')]);
    vi.mocked(discordForAccount).mockImplementation(async (_pool, accountId) =>
      accountId === 1 ? linkRow(1) : null,
    );

    const r = await runRoute('GET', '/internal/discord/relay', { headers: DISCORD_HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: {
        items: [
          {
            ...relayItem(1, 'a'),
            discordUserId: 'du1',
            discordUsername: 'un1',
            discordAvatar: 'av1',
          },
          {
            ...relayItem(2, 'b'),
            discordUserId: null,
            discordUsername: null,
            discordAvatar: null,
          },
        ],
      },
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 9. discord/activity (drain + participant enrichment; drop items with none linked).
// ---------------------------------------------------------------------------

describe('discord/activity', () => {
  it('drops items with no linked participant and strips accountIds/names', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(drainActivity).mockReturnValue([activityItem(1, 'Alice'), activityItem(2, 'Bob')]);
    vi.mocked(discordForAccount).mockImplementation(async (_pool, accountId) =>
      accountId === 1 ? linkRow(1) : null,
    );

    const r = await runRoute('GET', '/internal/discord/activity', { headers: DISCORD_HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: {
        items: [
          {
            kind: 'levelup',
            realm: 'R',
            profileUrl: null,
            level: 10,
            participants: [{ name: 'Alice', discordUserId: 'du1', discordAvatar: 'av1' }],
          },
        ],
      },
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 10. discord/daily-rewards-winners (GET limit coercion + POST mark).
// ---------------------------------------------------------------------------

describe('discord/daily-rewards-winners', () => {
  it('clamps the GET limit (99 -> 5, absent -> 1, 0 -> 1) and ok-wraps the service return', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const service = vi.mocked(dailyRewardService.discordWinnerAnnouncements);
    service.mockResolvedValue({ days: [] });

    const r = await runRoute('GET', '/internal/discord/daily-rewards-winners', {
      url: '/internal/discord/daily-rewards-winners?limit=99',
      headers: DISCORD_HEADERS,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { days: [] }, error: null });
    expect(service).toHaveBeenLastCalledWith(5);

    await runRoute('GET', '/internal/discord/daily-rewards-winners', { headers: DISCORD_HEADERS });
    expect(service).toHaveBeenLastCalledWith(1);

    await runRoute('GET', '/internal/discord/daily-rewards-winners', {
      url: '/internal/discord/daily-rewards-winners?limit=0',
      headers: DISCORD_HEADERS,
    });
    expect(service).toHaveBeenLastCalledWith(1);
  });

  it('mark returns the service fail body on error and ok-wraps success', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const mark = vi.mocked(dailyRewardService.markDiscordWinnersAnnounced);

    mark.mockResolvedValue({ error: 'nope', status: 400 });
    const failed = await runRoute('POST', '/internal/discord/daily-rewards-winners/mark', {
      headers: DISCORD_HEADERS,
      body: { day: 'not-a-day' },
    });
    expect(failed.status).toBe(400);
    expect(failed.body).toEqual({ success: false, data: null, error: 'nope' });

    mark.mockResolvedValue({ marked: 2 } as unknown as { ok: true });
    const ok = await runRoute('POST', '/internal/discord/daily-rewards-winners/mark', {
      headers: DISCORD_HEADERS,
      body: {},
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, data: { marked: 2 }, error: null });
  });
});

// ---------------------------------------------------------------------------
// 11. discord/members-meta (per-member id/name slice, finite joinedAt, role validation).
// ---------------------------------------------------------------------------

describe('discord/members-meta', () => {
  /** The records the handler handed the bulk upsert on the most recent call. */
  function pushedRecords(): DiscordMemberMetaRecord[] {
    const calls = vi.mocked(setDiscordMemberMetaBulk).mock.calls;
    return calls[calls.length - 1][1] as DiscordMemberMetaRecord[];
  }

  it('slices id/name, keeps only a known role key, and skips entries with no id', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 2,
      skipped: 0,
      unapplied: [],
    });

    const r = await runRoute('POST', '/internal/discord/members-meta', {
      headers: DISCORD_HEADERS,
      body: {
        members: [
          {
            discord_user_id: 'd'.repeat(40),
            name: 'n'.repeat(70),
            joinedAtMs: 1_700_000_000_000,
            role: 'mods',
          },
          { discord_user_id: 'u2', role: 'not-a-role' },
          { name: 'no id here' },
        ],
      },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { updated: 2, changed: 2, skipped: 0, unapplied: [] },
      error: null,
    });
    // ONE call carrying BOTH records, not one call per record.
    expect(vi.mocked(setDiscordMemberMetaBulk)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setDiscordMemberMetaBulk).mock.calls[0][0]).toBe(pool);
    expect(pushedRecords()).toEqual([
      // 'mods' is a real special-role key; id/name slice to 32/64; finite joinedAt kept.
      {
        discordUserId: 'd'.repeat(32),
        nickname: 'n'.repeat(64),
        joinedAtMs: 1_700_000_000_000,
        roleKey: 'mods',
      },
      // 'not-a-role' clears to null; no name/joinedAt provided -> nulls.
      { discordUserId: 'u2', nickname: null, joinedAtMs: null, roleKey: null },
    ]);
  });

  it('slices each request at 1000 entries, at or above the bot batch size', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 1000,
      skipped: 0,
      unapplied: [],
    });

    // The bot splits its roster into MEMBERS_META_BATCH-sized requests on the
    // promise that the server processes AT LEAST that many entries per request;
    // anything past the server's slice is silently dropped. Pin the slice cap
    // to its literal and the bot batch at or under it, so a drift on either
    // side fails here instead of silently re-dropping the roster tail. (The
    // records are id-only on purpose: full records at this count would trip
    // the 64 KiB readBody cap FIRST, which is why the bot batch is byte-sized;
    // that bound is pinned in tests/discord_bot.test.ts.)
    expect(MEMBERS_META_BATCH).toBeLessThanOrEqual(1000);
    const members = Array.from({ length: 1001 }, (_, i) => ({ discord_user_id: `u${i}` }));

    const r = await runRoute('POST', '/internal/discord/members-meta', {
      headers: DISCORD_HEADERS,
      body: { members },
    });

    expect(r.status).toBe(200);
    // Exactly the first 1000 process; the 1001st is sliced off by the cap.
    expect(r.body).toEqual({
      success: true,
      data: { updated: 1000, changed: 1000, skipped: 0, unapplied: [] },
      error: null,
    });
    // The cap holds and the whole push is still ONE database call, which is the
    // property the phase bought: 1000 members used to be 1000 serial UPDATEs.
    expect(vi.mocked(setDiscordMemberMetaBulk)).toHaveBeenCalledTimes(1);
    const records = pushedRecords();
    expect(records).toHaveLength(1000);
    expect(records[0].discordUserId).toBe('u0');
    expect(records[999].discordUserId).toBe('u999');
  });

  it('issues the same single database call for one member as for a thousand', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 1,
      skipped: 0,
      unapplied: [],
    });

    await runRoute('POST', '/internal/discord/members-meta', {
      headers: DISCORD_HEADERS,
      body: { members: [{ discord_user_id: 'u1' }] },
    });
    expect(vi.mocked(setDiscordMemberMetaBulk)).toHaveBeenCalledTimes(1);

    await runRoute('POST', '/internal/discord/members-meta', {
      headers: DISCORD_HEADERS,
      body: {
        members: Array.from({ length: 1000 }, (_, i) => ({ discord_user_id: `u${i}` })),
      },
    });
    // Two requests, two calls: the member count did not add any.
    expect(vi.mocked(setDiscordMemberMetaBulk)).toHaveBeenCalledTimes(2);
  });

  it('turns a request of unusable entries into an empty record list, not a write', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 0,
      skipped: 0,
      unapplied: [],
    });

    const r = await runRoute('POST', '/internal/discord/members-meta', {
      headers: DISCORD_HEADERS,
      body: { members: [{ name: 'no id' }, 'not an object', 42] },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { updated: 0, changed: 0, skipped: 0, unapplied: [] },
      error: null,
    });
    // Not one of the three entries survived validation, so nothing reaches the
    // database even though the upsert is still called: it owns the empty answer
    // and short-circuits before any SQL (pinned as zero statements in
    // tests/discord_db.test.ts, which is the layer that can count statements).
    expect(pushedRecords()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11b. members-meta reports what it APPLIED, not what it read (ledger item L14).
//
// The old handler counted `updated++` once per record it iterated, so a push for
// a Discord member with no discord_links row (every unlinked guild member) was
// answered as accepted. The bot cached it as pushed and never re-sent it, so the
// member's join date and staff flair never reached the game after they linked.
//
// The fix names the three outcomes separately. `updated` deliberately KEEPS its
// old meaning (records accepted for application) because the bot's client turns
// `updated === 0` on a non-empty push into a hard refusal that aborts the whole
// sweep; the new `changed` / `skipped` / `unapplied` fields carry the truth, and
// Phase 6 rewires the bot onto `unapplied`.
// ---------------------------------------------------------------------------

describe('discord/members-meta applied-vs-read reporting', () => {
  const THREE_MEMBERS = [
    { discord_user_id: 'changed1', name: 'New Name' },
    { discord_user_id: 'identical1', name: 'Same Name' },
    { discord_user_id: 'nolink1', name: 'Never Linked' },
  ];

  async function push(members: unknown[]) {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    return runRoute('POST', '/internal/discord/members-meta', {
      headers: DISCORD_HEADERS,
      body: { members },
    });
  }

  it('names an id with no link row as unapplied and never counts it as changed', async () => {
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 1,
      skipped: 1,
      unapplied: ['nolink1'],
    });

    const r = await push(THREE_MEMBERS);

    expect(r.status).toBe(200);
    // Built as a fresh literal, not spread from the mock's own return value.
    expect(r.body).toEqual({
      success: true,
      data: { updated: 3, changed: 1, skipped: 1, unapplied: ['nolink1'] },
      error: null,
    });
    // The whole point of L14: the id is NAMED, so the pusher can leave exactly
    // that record dirty instead of caching a write that reached no row.
    const data = (r.body as { data: { changed: number; unapplied: string[] } }).data;
    expect(data.unapplied).toEqual(['nolink1']);
    expect(data.changed).toBe(1);
  });

  it('relays a zero-changed non-zero-skipped upsert report without rewriting it', async () => {
    // The post-restart case: the bot's diff cache is empty so it re-sends the
    // whole roster, and nothing moved while it was down.
    //
    // TITLE SCOPE: setDiscordMemberMetaBulk is mocked here, so this layer cannot
    // and does not DECIDE that nothing moved; it pins that the handler relays the
    // upsert's own classification untouched and computes `updated` independently
    // of it (2 accepted against 0 changed). The real classification, where a
    // genuinely identical re-push produces those numbers, is executed against
    // Postgres in tests/discord_db_integration.test.ts.
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 0,
      skipped: 2,
      unapplied: [],
    });

    const r = await push([
      { discord_user_id: 'identical1', name: 'Same Name' },
      { discord_user_id: 'identical2', name: 'Also Same' },
    ]);

    expect(r.body).toEqual({
      success: true,
      data: { updated: 2, changed: 0, skipped: 2, unapplied: [] },
      error: null,
    });
  });

  it('relays changed and skipped untouched while deriving updated itself', async () => {
    // Same title scope as above: the 2/1 split is the mocked upsert's answer, and
    // what this pins is that the handler passes it through unaltered while
    // `updated` (3) comes from the accepted-record count, not from `changed`.
    // Narrowing `updated` to applied.changed is the exact L14 regression, and the
    // three differing numbers below are what make it fail here.
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 2,
      skipped: 1,
      unapplied: [],
    });

    const r = await push([
      { discord_user_id: 'changed1', name: 'A' },
      { discord_user_id: 'changed2', name: 'B' },
      { discord_user_id: 'identical1', name: 'Same' },
    ]);

    expect(r.body).toEqual({
      success: true,
      data: { updated: 3, changed: 2, skipped: 1, unapplied: [] },
      error: null,
    });
  });

  it('accounts for every accepted record exactly once across the three outcomes', async () => {
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 1,
      skipped: 1,
      unapplied: ['nolink1'],
    });

    const r = await push(THREE_MEMBERS);
    const data = (
      r.body as {
        data: { updated: number; changed: number; skipped: number; unapplied: string[] };
      }
    ).data;

    // updated === changed + skipped + unapplied.length is the invariant that says
    // no record was double-counted and none went missing between the classes.
    expect(data.changed + data.skipped + data.unapplied.length).toBe(data.updated);
  });

  it('never answers a non-empty push with updated 0, which the bot reads as a refusal', async () => {
    // REGRESSION PIN, the load-bearing one. bot/server_client.ts pushMembersMeta
    // turns `updated === 0` on a non-empty push into null, and
    // bot/member_writes.ts pushChangedMemberMeta ABORTS the whole run on a
    // refusal, skipping every later batch. Both cases below are ordinary (a
    // post-restart full re-push; a batch of guild members who never linked), so
    // narrowing `updated` to rows-actually-written would make the bot stop
    // pushing, re-send the same roster every sweep, and never populate its cache.
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 0,
      skipped: 0,
      unapplied: ['nolink1', 'nolink2'],
    });
    const allUnlinked = await push([
      { discord_user_id: 'nolink1' },
      { discord_user_id: 'nolink2' },
    ]);
    expect((allUnlinked.body as { data: { updated: number } }).data.updated).toBe(2);

    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 0,
      skipped: 2,
      unapplied: [],
    });
    const nothingMoved = await push([
      { discord_user_id: 'identical1' },
      { discord_user_id: 'identical2' },
    ]);
    expect((nothingMoved.body as { data: { updated: number } }).data.updated).toBe(2);

    // And the one case that legitimately SHOULD answer 0 still does, so the bot's
    // guard keeps the meaning it was added with: a body carrying no usable member
    // at all. (This arm is an empty list, not the over-64-KiB body readBody
    // rejects into {}; both reach parseMemberMetaRecords with nothing to accept
    // and are the same code path from here on, but only the empty list is what is
    // exercised below, so the comment says so rather than claiming the other.)
    const emptyPush = await push([]);
    expect((emptyPush.body as { data: { updated: number } }).data.updated).toBe(0);
    const allJunk = await push([null, 42, { name: 'no id' }]);
    expect((allJunk.body as { data: { updated: number } }).data.updated).toBe(0);
  });

  it('counts a repeated discord_user_id once, so updated matches what was applied', async () => {
    // parseMemberMetaRecords collapses repeats keeping the LAST occurrence, and
    // `updated` is read off the POST-dedupe array, so the de-duplication is
    // OBSERVABLE at the route and had no test at any layer. It is also the one
    // documented behavior change L14 made to `updated` (the old loop incremented
    // once per entry, so a doubled id counted twice while only one row was ever
    // written). Three entries, two of them the same id: the push must report two
    // records and hand the upsert two, carrying the LAST values for the repeat.
    // changed is 1, NOT 2, on purpose: with the mock echoing 2 the `updated` line
    // below would pass whether `updated` came from the post-dedupe record count or
    // from applied.changed, which is the exact L14 regression. Three distinct
    // numbers (3 sent, 2 accepted, 1 changed) make it discriminate.
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 1,
      skipped: 1,
      unapplied: [],
    });

    const r = await push([
      { discord_user_id: 'dup', name: 'first', role: 'mods' },
      { discord_user_id: 'other', name: 'other' },
      { discord_user_id: 'dup', name: 'last' },
    ]);

    expect((r.body as { data: { updated: number } }).data.updated).toBe(2);
    const records = vi.mocked(setDiscordMemberMetaBulk).mock.calls[0][1];
    // Pinned by VALUE, not by length: last-wins is what makes the stored row match
    // what the old sequential loop left behind, and a first-wins collapse would
    // keep the same count while storing the wrong name and a stale role.
    expect(records).toEqual([
      { discordUserId: 'dup', nickname: 'last', joinedAtMs: null, roleKey: null },
      { discordUserId: 'other', nickname: 'other', joinedAtMs: null, roleKey: null },
    ]);
  });

  it('answers identically on the frozen legacy ladder arm and the RouteDef arm', async () => {
    // members-meta is a MIGRATED route, so a behavior edit must land on both arms
    // (the dual-edit rule). They share applyMemberMetaPush, and this is what says
    // so from the outside: an edit that reaches only one arm fails here.
    vi.mocked(setDiscordMemberMetaBulk).mockResolvedValue({
      changed: 1,
      skipped: 1,
      unapplied: ['nolink1'],
    });

    const viaRouteDef = await push(THREE_MEMBERS);
    expect(viaRouteDef.status).toBe(200);

    const req = makeReq({
      method: 'POST',
      url: '/internal/discord/members-meta',
      headers: DISCORD_HEADERS,
      body: { members: THREE_MEMBERS },
    });
    const res = new FakeRes();
    await handleInternalApi(req, res as unknown as http.ServerResponse, null as never);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(viaRouteDef.body);
    // Non-vacuous: both arms really ran the upsert, and with the same records.
    const calls = vi.mocked(setDiscordMemberMetaBulk).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(calls[0][1]);
  });
});

// ---------------------------------------------------------------------------
// 11c. discord/flex-batch (RouteDef-only): one batched read for many ids.
// ---------------------------------------------------------------------------

describe('discord/flex-batch', () => {
  /** A batch entry, built fresh per call so no assertion compares an object to itself. */
  function batchEntry(discordUserId: string): DiscordFlexBatchEntry {
    return {
      discord_user_id: discordUserId,
      linked: true,
      found: true,
      username: 'coolguy',
      statusTier: 3,
      points: 500,
      character: { name: 'Hero', class: 'Warrior', level: 40, profileUrl: 'https://x/p' },
    };
  }

  /** The id list the handler passed to the batched read on its last call. */
  function requestedIds(): string[] {
    const calls = vi.mocked(discordFlexForAccounts).mock.calls;
    return calls[calls.length - 1][0] as string[];
  }

  it('answers the whole batch with ONE read and echoes each linked payload', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(discordFlexForAccounts).mockResolvedValue([batchEntry('u1'), batchEntry('u2')]);

    const r = await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: ['u1', 'u2'] },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { requested: 2, members: [batchEntry('u1'), batchEntry('u2')] },
      error: null,
    });
    expect(vi.mocked(discordFlexForAccounts)).toHaveBeenCalledTimes(1);
    expect(requestedIds()).toEqual(['u1', 'u2']);
    // The per-id route must not be reached: the batch is the whole point.
    expect(vi.mocked(discordFlexForAccount)).not.toHaveBeenCalled();
  });

  it('yields no payload for an unlinked id rather than a fabricated one', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    // 'unlinked' has no discord_links row, so the batched read returns no row for
    // it. Absence IS the answer (the per-id route's { linked: false } equivalent).
    vi.mocked(discordFlexForAccounts).mockResolvedValue([batchEntry('linked')]);

    const r = await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: ['linked', 'unlinked'] },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      // requested 2 against members 1 is exactly how a caller learns the missing
      // id was unlinked rather than never asked about.
      data: { requested: 2, members: [batchEntry('linked')] },
      error: null,
    });
    // Both ids WERE asked about, so the absence is the database's answer and not
    // the handler quietly dropping one before the read.
    expect(requestedIds()).toEqual(['linked', 'unlinked']);
  });

  it('clamps the array, slices over-long ids, and drops non-strings like members-meta', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(discordFlexForAccounts).mockResolvedValue([]);

    await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: ['d'.repeat(40), 42, null, { id: 'x' }, '', 'keep', 'keep'] },
    });

    // 32-char slice, non-strings and empties dropped, repeats collapsed. Same
    // rules as the members-meta member list, so the two cannot drift.
    expect(requestedIds()).toEqual(['d'.repeat(32), 'keep']);

    await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: Array.from({ length: 1001 }, (_, i) => `u${i}`) },
    });

    // The array cap is applied BEFORE per-entry validation, exactly like
    // members-meta: the first 1000 survive and the 1001st is sliced off.
    const capped = requestedIds();
    expect(capped).toHaveLength(1000);
    expect(capped[0]).toBe('u0');
    expect(capped[999]).toBe('u999');
    expect(capped).not.toContain('u1000');
  });

  it('counts requested AFTER de-duplication, which is the contract Phase 6 compares against', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(discordFlexForAccounts).mockResolvedValue([batchEntry('u1')]);

    // Four entries, two of them the same id. `requested` is 3, not 4: it counts
    // what survived validation, and de-duplication runs before the count. A caller
    // comparing it against its RAW array length would read this healthy response as
    // a truncated one, which is the opposite of what the field exists to signal, so
    // the rule is pinned here rather than left in a comment for Phase 6 to rediscover.
    const r = await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: ['u1', 'u2', 'u1', 'u3'] },
    });

    expect(r.body).toEqual({
      success: true,
      data: { requested: 3, members: [batchEntry('u1')] },
      error: null,
    });
    expect(requestedIds()).toEqual(['u1', 'u2', 'u3']);
  });

  it('reads nothing and answers an empty batch when the body carries no id list', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(discordFlexForAccounts).mockResolvedValue([]);

    const r = await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: 'not-an-array' },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      // requested 0 is the signal that separates a DROPPED request from a real
      // empty answer. readBody turns an over-64-KiB or malformed body into {},
      // which lands here, so without the echo this response is byte-identical to
      // "all of your ids are unlinked" and a caller that strips flair for missing
      // ids would mass-clear on a truncated push.
      data: { requested: 0, members: [] },
      error: null,
    });
    expect(requestedIds()).toEqual([]);
  });

  it('reports how many ids it accepted, so a caller can detect a dropped request', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(discordFlexForAccounts).mockResolvedValue([batchEntry('u1')]);

    // Three ids sent, three accepted, one linked. A caller comparing `requested`
    // against what it sent sees 3 === 3 and trusts the two absences.
    const honest = await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: ['u1', 'u2', 'u3'] },
    });
    expect((honest.body as { data: { requested: number } }).data.requested).toBe(3);

    // Same caller, body lost on the way in. requested 0 against 3 sent is the
    // mismatch that tells it not to act on the absences.
    vi.mocked(discordFlexForAccounts).mockResolvedValue([]);
    const dropped = await runRoute('POST', '/internal/discord/flex-batch', {
      headers: DISCORD_HEADERS,
      body: {},
    });
    expect((dropped.body as { data: { requested: number } }).data.requested).toBe(0);
    expect((dropped.body as { data: { members: unknown[] } }).data.members).toEqual([]);
  });

  it('is gated: a wrong secret is a 401 that never reaches the handler', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    const r = await runRoute('POST', '/internal/discord/flex-batch', {
      headers: { 'x-woc-discord-secret': 'wrong' },
      body: { discord_user_ids: ['u1'] },
    });

    expect(r.status).toBe(401);
    expect(r.reached).toBe(false);
    expect(vi.mocked(discordFlexForAccounts)).not.toHaveBeenCalled();
  });

  it('has NO arm on the frozen legacy ladder (RouteDef-only by design)', async () => {
    // D9: a route born after the pipeline migration never gets a legacy twin, so
    // the legacy dispatcher must fall through to its terminal 404. If someone
    // later adds a legacy arm, this fails and the dual-edit obligation is caught.
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    const req = makeReq({
      method: 'POST',
      url: '/internal/discord/flex-batch',
      headers: DISCORD_HEADERS,
      body: { discord_user_ids: ['u1'] },
    });
    const res = new FakeRes();
    await handleInternalApi(req, res as unknown as http.ServerResponse, null as never);

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      data: null,
      error: 'unknown endpoint',
    });
    expect(vi.mocked(discordFlexForAccounts)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// discord/outbox (the consolidated poll: three drains + the winner days, with
// ONE batched identity read for every account any of them mentions).
// ---------------------------------------------------------------------------

describe('discord/outbox', () => {
  const NO_WINNERS = { days: [] };

  /** Arm the three drains; each is destructive in production, so this is per test. */
  function stubDrains(relay: QueuedRelay[] = [], activity: QueuedActivity[] = []): void {
    vi.mocked(drainRelay).mockReturnValue(relay);
    vi.mocked(drainActivity).mockReturnValue(activity);
  }

  /** The account-id array the handler passed to the batched identity read. */
  function requestedAccountIds(): number[] {
    const calls = vi.mocked(discordLinksForAccounts).mock.calls;
    return [...(calls[calls.length - 1][1] as readonly number[])];
  }

  function dataOf(body: unknown): Record<string, unknown> {
    return (body as { data: Record<string, unknown> }).data;
  }

  it('resolves a mixed drain with ONE identity read over the deduplicated account union', async () => {
    // THE headline property. Relay, activity and link-change items all mention
    // accounts, some of them the SAME account, and the old per-endpoint routes
    // would have spent one discordForAccount per item (per participant, for
    // activity). Here it is one call for the whole drain, and never the per-item
    // read (invariant D1).
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains(
      [relayItem(1, 'a'), relayItem(2, 'b'), relayItem(1, 'c')],
      [
        { ...activityItem(3, 'Cara'), accountIds: [3, 4], names: ['Cara', 'Dan'] },
        activityItem(1, 'Ann'),
      ],
    );
    enqueueLinkChange({ accountId: 4, kinds: ['flex'] }, 1000);
    enqueueLinkChange({ accountId: 5, kinds: ['points'] }, 1000);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockResolvedValue([1, 2, 3, 4, 5].map(linkRow));

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(r.status).toBe(200);
    expect(vi.mocked(discordLinksForAccounts)).toHaveBeenCalledTimes(1);
    // Exactly the union, each account once: 1 rides three relay items and an
    // activity item, 4 rides both an activity item and a link change.
    expect([...requestedAccountIds()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    // The N+1 the batched read replaces must not survive anywhere on this path.
    expect(vi.mocked(discordForAccount)).not.toHaveBeenCalled();
  });

  it('reads nothing at all when every stream drained empty', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(r.status).toBe(200);
    // No account was mentioned, so there is nothing to ask the database about.
    expect(vi.mocked(discordLinksForAccounts)).not.toHaveBeenCalled();
    expect(vi.mocked(discordForAccount)).not.toHaveBeenCalled();
    // The winner days ride the service's TTL cache, so an idle poll costs at
    // most one read there and zero on a warm cache. ONE day, not the clamp's
    // ceiling of five: the bot announces and marks one day per poll, and every
    // day carries its winners' usernames and wallet pubkeys, so the routine ask
    // is minimized to what the caller actually consumes.
    expect(vi.mocked(dailyRewardService.discordWinnerAnnouncements)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dailyRewardService.discordWinnerAnnouncements)).toHaveBeenCalledWith(1);
    expect(dataOf(r.body)).toEqual({
      relay: { items: [] },
      activity: { items: [] },
      winners: NO_WINNERS,
      linkChanges: { items: [] },
    });
  });

  it('drains destructively: a second poll finds every stream empty', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    // The relay/activity queues are mocked here, so the REAL destructive drain
    // under test is the link-change feed's (the module is not mocked).
    stubDrains();
    enqueueLinkChange({ accountId: 1, kinds: ['link'], discordId: 'du1' }, 1000);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockResolvedValue([linkRow(1)]);

    const first = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });
    expect((dataOf(first.body).linkChanges as { items: unknown[] }).items).toHaveLength(1);

    const second = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });
    expect(dataOf(second.body)).toEqual({
      relay: { items: [] },
      activity: { items: [] },
      winners: NO_WINNERS,
      linkChanges: { items: [] },
    });
  });

  it('requeues every drained stream when the response build throws, and answers 500', async () => {
    // THE durability property. The three queues are the bot's ONLY copy of these
    // items, so a poll that fails after draining must put them back: the bot gets
    // a 500, retries, and loses nothing. Without the requeue, one transient
    // failure of the identity read silently deletes a whole drain.
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const relayItems = [relayItem(1, 'a')];
    const activityItems = [activityItem(2, 'Bea')];
    stubDrains(relayItems, activityItems);
    enqueueLinkChange({ accountId: 3, kinds: ['link'], discordId: 'du3' }, 1000);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockRejectedValueOnce(new Error('identity read failed'));

    const failed = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ success: false, data: null, error: 'internal.error' });
    // Relay and activity are mocked here, so what is provable of them is that the
    // handler handed the exact drained items back, by value. FRESH expectation
    // literals, never the arrays handed to the drain mocks: those are the same
    // live objects the handler holds, so an in-place mutation before the requeue
    // would move both sides of the comparison together.
    expect(vi.mocked(requeueRelay)).toHaveBeenCalledWith([relayItem(1, 'a')]);
    expect(vi.mocked(requeueActivity)).toHaveBeenCalledWith([activityItem(2, 'Bea')]);

    // The link-change feed is the REAL module, so its half is proved end to end:
    // the retry (drains empty, read restored) carries the item the failed poll
    // took, which can only happen if it really went back into the queue.
    stubDrains();
    vi.mocked(discordLinksForAccounts).mockResolvedValue([linkRow(3)]);
    const retried = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(retried.status).toBe(200);
    expect(dataOf(retried.body).linkChanges).toEqual({
      items: [
        {
          accountId: 3,
          kinds: ['link'],
          discordUserId: 'du3',
          discordUsername: 'un3',
          discordAvatar: 'av3',
        },
      ],
    });
  });

  it('reads the winner days BEFORE draining, so a winners failure costs no items', async () => {
    // Ordering as durability. The winners read is the most failure-prone await on
    // this path (a database read behind a TTL cache) and depends on nothing the
    // drains produce, so it runs first: a failure there refuses the poll without
    // having consumed a single queued item, and no requeue is even needed.
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains([relayItem(1, 'a')]);
    enqueueLinkChange({ accountId: 4, kinds: ['flex'] }, 1000);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockRejectedValueOnce(
      new Error('winner days unavailable'),
    );

    const failed = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(failed.status).toBe(500);
    // Nothing was drained at all, so nothing had to be given back.
    expect(vi.mocked(drainRelay)).not.toHaveBeenCalled();
    expect(vi.mocked(drainActivity)).not.toHaveBeenCalled();
    expect(vi.mocked(requeueRelay)).not.toHaveBeenCalled();
    expect(vi.mocked(requeueActivity)).not.toHaveBeenCalled();
    expect(vi.mocked(discordLinksForAccounts)).not.toHaveBeenCalled();

    // And the untouched link change is still there on the next poll.
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockResolvedValue([linkRow(4)]);
    const retried = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(
      (dataOf(retried.body).linkChanges as { items: { accountId: number }[] }).items.map(
        (it) => it.accountId,
      ),
    ).toEqual([4]);
  });

  it('carries the envelope fields in the documented order', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(Object.keys(dataOf(r.body))).toEqual(['relay', 'activity', 'winners', 'linkChanges']);
  });

  it('emits relay items byte-for-byte identical to the standalone relay GET', async () => {
    // Shape preservation is what lets Phase 6 reuse the bot-side handlers
    // unchanged (invariant D11), so it is proved by running ONE fixture through
    // both endpoints and comparing, not by re-typing the expected shape.
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const fixture = () => [relayItem(1, 'a'), relayItem(2, 'b')];
    const links = [linkRow(1)]; // account 2 is unlinked

    stubDrains(fixture());
    vi.mocked(discordForAccount).mockImplementation(async (_pool, accountId) =>
      accountId === 1 ? linkRow(1) : null,
    );
    const old = await runRoute('GET', '/internal/discord/relay', { headers: DISCORD_HEADERS });

    stubDrains(fixture());
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockResolvedValue(links);
    const outbox = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    const oldItems = (dataOf(old.body).items as unknown[]) ?? [];
    expect(oldItems).toHaveLength(2);
    expect(dataOf(outbox.body).relay).toEqual({ items: oldItems });
  });

  it('emits activity items byte-for-byte identical to the standalone activity GET', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const fixture = (): QueuedActivity[] => [
      { ...activityItem(1, 'Alice'), accountIds: [1, 2], names: ['Alice', 'Bob'] },
      activityItem(3, 'Carol'), // nobody linked: dropped by both endpoints
    ];
    const links = [linkRow(1)];

    stubDrains([], fixture());
    vi.mocked(discordForAccount).mockImplementation(async (_pool, accountId) =>
      accountId === 1 ? linkRow(1) : null,
    );
    const old = await runRoute('GET', '/internal/discord/activity', { headers: DISCORD_HEADERS });

    stubDrains([], fixture());
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockResolvedValue(links);
    const outbox = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    const oldItems = (dataOf(old.body).items as unknown[]) ?? [];
    // Non-vacuous: the unlinked-only item was dropped and the linked one survived.
    expect(oldItems).toHaveLength(1);
    expect(dataOf(outbox.body).activity).toEqual({ items: oldItems });
  });

  it('passes the winner announcements through exactly as the winners GET returns them', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();
    const days = { days: [{ day: '2026-06-30', taskName: 'Complete quests', payouts: [] }] };
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(days);

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(dataOf(r.body).winners).toEqual(days);
  });

  it('enriches a link change from the map, and lets a carried id win over it', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();
    // Account 1 carries no id: the map row supplies it, and the row therefore
    // describes the very id being emitted, so its name and avatar ride along.
    enqueueLinkChange({ accountId: 1, kinds: ['flex', 'points'] }, 1000);
    // Account 2 carries one that DISAGREES with its stored row. The carried id
    // wins because an unlink's row is already deleted by drain time, so the
    // enqueue-time id is the only truth about which member to stop flairing.
    // The row's identity fields do NOT ride along, because they describe a
    // different Discord user (see the repoint case below).
    enqueueLinkChange({ accountId: 2, kinds: ['unlink'], discordId: 'carried-2' }, 1000);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockResolvedValue([linkRow(1), linkRow(2)]);

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(dataOf(r.body).linkChanges).toEqual({
      items: [
        {
          accountId: 1,
          kinds: ['flex', 'points'],
          discordUserId: 'du1',
          discordUsername: 'un1',
          discordAvatar: 'av1',
        },
        {
          accountId: 2,
          kinds: ['unlink'],
          discordUserId: 'carried-2',
          discordUsername: null,
          discordAvatar: null,
        },
      ],
    });
  });

  it('never dresses one Discord id in another user identity on a repoint', async () => {
    // The repoint shape, which is the case that makes the rule matter. An account
    // unlinks one Discord user and links another: the item carries the OLD id (the
    // member to stop flairing) while the stored row already holds the NEW one.
    // Decorating from the row would hand the bot the old user's id wearing the new
    // user's handle and avatar, which is a wrong claim about who someone is, not a
    // stale one. A missing decoration is the correct answer; the bot re-reads the
    // account anyway.
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();
    enqueueLinkChange({ accountId: 3, kinds: ['unlink'], discordId: 'old-user' }, 1000);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    // The row is the account's NEW identity, under a different Discord id.
    vi.mocked(discordLinksForAccounts).mockResolvedValue([
      { ...linkRow(3), discord_user_id: 'new-user' },
    ]);

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(dataOf(r.body).linkChanges).toEqual({
      items: [
        {
          accountId: 3,
          kinds: ['unlink'],
          discordUserId: 'old-user',
          discordUsername: null,
          discordAvatar: null,
        },
      ],
    });
  });

  it('drops a link change for an account with no Discord identity from either source', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();
    // The points feed fires for unlinked accounts too (a playtime grant reaches
    // every player), and the bot has nothing to push for them.
    enqueueLinkChange({ accountId: 7, kinds: ['points'] }, 1000);
    enqueueLinkChange({ accountId: 8, kinds: ['points'] }, 1000);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue(NO_WINNERS);
    vi.mocked(discordLinksForAccounts).mockResolvedValue([linkRow(8)]);

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    // Both were queued and both were asked about; only the linked one ships.
    expect([...requestedAccountIds()].sort((a, b) => a - b)).toEqual([7, 8]);
    expect(dataOf(r.body).linkChanges).toEqual({
      items: [
        {
          accountId: 8,
          kinds: ['points'],
          discordUserId: 'du8',
          discordUsername: 'un8',
          discordAvatar: 'av8',
        },
      ],
    });
  });

  it('is gated: an unset feature secret is the anti-enumeration 404', async () => {
    delete process.env.DISCORD_BOT_SECRET;
    stubDrains();

    const r = await runRoute('GET', '/internal/discord/outbox', { headers: DISCORD_HEADERS });

    expect(r.status).toBe(404);
    expect(r.reached).toBe(false);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown endpoint' });
    // A refused request must not drain anything: the queues are the bot's only
    // copy, so a gate that drained before refusing would lose the items.
    expect(vi.mocked(drainRelay)).not.toHaveBeenCalled();
  });

  it('is gated: a wrong secret is a 401 that never reaches the handler', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();

    const r = await runRoute('GET', '/internal/discord/outbox', {
      headers: { 'x-woc-discord-secret': 'wrong' },
    });

    expect(r.status).toBe(401);
    expect(r.reached).toBe(false);
    expect(r.body).toEqual({ success: false, data: null, error: 'not authenticated' });
    expect(vi.mocked(discordLinksForAccounts)).not.toHaveBeenCalled();
    expect(vi.mocked(drainRelay)).not.toHaveBeenCalled();
  });

  it('has NO arm on the frozen legacy ladder (RouteDef-only by design)', async () => {
    // D9, same as flex-batch: a route born after the pipeline migration never
    // gets a legacy twin, so the legacy dispatcher falls through to its 404.
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    stubDrains();

    const req = makeReq({
      method: 'GET',
      url: '/internal/discord/outbox',
      headers: DISCORD_HEADERS,
    });
    const res = new FakeRes();
    await handleInternalApi(req, res as unknown as http.ServerResponse, null as never);

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      data: null,
      error: 'unknown endpoint',
    });
    expect(vi.mocked(discordLinksForAccounts)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// discord/flaired-ids (the stored-flair id list the bot diffs against the live
// roster to clear members who left while it was offline).
// ---------------------------------------------------------------------------

describe('discord/flaired-ids', () => {
  it('returns the flagged id list in the { success, data, error } envelope', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(discordIdsWithGuildFlair).mockResolvedValue(['u1', 'u2']);

    const r = await runRoute('GET', '/internal/discord/flaired-ids', {
      headers: DISCORD_HEADERS,
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ids: ['u1', 'u2'] }, error: null });
    expect(vi.mocked(discordIdsWithGuildFlair)).toHaveBeenCalledWith(pool);
  });

  it('is gated: a wrong secret is a 401 that never reaches the handler', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;

    const r = await runRoute('GET', '/internal/discord/flaired-ids', {
      headers: { 'x-woc-discord-secret': 'wrong' },
    });

    expect(r.status).toBe(401);
    expect(r.reached).toBe(false);
    expect(vi.mocked(discordIdsWithGuildFlair)).not.toHaveBeenCalled();
  });

  it('the legacy ladder arm answers with the same body as the RouteDef arm', async () => {
    // flaired-ids landed AFTER the migration, so it lives on both dispatch arms
    // per the dual-edit rule. The db-touching internal routes are excluded from
    // the parity corpus replay, so pin the twin bodies against each other here:
    // a behavior edit that reaches only one arm fails this test.
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    vi.mocked(discordIdsWithGuildFlair).mockResolvedValue(['u1', 'u2']);

    const viaRouteDef = await runRoute('GET', '/internal/discord/flaired-ids', {
      headers: DISCORD_HEADERS,
    });
    expect(viaRouteDef.status).toBe(200);

    const req = makeReq({
      method: 'GET',
      url: '/internal/discord/flaired-ids',
      headers: DISCORD_HEADERS,
    });
    const res = new FakeRes();
    // The game runtime is only consumed by the restart-countdown arm.
    await handleInternalApi(req, res as unknown as http.ServerResponse, null as never);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(viaRouteDef.body);
  });
});

// ---------------------------------------------------------------------------
// 12. The internalBodyValidationRemap 500 (a handler/DB throw).
// ---------------------------------------------------------------------------

describe('internalBodyValidationRemap', () => {
  it('serializes a handler/DB throw as a bare 500 internal.error admin envelope', async () => {
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(accountForDiscord).mockRejectedValue(new Error('db exploded'));

    const r = await runRoute('GET', '/internal/discord/flex', {
      url: '/internal/discord/flex?discord_user_id=u1',
      headers: DISCORD_HEADERS,
    });

    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, data: null, error: 'internal.error' });
    expect(r.contentType).toBe('application/json');
    expect(r.headers['x-request-id']).toBeDefined();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 13. The gates ride the RouteDef middleware (one representative case per family).
// ---------------------------------------------------------------------------

describe('the secret gates ride the route middleware', () => {
  it('discord route 404s "unknown endpoint" when the feature secret is unset', async () => {
    // DISCORD_BOT_SECRET deleted in beforeEach: the gate hides the endpoint.
    const r = await runRoute('GET', '/internal/discord/flex', {
      url: '/internal/discord/flex?discord_user_id=u1',
      headers: DISCORD_HEADERS,
    });

    expect(r.reached).toBe(false);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown endpoint' });
    expect(vi.mocked(accountForDiscord)).not.toHaveBeenCalled();
  });

  it('restart-countdown 401s "not authenticated" on a mismatched deploy secret', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = DEPLOY_SECRET;
    configureInternalRuntime({
      startRestartCountdown: vi.fn(() => ({
        started: true,
        active: true,
        totalSeconds: 600,
        remainingSeconds: 600,
      })),
    } as unknown as InternalRuntime);

    const r = await runRoute('POST', '/internal/restart-countdown', {
      headers: { 'x-woc-deploy-secret': 'wrong' },
    });

    expect(r.reached).toBe(false);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'not authenticated' });
  });
});

// ---------------------------------------------------------------------------
// 14. The { success, data, error } envelope is frozen on every arm.
// ---------------------------------------------------------------------------

describe('the internal envelope is frozen', () => {
  it('a success, a guard 4xx, and a gate 404 all carry exactly { success, data, error }', async () => {
    const only = ['data', 'error', 'success'];

    // Success arm (restart-countdown started).
    process.env.RESTART_COUNTDOWN_SECRET = DEPLOY_SECRET;
    configureInternalRuntime({
      startRestartCountdown: vi.fn(() => ({
        started: true,
        active: true,
        totalSeconds: 600,
        remainingSeconds: 600,
      })),
    } as unknown as InternalRuntime);
    const success = await runRoute('POST', '/internal/restart-countdown', {
      headers: DEPLOY_HEADERS,
    });
    expect(success.status).toBe(200);
    expect(Object.keys(success.body as object).sort()).toEqual(only);

    // Guard 4xx arm (grant with a missing reason).
    process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
    const guard = await runRoute('POST', '/internal/discord/grant', {
      headers: DISCORD_HEADERS,
      body: { discord_user_id: 'u1', points: 5 },
    });
    expect(guard.status).toBe(400);
    expect(Object.keys(guard.body as object).sort()).toEqual(only);

    // Gate 404 arm (deploy secret unset).
    delete process.env.RESTART_COUNTDOWN_SECRET;
    const gate = await runRoute('POST', '/internal/restart-countdown', { headers: DEPLOY_HEADERS });
    expect(gate.status).toBe(404);
    expect(Object.keys(gate.body as object).sort()).toEqual(only);
  });
});

// The size of what GET /internal/discord/outbox can hand back in one response,
// measured rather than argued.
//
// Consolidating four bot polls into one means one response now carries what four
// used to, and every stream feeding it is bounded for exactly that reason. This
// file drives the endpoint at the worst case those bounds admit (relay 50,
// activity 100, link changes OUTBOX_LINK_CHANGE_PAGE, one reward day with a full
// ten-payout table) and asserts the serialized payload stays under a stated byte
// bound. A page or cap raised without checking what it does to the response size
// fails here. Note the link-change bound is the PAGE, not the feed's cap: what a
// backlog past the page costs is another poll, not a bigger response, which is
// the paging case below.
//
// It lives beside tests/server/internal.test.ts rather than inside it because the
// fixtures are bulky and the question is different: that file pins the endpoint's
// BEHAVIOR (one identity read, the item shapes, the gates), this one pins its
// SIZE and the overflow rule of the feed that ships with it.
//
// Same rig as internal.test.ts: hoisted module mocks, then the real route chain
// (compose + withErrors + the real gate middleware) over a fakeCtx. The
// link-change feed module is deliberately NOT mocked, so its real cap and its
// real drain are what run.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5433/wocc_outbox_payload';
});

vi.mock('../../server/db', () => ({ pool: { __fake: 'outbox-pool' } }));
vi.mock('../../server/discord_db', () => ({
  accountForDiscord: vi.fn(),
  discordForAccount: vi.fn(),
  discordForAccounts: vi.fn(async () => new Map()),
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
// Partial mocks: the drains are fixtures, but the CAP constants must be the real
// module's values or the worst-case payload fixture drifts from production.
vi.mock('../../server/discord_activity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/discord_activity')>()),
  drainActivity: vi.fn(),
  requeueActivity: vi.fn(),
}));
vi.mock('../../server/discord_relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/discord_relay')>()),
  drainRelay: vi.fn(),
  requeueRelay: vi.fn(),
}));
vi.mock('../../server/daily_rewards', () => ({
  dailyRewardService: {
    discordWinnerAnnouncements: vi.fn(),
    markDiscordWinnersAnnounced: vi.fn(),
  },
}));

import type * as http from 'node:http';
import { dailyRewardService } from '../../server/daily_rewards';
import type { QueuedActivity } from '../../server/discord_activity';
import { ACTIVITY_MAX_QUEUE, drainActivity } from '../../server/discord_activity';
import type { DiscordOutboxLinkRow } from '../../server/discord_db';
import { discordLinksForAccounts } from '../../server/discord_db';
import {
  drainLinkChanges,
  enqueueLinkChange,
  LINK_CHANGE_MAX_QUEUE,
} from '../../server/discord_link_changes';
import type { QueuedRelay } from '../../server/discord_relay';
import { drainRelay, RELAY_MAX_QUEUE } from '../../server/discord_relay';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { OUTBOX_LINK_CHANGE_PAGE, routes } from '../../server/internal';
import { type FakeRes, fakeCtx } from './helpers';

const DISCORD_SECRET = 'discord-secret';
const DISCORD_HEADERS = { 'x-woc-discord-secret': DISCORD_SECRET };
const OUTBOX_PATH = '/internal/discord/outbox';

// The caps the three feeds enforce, all imported from the owning modules so the
// worst-case fixture tracks the REAL caps rather than a mirror that goes stale
// the day a cap moves (Phase 5 QA: the mirrors were restated literals). The
// payload-bound literals below stay literals on purpose: they are the measured
// contract, not a derivation.
const RELAY_CAP = RELAY_MAX_QUEUE;
const ACTIVITY_CAP = ACTIVITY_MAX_QUEUE;

/**
 * The bound on the serialized `data` payload, in bytes. The worst-case fixture
 * below measured 290,671 bytes (0.3 ms of JSON.stringify; 279,891 before the
 * activity fixture moved to the wider deed item shape) when the drain moved to
 * a 1000-item link-change page and a one-day winners ask; the bound is roughly
 * 1.5x that, rounded to a clean number, so ordinary drift in the fixtures does
 * not red it while a page raise or a new per-item field does. The test logs its
 * own measurement, so re-deriving the headroom never means guessing at the size.
 *
 * The earlier figure was 979,051 bytes, at a whole-cap 5,000-item drain and five
 * winner days: the page and the minimized winners ask are what moved it.
 */
const PAYLOAD_BOUND_BYTES = 420_000;

/**
 * The floor the same measurement has to clear. It sits just under the measured
 * size rather than far below it: a fixture that quietly stopped producing
 * realistic items would slip under any ceiling at all, and a floor with 3x of
 * slack would not notice.
 */
const PAYLOAD_FLOOR_BYTES = 270_000;

/** Drive the outbox route's real chain (its gate middleware + handler). */
async function runOutbox(headers: Record<string, string> = DISCORD_HEADERS) {
  const route = routes.find((r) => r.method === ('GET' as Method) && r.path === OUTBOX_PATH);
  if (!route) throw new Error(`no route GET ${OUTBOX_PATH}`);
  const ctx = fakeCtx({ method: 'GET', url: OUTBOX_PATH, headers });
  const terminal: Middleware = async (c) => {
    await route.handler(c);
  };
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  const fake = ctx.res as unknown as http.ServerResponse as unknown as FakeRes;
  return { status: fake.statusCode, raw: fake.body, body: JSON.parse(fake.body) };
}

/** A Discord snowflake-shaped id, an avatar hash and a handle, at real widths. */
function linkRow(accountId: number): DiscordOutboxLinkRow {
  return {
    account_id: accountId,
    discord_user_id: String(300_000_000_000_000_000n + BigInt(accountId)),
    discord_username: `guildmember_${accountId}`,
    discord_avatar: `a1b2c3d4e5f6${String(accountId).padStart(20, '0')}`,
  };
}

/** A relay post carrying a long-but-legal free-text message. */
function relayItem(accountId: number): QueuedRelay {
  return {
    commandId: 'lfg',
    tag: 'LFG',
    label: 'Looking for Group',
    color: 3_447_003,
    accountId,
    characterName: `Adventurer${accountId}`,
    level: 40,
    className: 'Hunter',
    realm: 'Claudemoon',
    zone: 'Blackrock Deeps, the Detention Block',
    message: `Need two more for a full clear, summons up at the meeting stone, whisper me. ${'x'.repeat(120)}`,
    profileUrl: `https://worldofclaudecraft.com/c/claudemoon/adventurer${accountId}`,
  };
}

/** An activity card with a realistic party-sized participant list, in the
 *  WIDEST per-item shape the queue admits: the deed kind carries deedId,
 *  deedName, deedTitle AND itemName (the first-koi catch name), which
 *  serializes larger than the rareloot shape this fixture used before the
 *  deed kind existed. The worst case must track the widest real shape. */
function activityItem(index: number, accountIds: number[]): QueuedActivity {
  return {
    kind: 'deed',
    accountIds,
    names: accountIds.map((id) => `Adventurer${id}`),
    realm: 'Claudemoon',
    profileUrl: `https://worldofclaudecraft.com/c/claudemoon/adventurer${accountIds[0]}`,
    itemName: `Moonlit Koi of the Verdant Vale ${index}`,
    deedId: `chr_willowfen_first_cast_${index}`,
    deedName: `First Cast of the Willowfen Reaches ${index}`,
    deedTitle: 'Angler of the Willowfen',
  };
}

/** One finalized reward day with the full ten-rank payout table. */
function winnerDay(dayIndex: number): unknown {
  return {
    day: `2026-06-${String(20 + dayIndex).padStart(2, '0')}`,
    realm: 'Claudemoon',
    prizePoolUsd: 150,
    finalizedAt: '2026-06-30T22:00:00.000Z',
    taskName: 'Complete quests today. Points increase with time spent online.',
    nextTaskName: 'Win an arena match.',
    payouts: Array.from({ length: 10 }, (_, rank) => ({
      day: `2026-06-${String(20 + dayIndex).padStart(2, '0')}`,
      realm: 'Claudemoon',
      rank: rank + 1,
      accountId: rank + 1,
      username: `Adventurer${rank + 1}`,
      walletPubkey: 'Wa11etPubKey1111111111111111111111111111111',
      points: 4200 - rank * 100,
      prizePercent: 0.2,
      prizeUsd: 30,
      status: 'paid',
      txSignature: '5'.repeat(88),
      paidAt: '2026-06-30T22:05:00.000Z',
      voidReason: null,
      voidedById: null,
      voidedByUsername: null,
      voidedAt: null,
      signedTransaction: null,
    })),
  };
}

const ORIGINAL_DISCORD_SECRET = process.env.DISCORD_BOT_SECRET;

beforeEach(() => {
  vi.resetAllMocks();
  drainLinkChanges();
  process.env.DISCORD_BOT_SECRET = DISCORD_SECRET;
});

afterEach(() => {
  if (ORIGINAL_DISCORD_SECRET === undefined) delete process.env.DISCORD_BOT_SECRET;
  else process.env.DISCORD_BOT_SECRET = ORIGINAL_DISCORD_SECRET;
  drainLinkChanges();
  vi.restoreAllMocks();
});

describe('discord/outbox payload size at the full-cap drain', () => {
  it('stays under the stated byte bound with every stream at its cap', async () => {
    // Relay and activity at their caps, with the activity items carrying real
    // party-sized participant lists rather than one account each.
    const relay = Array.from({ length: RELAY_CAP }, (_, i) => relayItem(i + 1));
    const activity = Array.from({ length: ACTIVITY_CAP }, (_, i) =>
      activityItem(i, [i * 5 + 1, i * 5 + 2, i * 5 + 3, i * 5 + 4, i * 5 + 5]),
    );
    vi.mocked(drainRelay).mockReturnValue(relay);
    vi.mocked(drainActivity).mockReturnValue(activity);

    // The link-change feed filled BEYOND its page, every account linked so NONE
    // are dropped: the drop path would understate the worst case. What one
    // response can carry is the PAGE, not the cap, so that is what this measures;
    // the rest stays queued and pages out on the next poll (pinned below).
    for (let i = 1; i <= LINK_CHANGE_MAX_QUEUE; i++) {
      enqueueLinkChange({ accountId: i, kinds: ['flex', 'points'] }, 1000);
    }

    // Every account any stream mentions resolves to a link row, so every item is
    // enriched to its full width.
    const mentioned = new Set<number>([
      ...relay.map((it) => it.accountId),
      ...activity.flatMap((it) => it.accountIds),
      ...Array.from({ length: LINK_CHANGE_MAX_QUEUE }, (_, i) => i + 1),
    ]);
    vi.mocked(discordLinksForAccounts).mockResolvedValue([...mentioned].map(linkRow));

    // ONE day, which is the ceiling of what the handler asks for now.
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue({
      days: [winnerDay(0)],
    });

    const r = await runOutbox();
    expect(r.status).toBe(200);

    const data = (r.body as { data: unknown }).data;
    // Timed as well as measured: serializing the worst case is work the event
    // loop does in one go, so the cost is reported beside the size. Logged only,
    // never asserted: a wall-clock threshold in a unit suite is a flake generator
    // on shared CI hardware.
    const startedAt = performance.now();
    const serialized = JSON.stringify(data);
    const stringifyMs = performance.now() - startedAt;
    const bytes = Buffer.byteLength(serialized, 'utf8');

    // Non-vacuous: the fixture really did reach every cap, so the number below
    // is the worst case and not an accidentally small drain.
    const payload = data as {
      relay: { items: unknown[] };
      activity: { items: unknown[] };
      winners: { days: unknown[] };
      linkChanges: { items: unknown[] };
    };
    expect(payload.relay.items).toHaveLength(RELAY_CAP);
    expect(payload.activity.items).toHaveLength(ACTIVITY_CAP);
    expect(payload.linkChanges.items).toHaveLength(OUTBOX_LINK_CHANGE_PAGE);
    expect(payload.winners.days).toHaveLength(1);

    // Reported so the bound can be re-derived without re-measuring by hand.
    console.info(
      `[outbox] full-cap payload: ${bytes} bytes in ${stringifyMs.toFixed(2)} ms of JSON.stringify (bound ${PAYLOAD_BOUND_BYTES})`,
    );
    expect(bytes).toBeLessThan(PAYLOAD_BOUND_BYTES);
    expect(bytes).toBeGreaterThan(PAYLOAD_FLOOR_BYTES);
  });

  it('pages a backlog out across polls, carrying the NEXT page and losing nothing', async () => {
    // The other half of the page: what one response leaves behind is still there,
    // in order, on the next poll. Two full pages are queued and both are drained,
    // so the assertion sees the whole backlog rather than only its head.
    vi.mocked(drainRelay).mockReturnValue([]);
    vi.mocked(drainActivity).mockReturnValue([]);
    const queued = OUTBOX_LINK_CHANGE_PAGE * 2;
    for (let i = 1; i <= queued; i++) {
      enqueueLinkChange({ accountId: i, kinds: ['flex'], discordId: `du${i}` }, 1000);
    }
    vi.mocked(discordLinksForAccounts).mockResolvedValue([]);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue({ days: [] });

    const first = await runOutbox();
    const second = await runOutbox();
    const third = await runOutbox();

    const idsOf = (r: { body: unknown }): number[] =>
      (
        r.body as { data: { linkChanges: { items: { accountId: number }[] } } }
      ).data.linkChanges.items.map((it) => it.accountId);
    // Contiguous, in FIFO order, no gap and no repeat between the two pages.
    expect(idsOf(first)).toEqual(Array.from({ length: OUTBOX_LINK_CHANGE_PAGE }, (_, i) => i + 1));
    expect(idsOf(second)).toEqual(
      Array.from({ length: OUTBOX_LINK_CHANGE_PAGE }, (_, i) => i + 1 + OUTBOX_LINK_CHANGE_PAGE),
    );
    expect(idsOf(third)).toEqual([]);
  });

  it('drops the OLDEST link change once the feed is at its cap', async () => {
    // The feed's overflow rule (bounded staleness, never unbounded growth),
    // proved through the endpoint that ships it. Every item carries a Discord id,
    // so none of them is the playtime-noise class the eviction prefers and the
    // fallback oldest-first rule is what runs (the preference itself is pinned in
    // tests/server/discord_link_changes.test.ts). Relay and activity overflow are
    // already pinned by their own suites and are not re-pinned here.
    vi.mocked(drainRelay).mockReturnValue([]);
    vi.mocked(drainActivity).mockReturnValue([]);
    for (let i = 1; i <= LINK_CHANGE_MAX_QUEUE + 3; i++) {
      enqueueLinkChange({ accountId: i, kinds: ['flex'], discordId: `du${i}` }, 1000 + i);
    }
    vi.mocked(discordLinksForAccounts).mockResolvedValue([]);
    vi.mocked(dailyRewardService.discordWinnerAnnouncements).mockResolvedValue({ days: [] });

    const r = await runOutbox();

    const items = (r.body as { data: { linkChanges: { items: { accountId: number }[] } } }).data
      .linkChanges.items;
    // The three oldest were evicted, so the first page starts at account 4: the
    // survivor set is asserted by VALUE, in FIFO order, not merely counted.
    expect(items.map((it) => it.accountId)).toEqual(
      Array.from({ length: OUTBOX_LINK_CHANGE_PAGE }, (_, i) => i + 4),
    );
  });
});

describe('outbox contract literals', () => {
  // The D1 no-N+1 pins (ONE identity read for a mixed drain, ZERO for an empty
  // one) live in tests/server/internal.test.ts describe('discord/outbox'), which
  // drives the real route stack; this file only ARMS discordLinksForAccounts as a
  // fixture. Recorded so nobody hunts for the guard here (Phase 5 QA, finding B1).
  it('pins the page and cap literals the fixtures above are built from', () => {
    expect(OUTBOX_LINK_CHANGE_PAGE).toBe(1000);
    expect(RELAY_MAX_QUEUE).toBe(50);
    expect(ACTIVITY_MAX_QUEUE).toBe(100);
  });
});

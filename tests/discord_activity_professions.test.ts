// Discord activity feed, professions moments (phase 15): the pure deed
// feed-worthiness gate (discordFeedDeed) and the two new detectActivity arms,
// masterwork procs and feed-worthy deed unlocks (titles + the first koi). The
// server rig mirrors tests/vale_cup_online.test.ts (GameServer over a mocked
// db) and drives detectActivity with synthetic events, the
// tests/game_sessions.test.ts precedent. Each test joins a DISTINCT account:
// the queue's dedupe keys are account-scoped and its recent-key map is
// module-global wall-clock state, so a shared account would collapse cards
// across tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => ({ listings: [], collections: new Map() })),
  saveMarketState: vi.fn(async () => {}),
  loadMailState: vi.fn(async () => ({})),
  saveMailState: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { FIRST_KOI_DEED_ID as BOT_FIRST_KOI_DEED_ID } from '../bot/logic';
import * as db from '../server/db';
import { discordFeedDeed, FIRST_KOI_DEED_ID } from '../server/deeds_records';
import { claimDedupeKey, drainActivity, releaseDedupeKey } from '../server/discord_activity';
import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: unknown[];
  ws: { readyState: number; send: (payload: string) => void };
}

function fakeWs(): FakeClient {
  const sent: unknown[] = [];
  return {
    sent,
    ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) },
  };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws as any, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

// The deed fan-out reads the broadcast opt-out (mocked pool.query) before it
// enqueues; setImmediate lands after every pending microtask in that chain.
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** The opt-out (accounts.deed_broadcasts) reads issued so far. */
function optOutReads(): number {
  return (db.pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes('deed_broadcasts'),
  ).length;
}

describe('discordFeedDeed: the feed-worthiness gate', () => {
  it('maps a title deed to its name and title text', () => {
    expect(discordFeedDeed('chr_vale_chapter_iii')).toEqual({
      deedName: 'Chronicle of the Vale',
      deedTitle: 'of the Vale',
    });
  });

  it('maps the first-koi deed to a catch payload (no title)', () => {
    expect(discordFeedDeed(FIRST_KOI_DEED_ID)).toEqual({
      deedName: 'Glimmer of Hope',
      itemName: 'Sunglint Koi',
    });
  });

  it('returns null for a real deed that is neither titled nor the koi', () => {
    expect(discordFeedDeed('col_junk_drawer')).toBeNull();
  });

  it('fails CLOSED on a hidden deed even when it rewards a title', () => {
    // hid_saul_footnote rewards the title "the Footnote"; without the
    // public-surface gate this would return a title payload.
    expect(discordFeedDeed('hid_saul_footnote')).toBeNull();
  });

  it('fails CLOSED on an unknown deed id', () => {
    expect(discordFeedDeed('deed_from_a_newer_build')).toBeNull();
  });

  it('names the SAME first-koi deed on both sides of the process boundary', () => {
    // The bot special-cases the catch-flavored card by this id; a drift here
    // degrades the first koi to a generic deed card (the ActivityKind class
    // of bug, caught at the constant instead of in production).
    expect(BOT_FIRST_KOI_DEED_ID).toBe(FIRST_KOI_DEED_ID);
  });
});

describe('detectActivity: professions arms (GameServer)', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
    vi.clearAllMocks();
    (db.pool.query as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ rows: [] }));
    drainActivity(); // the activity queue is module-global; start each test empty
  });

  it('masterwork proc enqueues one card behind the deed-broadcasts opt-out read', async () => {
    const session = joinServer(server, fakeWs(), 101, 'Smith');
    (server as any).detectActivity([
      {
        type: 'masterwork',
        recipeId: 'recipe_eastbrook_arming_sword',
        itemId: 'eastbrook_arming_sword',
        crafter: session.pid,
        pid: session.pid,
      },
    ]);
    // Masterwork procs repeat, so unlike levelup/rareloot the card waits on
    // the async consent read; nothing may enqueue synchronously.
    expect(drainActivity()).toHaveLength(0);
    await flushAsync();
    const cards = drainActivity();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: 'masterwork',
      accountIds: [101],
      names: ['Smith'],
      itemName: 'Eastbrook Arming Sword',
    });
  });

  it('a same-account masterwork burst collapses to one card (account dedupe)', async () => {
    const session = joinServer(server, fakeWs(), 102, 'Burst');
    const ev = (itemId: string) => ({
      type: 'masterwork',
      recipeId: 'recipe_eastbrook_arming_sword',
      itemId,
      crafter: session.pid,
      pid: session.pid,
    });
    (db.pool.query as ReturnType<typeof vi.fn>).mockClear();
    (server as any).detectActivity([ev('eastbrook_arming_sword')]);
    (server as any).detectActivity([ev('eastbrook_chain_vest')]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(1);
    // The dedupe key is claimed BEFORE the opt-out read: the second proc in
    // the burst must not fire a second accounts query for a card that the
    // TTL already spent (the fix-round P1).
    expect(optOutReads()).toBe(1);
  });

  it('a masterwork proc with no session (a bot crafter) enqueues nothing', async () => {
    (server as any).detectActivity([
      {
        type: 'masterwork',
        recipeId: 'recipe_eastbrook_arming_sword',
        itemId: 'eastbrook_arming_sword',
        crafter: 424242,
        pid: 424242,
      },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(0);
  });

  it('the deed-broadcasts opt-out suppresses the masterwork card too', async () => {
    const session = joinServer(server, fakeWs(), 108, 'Quiet');
    (db.pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) =>
      typeof sql === 'string' && sql.includes('deed_broadcasts')
        ? { rows: [{ deed_broadcasts: false }] }
        : { rows: [] },
    );
    (server as any).detectActivity([
      {
        type: 'masterwork',
        recipeId: 'recipe_eastbrook_arming_sword',
        itemId: 'eastbrook_arming_sword',
        crafter: session.pid,
        pid: session.pid,
      },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(0);
  });

  it('a FAILED opt-out read re-opens the key after the retry backoff (one blip, one loss)', async () => {
    // R60: the release is a compare-and-set RE-STAMP, not a delete. A blip
    // must not burn the account's whole TTL window, but the retry may only
    // land after the 2s backoff, or a sustained outage would flip the read
    // rate from one per TTL to one per proc against the failing pool.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const session = joinServer(server, fakeWs(), 112, 'Blipped');
      const ev = {
        type: 'masterwork',
        recipeId: 'recipe_eastbrook_arming_sword',
        itemId: 'eastbrook_arming_sword',
        crafter: session.pid,
        pid: session.pid,
      };
      // First proc: the opt-out read rejects (db blip). The card is lost
      // fail-closed, and the claimed key is re-stamped with the backoff.
      (db.pool.query as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        throw new Error('db blip');
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (server as any).detectActivity([ev]);
      await flushAsync();
      expect(drainActivity()).toHaveLength(0);
      // A proc INSIDE the backoff is still deduped: the blip costs one card,
      // never an immediate retry storm.
      vi.setSystemTime(Date.now() + 1_000);
      (server as any).detectActivity([ev]);
      await flushAsync();
      expect(drainActivity()).toHaveLength(0);
      // Past the backoff (2s) but still far inside the 30s TTL: the account
      // is NOT dark for the whole window.
      vi.setSystemTime(Date.now() + 1_500);
      (server as any).detectActivity([ev]);
      await flushAsync();
      expect(drainActivity()).toHaveLength(1);
      errSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a masterworkZone bystander copy never enqueues a card', async () => {
    // A real overworld craft emits BOTH the personal event and one zone copy
    // per player in zone; only the personal one may post, or every bystander
    // would card under their own account past the crafter-scoped dedupe.
    const session = joinServer(server, fakeWs(), 109, 'Bystander');
    (server as any).detectActivity([
      {
        type: 'masterworkZone',
        crafterPid: 424242,
        crafterName: 'SomeoneElse',
        recipeId: 'recipe_eastbrook_arming_sword',
        itemId: 'eastbrook_arming_sword',
        pid: session.pid,
      },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(0);
  });

  it('a title-deed unlock enqueues a deed card behind the opt-out read', async () => {
    const session = joinServer(server, fakeWs(), 103, 'Chronicler');
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: 'chr_vale_chapter_iii', pid: session.pid },
    ]);
    expect(drainActivity()).toHaveLength(0); // not before the async opt-out read
    await flushAsync();
    const cards = drainActivity();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: 'deed',
      accountIds: [103],
      names: ['Chronicler'],
      deedId: 'chr_vale_chapter_iii',
      deedName: 'Chronicle of the Vale',
      deedTitle: 'of the Vale',
    });
  });

  it('the first-koi unlock enqueues the catch-flavored deed card', async () => {
    const session = joinServer(server, fakeWs(), 104, 'Angler');
    // col_glimmerfin is feed-worthy but renown 0, NOT a marquee deed: the
    // shared fan-out must post the card WITHOUT broadcasting to guildmates
    // (an unconditional marquee would spam every follower with a renown-0
    // collection deed).
    const marqueeSpy = vi.spyOn((server as any).social, 'broadcastDeedUnlock');
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: FIRST_KOI_DEED_ID, pid: session.pid },
    ]);
    await flushAsync();
    const cards = drainActivity();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: 'deed',
      deedId: FIRST_KOI_DEED_ID,
      deedName: 'Glimmer of Hope',
      itemName: 'Sunglint Koi',
    });
    expect(cards[0].deedTitle).toBeUndefined();
    expect(marqueeSpy).not.toHaveBeenCalled();
  });

  it('a HIDDEN titled deed unlock enqueues nothing and reads nothing (server arm)', async () => {
    // The pure gate (discordFeedDeed) failing closed is pinned above; this
    // arm pins the CALLER: a hidden deed is neither marquee nor feed, so the
    // fan-out early-returns before the opt-out read and before any enqueue.
    const session = joinServer(server, fakeWs(), 113, 'Footnote');
    const marqueeSpy = vi.spyOn((server as any).social, 'broadcastDeedUnlock');
    (db.pool.query as ReturnType<typeof vi.fn>).mockClear();
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: 'hid_saul_footnote', pid: session.pid },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(0);
    expect(marqueeSpy).not.toHaveBeenCalled();
    expect(optOutReads()).toBe(0);
  });

  it('two feed-worthy deeds for ONE account inside the TTL both card', async () => {
    // The dedupe key is per (account, deed): a title deed and the first koi
    // landing together is a plausible pair, and an account-only key would
    // silently collapse them to one card.
    const session = joinServer(server, fakeWs(), 110, 'Prolific');
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: 'chr_vale_chapter_iii', pid: session.pid },
      { type: 'deedUnlocked', deedId: FIRST_KOI_DEED_ID, pid: session.pid },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(2);
  });

  it('ONE opt-out read serves both the marquee and the feed card', async () => {
    // chr_vale_chapter_iii is BOTH marquee (renown 25) and feed-worthy
    // (titled); the fan-out must not double the per-unlock accounts query.
    const session = joinServer(server, fakeWs(), 111, 'Shared');
    (db.pool.query as ReturnType<typeof vi.fn>).mockClear();
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: 'chr_vale_chapter_iii', pid: session.pid },
    ]);
    await flushAsync();
    const optOutReads = (db.pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('deed_broadcasts'),
    );
    expect(optOutReads).toHaveLength(1);
    expect(drainActivity()).toHaveLength(1);
  });

  it('a RETRO unlock never reaches the feed', async () => {
    const session = joinServer(server, fakeWs(), 105, 'Veteran');
    (db.pool.query as ReturnType<typeof vi.fn>).mockClear();
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: 'chr_vale_chapter_iii', retro: true, pid: session.pid },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(0);
    // The retro gate must sit BEFORE the opt-out read: a veteran's first
    // login replays dozens of marquee deeds, and a leaked per-deed query is
    // a login-storm amplifier even with every card suppressed.
    expect(optOutReads()).toBe(0);
  });

  it('a non-feed-worthy unlock never reaches the feed', async () => {
    const session = joinServer(server, fakeWs(), 106, 'Collector');
    (db.pool.query as ReturnType<typeof vi.fn>).mockClear();
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: 'col_junk_drawer', pid: session.pid },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(0);
    // Neither marquee nor feed-worthy: the early return must keep the
    // per-unlock accounts query at zero, not merely suppress the card.
    expect(optOutReads()).toBe(0);
  });

  it('the deed-broadcasts opt-out suppresses the feed card', async () => {
    const session = joinServer(server, fakeWs(), 107, 'Private');
    (db.pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) =>
      typeof sql === 'string' && sql.includes('deed_broadcasts')
        ? { rows: [{ deed_broadcasts: false }] }
        : { rows: [] },
    );
    (server as any).detectActivity([
      { type: 'deedUnlocked', deedId: 'chr_vale_chapter_iii', pid: session.pid },
    ]);
    await flushAsync();
    expect(drainActivity()).toHaveLength(0);
  });
});

describe('dedupe key semantics (the pure claim/release layer, R60)', () => {
  // recentKeys is module-global; every key here is unique to its test so
  // leftover stamps from the GameServer suites above cannot collide.
  it('a late release cannot delete a newer claim (ownership compare-and-set)', () => {
    expect(claimDedupeKey('r60:own', 1_000)).toBe(true);
    // The TTL expires and a NEWER claimant takes the key.
    expect(claimDedupeKey('r60:own', 31_001)).toBe(true);
    // The original claimant's rejection lands late (a driver-timeout reject
    // can outlive the TTL) and releases with ITS stamp: a no-op.
    releaseDedupeKey('r60:own', 1_000);
    // The newer claimant's window is intact: a third claim inside it dedupes.
    expect(claimDedupeKey('r60:own', 32_000)).toBe(false);
  });

  it('a released key re-opens only after the 2s retry backoff, never immediately', () => {
    expect(claimDedupeKey('r60:backoff', 100_000)).toBe(true);
    releaseDedupeKey('r60:backoff', 100_000);
    expect(claimDedupeKey('r60:backoff', 101_999)).toBe(false);
    expect(claimDedupeKey('r60:backoff', 102_000)).toBe(true);
  });

  it('a live-key flood past the 4096 cap evicts oldest-first instead of rescanning forever', () => {
    // Stamps sit far past any real-clock stamp the suites above left behind,
    // so those leftovers read as expired and are pruned first; these 4200 are
    // all inside one TTL of each other, so expiry alone cannot shrink the
    // map and the overflow backstop must evict from the OLD end. The cap is
    // sized for the 1,000-concurrent target (the whole-branch db review):
    // eviction inside a TTL costs a duplicate card and an extra opt-out
    // read, so the flood here must exceed the cap, not sit at it.
    const base = 9_000_000_000_000;
    for (let i = 0; i < 4200; i++) claimDedupeKey(`r60:ov:${i}`, base + i);
    // The oldest key was evicted: it re-claims inside what would have been
    // its own TTL window. The newest key survived and still dedupes.
    expect(claimDedupeKey('r60:ov:0', base + 4300)).toBe(true);
    expect(claimDedupeKey('r60:ov:4199', base + 4300)).toBe(false);
    // And a population UNDER the cap never evicts: key 200 was claimed after
    // the flood start yet inside the TTL, so it still dedupes.
    expect(claimDedupeKey('r60:ov:200', base + 4300)).toBe(false);
  });
});

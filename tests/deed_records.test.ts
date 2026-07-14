import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import) so GameServer runs
// with no live DB; the deeds SQL boundary is mocked separately so the
// fire-and-forget observer writer is a spy we can assert against.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  insertBankLedgerRow: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/deeds_db', () => ({
  insertCharacterDeed: vi.fn(async () => {}),
  insertCharacterDeeds: vi.fn(async () => {}),
  getDeedBroadcasts: vi.fn(async () => true),
}));

// The Steam mirror observes the recorder (deeds_records calls onDeedRecorded
// after each character_deeds upsert resolves); spy it so that wiring is pinned
// here, not only in the mirror's own isolated suite.
vi.mock('../server/steam/mirror', () => ({
  onDeedRecorded: vi.fn(),
  reconcileOnLogin: vi.fn(),
}));

import { saveCharacterState } from '../server/db';
import { getDeedBroadcasts, insertCharacterDeed, insertCharacterDeeds } from '../server/deeds_db';
import {
  deedRecordsIdle,
  isHiddenDeedId,
  isMarqueeDeed,
  isPubliclyListableDeedId,
  publicRarityPayload,
  reconcileCharacterDeeds,
  recordDeedUnlock,
  recordDeedUnlocks,
} from '../server/deeds_records';
import { GameServer } from '../server/game';
import { onDeedRecorded } from '../server/steam/mirror';
import { DEEDS } from '../src/sim/content/deeds';
import type { DeedDef } from '../src/sim/types';

const insertMock = vi.mocked(insertCharacterDeed);
const insertDeedsMock = vi.mocked(insertCharacterDeeds);
const broadcastsFlagMock = vi.mocked(getDeedBroadcasts);
const onDeedRecordedMock = vi.mocked(onDeedRecorded);
// The blob-write seam: tests that hold or reject the authoritative save
// control THIS mock while the real saveCharacter (which owns the publish-
// after-durable drain) keeps running.
const saveStateMock = vi.mocked(saveCharacterState);

// Let the fire-and-forget promise chains (FIFO tail + the broadcast gate)
// settle deterministically before asserting. Unlocks routed through
// detectActivity chain their inserts behind the durable character save, so
// flush the queues once BEFORE draining the tail (the tail only carries an
// unlock after its save resolves), then once after for the mirror/broadcast.
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await deedRecordsIdle();
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  // Drain any prior test's tail before clearing, so a straggler insert from an
  // earlier case can never land inside this test's assertions.
  await deedRecordsIdle();
  insertMock.mockClear();
  insertMock.mockImplementation(async () => {});
  insertDeedsMock.mockClear();
  insertDeedsMock.mockImplementation(async () => {});
  broadcastsFlagMock.mockClear();
  broadcastsFlagMock.mockResolvedValue(true);
  onDeedRecordedMock.mockClear();
  onDeedRecordedMock.mockImplementation(() => {});
  // vi.restoreAllMocks does not touch module-factory vi.fn mocks, so a held
  // or rejecting blob write set by one test must not leak into the next.
  saveStateMock.mockReset();
  saveStateMock.mockImplementation(async () => {});
});

afterEach(async () => {
  await settle();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isMarqueeDeed (pure): the broadcast bar.
// ---------------------------------------------------------------------------

describe('isMarqueeDeed', () => {
  const base: DeedDef = {
    id: 'x',
    name: 'X',
    desc: 'x',
    category: 'progression',
    renown: 10,
    trigger: { kind: 'level', level: 2 },
  };

  it('notable-or-better Renown clears the bar; routine Renown does not', () => {
    expect(isMarqueeDeed({ ...base, renown: 25 })).toBe(true);
    expect(isMarqueeDeed({ ...base, renown: 50 })).toBe(true);
    expect(isMarqueeDeed({ ...base, renown: 10 })).toBe(false);
    expect(isMarqueeDeed({ ...base, renown: 5 })).toBe(false);
    // The exact boundary: 24 (below any real rung, but the decisive mutant
    // killer for the >= 25 threshold that governs guild-chat volume).
    expect(isMarqueeDeed({ ...base, renown: 24 as DeedDef['renown'] })).toBe(false);
  });

  it('any cosmetic reward clears the bar regardless of Renown', () => {
    expect(isMarqueeDeed({ ...base, renown: 10, reward: { kind: 'title', text: 'X' } })).toBe(true);
    expect(isMarqueeDeed({ ...base, renown: 0, reward: { kind: 'border', slug: 'x' } })).toBe(true);
    expect(isMarqueeDeed({ ...base, renown: 0, feat: true })).toBe(false);
  });

  it('agrees with the real catalog on the two exemplars', () => {
    expect(isMarqueeDeed(DEEDS.prog_veteran)).toBe(true); // title reward at renown 10
    expect(isMarqueeDeed(DEEDS.prog_first_steps)).toBe(false); // renown 5, rewardless
  });
});

// ---------------------------------------------------------------------------
// The hidden-deed strip for public surfaces (pure): existence is part of the
// hidden contract, so the anonymous rarity payload must never carry a hidden
// deed's id. The strip fails CLOSED: an id with no live DeedDef is dropped too,
// since production runs a mixed-version fleet over one shared database and a
// newer (or rolled-back) hidden deed's descriptive slug would otherwise leak.
// ---------------------------------------------------------------------------

describe('publicRarityPayload', () => {
  it('strips hidden deeds from the earned map and keeps everything else intact', () => {
    // Fixture guard: the exemplar must actually be hidden in the catalog.
    expect(DEEDS.hid_saul_footnote.hidden).toBe(true);
    expect(DEEDS.prog_veteran.hidden).not.toBe(true);
    const out = publicRarityPayload({
      totalEligible: 120,
      earned: { prog_veteran: 30, hid_saul_footnote: 4 },
    });
    expect(out).toEqual({ totalEligible: 120, earned: { prog_veteran: 30 } });
    expect(isHiddenDeedId('hid_saul_footnote')).toBe(true);
    expect(isHiddenDeedId('prog_veteran')).toBe(false);
  });

  it('fails closed on an unknown id: it is stripped, listable content stays, totalEligible untouched', () => {
    // Fixture guard: gone_deed is absent from the catalog (an id a newer or
    // rolled-back process could still emit); prog_veteran is present.
    expect(DEEDS.gone_deed).toBeUndefined();
    expect(DEEDS.prog_veteran).toBeDefined();
    const out = publicRarityPayload({
      totalEligible: 10,
      earned: { gone_deed: 1, prog_veteran: 3 },
    });
    expect(out).toEqual({ totalEligible: 10, earned: { prog_veteran: 3 } });
  });

  it('isPubliclyListableDeedId is true only for a known, non-hidden deed', () => {
    // Fixture-guard the exemplars against the real catalog.
    expect(DEEDS.prog_veteran.hidden).not.toBe(true);
    expect(DEEDS.hid_saul_footnote.hidden).toBe(true);
    expect(DEEDS.gone_deed).toBeUndefined();
    expect(isPubliclyListableDeedId('prog_veteran')).toBe(true);
    expect(isPubliclyListableDeedId('hid_saul_footnote')).toBe(false); // hidden
    expect(isPubliclyListableDeedId('gone_deed')).toBe(false); // unknown: fail closed
  });
});

// ---------------------------------------------------------------------------
// recordDeedUnlock: the fire-and-forget FIFO observer.
// ---------------------------------------------------------------------------

describe('recordDeedUnlock', () => {
  it('writes one row per unlock with the exact field mapping', async () => {
    // Distinct account/character ids so a swapped-field bug cannot pass.
    recordDeedUnlock({ characterId: 42, accountId: 7 }, 'prog_first_steps');
    await deedRecordsIdle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      realm: 'Claudemoon',
      characterId: 42,
      accountId: 7,
      deedId: 'prog_first_steps',
    });
  });

  it('preserves FIFO order: the second insert starts only after the first resolves', async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    insertMock.mockImplementationOnce(async (row) => {
      order.push(`start:${row.deedId}`);
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push(`end:${row.deedId}`);
    });
    insertMock.mockImplementationOnce(async (row) => {
      order.push(`start:${row.deedId}`);
      order.push(`end:${row.deedId}`);
    });
    recordDeedUnlock({ characterId: 1, accountId: 1 }, 'a');
    recordDeedUnlock({ characterId: 1, accountId: 1 }, 'b');
    // Give the chain a chance to (wrongly) start the second insert early.
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['start:a']);
    releaseFirst();
    await deedRecordsIdle();
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('a replay of the same (character, deed) pair leaves ONE row via the conflict-faking store', async () => {
    // Emulate the UNIQUE (character_id, deed_id) ON CONFLICT DO NOTHING
    // backbone: same pair collapses, a different deed lands its own row.
    const store = new Map<string, { characterId: number; accountId: number; deedId: string }>();
    insertMock.mockImplementation(async (row) => {
      const key = `${row.characterId}:${row.deedId}`;
      if (!store.has(key)) store.set(key, row);
    });
    recordDeedUnlock({ characterId: 42, accountId: 7 }, 'prog_veteran');
    recordDeedUnlock({ characterId: 42, accountId: 7 }, 'prog_veteran'); // retro replay
    recordDeedUnlock({ characterId: 42, accountId: 7 }, 'prog_first_steps');
    await deedRecordsIdle();
    expect(insertMock).toHaveBeenCalledTimes(3); // the SQL is what dedupes
    expect(store.size).toBe(2);
    expect([...store.keys()].sort()).toEqual(['42:prog_first_steps', '42:prog_veteran']);
  });

  it('a rejected insert logs, never throws into the caller, and never stalls the chain', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertMock.mockRejectedValueOnce(new Error('db down'));
    expect(() => recordDeedUnlock({ characterId: 1, accountId: 1 }, 'a')).not.toThrow();
    recordDeedUnlock({ characterId: 1, accountId: 1 }, 'b');
    await deedRecordsIdle();
    expect(errorSpy).toHaveBeenCalledWith('character_deeds write failed:', expect.any(Error));
    // The rejection did not break FIFO: the second insert still landed.
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls[1][0].deedId).toBe('b');
  });

  it('notifies the Steam mirror once per unlock, only AFTER the insert resolves', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    insertMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push('insert');
    });
    onDeedRecordedMock.mockImplementation(() => {
      order.push('mirror');
    });
    recordDeedUnlock({ characterId: 42, accountId: 7 }, 'prog_veteran');
    await new Promise((resolve) => setImmediate(resolve));
    // The row has not landed yet, so the mirror must not have been told.
    expect(onDeedRecordedMock).not.toHaveBeenCalled();
    release();
    await deedRecordsIdle();
    expect(order).toEqual(['insert', 'mirror']);
    expect(onDeedRecordedMock).toHaveBeenCalledTimes(1);
    expect(onDeedRecordedMock).toHaveBeenCalledWith(7, 'prog_veteran');
  });

  it('never notifies the mirror for an unlock whose insert failed (reconcile heals it)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertMock.mockRejectedValueOnce(new Error('db down'));
    recordDeedUnlock({ characterId: 42, accountId: 7 }, 'prog_veteran');
    recordDeedUnlock({ characterId: 42, accountId: 7 }, 'prog_first_steps');
    await deedRecordsIdle();
    expect(errorSpy).toHaveBeenCalled();
    // Only the landed row reached the mirror; the failed one is Steam-invisible
    // until the next reconcile-on-link.
    expect(onDeedRecordedMock).toHaveBeenCalledTimes(1);
    expect(onDeedRecordedMock).toHaveBeenCalledWith(7, 'prog_first_steps');
  });

  it('deedRecordsIdle resolves only after a pending insert completes (the test drain hook)', async () => {
    let release: () => void = () => {};
    let finished = false;
    insertMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      finished = true;
    });
    recordDeedUnlock({ characterId: 1, accountId: 1 }, 'a');
    const idle = deedRecordsIdle().then(() => {
      expect(finished).toBe(true);
    });
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await idle;
  });
});

// ---------------------------------------------------------------------------
// recordDeedUnlocks: the batched multi-deed drain (the post-save flush). One
// multi-row insert replaces N single-row round trips so a login storm never
// serializes ahead of the public index, the Steam pushes, and the shutdown
// drain; a single-id slice keeps the exact single-row path.
// ---------------------------------------------------------------------------

describe('recordDeedUnlocks (batch drain)', () => {
  it('mirrors a multi-deed slice in ONE batch insert carrying every id in order, no single-row inserts', async () => {
    recordDeedUnlocks({ characterId: 42, accountId: 7 }, ['a', 'b', 'c', 'd', 'e']);
    await deedRecordsIdle();
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    const [who, ids] = insertDeedsMock.mock.calls[0];
    expect(who).toEqual({ realm: 'Claudemoon', characterId: 42, accountId: 7 });
    expect([...ids]).toEqual(['a', 'b', 'c', 'd', 'e']); // event order preserved
    expect(insertMock).not.toHaveBeenCalled(); // zero single-row round trips
  });

  it('notifies the Steam mirror once per id, in order, only AFTER the batch insert resolves', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    insertDeedsMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push('insert');
    });
    onDeedRecordedMock.mockImplementation((_accountId, id) => {
      order.push(`mirror:${id}`);
    });
    recordDeedUnlocks({ characterId: 42, accountId: 7 }, ['a', 'b', 'c']);
    // The batch has not resolved, so no id may have reached Steam yet.
    await new Promise((resolve) => setImmediate(resolve));
    expect(onDeedRecordedMock).not.toHaveBeenCalled();
    release();
    await deedRecordsIdle();
    expect(order).toEqual(['insert', 'mirror:a', 'mirror:b', 'mirror:c']);
    expect(onDeedRecordedMock.mock.calls).toEqual([
      [7, 'a'],
      [7, 'b'],
      [7, 'c'],
    ]);
  });

  it('a rejected batch logs, never breaks the tail, and the join reconcile replays the same ids', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertDeedsMock.mockRejectedValueOnce(new Error('db down'));
    expect(() => recordDeedUnlocks({ characterId: 1, accountId: 1 }, ['a', 'b'])).not.toThrow();
    // The FIFO tail survived: the login reconcile heals by replaying the ids.
    reconcileCharacterDeeds({ characterId: 1, accountId: 1 }, ['a', 'b']);
    await deedRecordsIdle();
    expect(errorSpy).toHaveBeenCalledWith('character_deeds batch write failed:', expect.any(Error));
    expect(insertDeedsMock).toHaveBeenCalledTimes(2);
    expect([...insertDeedsMock.mock.calls[1][1]]).toEqual(['a', 'b']); // reconcile replay
    // The rejected batch never told Steam; the heal is Steam-invisible until the
    // account's reconcile-on-link (the reconcile itself is a DB write only).
    expect(onDeedRecordedMock).not.toHaveBeenCalled();
  });

  it('a live single unlock enqueued after a batch lands BEHIND it on the same FIFO tail', async () => {
    const order: string[] = [];
    let releaseBatch: () => void = () => {};
    insertDeedsMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseBatch = resolve;
      });
      order.push('batch');
    });
    insertMock.mockImplementationOnce(async (row) => {
      order.push(`single:${row.deedId}`);
    });
    recordDeedUnlocks({ characterId: 1, accountId: 1 }, ['a', 'b']);
    recordDeedUnlock({ characterId: 1, accountId: 1 }, 'c');
    // Give the single insert a chance to (wrongly) run ahead of the held batch.
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);
    releaseBatch();
    await deedRecordsIdle();
    expect(order).toEqual(['batch', 'single:c']);
  });

  it('a single-id slice takes the single-row path (delegates to recordDeedUnlock)', async () => {
    recordDeedUnlocks({ characterId: 42, accountId: 7 }, ['prog_veteran']);
    await deedRecordsIdle();
    expect(insertDeedsMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      realm: 'Claudemoon',
      characterId: 42,
      accountId: 7,
      deedId: 'prog_veteran',
    });
  });

  it('an empty slice is a no-op that never touches the queue', async () => {
    recordDeedUnlocks({ characterId: 42, accountId: 7 }, []);
    await deedRecordsIdle();
    expect(insertDeedsMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// detectActivity wiring: the sim's deedUnlocked events (and nothing else)
// reach the observer, with the marquee/retro/opt-out gates on the broadcast.
// ---------------------------------------------------------------------------

describe('deedUnlocked through GameServer.detectActivity', () => {
  let server: GameServer;

  function fakeWs() {
    const fc = {
      sent: [] as unknown[],
      ws: { readyState: 1, send: (p: string) => fc.sent.push(JSON.parse(p)) },
    };
    return fc;
  }

  beforeEach(() => {
    server = new GameServer();
  });

  // Run one authoritative tick and hand its events to the observer exactly
  // like the world loop does (routeEvents ordering is irrelevant here).
  function tickAndDetect(): void {
    const events = server.sim.tick();
    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity(events);
  }

  it('founding a guild grants soc_guild_founded live: the transport observer feeds the sim stat', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    vi.spyOn(server.social, 'broadcastDeedUnlock').mockResolvedValue(undefined);
    tickAndDetect(); // settle the fresh join
    await settle();
    insertMock.mockClear();

    // Drive the REAL game-side transport closure (the seam social.guildCreate
    // fires on its success arm), not a hand-bumped counter: it must resolve
    // the session by character id, reach the live sim meta, and bump.
    const tx = (
      server.social as unknown as {
        tx: { onGuildFounded(characterId: number): void };
      }
    ).tx;
    tx.onGuildFounded(42);
    const meta = server.sim.meta(session.pid);
    expect(meta?.deedStats.counters.guildsFounded).toBe(1);
    expect(meta?.deedsEarned.has('soc_guild_founded')).toBe(false); // tick tail grants
    tickAndDetect();
    await settle();
    expect(meta?.deedsEarned.has('soc_guild_founded')).toBe(true);
    const rows = insertMock.mock.calls.map((c) => c[0]);
    expect(rows.some((r) => r.deedId === 'soc_guild_founded')).toBe(true);
    // An unknown character id (no live session) is a safe no-op.
    expect(() => tx.onGuildFounded(999999)).not.toThrow();
  });

  it('a multi-deed live tick batches every earned id with the session ids; a marquee unlock broadcasts', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    const broadcastSpy = vi
      .spyOn(server.social, 'broadcastDeedUnlock')
      .mockResolvedValue(undefined);
    tickAndDetect(); // settle the fresh join (level 1: nothing earned)
    await settle();
    insertMock.mockClear();
    insertDeedsMock.mockClear();

    // 250k lifetime XP crosses prog_veteran (marquee: title reward) plus the
    // low level rungs (non-marquee) in one tick, all non-retro: the post-save
    // drain mirrors the whole slice in ONE multi-row batch, no per-row singles.
    server.sim.grantXp(250_000, server.sim.meta(session.pid) ?? undefined);
    tickAndDetect();
    await settle();

    expect(insertMock).not.toHaveBeenCalled(); // a multi-deed slice takes the batch path
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    const [who, ids] = insertDeedsMock.mock.calls[0];
    expect(who).toEqual({ realm: 'Claudemoon', characterId: 42, accountId: 7 });
    const drainedIds = [...ids];
    expect(drainedIds.length).toBeGreaterThan(1);
    expect(drainedIds).toContain('prog_veteran');
    expect(drainedIds).toContain('prog_first_steps');
    // Exactly the marquee subset of this tick's unlocks broadcast (with the
    // session actor), and the opt-out flag was consulted by account id.
    expect(broadcastSpy).toHaveBeenCalledWith({ characterId: 42, name: 'Hilda' }, 'prog_veteran');
    const broadcastIds = broadcastSpy.mock.calls.map((c) => c[1]);
    const expectedMarquee = drainedIds.filter((id) => isMarqueeDeed(DEEDS[id]));
    expect(broadcastIds.sort()).toEqual(expectedMarquee.sort());
    expect(broadcastIds).not.toContain('prog_first_steps');
    expect(broadcastsFlagMock).toHaveBeenCalledWith(7);
  });

  it('the account opt-out suppresses the broadcast but never the record', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    const broadcastSpy = vi
      .spyOn(server.social, 'broadcastDeedUnlock')
      .mockResolvedValue(undefined);
    tickAndDetect();
    await settle();
    insertMock.mockClear();
    insertDeedsMock.mockClear();
    broadcastsFlagMock.mockResolvedValue(false);

    server.sim.grantXp(250_000, server.sim.meta(session.pid) ?? undefined);
    tickAndDetect();
    await settle();

    // 250k XP crosses several rungs at once, so the drain batches them.
    const drainedIds = insertDeedsMock.mock.calls.flatMap((c) => [...c[1]]);
    expect(drainedIds).toContain('prog_veteran');
    expect(broadcastsFlagMock).toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('retro unlocks on join batch-insert rows but NEVER broadcast or read the opt-out', async () => {
    // A pre-deeds save: high lifetime XP but no earned map, so the join pass
    // back-credits prog_veteran (marquee) with retro: true.
    const state = {
      level: 12,
      xp: 0,
      lifetimeXp: 260_000,
      copper: 0,
      hp: 100,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
    };
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Returning', 'warrior', state as never);
    if ('error' in session) throw new Error(session.error);
    const broadcastSpy = vi
      .spyOn(server.social, 'broadcastDeedUnlock')
      .mockResolvedValue(undefined);
    // The join fires its own reconcile batch (the loaded + retro earned set);
    // let it land and clear it so the assertion isolates the post-save DRAIN of
    // the retro unlocks, which the next tick delivers.
    await settle();
    insertMock.mockClear();
    insertDeedsMock.mockClear();
    tickAndDetect(); // the join's retro grants drain with this tick
    await settle();

    expect(insertMock).not.toHaveBeenCalled(); // a multi-deed retro slice batches
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    const [who, ids] = insertDeedsMock.mock.calls[0];
    expect(who).toEqual({ realm: 'Claudemoon', characterId: 42, accountId: 7 });
    expect([...ids]).toContain('prog_veteran');
    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(broadcastsFlagMock).not.toHaveBeenCalled();
  });

  it('a drifted deed id (content removed) still records but never reaches the broadcast gate', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    const broadcastSpy = vi
      .spyOn(server.social, 'broadcastDeedUnlock')
      .mockResolvedValue(undefined);
    tickAndDetect();
    await settle();
    insertMock.mockClear();

    // A synthetic event whose id has left the catalog: the observer mirrors
    // the sim's decision regardless (the index answers "what was earned",
    // not "what still exists"), while the broadcast gate drops it before
    // ever reading the opt-out flag.
    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_deed' },
    ]);
    await settle();
    expect(insertMock.mock.calls.map((c) => c[0].deedId)).toEqual(['gone_deed']);
    expect(broadcastsFlagMock).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('a hidden deed never broadcasts, even when a reward makes it marquee', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    const broadcastSpy = vi
      .spyOn(server.social, 'broadcastDeedUnlock')
      .mockResolvedValue(undefined);
    tickAndDetect();
    await settle();
    insertMock.mockClear();

    // Preconditions that make this test decisive: the deed clears the marquee
    // bar (title reward) AND is hidden, so only the hidden gate can stop it.
    expect(isMarqueeDeed(DEEDS.hid_saul_footnote)).toBe(true);
    expect(DEEDS.hid_saul_footnote.hidden).toBe(true);

    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'hid_saul_footnote' },
    ]);
    await settle();
    // The record still lands (the earner's own index is not a third-party
    // surface); the broadcast path never runs, opt-out read included.
    expect(insertMock.mock.calls.map((c) => c[0].deedId)).toEqual(['hid_saul_footnote']);
    expect(broadcastsFlagMock).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('account quest lockouts applied at join grant their deeds without a later mark', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    tickAndDetect();
    await settle();

    // The lockout path pokes questsDone directly (bypassing the quest-credit
    // mark site), so it must request its own full evaluator pass: the quest
    // deed has to grant on the very next tick, not whenever some unrelated
    // mark happens to arrive.
    const quested = DEEDS.prog_callused_hands.trigger;
    if (quested.kind !== 'quest') throw new Error('prog_callused_hands is no longer a quest deed');
    (
      server as unknown as {
        applyAccountQuestLockouts(pid: number, c: unknown): void;
      }
    ).applyAccountQuestLockouts(session.pid, {
      completedQuestIds: [quested.questId],
      mechChromaIds: [],
    });
    tickAndDetect();
    await settle();
    expect(server.sim.meta(session.pid)?.deedsEarned.has('prog_callused_hands')).toBe(true);
  });

  it('never inserts into character_deeds before the character save resolves', async () => {
    // Crash-ordering: if the index row (and the Steam push chained off it)
    // could land while the authoritative blob save is still in flight, a hard
    // crash would leave the public record ahead of the Book, the one drift
    // direction the join reconcile cannot heal.
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    tickAndDetect();
    await settle();
    insertMock.mockClear();

    let releaseSave: () => void = () => {};
    const saveSpy = vi.spyOn(server, 'saveCharacter');
    saveStateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_deed' },
    ]);
    // Give a wrongly-immediate insert every chance to fire first.
    await new Promise((resolve) => setImmediate(resolve));
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(session);
    expect(insertMock).not.toHaveBeenCalled();
    expect(onDeedRecordedMock).not.toHaveBeenCalled();
    releaseSave();
    await settle();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      realm: 'Claudemoon',
      characterId: 42,
      accountId: 7,
      deedId: 'gone_deed',
    });
  });

  it('an unlock granted while a save is in flight waits for ITS OWN save, not the in-flight one', async () => {
    // The publish set is captured when the blob is SERIALIZED: an unlock
    // landing while that write is in flight is not inside it, so publishing
    // it on the in-flight save's success would put the index ahead of
    // durable state for the crash window until the queued save lands.
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    tickAndDetect();
    await settle();
    insertMock.mockClear();

    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    saveStateMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseSecond = resolve;
          }),
      );
    const detect = (server as unknown as { detectActivity(events: unknown[]): void })
      .detectActivity;
    detect.call(server, [{ type: 'deedUnlocked', pid: session.pid, deedId: 'gone_first' }]);
    // Let the first save serialize and start its (held) write.
    await new Promise((resolve) => setImmediate(resolve));
    detect.call(server, [{ type: 'deedUnlocked', pid: session.pid, deedId: 'gone_second' }]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(insertMock).not.toHaveBeenCalled();

    releaseFirst();
    await settle();
    // Only the id the first blob actually contained publishes.
    expect(insertMock.mock.calls.map((c) => c[0].deedId)).toEqual(['gone_first']);

    releaseSecond();
    await settle();
    expect(insertMock.mock.calls.map((c) => c[0].deedId)).toEqual(['gone_first', 'gone_second']);
  });

  it('a burst of unlocks for one session coalesces into ONE save and ONE batch insert in event order', async () => {
    // The retro back-credit on a veteran's first login lands dozens of
    // unlocks in one tick; one blob write must cover them all, and the drain
    // mirrors the whole slice in ONE multi-row batch rather than N singles.
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    tickAndDetect();
    await settle();
    insertMock.mockClear();
    insertDeedsMock.mockClear();

    const saveSpy = vi.spyOn(server, 'saveCharacter');
    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_first' },
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_second' },
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_third' },
    ]);
    await settle();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveStateMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    expect([...insertDeedsMock.mock.calls[0][1]]).toEqual([
      'gone_first',
      'gone_second',
      'gone_third',
    ]);
    // The drain owns the Steam at-least-once push: one per id, after the batch.
    expect(onDeedRecordedMock.mock.calls).toEqual([
      [7, 'gone_first'],
      [7, 'gone_second'],
      [7, 'gone_third'],
    ]);
  });

  it('a rejected save logs, defers every record, and the next successful save publishes in order', async () => {
    // The failure arm must never publish: a record landing while the blob
    // save failed is the ONE drift direction the insert-only join reconcile
    // cannot heal (index and Steam claiming a deed the character does not
    // have). The ids stay pending on the session and the next successful
    // save (the 30s autosave stands in here) publishes them in event order.
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    tickAndDetect();
    await settle();
    insertMock.mockClear();
    insertDeedsMock.mockClear();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveStateMock.mockRejectedValue(new Error('db down'));
    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_first' },
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_second' },
    ]);
    await settle();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('deed-unlock save failed'),
      expect.any(Error),
    );
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertDeedsMock).not.toHaveBeenCalled();
    expect(onDeedRecordedMock).not.toHaveBeenCalled();

    // Still failing across a second tick: nothing may ever publish (the
    // crash analog: blob and index stay CONSISTENTLY without the deed).
    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'gone_third' },
    ]);
    await settle();
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertDeedsMock).not.toHaveBeenCalled();

    // The next successful save publishes the whole backlog in ONE batch in
    // event order (three deferred ids: a multi-deed drain).
    saveStateMock.mockImplementation(async () => {});
    await server.saveCharacter(session);
    await settle();
    expect(insertMock).not.toHaveBeenCalled();
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    expect([...insertDeedsMock.mock.calls[0][1]]).toEqual([
      'gone_first',
      'gone_second',
      'gone_third',
    ]);
    expect(onDeedRecordedMock).toHaveBeenCalledTimes(3);
  });

  it('the marquee broadcast fires immediately, never gated on the save', async () => {
    // The guild-chat fan-out is cosmetic (no durability contract), so it must
    // not inherit the save's latency, or a slow autosave queue would delay
    // every congratulation by seconds.
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    const broadcastSpy = vi
      .spyOn(server.social, 'broadcastDeedUnlock')
      .mockResolvedValue(undefined);
    tickAndDetect();
    await settle();
    insertMock.mockClear();

    let releaseSave: () => void = () => {};
    saveStateMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    (server as unknown as { detectActivity(events: unknown[]): void }).detectActivity([
      { type: 'deedUnlocked', pid: session.pid, deedId: 'prog_veteran' },
    ]);
    // The async opt-out read resolves on the microtask queue; the save has not.
    await new Promise((resolve) => setImmediate(resolve));
    expect(broadcastSpy).toHaveBeenCalledWith({ characterId: 42, name: 'Hilda' }, 'prog_veteran');
    expect(insertMock).not.toHaveBeenCalled();
    releaseSave();
    await settle();
    expect(insertMock.mock.calls.map((c) => c[0].deedId)).toEqual(['prog_veteran']);
  });

  it('a non-marquee live unlock records without ever reading the opt-out flag', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    const broadcastSpy = vi
      .spyOn(server.social, 'broadcastDeedUnlock')
      .mockResolvedValue(undefined);
    tickAndDetect();
    await settle();
    insertMock.mockClear();

    // Level 2 earns only the rewardless renown-5 first rung.
    server.sim.setPlayerLevel(2, session.pid);
    server.sim.ctx.markDeedsDirty(session.pid);
    tickAndDetect();
    await settle();

    expect(insertMock.mock.calls.map((c) => c[0].deedId)).toContain('prog_first_steps');
    expect(broadcastsFlagMock).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

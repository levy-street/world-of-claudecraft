import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import) so GameServer runs
// with no live DB; the deeds SQL boundary is mocked separately so the batched
// login reconcile writer is a spy we can assert against without a real table.
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

// The Steam mirror hook must NEVER fire from the reconcile (only from the live
// per-unlock recorder); spy it so that boundary is pinned here.
vi.mock('../server/steam/mirror', () => ({
  onDeedRecorded: vi.fn(),
  reconcileOnLogin: vi.fn(),
}));

import { insertCharacterDeeds } from '../server/deeds_db';
import { deedRecordsIdle, reconcileCharacterDeeds } from '../server/deeds_records';
import { GameServer } from '../server/game';
import { REALM } from '../server/realm';
import { onDeedRecorded, reconcileOnLogin } from '../server/steam/mirror';

const insertDeedsMock = vi.mocked(insertCharacterDeeds);
const onDeedRecordedMock = vi.mocked(onDeedRecorded);
const reconcileOnLoginMock = vi.mocked(reconcileOnLogin);

// Let the fire-and-forget FIFO tail settle deterministically before asserting.
async function settle(): Promise<void> {
  await deedRecordsIdle();
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  // Drain any prior test's tail before clearing, so a straggler write from an
  // earlier case can never land inside this test's assertions.
  await deedRecordsIdle();
  insertDeedsMock.mockClear();
  insertDeedsMock.mockImplementation(async () => {});
  onDeedRecordedMock.mockClear();
  onDeedRecordedMock.mockImplementation(() => {});
  // The Steam login reconcile is a module-factory vi.fn that vi.restoreAllMocks
  // does not touch, so its call log and any per-test implementation must be
  // reset here or they accumulate across the join tests below.
  reconcileOnLoginMock.mockClear();
  reconcileOnLoginMock.mockImplementation(() => {});
});

afterEach(async () => {
  await settle();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// reconcileCharacterDeeds (direct): the fire-and-forget batched heal.
// ---------------------------------------------------------------------------

describe('reconcileCharacterDeeds', () => {
  it('enqueues ONE batched insert carrying the explicit realm, ids, and who', async () => {
    reconcileCharacterDeeds({ characterId: 42, accountId: 7 }, [
      'prog_veteran',
      'prog_first_steps',
    ]);
    await settle();
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    const [who, ids] = insertDeedsMock.mock.calls[0];
    expect(who).toEqual({ realm: REALM, characterId: 42, accountId: 7 });
    expect([...ids].sort()).toEqual(['prog_first_steps', 'prog_veteran']);
  });

  it('never notifies the Steam mirror (the reconcile is a DB write only)', async () => {
    reconcileCharacterDeeds({ characterId: 42, accountId: 7 }, ['prog_veteran']);
    await settle();
    expect(onDeedRecordedMock).not.toHaveBeenCalled();
  });

  it('an empty earned set is a no-op that never touches the db', async () => {
    reconcileCharacterDeeds({ characterId: 42, accountId: 7 }, []);
    await settle();
    expect(insertDeedsMock).not.toHaveBeenCalled();
  });

  it('does not pre-dedupe: a replayed reconcile issues its own batch (the SQL collapses it)', async () => {
    // Idempotence lives in ON CONFLICT DO NOTHING, pinned as a literal in
    // tests/deeds_db.test.ts. From the caller's side, two reconciles for the
    // same character issue two batches; the store, not the queue, collapses
    // the already-present rows.
    reconcileCharacterDeeds({ characterId: 42, accountId: 7 }, ['prog_veteran']);
    reconcileCharacterDeeds({ characterId: 42, accountId: 7 }, ['prog_veteran']);
    await settle();
    expect(insertDeedsMock).toHaveBeenCalledTimes(2);
    for (const call of insertDeedsMock.mock.calls) expect([...call[1]]).toEqual(['prog_veteran']);
  });

  it('a rejected batch logs, never throws into the caller, and never faults the chain', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertDeedsMock.mockRejectedValueOnce(new Error('db down'));
    expect(() => reconcileCharacterDeeds({ characterId: 1, accountId: 1 }, ['a'])).not.toThrow();
    // A later reconcile still runs: the rejection did not stall the FIFO tail.
    reconcileCharacterDeeds({ characterId: 1, accountId: 1 }, ['b']);
    await settle();
    expect(errorSpy).toHaveBeenCalledWith('character_deeds reconcile failed:', expect.any(Error));
    expect(insertDeedsMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The join wiring: GameServer.join replays the loaded earned set once.
// ---------------------------------------------------------------------------

describe('reconcile through GameServer.join', () => {
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

  it('replays exactly the loaded blob deeds into ONE batch with the session ids', async () => {
    // A returning character whose state blob already carries earned deeds. The
    // sim never re-emits a persisted deed on load, so ONLY the reconcile can
    // mirror it into character_deeds. Level 1 / 0 lifetime XP so the load grants
    // no level/XP deeds on top, leaving a known earned set; no tick is run, so
    // no live/retro unlock competes.
    const state = {
      level: 1,
      xp: 0,
      lifetimeXp: 0,
      copper: 0,
      hp: 100,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      deeds: { prog_veteran: '2026-01-01', prog_first_steps: '2026-01-02' },
    };
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Returning', 'warrior', state as never);
    if ('error' in session) throw new Error(session.error);
    await settle();

    // The loaded earned set is exactly the two blob deeds (nothing granted on
    // top at level 1), so it is a concrete, known reconcile target.
    const earnedIds = [...(server.sim.meta(session.pid)?.deedsEarned.keys() ?? [])].sort();
    expect(earnedIds).toEqual(['prog_first_steps', 'prog_veteran']);
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    const [who, ids] = insertDeedsMock.mock.calls[0];
    expect(who).toEqual({ realm: REALM, characterId: 42, accountId: 7 });
    // The reconcile replays the WHOLE loaded set, faithfully.
    expect([...ids].sort()).toEqual(earnedIds);
    // The reconcile is a DB write only; the Steam mirror is never told
    // per-row. The join DOES fire the account-level Steam login reconcile
    // (the durable heal for a dropped push), exactly once, chained BEHIND this
    // one on the records FIFO so its earnedDeedIds read sees the healed rows.
    expect(onDeedRecordedMock).not.toHaveBeenCalled();
    expect(reconcileOnLoginMock).toHaveBeenCalledTimes(1);
    expect(reconcileOnLoginMock).toHaveBeenCalledWith(7);
  });

  it('replays the retro/legacy grants too, not just the loaded ids, and never tells Steam', async () => {
    // A leatherworking craft skill in the blob makes retroFallbackGrants
    // back-credit prog_first_craft (retro) during addPlayer, so the live earned
    // set the reconcile replays is the loaded blob deeds PLUS that retro grant,
    // not only the ids the blob carried. Every join-time grant is a
    // deterministic function of the already-durable blob, so replaying it is a
    // free crash-heal under ON CONFLICT.
    const state = {
      level: 1,
      xp: 0,
      lifetimeXp: 0,
      copper: 0,
      hp: 100,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      craftSkills: { leatherworking: 5 },
    };
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Crafter', 'warrior', state as never);
    if ('error' in session) throw new Error(session.error);
    await settle();

    const earnedIds = [...(server.sim.meta(session.pid)?.deedsEarned.keys() ?? [])];
    expect(earnedIds).toContain('prog_first_craft'); // the retro grant landed
    expect(insertDeedsMock).toHaveBeenCalledTimes(1);
    const [who, ids] = insertDeedsMock.mock.calls[0];
    expect(who).toEqual({ realm: REALM, characterId: 42, accountId: 7 });
    expect([...ids]).toContain('prog_first_craft'); // the batch carries the retro id
    expect([...ids].sort()).toEqual(earnedIds.sort()); // the WHOLE live earned set
    // No tick ran, so the retro deedUnlocked event never reached the drain, and
    // the reconcile itself is a DB write only: Steam is never told per row.
    expect(onDeedRecordedMock).not.toHaveBeenCalled();
  });

  it('the JOIN guild stamp passes retroDeeds true; a linkdead RESUME stamps it false', async () => {
    // The firstJoin thread: join -> initSocial(session, true) -> sendSocialSnapshot
    // -> setPlayerGuild(pid, name, { retroDeeds: true }), so an existing member's
    // soc_guild_joined is re-credited silently. Dropping the `true` would starve
    // the retro credit; passing it on a resume would fire the live banner on
    // every reconnect. Both arms are driven behaviorally here.
    const guild = {
      id: 1,
      name: 'The Vanguard',
      rank: 'member' as const,
      members: [],
      events: [],
    };
    vi.spyOn(server.social, 'snapshot').mockResolvedValue({
      friends: [],
      blocks: [],
      ignores: [],
      guild,
    });
    const setPlayerGuild = vi.spyOn(server.sim, 'setPlayerGuild');
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Guilded', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    await vi.waitFor(() => expect(setPlayerGuild).toHaveBeenCalled());
    expect(setPlayerGuild).toHaveBeenCalledWith(session.pid, 'The Vanguard', { retroDeeds: true });
    // A linkdead resume re-stamps the guild through the same chokepoint but
    // with retroDeeds false: the entity already carries it, nothing to credit.
    setPlayerGuild.mockClear();
    session.linkdead = true;
    const fc2 = fakeWs();
    const resumed = server.join(fc2.ws as never, 7, 42, 'Guilded', 'warrior', null);
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed).toBe(session); // planJoin resumed the held session
    await vi.waitFor(() => expect(setPlayerGuild).toHaveBeenCalled());
    expect(setPlayerGuild).toHaveBeenCalledWith(session.pid, 'The Vanguard', {
      retroDeeds: false,
    });
    await settle();
  });

  it('a fresh character with no earned deeds issues no reconcile batch', async () => {
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    await settle();
    expect(insertDeedsMock).not.toHaveBeenCalled();
  });

  it('runs the Steam login reconcile only AFTER the join deeds batch insert resolves', async () => {
    // reconcileOnLogin stamps a 6h TTL then reads earnedDeedIds, so it must
    // observe the healed character_deeds rows: chained onto the records FIFO, it
    // may run only after the reconcile batch insert resolves, never beside it.
    // This FAILS on the old side-by-side wiring, where the Steam reconcile fired
    // synchronously at join, before the batch landed.
    const order: string[] = [];
    let releaseInsert: () => void = () => {};
    insertDeedsMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseInsert = resolve;
      });
      order.push('insert');
    });
    reconcileOnLoginMock.mockImplementation(() => {
      order.push('steam');
    });
    // A loaded earned set so the reconcile batch actually chains onto the tail.
    const state = {
      level: 1,
      xp: 0,
      lifetimeXp: 0,
      copper: 0,
      hp: 100,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      deeds: { prog_veteran: '2026-01-01' },
    };
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 7, 42, 'Returning', 'warrior', state as never);
    if ('error' in session) throw new Error(session.error);
    // The batch insert is held: Steam must wait behind it on the FIFO tail.
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);
    expect(reconcileOnLoginMock).not.toHaveBeenCalled();
    releaseInsert();
    await settle();
    expect(order).toEqual(['insert', 'steam']);
    expect(reconcileOnLoginMock).toHaveBeenCalledTimes(1);
    expect(reconcileOnLoginMock).toHaveBeenCalledWith(7);
  });
});

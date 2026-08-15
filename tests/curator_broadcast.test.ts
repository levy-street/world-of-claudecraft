// Curator standing on the identity wire: server stamp -> sparse encode -> client
// decode, the shape tests/dev_broadcast.test.ts + tests/dev_badge_refresh.test.ts
// give the contributor ladder.
//
// Two halves, deliberately:
//   - the CODEC half stamps curatorRank / relicsOwned / relicsTotal onto the sim
//     entity directly and pins the sparse crk/cro/crt encoding, the full-record
//     reset, and the client decode defaults;
//   - the RESOLUTION half drives the real GameServer.refreshCuratorStanding off a
//     live PlayerMeta, so the numbers are proven to come from the character's own
//     Reliquary ownership rather than only proving the codec round-trips whatever
//     is already on the entity.
//
// Server AUTHORITY is a claim with its own test at the bottom: there is no client
// command that can set a standing, which is what makes the sigil an honor rather
// than a checkbox.

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { RELIQUARY_PAGES } from '../src/sim/content/reliquary';
import {
  CURATOR_RANK_THRESHOLDS,
  catalogCharacterCompletion,
  characterReliquaryOwnership,
  curatorRankFromOwned,
} from '../src/sim/reliquary';
import type { PlayerClass } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i].t === 'snap') return sent[i];
  }
  return null;
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

// Catalogued relic ITEM ids straight off the live pages, so the fixtures below
// score real completion instead of inventing ids the catalog would ignore.
const CATALOGUED_ITEM_IDS: readonly string[] = [
  ...new Set(
    RELIQUARY_PAGES.flatMap((page) =>
      page.relics.flatMap((relic) => (relic.kind === 'item' ? [relic.itemId] : [])),
    ),
  ),
];

/** Discover the first `n` catalogued relic items on the live character, the
 *  cheapest way to drive the rank ladder to a chosen rung. */
function discoverRelics(server: GameServer, session: ClientSession, n: number): void {
  const meta = server.sim.meta(session.pid);
  if (!meta) throw new Error('expected live player meta');
  for (const itemId of CATALOGUED_ITEM_IDS.slice(0, n)) meta.deedStats.itemsDiscovered.add(itemId);
}

/** Character-scoped catalog total derived by an INDEPENDENT page-table walk
 *  (dedupe per kind, account weapon-skin slots excluded, every
 *  excludeFromCompletion page skipped whole whatever its reason, the skip
 *  mirroring the weapon_skin arm: both are slots the character pair must not
 *  count),
 *  written here so the relicsTotal pin has a second oracle instead of
 *  re-calling the same helper pair the refresher under test calls (the
 *  function-level form of the constant-self-comparison trap). */
function characterScopedTotalByWalk(): number {
  const byKind = new Map<string, Set<string>>();
  for (const page of RELIQUARY_PAGES) {
    if (page.excludeFromCompletion !== undefined) continue;
    for (const relic of page.relics) {
      if (relic.kind === 'weapon_skin') continue;
      const id =
        relic.kind === 'item'
          ? relic.itemId
          : relic.kind === 'mark'
            ? relic.markId
            : relic.kind === 'mount'
              ? relic.mountId
              : relic.deedId;
      let ids = byKind.get(relic.kind);
      if (!ids) {
        ids = new Set();
        byKind.set(relic.kind, ids);
      }
      ids.add(id);
    }
  }
  let total = 0;
  for (const ids of byKind.values()) total += ids.size;
  return total;
}

/** The mocked pg pool's query spy. server/game.ts imports `pool` from './db'
 *  and hands it straight to its db helpers, so this is the very object the code
 *  under test queries through; the positive control below proves that rather
 *  than assuming it, which is what keeps the zero-query pins from being
 *  assertions about a dead object. */
function poolQuery(): Mock {
  return pool.query as unknown as Mock;
}

describe('Curator standing: the identity wire codec', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(() => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Curatrix');
  });

  it('encodes crk/cro/crt in the full identity record for a ranked character', () => {
    const player = server.sim.entities.get(session.pid)!;
    player.curatorRank = 5;
    player.relicsOwned = 137;
    player.relicsTotal = 402;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    expect(snap).not.toBeNull();
    expect(snap.self.crk).toBe(5);
    expect(snap.self.cro).toBe(137);
    expect(snap.self.crt).toBe(402);
  });

  it('omits all three for a fresh character with no standing', () => {
    const player = server.sim.entities.get(session.pid)!;
    // A brand-new character has discovered nothing, so join stamped nothing.
    expect(player.curatorRank).toBeUndefined();
    broadcast(server);

    const snap = lastSnap(fc.sent);
    for (const key of ['crk', 'cro', 'crt']) expect(snap.self).not.toHaveProperty(key);
  });

  it('never ships the pair without the rank (all-or-nothing is structural)', () => {
    // The encoder nests cro/crt under crk, so a refresher bug (or a future
    // rank-1 threshold above one relic) cannot strand the pair on the wire
    // with the rank absent. Stamp the inconsistent state directly: the
    // refresher itself can no longer produce it.
    const player = server.sim.entities.get(session.pid)!;
    player.curatorRank = undefined;
    player.relicsOwned = 137;
    player.relicsTotal = 402;
    player.holderTier = 2;
    broadcast(server);
    const snap = lastSnap(fc.sent);
    // In-snapshot witness: a sibling identity key rides in the SAME payload,
    // so the three absences below cannot pass because identity was never
    // built at all in this broadcast.
    expect(snap.self.ht).toBe(2);
    for (const key of ['crk', 'cro', 'crt']) expect(snap.self).not.toHaveProperty(key);

    // Positive control: the same pair rides again once the rank is present.
    player.curatorRank = 5;
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    const ranked = lastSnap(fc.sent);
    expect(ranked.self.crk).toBe(5);
    expect(ranked.self.cro).toBe(137);
    expect(ranked.self.crt).toBe(402);
  });

  it("round-trips another player's standing through the full entity record", () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Eternal', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.curatorRank = 5;
    otherEnt.relicsOwned = 137;
    otherEnt.relicsTotal = 402;
    fc.sent.length = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire.k).toBe('player'); // a first-sight record is full: identity rides
    expect(wire.crk).toBe(5);
    expect(wire.cro).toBe(137);
    expect(wire.crt).toBe(402);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    const decoded = client.entities.get(other.pid)!;
    expect(decoded.curatorRank).toBe(5);
    expect(decoded.relicsOwned).toBe(137);
    expect(decoded.relicsTotal).toBe(402);
  });

  it('a later refresh re-broadcasts a CHANGED standing to a tracking client', () => {
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Climber', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;

    broadcast(server);
    let wire = lastSnap(fc.sent).ents.find((e: any) => e.id === other.pid);
    expect(wire).toBeDefined();
    expect(wire).not.toHaveProperty('crk');

    otherEnt.curatorRank = 2;
    otherEnt.relicsOwned = 12;
    otherEnt.relicsTotal = 402;
    server.sim.tick(); // let the per-tick wire cache rebuild identityFields
    fc.sent.length = 0;
    broadcast(server);

    wire = lastSnap(fc.sent).ents.find((e: any) => e.id === other.pid);
    expect(wire.k).toBe('player'); // identity re-sent => full record
    expect(wire.crk).toBe(2);
    expect(wire.cro).toBe(12);
    expect(wire.crt).toBe(402);
  });

  it('a CLEARED standing rides as an absent key, which resets the mirror', () => {
    // The reset path the sparse encoding depends on: a character whose ownership
    // went to zero must not keep a stale rank on every nearby client.
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Faller', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.curatorRank = 3;
    otherEnt.relicsOwned = 30;
    otherEnt.relicsTotal = 402;
    server.sim.tick();
    broadcast(server);
    let snap = lastSnap(fc.sent);
    expect(snap.ents.find((e: any) => e.id === other.pid).crk).toBe(3);

    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.entities.get(other.pid)!.curatorRank).toBe(3);

    otherEnt.curatorRank = undefined;
    otherEnt.relicsOwned = undefined;
    otherEnt.relicsTotal = undefined;
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);
    snap = lastSnap(fc.sent);
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire.k).toBe('player');
    for (const key of ['crk', 'cro', 'crt']) expect(wire).not.toHaveProperty(key);

    (client as any).applySnapshot(snap);
    const decoded = client.entities.get(other.pid)!;
    expect(decoded.curatorRank).toBe(0);
    expect(decoded.relicsOwned).toBeUndefined();
    expect(decoded.relicsTotal).toBeUndefined();
  });

  it('decodes each field independently, with the ht/hb split for the pair', () => {
    const client = bareClient(99);
    (client as any).applySnapshot({
      t: 'snap',
      ents: [
        {
          id: 42,
          k: 'player',
          tid: 'player',
          nm: 'Eternal',
          lv: 60,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 100,
          mhp: 100,
          crk: 5,
          // cro/crt deliberately absent: a rank with no pair must not synthesize
          // numbers, it must leave them undefined so the card's line fails closed.
        },
      ],
    });
    const decoded = client.entities.get(42)!;
    expect(decoded.curatorRank).toBe(5);
    expect(decoded.relicsOwned).toBeUndefined();
    expect(decoded.relicsTotal).toBeUndefined();
  });

  it("the self payload carries reliq while another player's record never does", () => {
    // The cross-player privacy rule, pinned with its positive control: reliq
    // (firstFind, marks, recent, illuminated pages) is omit-empty on the self
    // payload, so seed one authored mark on the SELF character first and prove
    // the key actually rides. Without that arm the absence pin below would
    // pass with the whole feature deleted (the dead-alternate-negative trap).
    server.sim.meta(session.pid)!.reliquary.marks.add('masterwork:first');
    const fc2 = fakeWs();
    const other = joinServer(server, fc2, 2, 'Hoarder', 'mage');
    const otherEnt = server.sim.entities.get(other.pid)!;
    otherEnt.curatorRank = 5;
    otherEnt.relicsOwned = 137;
    otherEnt.relicsTotal = 402;
    server.sim.tick();
    fc.sent.length = 0;
    broadcast(server);

    const snap = lastSnap(fc.sent);
    // The control asserts the seeded CONTENT, not mere key presence: reliq
    // rides as an empty object on a first broadcast even for a fresh
    // character (maybeRaw diffs against the previously sent string), so a
    // bare truthiness check would pass with the seed deleted.
    expect(snap.self.reliq.marks, 'the self payload must carry the seeded mark').toContain(
      'masterwork:first',
    );
    const wire = snap.ents.find((e: any) => e.id === other.pid);
    expect(wire.crk).toBe(5); // the aggregate standing rides the record...
    expect(wire).not.toHaveProperty('reliq'); // ...the per-relic blob never does
  });

  it('coerces hostile wire values: wrong types, fractions, and huge counts degrade', () => {
    // The decode guards' wrong-type arm, previously indistinguishable from the
    // absent-key arm: a string rank must not flow into the `rank >= 5` sigil
    // gate ('9' >= 5 is true in JS), a fractional rank must floor rather than
    // index between rungs, and a huge count must clamp to the sim's 1e9
    // obtain-count ceiling instead of rendering a 300-digit line.
    const client = bareClient(99);
    (client as any).applySnapshot({
      t: 'snap',
      ents: [
        {
          id: 44,
          k: 'player',
          tid: 'player',
          nm: 'Forged',
          lv: 60,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 1,
          mhp: 1,
          crk: '5',
          cro: {},
          crt: [],
        },
        {
          id: 45,
          k: 'player',
          tid: 'player',
          nm: 'Fraction',
          lv: 60,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 1,
          mhp: 1,
          crk: 3.5,
          cro: 2.5,
          crt: 1e308,
        },
        {
          id: 46,
          k: 'player',
          tid: 'player',
          nm: 'Negative',
          lv: 60,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 1,
          mhp: 1,
          crk: -2,
          cro: Number.NaN,
          crt: Number.POSITIVE_INFINITY,
        },
      ],
    });
    const forged = client.entities.get(44)!;
    expect(forged.curatorRank).toBe(0);
    expect(forged.relicsOwned).toBeUndefined();
    expect(forged.relicsTotal).toBeUndefined();
    const fraction = client.entities.get(45)!;
    expect(fraction.curatorRank).toBe(3);
    expect(fraction.relicsOwned).toBe(2);
    expect(fraction.relicsTotal).toBe(1e9);
    const negative = client.entities.get(46)!;
    expect(negative.curatorRank).toBe(0);
    expect(negative.relicsOwned).toBeUndefined();
    expect(negative.relicsTotal).toBeUndefined();
  });

  it('passes an above-ladder INTEGER rank through, deliberately (mixed-version rule)', () => {
    // No clamp to today's five rungs, decided at Phase 20 QA: a NEWER server
    // whose ladder grew a rank 6 must keep reading as at-least-rank-5 on this
    // client (the name falls to the generic key; the sigil gate rank >= 5
    // still lights, which is the honest rendering of a higher rank). A forged
    // high rank needs a hostile SERVER, which already owns every cosmetic.
    const client = bareClient(99);
    (client as any).applySnapshot({
      t: 'snap',
      ents: [
        {
          id: 47,
          k: 'player',
          tid: 'player',
          nm: 'Future',
          lv: 60,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 1,
          mhp: 1,
          crk: 9,
          cro: 200,
          crt: 260,
        },
      ],
    });
    const future = client.entities.get(47)!;
    expect(future.curatorRank).toBe(9);
    expect(future.relicsOwned).toBe(200);
  });

  it('defaults the rank to 0 on a record that carries no standing at all', () => {
    const client = bareClient(99);
    (client as any).applySnapshot({
      t: 'snap',
      ents: [
        {
          id: 43,
          k: 'mob',
          tid: 'forest_wolf',
          nm: 'Forest Wolf',
          lv: 1,
          x: 0,
          y: 0,
          z: 0,
          f: 0,
          hp: 45,
          mhp: 45,
        },
      ],
    });
    const decoded = client.entities.get(43)!;
    expect(decoded.curatorRank).toBe(0); // typeof w.crk === 'number' ? w.crk : 0
    expect(decoded.relicsOwned).toBeUndefined();
    expect(decoded.relicsTotal).toBeUndefined();
  });
});

describe('GameServer.refreshCuratorStanding (real ownership resolution)', () => {
  let server: GameServer;
  let fc: FakeClient;
  let session: ClientSession;

  beforeEach(async () => {
    server = new GameServer();
    fc = fakeWs();
    session = joinServer(server, fc, 1, 'Curatrix');
    // Join is allowed to touch the database, and it does: the social lists and
    // the three awaited flair reads are best-effort work it kicks off without
    // awaiting. Let those settle BEFORE the count is zeroed, or a late microtask
    // lands inside a zero-query pin's window and reads as curator work.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    poolQuery().mockClear();
  });

  it('leaves a fresh character with no standing at all (absent, not zero)', () => {
    (server as any).refreshCuratorStanding(session);
    const e = server.sim.entities.get(session.pid)!;
    expect(e.curatorRank).toBeUndefined();
    expect(e.relicsOwned).toBeUndefined();
    expect(e.relicsTotal).toBeUndefined();
  });

  it('resolves ONE catalogued find to rank 1 and a real pair', () => {
    discoverRelics(server, session, 1);
    (server as any).refreshCuratorStanding(session);
    const e = server.sim.entities.get(session.pid)!;
    expect(e.curatorRank).toBe(1);
    expect(e.relicsOwned).toBe(1);
    // The total is the character-scoped catalog size, which excludes the
    // account weapon-skin slots. Two oracles: the live helper (so a catalog
    // that grows moves both together instead of stranding a literal) AND the
    // independent page-table walk above, which is what catches a refresher
    // that swapped in a different helper agreeing with itself.
    const meta = server.sim.meta(session.pid)!;
    expect(e.relicsTotal).toBe(catalogCharacterCompletion(characterReliquaryOwnership(meta)).total);
    expect(e.relicsTotal).toBe(characterScopedTotalByWalk());
    expect(e.relicsTotal).toBeGreaterThan(1);
  });

  it('climbs the ladder with the character (rank 4 at 50, rank 5 at 100)', () => {
    // The two thresholds the sigil's boundary is drawn around, driven through
    // the REAL resolution rather than stamped: rank 4 must not carry the honor.
    expect(CURATOR_RANK_THRESHOLDS[3]).toBe(50);
    expect(CURATOR_RANK_THRESHOLDS[4]).toBe(100);
    expect(CATALOGUED_ITEM_IDS.length).toBeGreaterThanOrEqual(100);

    discoverRelics(server, session, 50);
    (server as any).refreshCuratorStanding(session);
    const e = server.sim.entities.get(session.pid)!;
    expect(e.relicsOwned).toBe(50);
    expect(e.curatorRank).toBe(4);

    discoverRelics(server, session, 100);
    (server as any).refreshCuratorStanding(session);
    expect(e.relicsOwned).toBe(100);
    expect(e.curatorRank).toBe(5);
  });

  it('derives the same numbers the pure helpers do (one catalog walk, no fork)', () => {
    discoverRelics(server, session, 30);
    (server as any).refreshCuratorStanding(session);
    const e = server.sim.entities.get(session.pid)!;
    const meta = server.sim.meta(session.pid)!;
    const expected = catalogCharacterCompletion(characterReliquaryOwnership(meta));
    expect(e.relicsOwned).toBe(expected.owned);
    expect(e.relicsTotal).toBe(expected.total);
    expect(e.curatorRank).toBe(curatorRankFromOwned(expected.owned));
  });

  it('CLEARS a standing back to absent when the ownership behind it goes away', () => {
    discoverRelics(server, session, 12);
    (server as any).refreshCuratorStanding(session);
    const e = server.sim.entities.get(session.pid)!;
    expect(e.curatorRank).toBe(2);

    server.sim.meta(session.pid)!.deedStats.itemsDiscovered.clear();
    (server as any).refreshCuratorStanding(session);
    expect(e.curatorRank).toBeUndefined();
    expect(e.relicsOwned).toBeUndefined();
    expect(e.relicsTotal).toBeUndefined();
  });

  it('reaches the wire end to end: live ownership -> entity -> snapshot', () => {
    discoverRelics(server, session, 25);
    (server as any).refreshCuratorStanding(session);
    broadcast(server);
    const snap = lastSnap(fc.sent);
    expect(snap.self.crk).toBe(3);
    expect(snap.self.cro).toBe(25);
    expect(snap.self.crt).toBeGreaterThan(25);
  });

  it('is stamped BY JOIN itself, so an inspect before the first cycle reads true', () => {
    // End to end through the real load path: a returning character whose saved
    // deedStats already carry ten catalogued finds must be inspectable at rank 2
    // immediately, without waiting up to 60s for the flair cycle.
    const returning = new GameServer();
    const rfc = fakeWs();
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
      deedStats: { itemsDiscovered: CATALOGUED_ITEM_IDS.slice(0, 10) },
    };
    const rejoined = returning.join(rfc.ws as never, 7, 42, 'Returning', 'warrior', state as never);
    if ('error' in rejoined) throw new Error(rejoined.error);
    rejoined.blockListLoaded = true;

    const e = returning.sim.entities.get(rejoined.pid)!;
    const meta = returning.sim.meta(rejoined.pid)!;
    // Pinned against the live helper, not the literal 10: join also runs the
    // retro deed reconcile, and an earned deed that is itself a catalogued title
    // relic scores too, so the true owned count is the ten finds PLUS whatever
    // that pass granted. What this asserts is that join stamped the character's
    // WHOLE live ownership, not that the catalog has a particular size.
    const expected = catalogCharacterCompletion(characterReliquaryOwnership(meta));
    expect(expected.owned).toBeGreaterThanOrEqual(10);
    expect(e.relicsOwned).toBe(expected.owned);
    expect(e.relicsTotal).toBe(expected.total);
    expect(e.curatorRank).toBe(curatorRankFromOwned(expected.owned));
    expect(e.curatorRank).toBe(2);
    // And it is on the very first snapshot that character's client receives.
    (returning as any).broadcastSnapshots();
    const snap = lastSnap(rfc.sent);
    expect(snap.self.crk).toBe(2);
    expect(snap.self.cro).toBe(expected.owned);
  });

  it('runs on the periodic flair cycle too, so a mid-session find converges', async () => {
    // The 60s cycle is what catches a relic found after login. Drive the real
    // cycle (not the per-session method) so a refresher dropped from
    // refreshAllHolderTiers reds here.
    discoverRelics(server, session, 12);
    const e = server.sim.entities.get(session.pid)!;
    expect(e.curatorRank).toBeUndefined();
    await (server as any).refreshAllHolderTiers();
    expect(e.curatorRank).toBe(2);
    expect(e.relicsOwned).toBe(12);
  });

  it('sweeps even while a degraded RPC cycle still holds the overlap guard', async () => {
    // The overlap guard belongs to the three AWAITED refreshers (wallet RPC,
    // Discord, GitHub), whose cycle can outrun the 60s interval and must not
    // pile up. The curator sweep is pure CPU with no IO, so it can never be the
    // thing that piles up; while it sat under that early return, one hung RPC
    // cycle froze every online player's Curator standing along with it. Holding
    // the flag down IS that degraded cycle, and it must not stop the sweep.
    discoverRelics(server, session, 12);
    const e = server.sim.entities.get(session.pid)!;
    (server as any).holderTierRefreshing = true;
    await (server as any).refreshAllHolderTiers();
    expect(e.curatorRank).toBe(2);
    expect(e.relicsOwned).toBe(12);
    // ... while the guard still guards its OWN half: the awaited refreshers did
    // not run a second time, so nothing reached the database on this pass. Reds
    // if the hoist ever drags the awaited three out from under the guard too.
    expect(poolQuery()).not.toHaveBeenCalled();
  });

  it('does ZERO database work on either curator path', async () => {
    // The standing is derived from live sim meta, so neither entry point may add
    // a query: not the per-session refresher, and not a 60s sweep over every
    // online session (which would be one round trip per player per minute). The
    // criterion held only by inspection until this pin.
    discoverRelics(server, session, 12);
    const e = server.sim.entities.get(session.pid)!;
    (server as any).refreshCuratorStanding(session);
    expect(e.curatorRank).toBe(2); // the work under test really ran
    expect(poolQuery()).not.toHaveBeenCalled();

    // The same through the cycle, with the awaited half held off by its own
    // overlap guard so only the sweep runs. Clearing the stamp first is what
    // proves the sweep re-derived it rather than the assertion reading the
    // value the direct call left behind.
    e.curatorRank = undefined;
    e.relicsOwned = undefined;
    (server as any).holderTierRefreshing = true;
    await (server as any).refreshAllHolderTiers();
    expect(e.curatorRank).toBe(2);
    expect(e.relicsOwned).toBe(12);
    expect(poolQuery()).not.toHaveBeenCalled();
  });

  it('skips a session whose entity has left the sim, and one with no meta, without throwing', () => {
    // The `if (!e || !meta) return;` guard. A session can outlive its entity for
    // a tick (a logout or a kick racing the 60s sweep), and the sweep must treat
    // that as nothing to stamp rather than as an error. Both disjuncts are
    // driven separately, or one arm proves nothing about the other.
    discoverRelics(server, session, 12);
    (server as any).refreshCuratorStanding(session);
    const e = server.sim.entities.get(session.pid)!;
    expect(e.curatorRank).toBe(2); // the guard is not what produced the skip below

    server.sim.entities.delete(session.pid);
    expect(() => (server as any).refreshCuratorStanding(session)).not.toThrow();
    // The stamp on the detached entity is untouched, so the guard RETURNED
    // rather than falling through and clearing it.
    expect(e.curatorRank).toBe(2);

    // The meta half: entity back, player record gone.
    server.sim.entities.set(session.pid, e);
    const meta = server.sim.meta(session.pid)!;
    (server.sim as any).players.delete(session.pid);
    expect(server.sim.meta(session.pid)).toBeNull();
    expect(() => (server as any).refreshCuratorStanding(session)).not.toThrow();
    expect(e.curatorRank).toBe(2);

    // Positive control: with both restored the same call DOES stamp, so the two
    // no-ops above are the guard and not a refresher that stopped working.
    (server.sim as any).players.set(session.pid, meta);
    e.curatorRank = undefined;
    (server as any).refreshCuratorStanding(session);
    expect(e.curatorRank).toBe(2);
  });

  it('isolates a throwing session so the sweep still stamps the ones behind it', async () => {
    // The per-session try/catch inside refreshAllHolderTiers. Its contract lived
    // only in prose: one session throwing must not cost every session after it
    // in the iteration its standing for the next 60 seconds. The overlap guard
    // is held down so only the synchronous curator half runs.
    const fc2 = fakeWs();
    const second = joinServer(server, fc2, 2, 'Steady', 'mage');
    discoverRelics(server, session, 12);
    discoverRelics(server, second, 25);
    const first = server.sim.entities.get(session.pid)!;
    const e2 = server.sim.entities.get(second.pid)!;
    expect([...(server as any).clients.values()][0]).toBe(session); // the thrower is FIRST

    const realMeta = server.sim.meta.bind(server.sim);
    const metaSpy = vi.spyOn(server.sim, 'meta').mockImplementation((pid: number) => {
      if (pid === session.pid) throw new Error('meta read exploded');
      return realMeta(pid);
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      (server as any).holderTierRefreshing = true;
      await (server as any).refreshAllHolderTiers();
      // The throw really happened (nothing stamped the first session) ...
      expect(first.curatorRank).toBeUndefined();
      expect(errSpy).toHaveBeenCalled();
      // ... and the session behind it still converged.
      expect(e2.curatorRank).toBe(3);
      expect(e2.relicsOwned).toBe(25);
    } finally {
      metaSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('a throwing curator stamp at JOIN never blocks the join', () => {
    // The join-time try/catch, the same best-effort contract the awaited flair
    // reads get from their .catch arms: a flair stamp must never decide whether
    // a player gets into the world.
    const joining = new GameServer();
    const jfc = fakeWs();
    const stampSpy = vi.spyOn(joining as any, 'refreshCuratorStanding').mockImplementation(() => {
      throw new Error('curator stamp exploded');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const joined = joining.join(jfc.ws as never, 9, 9, 'Unlucky', 'warrior', null);
      expect('error' in joined).toBe(false);
      expect(stampSpy).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      // The player is really in the world, not a half-built session.
      expect(joining.sim.entities.get((joined as ClientSession).pid)).toBeDefined();
    } finally {
      stampSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('positive control: the pool spy IS the handle the server queries through', async () => {
    // Without this, the zero-query pins above could not tell "the curator paths
    // do no database work" from "this spy is not the object server/game.ts
    // calls, so it was never going to count anything either way". An UNGUARDED
    // cycle does reach the database through the very same pool
    // (refreshDiscordFlair hands it straight to discordFlairForAccount), so a
    // nonzero count here is what makes those zeros mean something.
    await (server as any).refreshAllHolderTiers();
    expect(poolQuery().mock.calls.length).toBeGreaterThan(0);
  });
});

// Named path constants, so a module move is one edit here rather than a scrape
// left pointing at a file that no longer holds its subject (which would pass
// vacuously over an empty corpus).
const SERVER_ROOT = fileURLToPath(new URL('../server', import.meta.url));
const GAME_SRC = fileURLToPath(new URL('../server/game.ts', import.meta.url));

/** Strip block and line comments (keeping a `://` in a URL intact) before any
 *  bound below counts anything. Without it, prose describing a write this code
 *  deliberately does NOT make would both game the negative direction and red
 *  the counts for the wrong reason. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * A write to any of the three standing fields, through ANY receiver.
 *
 * The first form of this pin required a bare identifier before the dot
 * (`\b\w+\.`), which reads as "exactly three writes exist" while a chained write
 * walks straight past it: `this.sim.entities.get(pid)!.curatorRank = 5` has `)!`
 * before the dot, and so do `sessions['a'].relicsOwned = 9` and
 * `ent?.relicsTotal = 3`. Compound assignment (`+=`, `??=`) is a write too. So
 * the receiver is dropped entirely and the field name carries the match, with a
 * trailing `\b` (or `curatorRankFromOwned` would count) and a `(?!=)` lookahead
 * (or `===` would). Verified against the live tree: this matches exactly the
 * six sanctioned writes, all inside refreshCuratorStanding (the fail-to-absent
 * clear cluster plus the rank-gated stamp cluster), and none of the reads
 * beside them (`=== 5`, `!== total`, `>= 3`, the `curatorRank: number` field,
 * the imported helper).
 */
const CURATOR_WRITE =
  /\b(?:curatorRank|relicsOwned|relicsTotal)\b\s*(?:\*\*|<<|>>>?|\?\?|\|\||&&|[+\-*/%&|^])?=(?!=)/g;

describe('Curator standing is server authority, never a client claim', () => {
  // The honor is computed from the character's own catalog or it does not
  // exist, so the bound has to hold over the WHOLE server surface, not only the
  // module that happens to own the refresher today: a command handler in
  // server/http/ writing a rank would have been invisible to a game.ts-only
  // scan. Read once, comment-stripped, for every bound below.
  const serverFiles = tsFilesUnder(SERVER_ROOT);
  const serverCode = serverFiles.map(({ full }) => codeOnly(readFileSync(full, 'utf8'))).join('\n');

  it('scans the WHOLE server tree, subdirectories included', () => {
    // server/ is genuinely deep (http/, http/middleware/, steam/, epic/, parse/,
    // email/, bot_detector/), so the recursion is pinned directly by a file
    // floor over the real tree, the way mobile_window_coverage does it, rather
    // than by a synthetic fixture: a single-level read returns 172 of these 258
    // files and reds here. The floor sits just under the real count so a handful
    // of deletions does not have to move it, while a whole subtree leaving the
    // scan cannot hide under it.
    expect(serverFiles.length).toBeGreaterThanOrEqual(240);
    const names = serverFiles.map(({ file }) => file);
    expect(names).toContain('game.ts'); // the module that owns the three sites
    expect(names).toContain('http/registry.ts'); // ... and one a flat read misses
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  it('no client command anywhere can write a rank or a relic count', () => {
    const writes = serverCode.match(CURATOR_WRITE) ?? [];
    expect(writes, 'only refreshCuratorStanding may write a Curator standing').toHaveLength(6);

    const game = codeOnly(readFileSync(GAME_SRC, 'utf8'));
    const start = game.indexOf('private refreshCuratorStanding(');
    const end = game.indexOf('private async refreshAllHolderTiers(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // Counting the writes INSIDE the refresher, rather than checking each
    // whole-tree match is a substring of it, is what makes containment
    // decisive: three identical `curatorRank =` strings anywhere else in the
    // tree satisfy a substring check while sitting outside the refresher.
    expect(game.slice(start, end).match(CURATOR_WRITE) ?? []).toHaveLength(6);
  });

  it('the terse wire keys are WRITE-ONLY on the server', () => {
    // Count every occurrence of the bare tokens across the tree instead of
    // grepping one hand-listed read spelling. The first form of this pin was
    // `not.toContain('msg.crk')`, blind to `msg['crk']`, `const { crk } = msg`
    // and `payload?.crt` alike, and (being a negative pin over a string that
    // never appeared in the file) it could not have announced its own death
    // either. Three tokens in the whole tree, all three of them the encoder's
    // own writes, leaves room for no inbound read in any spelling: a fourth
    // occurrence reds, and so does deleting an encode.
    const tokens = serverCode.match(/\b(?:crk|cro|crt)\b/g) ?? [];
    const encodes = serverCode.match(/\bout\.(?:crk|cro|crt)\s*=(?!=)/g) ?? [];
    expect(encodes, 'the three identityFields encodes').toHaveLength(3);
    expect(tokens, 'crk/cro/crt may appear ONLY as those three encodes').toHaveLength(3);
  });

  it('the sweep is scheduled on the 60s flair interval (join is the only other entry)', () => {
    // The cadence a NEW surface now depends on: deleting the setInterval
    // registration would leave every suite green while live standings never
    // refreshed after join. Matched over comment-stripped code, so a
    // commented-out copy cannot satisfy it, and anchored on both the callback
    // body and the HOLDER_TIER_REFRESH_MS constant so neither can drift alone.
    const game = codeOnly(readFileSync(GAME_SRC, 'utf8'));
    expect(game).toMatch(
      /this\.holderTierInterval = setInterval\(\(\) => \{\s*void this\.refreshAllHolderTiers\(\);\s*\}, HOLDER_TIER_REFRESH_MS\);/,
    );
    // The VALUE too, or "the 60s cycle" in every doc and comment is a claim
    // no test owns: the registration pin above survives a retune to ten
    // minutes; this line does not.
    expect(game).toMatch(/const HOLDER_TIER_REFRESH_MS = 60_000;/);
  });
});

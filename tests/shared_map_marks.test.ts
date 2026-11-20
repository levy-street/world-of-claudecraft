// The raid map's shared marks, sim layer (src/sim/social/shared_map_marks.ts):
// who may edit (solo, any party member, the raid leader only), where (inside the
// group's own live instance claim), what (symbol 0..7 unique per claim, page and
// bounds), how often (the per-group sim-clock rate window), who sees them (the
// group members standing in that instance copy, nobody else) and when they go
// (party disband, the claim freed or reset).

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { freeInstance } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import {
  canEditSharedMapMarks,
  SHARED_MAP_MARK_EDITS_PER_WINDOW,
  SHARED_MAP_MARK_MAX_ENTRIES,
  SHARED_MAP_MARK_PAGES,
  SharedMapMarks,
} from '../src/sim/social/shared_map_marks';

const DUNGEON = 'hollow_crypt';
const SKULL = 7;
const STAR = 0;

function world() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function party(sim: Sim, ...pids: number[]): void {
  for (let i = 1; i < pids.length; i++) {
    sim.partyInvite(pids[i], pids[0]);
    sim.partyAccept(pids[i]);
  }
}

function claimOf(sim: Sim, pid: number): InstanceSlot {
  const pos = sim.entities.get(pid)?.pos;
  const inst = sim.ctx.instances.find((i) => {
    if (i.partyKey === null || i.exitId === null || !pos) return false;
    const o = instanceOrigin(DUNGEONS[i.dungeonId].index, i.slot);
    return Math.abs(pos.x - o.x) < 200 && Math.abs(pos.z - o.z) < 250;
  });
  if (!inst) throw new Error('player is in no claim');
  return inst;
}

/** Two players in one party, both inside the party's crypt claim. */
function partyInCrypt() {
  const sim = world();
  const a = sim.addPlayer('warrior', 'Aleph');
  const b = sim.addPlayer('mage', 'Bet');
  party(sim, a, b);
  expect(sim.enterDungeon(DUNGEON, a)).toBe(true);
  expect(sim.enterDungeon(DUNGEON, b)).toBe(true);
  return { sim, a, b };
}

// The store lives on the private Targeting slice; the server reaches it through
// the public Sim delegates, and these tests read its view and size directly.
function store(sim: Sim): SharedMapMarks {
  return (sim as unknown as { targeting: { mapMarks: SharedMapMarks } }).targeting.mapMarks;
}
const marks = (sim: Sim, pid: number) => store(sim).viewFor(pid);

describe('shared map marks: who may edit', () => {
  it('the rule: solo and party members always, a raid only its leader', () => {
    expect(canEditSharedMapMarks(null, 5)).toBe(true);
    expect(canEditSharedMapMarks({ leader: 1, raid: false }, 5)).toBe(true);
    expect(canEditSharedMapMarks({ leader: 1, raid: true }, 1)).toBe(true);
    expect(canEditSharedMapMarks({ leader: 1, raid: true }, 5)).toBe(false);
  });

  it('a solo player marks their own instance and sees it', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(sim.enterDungeon(DUNGEON, a)).toBe(true);
    sim.placeSharedMapMark(0, 3.14, -12.06, SKULL, a);
    expect(marks(sim, a)).toEqual([{ symbol: SKULL, page: 0, x: 3.1, z: -12.1 }]);
  });

  it('in a party any member places, and the whole party in the instance sees it', () => {
    const { sim, a, b } = partyInCrypt();
    sim.placeSharedMapMark(0, 10, 20, STAR, b);
    expect(marks(sim, a)).toEqual([{ symbol: STAR, page: 0, x: 10, z: 20 }]);
    expect(marks(sim, b)).toEqual(marks(sim, a));
  });

  it('in a raid only the leader places or clears; a member reads only', () => {
    const { sim, a, b } = partyInCrypt();
    // (The convert command needs five members; the group shape is what counts here.)
    const group = sim.partyOf(a);
    if (!group) throw new Error('no party');
    group.raid = true;
    sim.placeSharedMapMark(0, 10, 20, STAR, b);
    expect(marks(sim, b)).toEqual([]);
    sim.placeSharedMapMark(0, 10, 20, SKULL, a);
    expect(marks(sim, b)).toEqual([{ symbol: SKULL, page: 0, x: 10, z: 20 }]);
    sim.clearSharedMapMarks(null, b);
    expect(marks(sim, b)).toHaveLength(1);
    // Leadership moves the right with it.
    sim.partyPromote(b, a);
    sim.clearSharedMapMarks(SKULL, b);
    expect(marks(sim, a)).toEqual([]);
  });

  it('a player outside any instance, or in another group, cannot edit', () => {
    const { sim, a } = partyInCrypt();
    const c = sim.addPlayer('rogue', 'Gimel'); // in the open world
    sim.placeSharedMapMark(0, 1, 1, STAR, c);
    expect(store(sim).size).toBe(0);
    // An outsider in their OWN crypt claim marks only that claim.
    expect(sim.enterDungeon(DUNGEON, c)).toBe(true);
    expect(claimOf(sim, c)).not.toBe(claimOf(sim, a));
    sim.placeSharedMapMark(0, 1, 1, STAR, c);
    expect(marks(sim, c)).toHaveLength(1);
    expect(marks(sim, a)).toEqual([]);
  });
});

describe('shared map marks: the marks themselves', () => {
  it('a symbol is unique per instance: placing it again moves it', () => {
    const { sim, a } = partyInCrypt();
    sim.placeSharedMapMark(0, 1, 1, SKULL, a);
    sim.placeSharedMapMark(1, -5, 8, SKULL, a);
    expect(marks(sim, a)).toEqual([{ symbol: SKULL, page: 1, x: -5, z: 8 }]);
  });

  it('holds at most the eight symbols; anything outside 0..7 is refused', () => {
    const { sim, a } = partyInCrypt();
    for (let s = 0; s < 8; s++) sim.placeSharedMapMark(0, s, s, s, a);
    expect(marks(sim, a)).toHaveLength(8);
    sim.placeSharedMapMark(0, 1, 1, 8, a);
    sim.placeSharedMapMark(0, 1, 1, -1, a);
    sim.placeSharedMapMark(0, 1, 1, 2.5, a);
    expect(marks(sim, a)).toHaveLength(8);
  });

  it('refuses a bad page or a point outside the instance footprint', () => {
    const { sim, a } = partyInCrypt();
    sim.placeSharedMapMark(SHARED_MAP_MARK_PAGES, 1, 1, STAR, a);
    sim.placeSharedMapMark(-1, 1, 1, STAR, a);
    sim.placeSharedMapMark(0.5, 1, 1, STAR, a);
    sim.placeSharedMapMark(0, 5000, 1, STAR, a);
    sim.placeSharedMapMark(0, 1, -250, STAR, a);
    sim.placeSharedMapMark(0, Number.NaN, 1, STAR, a);
    sim.placeSharedMapMark(0, 1, Number.POSITIVE_INFINITY, STAR, a);
    expect(marks(sim, a)).toEqual([]);
  });

  it('clears one symbol, or all of them', () => {
    const { sim, a, b } = partyInCrypt();
    sim.placeSharedMapMark(0, 1, 1, STAR, a);
    sim.placeSharedMapMark(0, 2, 2, SKULL, a);
    sim.clearSharedMapMarks(STAR, b);
    expect(marks(sim, a).map((m) => m.symbol)).toEqual([SKULL]);
    sim.clearSharedMapMarks(null, a);
    expect(marks(sim, b)).toEqual([]);
  });

  it('rate-limits a group per sim-clock window, then recovers', () => {
    const { sim, a, b } = partyInCrypt();
    for (let i = 0; i < SHARED_MAP_MARK_EDITS_PER_WINDOW; i++)
      sim.placeSharedMapMark(0, i, 0, i % 8, i % 2 ? a : b);
    sim.placeSharedMapMark(0, 50, 50, SKULL, a);
    expect(marks(sim, a).find((m) => m.symbol === SKULL)?.x).not.toBe(50);
    // Clearing spends the same window (an emptied entry keeps it).
    sim.clearSharedMapMarks(null, a);
    expect(marks(sim, a).length).toBeGreaterThan(0);
    for (let t = 0; t < 4 * 20 + 1; t++) sim.tick();
    sim.placeSharedMapMark(0, 50, 50, SKULL, a);
    expect(marks(sim, a).find((m) => m.symbol === SKULL)?.x).toBe(50);
  });

  it('draws no rng (cosmetic state)', () => {
    const { sim, a } = partyInCrypt();
    const rng = sim.ctx.rng as unknown as Record<string, unknown>;
    const before = JSON.stringify(rng);
    sim.placeSharedMapMark(0, 1, 1, STAR, a);
    sim.clearSharedMapMarks(null, a);
    expect(JSON.stringify(rng)).toBe(before);
  });
});

describe('shared map marks: who sees them, and when they go', () => {
  it('a member who leaves the instance stops seeing them, and sees them again on return', () => {
    const { sim, a, b } = partyInCrypt();
    sim.placeSharedMapMark(0, 1, 1, STAR, a);
    expect(sim.leaveDungeon(b)).toBe(true);
    expect(marks(sim, b)).toEqual([]);
    expect(sim.sharedMapMarksWireFor(b)).toBe('null');
    expect(sim.enterDungeon(DUNGEON, b)).toBe(true);
    expect(marks(sim, b)).toHaveLength(1);
  });

  it('the party disbanding clears its marks', () => {
    const { sim, a, b } = partyInCrypt();
    sim.placeSharedMapMark(0, 1, 1, STAR, a);
    expect(store(sim).size).toBe(1);
    sim.partyLeave(b); // two-player party: disbands
    expect(sim.partyOf(a)).toBeNull();
    expect(store(sim).size).toBe(0);
    expect(marks(sim, a)).toEqual([]);
  });

  it('a freed (reset) claim hides its marks at once and is pruned on the next edit', () => {
    const { sim, a } = partyInCrypt();
    sim.placeSharedMapMark(0, 1, 1, STAR, a);
    const old = claimOf(sim, a);
    freeInstance(sim.ctx, old);
    expect(marks(sim, a)).toEqual([]);
    expect(store(sim).size).toBe(1);
    // Re-entering claims a fresh run: none of the old marks, and the old entry goes.
    sim.leaveDungeon(a);
    expect(sim.enterDungeon(DUNGEON, a)).toBe(true);
    expect(marks(sim, a)).toEqual([]);
    sim.placeSharedMapMark(0, 2, 2, SKULL, a);
    expect(store(sim).size).toBe(1);
    expect(marks(sim, a)).toEqual([{ symbol: SKULL, page: 0, x: 2, z: 2 }]);
  });

  it('the wire row is [symbol, page, x, z], serialized once and shared by the group', () => {
    const { sim, a, b } = partyInCrypt();
    expect(sim.sharedMapMarksWireFor(a)).toBe('null');
    sim.placeSharedMapMark(1, 4.25, -3, SKULL, a);
    const wire = sim.sharedMapMarksWireFor(a);
    expect(JSON.parse(wire)).toEqual([[SKULL, 1, 4.3, -3]]);
    expect(sim.sharedMapMarksWireFor(b)).toBe(wire);
    sim.clearSharedMapMarks(null, a);
    expect(sim.sharedMapMarksWireFor(b)).toBe('[]');
  });

  it('the offline world reads the local player through IWorld', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: false });
    expect(sim.enterDungeon(DUNGEON)).toBe(true);
    sim.placeSharedMapMark(0, 6, 7, STAR);
    expect(sim.sharedMapMarks()).toEqual([{ symbol: STAR, page: 0, x: 6, z: 7 }]);
    sim.clearSharedMapMarks(STAR);
    expect(sim.sharedMapMarks()).toEqual([]);
  });

  it('caps the store as a whole: past the cap a new claim is refused', () => {
    // A bare seam over more live claims than the cap, one solo player standing
    // in each (the Sim never runs this many slots; the cap is the backstop).
    const n = SHARED_MAP_MARK_MAX_ENTRIES + 1;
    const index = DUNGEONS[DUNGEON].index;
    const instances = Array.from({ length: n }, (_, slot) => ({
      dungeonId: DUNGEON,
      slot,
      partyKey: `solo:${slot + 1}`,
      exitId: 100000 + slot,
    }));
    const pos = (pid: number) => {
      const o = instanceOrigin(index, pid - 1);
      return { x: o.x, y: 0, z: o.z };
    };
    const ctx = {
      time: 0,
      instances,
      players: { has: () => true },
      entities: { get: (pid: number) => ({ pos: pos(pid) }) },
      resolve: (pid: number) => ({ meta: { entityId: pid }, e: { pos: pos(pid) } }),
      partyOf: () => null,
      instanceKeyFor: (pid: number) => `solo:${pid}`,
    } as unknown as SimContext;
    const mm = new SharedMapMarks(ctx);
    for (let pid = 1; pid <= SHARED_MAP_MARK_MAX_ENTRIES; pid++)
      expect(mm.place(0, 1, 1, STAR, pid)).toBe(true);
    expect(mm.size).toBe(SHARED_MAP_MARK_MAX_ENTRIES);
    expect(mm.place(0, 1, 1, STAR, n)).toBe(false);
    expect(mm.viewFor(n)).toEqual([]);
    // A freed claim makes room again (pruned on the next new entry).
    instances[0].exitId = null as unknown as number;
    expect(mm.place(0, 1, 1, STAR, n)).toBe(true);
    expect(mm.size).toBe(SHARED_MAP_MARK_MAX_ENTRIES);
  });
});

// The Wildheart Basin route contract (docs/design/dungeon-rework/
// wildheart_basin.md section 3, "no skipping"): walk the walkable graph of the
// open-air caldera from the Idol Maw, with the gates open exactly as the dead
// packs and bosses allow, and prove every pack and boss is unreachable until
// the packs before it die; that BOTH wings open on the ford; that the Sunbone
// Causeway's thorns recede only once both wing bosses are dead; and that the
// cleared route never spills into the gorge.
//
// The walk is a flood fill over a one-yard grid that asks the REAL collision
// seam (colliders.ts isBlocked, which reads the field's generated cliffs,
// props and the per-slot gate view). It ignores height, so a missing cliff
// wall would let it spill into the gorge, which the last cases forbid.

import { beforeEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  WILDHEART_BASIN_GATES,
  WILDHEART_BASIN_PACKS,
  WILDHEART_BASIN_PATROLS,
  WILDHEART_BASIN_SPAWNS,
} from '../src/sim/content/wildheart';
import {
  BASALT_STEPS,
  BEAST_PIT_HOLES,
  RIVER_FORD,
  SUN_GLYPHS,
  WILDHEART_BASIN_ANCHORS,
  WILDHEART_BASIN_FIELD,
  WILDHEART_HEIGHTS,
} from '../src/sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { authoredFieldHeight, instancedFieldHeight } from '../src/sim/instances/authored_field';
import {
  clearDungeonGateStateForTest,
  setOpenDungeonGates,
} from '../src/sim/instances/dungeon_gate_state';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const DUNGEON = DUNGEONS.wildheart_basin;
const SLOT = 5;
const O = instanceOrigin(DUNGEON.index, SLOT);
const FIELD = WILDHEART_BASIN_FIELD;
const { minX, maxX, minZ, maxZ } = FIELD.bounds;
const W = maxX - minX + 1;
const H = maxZ - minZ + 1;

function cell(x: number, z: number): number {
  return (Math.round(z) - minZ) * W + (Math.round(x) - minX);
}

/** Flood fill from the arrival point with the given gates open. */
function reachable(open: string[]): Uint8Array {
  setOpenDungeonGates(O.x, O.z, open);
  const seen = new Uint8Array(W * H);
  const blocked = new Int8Array(W * H).fill(-1);
  const isFree = (x: number, z: number): boolean => {
    const i = cell(x, z);
    if (blocked[i] === -1) blocked[i] = isBlocked(SEED, O.x + x, O.z + z, 0.5) ? 1 : 0;
    return blocked[i] === 0;
  };
  const start = DUNGEON.entry;
  const queue: number[] = [Math.round(start.x), Math.round(start.z)];
  seen[cell(start.x, start.z)] = 1;
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q];
    const z = queue[q + 1];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
      const i = cell(nx, nz);
      if (seen[i] || !isFree(nx, nz)) continue;
      seen[i] = 1;
      queue.push(nx, nz);
    }
  }
  return seen;
}

/** Is a spawn standing inside the reached region (its own or a next cell)? */
function spawnReached(seen: Uint8Array, x: number, z: number): boolean {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = Math.round(x) + dx;
      const cz = Math.round(z) + dz;
      if (cx < minX || cx > maxX || cz < minZ || cz > maxZ) continue;
      if (seen[cell(cx, cz)]) return true;
    }
  }
  return false;
}

/** Packs (or, for a pack-less spawn, the mob id) whose placement is reached. */
function reachedPacks(seen: Uint8Array): string[] {
  const out = new Set<string>();
  for (const s of WILDHEART_BASIN_SPAWNS) {
    // A patrol is reachable when any point of its loop is.
    const pts = s.patrol ? s.patrol.points : [{ x: s.x, z: s.z }];
    if (!pts.some((p) => spawnReached(seen, p.x, p.z))) continue;
    out.add(s.packId ?? s.mobId);
  }
  return [...out].sort();
}

/** The gates a set of dead packs and bosses opens (seals idle: nobody engaged). */
function openGates(dead: Set<string>): string[] {
  return WILDHEART_BASIN_GATES.filter(
    (g) => (g.packs ?? []).every((p) => dead.has(p)) && (g.bosses ?? []).every((b) => dead.has(b)),
  ).map((g) => g.id);
}

const BEASTMASTER = 'wildheart_beastmaster';
const JAGUAR = 'fanglord_jaguar';
const GORGEBLOOM = 'the_gorgebloom';
const ZULGAR = 'wildheart_high_priest';
const FORD = ['g1', 'g2', 'g3', 'pa'];
const WEST = ['g4', 'g5', 'pb'];
const EAST = ['g6', 'g7'];
const ISLAND = ['g8', 'g9', 'pc'];
const NORTH = ['g10', 'g11', 'g12', 'g13', 'pd'];

/** Everything dead up to and including a stage. */
function upTo(...stages: (readonly string[])[]): Set<string> {
  return new Set(stages.flat());
}

describe('Wildheart Basin route contract: every pack is mandatory', () => {
  beforeEach(() => clearDungeonGateStateForTest());

  it('lists 13 groups and 4 patrols, each a real pack of the spawn list', () => {
    expect(WILDHEART_BASIN_PACKS).toHaveLength(17);
    expect(WILDHEART_BASIN_PATROLS).toHaveLength(4);
    const groups = WILDHEART_BASIN_PACKS.filter(
      (p) => !(WILDHEART_BASIN_PATROLS as readonly string[]).includes(p),
    );
    expect(groups).toHaveLength(13);
    const packs = new Set(WILDHEART_BASIN_SPAWNS.map((s) => s.packId));
    for (const p of WILDHEART_BASIN_PACKS) expect(packs.has(p), p).toBe(true);
    for (const p of WILDHEART_BASIN_PATROLS) {
      const members = WILDHEART_BASIN_SPAWNS.filter((s) => s.packId === p);
      expect(members.length, p).toBeGreaterThanOrEqual(1);
      for (const m of members) expect(m.patrol, `${p} ${m.mobId}`).toBeDefined();
    }
    // Patrol A is the Great Saurian alone (the showpiece).
    expect(WILDHEART_BASIN_SPAWNS.filter((s) => s.packId === 'pa').map((s) => s.mobId)).toEqual([
      'great_saurian',
    ]);
    // Every group is three to five mobs (the design's section 4.2 table).
    for (const p of groups) {
      const n = WILDHEART_BASIN_SPAWNS.filter((s) => s.packId === p).length;
      expect(n, p).toBeGreaterThanOrEqual(3);
      expect(n, p).toBeLessThanOrEqual(5);
    }
    // Every placed mob resolves, and no placement repeats a spot.
    const spots = new Set<string>();
    for (const s of WILDHEART_BASIN_SPAWNS) {
      expect(MOBS[s.mobId], s.mobId).toBeDefined();
      if (s.patrol) continue;
      const key = `${s.x},${s.z}`;
      expect(spots.has(key), key).toBe(false);
      spots.add(key);
    }
  });

  it('matches the design roster: about 58 trash mobs, the Saurian and the three bosses', () => {
    const trash = WILDHEART_BASIN_SPAWNS.filter(
      (s) => s.packId !== undefined && s.packId !== 'pa' && s.packId !== 'beastmaster',
    );
    expect(trash.length).toBe(58);
    // The design's section 4.2 table, pack by pack.
    const roster = (pack: string) =>
      WILDHEART_BASIN_SPAWNS.filter((s) => s.packId === pack)
        .map((s) => s.mobId)
        .sort();
    expect(roster('g1')).toEqual([...Array(4).fill('basin_raptor'), 'wildheart_stalker']);
    expect(roster('g3')).toEqual([
      'sunbone_totem_binder',
      'wildheart_stalker',
      'wildheart_stalker',
    ]);
    expect(roster('g6')).toEqual(['spore_toad', 'spore_toad', 'spore_toad', 'vine_lasher']);
    expect(roster('pb')).toEqual(Array(4).fill('basin_raptor'));
    expect(roster('pd')).toEqual(['wildheart_stalker', 'wildheart_stalker']);
    // The Beastmaster spawns ONCE now (no longer a twice-spawned rare), beside
    // his jaguar in one pack; the Gorgebloom and Zulgar once each.
    for (const boss of [BEASTMASTER, JAGUAR, GORGEBLOOM, ZULGAR, 'great_saurian']) {
      expect(
        WILDHEART_BASIN_SPAWNS.filter((s) => s.mobId === boss),
        boss,
      ).toHaveLength(1);
    }
    expect(MOBS[BEASTMASTER].rare).toBeUndefined();
    expect(roster('beastmaster')).toEqual([JAGUAR, BEASTMASTER].sort());
  });

  it('with nothing dead, only the Fern Steps and the River Ford are reachable', () => {
    const seen = reachable(openGates(new Set()));
    expect(reachedPacks(seen)).toEqual([...FORD].sort());
  });

  it('the Twin Vine Bridges weave only when G1, G2, G3 and the Saurian are dead', () => {
    for (const missing of FORD) {
      const dead = new Set(FORD.filter((p) => p !== missing));
      const packs = reachedPacks(reachable(openGates(dead)));
      for (const p of [...WEST, ...EAST]) expect(packs, `${missing} alive`).not.toContain(p);
    }
    const packs = reachedPacks(reachable(openGates(upTo(FORD))));
    expect(packs).toEqual(expect.arrayContaining([...WEST, ...EAST]));
    for (const p of [BEASTMASTER, GORGEBLOOM, ...ISLAND, ...NORTH, ZULGAR])
      expect(packs).not.toContain(p);
  });

  it('each wing boss waits behind its thorn wall until its packs die', () => {
    const base = upTo(FORD);
    for (const [wing, pack] of [
      [WEST, 'beastmaster'],
      [EAST, GORGEBLOOM],
    ] as const) {
      for (const missing of wing) {
        const dead = upTo(
          [...base],
          wing.filter((p) => p !== missing),
        );
        expect(reachedPacks(reachable(openGates(dead))), `${missing} alive`).not.toContain(pack);
      }
      expect(reachedPacks(reachable(openGates(upTo([...base], wing))))).toContain(pack);
    }
  });

  it('the Sunbone Causeway thorns recede only when BOTH wing bosses are dead', () => {
    const wings = upTo(FORD, WEST, EAST);
    for (const alive of [BEASTMASTER, GORGEBLOOM]) {
      const dead = upTo(
        [...wings],
        [BEASTMASTER, JAGUAR, GORGEBLOOM].filter((b) => b !== alive),
      );
      const packs = reachedPacks(reachable(openGates(dead)));
      for (const p of ISLAND) expect(packs, `${alive} alive`).not.toContain(p);
    }
    const packs = reachedPacks(
      reachable(openGates(upTo([...wings], [BEASTMASTER, JAGUAR, GORGEBLOOM]))),
    );
    expect(packs).toEqual(expect.arrayContaining(ISLAND));
    for (const p of NORTH) expect(packs).not.toContain(p);
  });

  it('the Convergence Stair ward needs the island packs and its patrol', () => {
    const base = upTo(FORD, WEST, EAST, [BEASTMASTER, JAGUAR, GORGEBLOOM]);
    for (const missing of ISLAND) {
      const dead = upTo(
        [...base],
        ISLAND.filter((p) => p !== missing),
      );
      const packs = reachedPacks(reachable(openGates(dead)));
      for (const p of NORTH) expect(packs, `${missing} alive`).not.toContain(p);
    }
    const packs = reachedPacks(reachable(openGates(upTo([...base], ISLAND))));
    expect(packs).toEqual(expect.arrayContaining(NORTH));
    expect(packs).not.toContain(ZULGAR);
  });

  it('Zulgar waits behind the Shrine Ward until every northern pack dies', () => {
    const base = upTo(FORD, WEST, EAST, [BEASTMASTER, JAGUAR, GORGEBLOOM], ISLAND);
    for (const missing of NORTH) {
      const dead = upTo(
        [...base],
        NORTH.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), `${missing} alive`).not.toContain(ZULGAR);
    }
    expect(reachedPacks(reachable(openGates(upTo([...base], NORTH))))).toContain(ZULGAR);
  });

  it('a fully cleared route reaches every placement and never the gorge', () => {
    const dead = new Set<string>([
      ...WILDHEART_BASIN_GATES.flatMap((g) => [...(g.packs ?? []), ...(g.bosses ?? [])]),
    ]);
    const seen = reachable(openGates(dead));
    for (const s of WILDHEART_BASIN_SPAWNS) {
      expect(spawnReached(seen, s.x, s.z), `${s.mobId} at ${s.x},${s.z}`).toBe(true);
    }
    let voidCells = 0;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!seen[cell(x, z)]) continue;
        if (authoredFieldHeight(FIELD, x, z) <= FIELD.voidHeight) voidCells++;
      }
    }
    expect(voidCells).toBe(0);
    // The boss exit portal stands in the jaguar's maw past the terrace's
    // north edge, on reached walkable floor (the jaw behind the front teeth).
    const portal = DUNGEON.bossExitPortal;
    expect(portal).toBeDefined();
    if (portal) {
      expect(spawnReached(seen, portal.x, portal.z)).toBe(true);
      expect(portal.z).toBeGreaterThan(236);
      expect(authoredFieldHeight(FIELD, portal.x, portal.z)).toBeGreaterThan(
        WILDHEART_HEIGHTS.shrineTerrace - 1,
      );
    }
  });

  it('keeps the whole walkable field inside the slot footprint the claim counts', () => {
    expect(Math.max(Math.abs(minX), Math.abs(maxX))).toBeLessThan(120);
    expect(Math.max(Math.abs(minZ), Math.abs(maxZ))).toBeLessThan(250);
  });

  it('keeps each patrol walk clear of the held packs (it passes them, never through them)', () => {
    const held = WILDHEART_BASIN_SPAWNS.filter((s) => !s.patrol && s.packId);
    for (const s of WILDHEART_BASIN_SPAWNS) {
      if (!s.patrol) continue;
      const pts = s.patrol.points;
      let nearest = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          for (const h of held) nearest = Math.min(nearest, Math.hypot(h.x - x, h.z - z));
        }
      }
      expect(nearest, `${s.packId} ${s.mobId}`).toBeGreaterThanOrEqual(7.5);
    }
  });

  it('every patrol loop stays on walkable ground, clear of props', () => {
    for (const s of WILDHEART_BASIN_SPAWNS) {
      if (!s.patrol) continue;
      const pts = s.patrol.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          expect(
            authoredFieldHeight(FIELD, x, z),
            `${s.packId} over the gorge at ${x},${z}`,
          ).toBeGreaterThan(FIELD.voidHeight);
          expect(isBlocked(SEED, O.x + x, O.z + z, 0.5), `${s.packId} at ${x},${z}`).toBe(false);
        }
      }
    }
  });

  it('stands every prop on a walkable floor (a collider never hangs over the gorge)', () => {
    for (const p of FIELD.props) {
      if (p.kind === 'wb_idol_maw') continue; // the render-only jaw over the landing's lip
      expect(
        authoredFieldHeight(FIELD, p.x, p.z),
        `${p.kind} at ${p.x},${p.z} over the gorge`,
      ).toBeGreaterThan(FIELD.voidHeight);
    }
  });

  it('the Great Saurian wades the ford shallows, never the basalt steps', () => {
    const saurian = WILDHEART_BASIN_SPAWNS.find((s) => s.mobId === 'great_saurian');
    expect(saurian?.patrol).toBeDefined();
    for (const p of saurian?.patrol?.points ?? []) {
      expect(p.x).toBeGreaterThan(RIVER_FORD.x0);
      expect(p.x).toBeLessThan(RIVER_FORD.x1);
      expect(p.z).toBeGreaterThan(RIVER_FORD.z0);
      expect(p.z).toBeLessThan(RIVER_FORD.z1);
      expect(authoredFieldHeight(FIELD, p.x, p.z)).toBe(RIVER_FORD.h);
      for (const step of BASALT_STEPS)
        expect(Math.hypot(p.x - step.x, p.z - step.z)).toBeGreaterThan(step.r + 6);
    }
  });

  it('the arrival stands on the Idol Maw Landing, above and clear of every pack', () => {
    const e = WILDHEART_BASIN_ANCHORS.entry;
    expect(authoredFieldHeight(FIELD, e.x, e.z)).toBe(WILDHEART_HEIGHTS.landing);
    for (const s of WILDHEART_BASIN_SPAWNS) {
      const pts = s.patrol ? s.patrol.points : [{ x: s.x, z: s.z }];
      for (const p of pts) {
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        expect(d, `${s.mobId} at ${p.x},${p.z}`).toBeGreaterThan(35);
      }
    }
  });

  it('floors every area at its designed height (one floor height per point)', () => {
    const h = (x: number, z: number) => authoredFieldHeight(FIELD, x, z);
    const A = WILDHEART_BASIN_ANCHORS;
    const Hd = WILDHEART_HEIGHTS;
    expect(h(A.landing.x, A.landing.z)).toBe(Hd.landing);
    expect(h(A.fernLanding.x, A.fernLanding.z)).toBe(Hd.fernLanding);
    expect(h(A.southBank.x, A.southBank.z)).toBe(Hd.bank);
    expect(h(A.ford.x, A.ford.z)).toBe(Hd.ford);
    expect(h(A.basaltSteps.x + 2, A.basaltSteps.z)).toBe(2.4);
    expect(h(A.northBank.x, A.northBank.z)).toBe(Hd.bank);
    expect(h(A.huntLower.x, A.huntLower.z)).toBe(Hd.huntLower);
    expect(h(A.huntUpper.x, A.huntUpper.z)).toBe(Hd.huntUpper);
    expect(h(A.beastPits.x, A.beastPits.z + 18)).toBe(Hd.beastPits);
    for (const pit of BEAST_PIT_HOLES) expect(h(pit.x, pit.z)).toBe(Hd.pit);
    expect(h(A.waterfallLedge.x, A.waterfallLedge.z)).toBe(Hd.ledge);
    expect(h(A.behindFalls.x, A.behindFalls.z)).toBe(Hd.behindFalls);
    expect(h(A.weepingFalls.x - 12, A.weepingFalls.z)).toBe(Hd.fallsTerrace);
    expect(h(A.island.x, A.island.z)).toBe(Hd.island);
    expect(h(A.convergence.x, A.convergence.z)).toBe(Hd.convergence);
    expect(h(A.shrineLanding1.x, A.shrineLanding1.z)).toBe(Hd.shrineLanding1);
    expect(h(A.shrineLanding2.x, A.shrineLanding2.z)).toBe(Hd.shrineLanding2);
    expect(h(A.shrineTerrace.x, A.shrineTerrace.z)).toBe(Hd.shrineTerrace);
    for (const g of SUN_GLYPHS) expect(h(g.x, g.z)).toBe(Hd.shrineTerrace);
    // The gorge between the terraces drops to the void.
    expect(h(0, -60 - 40)).toBe(Hd.ford);
    expect(h(30, -60)).toBe(FIELD.voidHeight);
  });

  it('the Wildheart interior rides the authored field: the world ground IS the record', () => {
    const height = instancedFieldHeight('wildheart');
    expect(height).not.toBeNull();
    for (const [x, z] of [
      [0, -222],
      [-34, -180],
      [-18, -109],
      [-86, 40],
      [84, 42],
      [0, 16],
      [0, 216],
    ] as const) {
      expect(height?.(x, z)).toBe(authoredFieldHeight(FIELD, x, z));
      expect(groundHeight(O.x + x, O.z + z, SEED)).toBe(authoredFieldHeight(FIELD, x, z));
    }
  });

  it('gate state is per slot: opening slot 5 leaves slot 6 shut', () => {
    setOpenDungeonGates(O.x, O.z, ['sunbone_causeway_thorns']);
    const o6 = instanceOrigin(DUNGEON.index, SLOT + 1);
    expect(isBlocked(SEED, O.x, O.z - 76, 0.5)).toBe(false);
    expect(isBlocked(SEED, o6.x, o6.z - 76, 0.5)).toBe(true);
  });
});

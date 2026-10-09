// The Gravewyrm Sanctum route contract (docs/design/dungeon-rework/
// gravewyrm_sanctum.md section 4, "nothing can be skipped"): walk the walkable
// graph of the glacier cirque from the Gate Landing, with the gates open
// exactly as the dead packs and bosses allow, and prove every pack and boss is
// unreachable until the packs before it die; that BOTH wings open at the Rime
// Gate; that the Chain Stairs rise only with both wings clear; that the Chain
// Bridge falls only with Korgath dead; and that the cleared route never spills
// into the crevasses.
//
// The walk is a flood fill over a one-yard grid that asks the REAL collision
// seam (colliders.ts isBlocked, which reads the field's generated cliffs,
// props and the per-slot gate view). It ignores height, so a missing cliff
// wall would let it spill into a crevasse, which the last cases forbid.

import { beforeEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  GRAVEWYRM_SANCTUM_GATES,
  GRAVEWYRM_SANCTUM_PACKS,
  GRAVEWYRM_SANCTUM_PATROLS,
  GRAVEWYRM_SANCTUM_SPAWNS,
  TUSKER_ROAD,
} from '../src/sim/content/gravewyrm_sanctum';
import {
  GRAVEWYRM_HEIGHTS,
  GRAVEWYRM_SANCTUM_ANCHORS,
  GRAVEWYRM_SANCTUM_FIELD,
  LAKE_PLATES,
  SEAL_PILLARS,
  STORY_MARKERS,
  THAW_POOLS,
  WYRMS_HOLLOW,
} from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { authoredFieldHeight, instancedFieldHeight } from '../src/sim/instances/authored_field';
import {
  clearDungeonGateStateForTest,
  setOpenDungeonGates,
} from '../src/sim/instances/dungeon_gate_state';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const DUNGEON = DUNGEONS.gravewyrm_sanctum;
const SLOT = 5;
const O = instanceOrigin(DUNGEON.index, SLOT);
const FIELD = GRAVEWYRM_SANCTUM_FIELD;
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
  for (const s of GRAVEWYRM_SANCTUM_SPAWNS) {
    const pts = s.patrol ? s.patrol.points : [{ x: s.x, z: s.z }];
    if (!pts.some((p) => spawnReached(seen, p.x, p.z))) continue;
    out.add(s.packId ?? s.mobId);
  }
  return [...out].sort();
}

/** The gates a set of dead packs and bosses opens (seals idle: nobody engaged). */
function openGates(dead: Set<string>): string[] {
  return GRAVEWYRM_SANCTUM_GATES.filter(
    (g) => (g.packs ?? []).every((p) => dead.has(p)) && (g.bosses ?? []).every((b) => dead.has(b)),
  ).map((g) => g.id);
}

const KORGATH = 'korgath_the_bound';
const VELKHAR = 'grand_necromancer_velkhar';
const KORZUL = 'korzul_the_gravewyrm';
const ROAD = ['g1', 'g2', 'g3', 'pa'];
const WEST = ['g4', 'g5', 'pb'];
const EAST = ['g6', 'g7'];
const WORKS = ['g8', 'g9', 'g10', 'pc'];
const SHORE = ['g11', 'g12', 'pd'];

function upTo(...stages: (readonly string[])[]): Set<string> {
  return new Set(stages.flat());
}

describe('Gravewyrm Sanctum route contract: every pack is mandatory', () => {
  beforeEach(() => clearDungeonGateStateForTest());

  it('lists 12 groups and 4 patrols, each a real pack of the spawn list', () => {
    expect(GRAVEWYRM_SANCTUM_PACKS).toHaveLength(16);
    expect(GRAVEWYRM_SANCTUM_PATROLS).toHaveLength(4);
    const groups = GRAVEWYRM_SANCTUM_PACKS.filter(
      (p) => !(GRAVEWYRM_SANCTUM_PATROLS as readonly string[]).includes(p),
    );
    expect(groups).toHaveLength(12);
    const packs = new Set(GRAVEWYRM_SANCTUM_SPAWNS.map((s) => s.packId));
    for (const p of GRAVEWYRM_SANCTUM_PACKS) expect(packs.has(p), p).toBe(true);
    for (const p of GRAVEWYRM_SANCTUM_PATROLS) {
      const members = GRAVEWYRM_SANCTUM_SPAWNS.filter((s) => s.packId === p);
      expect(members.length, p).toBeGreaterThanOrEqual(1);
      for (const m of members) expect(m.patrol, `${p} ${m.mobId}`).toBeDefined();
    }
    // Patrol A is the Sledge Tusker alone (the showpiece).
    expect(GRAVEWYRM_SANCTUM_SPAWNS.filter((s) => s.packId === 'pa').map((s) => s.mobId)).toEqual([
      'sledge_tusker',
    ]);
    const spots = new Set<string>();
    for (const s of GRAVEWYRM_SANCTUM_SPAWNS) {
      expect(MOBS[s.mobId], s.mobId).toBeDefined();
      if (s.patrol) continue;
      const key = `${s.x},${s.z}`;
      expect(spots.has(key), key).toBe(false);
      spots.add(key);
    }
  });

  it('matches the design roster pack by pack (section 5.2)', () => {
    const roster = (pack: string) =>
      GRAVEWYRM_SANCTUM_SPAWNS.filter((s) => s.packId === pack)
        .map((s) => s.mobId)
        .sort();
    expect(roster('g1')).toEqual(
      ['sanctum_boneguard', 'sanctum_boneguard', 'broodsworn_thawcaller'].sort(),
    );
    expect(roster('g2')).toEqual(
      ['ogre_sledge_hauler', 'broodsworn_goadsmith', 'broodsworn_goadsmith'].sort(),
    );
    expect(roster('g3')).toEqual(['broodsworn_pyre_tender', ...Array(4).fill('rime_whelp')].sort());
    expect(roster('g4')).toEqual(
      ['glacier_splinter', 'glacier_splinter', 'sanctum_drakonid'].sort(),
    );
    expect(roster('g5')).toEqual(
      [
        'broodsworn_thawcaller',
        'sanctum_boneguard',
        'sanctum_boneguard',
        'broodsworn_pyre_tender',
      ].sort(),
    );
    expect(roster('pb')).toEqual([...Array(4).fill('rime_whelp'), 'sanctum_drakonid'].sort());
    expect(roster('g6')).toEqual(
      ['ogre_sledge_hauler', 'broodsworn_goadsmith', 'broodsworn_thawcaller'].sort(),
    );
    expect(roster('g7')).toEqual(
      ['sanctum_drakonid', 'sanctum_drakonid', 'glacier_splinter'].sort(),
    );
    expect(roster('g8')).toEqual(
      [
        'broodsworn_goadsmith',
        'broodsworn_goadsmith',
        'broodsworn_pyre_tender',
        'ogre_sledge_hauler',
      ].sort(),
    );
    expect(roster('g9')).toEqual(
      [...Array(4).fill('rime_whelp'), 'broodsworn_thawcaller', 'broodsworn_thawcaller'].sort(),
    );
    expect(roster('g10')).toEqual(
      ['sanctum_boneguard', 'sanctum_boneguard', 'sanctum_drakonid', 'glacier_splinter'].sort(),
    );
    expect(roster('pc')).toEqual(
      ['broodsworn_goadsmith', 'sanctum_boneguard', 'sanctum_boneguard'].sort(),
    );
    expect(roster('g11')).toEqual(
      ['sanctum_drakonid', 'sanctum_drakonid', ...Array(4).fill('rime_whelp')].sort(),
    );
    expect(roster('g12')).toEqual(
      [
        'ogre_sledge_hauler',
        'broodsworn_thawcaller',
        'broodsworn_pyre_tender',
        'glacier_splinter',
      ].sort(),
    );
    expect(roster('pd')).toEqual(['sanctum_drakonid', 'sanctum_drakonid']);
    for (const boss of [KORGATH, VELKHAR, KORZUL, 'sledge_tusker']) {
      expect(
        GRAVEWYRM_SANCTUM_SPAWNS.filter((s) => s.mobId === boss),
        boss,
      ).toHaveLength(1);
    }
  });

  it('keeps the shipped interior key off this dungeon (the field record replaces it)', () => {
    expect(DUNGEON.interior).toBe('gravewyrm_sanctum');
    expect(DUNGEON.doorPos).toEqual({ x: 0, z: 858 });
    expect(DUNGEON.bossChainPull).toBe(true);
    expect(DUNGEON.gates).toBe(GRAVEWYRM_SANCTUM_GATES);
  });

  it('with nothing dead, only the Keystone Court and the Sledge Road are reachable', () => {
    const seen = reachable(openGates(new Set()));
    expect(reachedPacks(seen)).toEqual([...ROAD].sort());
  });

  it('the Rime Gate shatters only when G1, G2, G3 and the Tusker are dead, opening BOTH wings', () => {
    for (const missing of ROAD) {
      const dead = new Set(ROAD.filter((p) => p !== missing));
      const packs = reachedPacks(reachable(openGates(dead)));
      for (const p of [...WEST, ...EAST]) expect(packs, `${missing} alive`).not.toContain(p);
    }
    const packs = reachedPacks(reachable(openGates(upTo(ROAD))));
    expect(packs).toEqual(expect.arrayContaining([...WEST, ...EAST]));
    for (const p of [KORGATH, ...WORKS, VELKHAR, ...SHORE, KORZUL]) expect(packs).not.toContain(p);
  });

  it('the Chain Stairs rise only once BOTH wings are clear', () => {
    const base = upTo(ROAD);
    for (const missing of [...WEST, ...EAST]) {
      const dead = upTo(
        [...base],
        [...WEST, ...EAST].filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), `${missing} alive`).not.toContain(KORGATH);
    }
    expect(reachedPacks(reachable(openGates(upTo([...base], WEST, EAST))))).toContain(KORGATH);
  });

  it('the Chain Bridge falls only with Korgath dead', () => {
    const base = upTo(ROAD, WEST, EAST);
    const packs = reachedPacks(reachable(openGates(base)));
    for (const p of WORKS) expect(packs).not.toContain(p);
    const after = reachedPacks(reachable(openGates(upTo([...base], [KORGATH]))));
    expect(after).toEqual(expect.arrayContaining(WORKS));
    expect(after).not.toContain(VELKHAR);
  });

  it('Velkhar waits behind the Vault Ward until every Thaw Works pack dies', () => {
    const base = upTo(ROAD, WEST, EAST, [KORGATH]);
    for (const missing of WORKS) {
      const dead = upTo(
        [...base],
        WORKS.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), `${missing} alive`).not.toContain(VELKHAR);
    }
    const packs = reachedPacks(reachable(openGates(upTo([...base], WORKS))));
    expect(packs).toContain(VELKHAR);
    for (const p of SHORE) expect(packs).not.toContain(p);
  });

  it('the Tithe Gate opens on the shore only with Velkhar dead, the Hollow Ward on its packs', () => {
    const base = upTo(ROAD, WEST, EAST, [KORGATH], WORKS);
    const after = reachedPacks(reachable(openGates(upTo([...base], [VELKHAR]))));
    expect(after).toEqual(expect.arrayContaining(SHORE));
    expect(after).not.toContain(KORZUL);
    for (const missing of SHORE) {
      const dead = upTo(
        [...base],
        [VELKHAR],
        SHORE.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), `${missing} alive`).not.toContain(KORZUL);
    }
    expect(reachedPacks(reachable(openGates(upTo([...base], [VELKHAR], SHORE))))).toContain(KORZUL);
  });

  it('a fully cleared route reaches every placement and never a crevasse', () => {
    const dead = new Set<string>([
      ...GRAVEWYRM_SANCTUM_GATES.flatMap((g) => [...(g.packs ?? []), ...(g.bosses ?? [])]),
    ]);
    const seen = reachable(openGates(dead));
    for (const s of GRAVEWYRM_SANCTUM_SPAWNS) {
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
    // The boss exit portal stands on the Shore of the Held, on reached floor.
    const portal = DUNGEON.bossExitPortal;
    expect(portal).toBeDefined();
    if (portal) {
      expect(spawnReached(seen, portal.x, portal.z)).toBe(true);
      expect(authoredFieldHeight(FIELD, portal.x, portal.z)).toBe(GRAVEWYRM_HEIGHTS.shore);
    }
  });

  it('keeps the whole walkable field inside the slot footprint the claim counts', () => {
    expect(Math.max(Math.abs(minX), Math.abs(maxX))).toBeLessThan(120);
    expect(Math.max(Math.abs(minZ), Math.abs(maxZ))).toBeLessThan(250);
  });

  it('every patrol loop stays on walkable ground, clear of props', () => {
    for (const s of GRAVEWYRM_SANCTUM_SPAWNS) {
      if (!s.patrol) continue;
      const pts = s.patrol.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          expect(
            authoredFieldHeight(FIELD, x, z),
            `${s.packId} over a crevasse at ${x},${z}`,
          ).toBeGreaterThan(FIELD.voidHeight);
          expect(isBlocked(SEED, O.x + x, O.z + z, 0.5), `${s.packId} at ${x},${z}`).toBe(false);
        }
      }
    }
  });

  it('the Sledge Tusker walks the haul road between the court and the lower bend', () => {
    for (const p of TUSKER_ROAD) {
      const h = authoredFieldHeight(FIELD, p.x, p.z);
      expect(h).toBeGreaterThanOrEqual(GRAVEWYRM_HEIGHTS.lowerBend);
      expect(h).toBeLessThanOrEqual(GRAVEWYRM_HEIGHTS.court);
    }
  });

  it('stands every held mob and every prop on a walkable floor, clear of a collider', () => {
    for (const s of GRAVEWYRM_SANCTUM_SPAWNS) {
      if (s.patrol) continue;
      expect(authoredFieldHeight(FIELD, s.x, s.z), `${s.mobId}`).toBeGreaterThan(FIELD.voidHeight);
      expect(isBlocked(SEED, O.x + s.x, O.z + s.z, 0.5), `${s.mobId} at ${s.x},${s.z}`).toBe(false);
    }
    for (const p of FIELD.props) {
      if (p.kind === 'gs_gate_tunnel') continue; // the render-only mouth behind the landing
      expect(
        authoredFieldHeight(FIELD, p.x, p.z),
        `${p.kind} at ${p.x},${p.z} over a crevasse`,
      ).toBeGreaterThan(FIELD.voidHeight);
    }
  });

  it('the arrival stands on the Gate Landing, above and clear of every pack', () => {
    const e = GRAVEWYRM_SANCTUM_ANCHORS.entry;
    expect(authoredFieldHeight(FIELD, e.x, e.z)).toBe(GRAVEWYRM_HEIGHTS.landing);
    for (const s of GRAVEWYRM_SANCTUM_SPAWNS) {
      const pts = s.patrol ? s.patrol.points : [{ x: s.x, z: s.z }];
      for (const p of pts) {
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        expect(d, `${s.mobId} at ${p.x},${p.z}`).toBeGreaterThan(35);
      }
    }
  });

  it('descends from the pass to the lake: every area at its designed height', () => {
    const h = (x: number, z: number) => authoredFieldHeight(FIELD, x, z);
    const A = GRAVEWYRM_SANCTUM_ANCHORS;
    const Hd = GRAVEWYRM_HEIGHTS;
    expect(h(A.landing.x, A.landing.z)).toBe(Hd.landing);
    expect(h(A.court.x, A.court.z)).toBe(Hd.court);
    expect(h(A.upperBend.x, A.upperBend.z)).toBe(Hd.upperBend);
    expect(h(A.lowerBend.x, A.lowerBend.z)).toBe(Hd.lowerBend);
    expect(h(A.fork.x, A.fork.z)).toBe(Hd.fork);
    expect(h(A.seracUpper.x, A.seracUpper.z)).toBe(Hd.seracUpper);
    expect(h(A.seracLower.x, A.seracLower.z)).toBe(Hd.seracLower);
    expect(h(A.anchorUpper.x, A.anchorUpper.z)).toBe(Hd.anchorUpper);
    expect(h(A.anchorLower.x, A.anchorLower.z)).toBe(Hd.anchorLower);
    expect(h(A.terrace.x, A.terrace.z)).toBe(Hd.terrace);
    expect(h(A.worksUpper.x, A.worksUpper.z)).toBe(Hd.worksUpper);
    expect(h(A.worksLower.x, A.worksLower.z)).toBe(Hd.worksLower);
    expect(h(A.vault.x, A.vault.z)).toBe(Hd.vault);
    expect(h(A.shore.x, A.shore.z)).toBe(Hd.shore);
    expect(h(A.lake.x, A.lake.z)).toBe(Hd.lake);
    // The route only ever goes down: landing > court > ... > lake.
    const order = [
      Hd.landing,
      Hd.court,
      Hd.upperBend,
      Hd.lowerBend,
      Hd.fork,
      Hd.terrace,
      Hd.worksUpper,
      Hd.worksLower,
      Hd.vault,
      Hd.shore,
      Hd.lake,
    ];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThan(order[i - 1]);
    // A crevasse between the fork and the terrace drops to the void.
    expect(h(0, -52)).toBe(FIELD.voidHeight);
  });

  it('lays out the arenas phase B needs: four pillars, three pools, nineteen plates', () => {
    expect(SEAL_PILLARS.map((p) => p.id)).toEqual(['hammer', 'tongs', 'anvil', 'bellows']);
    for (const p of SEAL_PILLARS) {
      expect(Math.hypot(p.x - 0, p.z + 22)).toBeCloseTo(18, 5);
      expect(authoredFieldHeight(FIELD, p.shackle.x, p.shackle.z)).toBe(GRAVEWYRM_HEIGHTS.terrace);
    }
    expect(THAW_POOLS).toHaveLength(3);
    for (const p of THAW_POOLS)
      expect(authoredFieldHeight(FIELD, p.x, p.z)).toBe(GRAVEWYRM_HEIGHTS.vault);
    expect(LAKE_PLATES).toHaveLength(19);
    for (const p of LAKE_PLATES) {
      expect(Math.hypot(p.x - WYRMS_HOLLOW.x, p.z - WYRMS_HOLLOW.z) + p.r).toBeLessThanOrEqual(
        WYRMS_HOLLOW.lakeR + 0.6,
      );
      expect(authoredFieldHeight(FIELD, p.x, p.z)).toBe(GRAVEWYRM_HEIGHTS.lake);
    }
  });

  it('spreads the story markers so every walkable point is within interest of one', () => {
    for (let z = minZ; z <= maxZ; z += 4) {
      for (let x = minX; x <= maxX; x += 4) {
        if (authoredFieldHeight(FIELD, x, z) <= FIELD.voidHeight) continue;
        const near = Math.min(...STORY_MARKERS.map((m) => Math.hypot(m.x - x, m.z - z)));
        expect(near, `${x},${z}`).toBeLessThan(115);
      }
    }
  });

  it('the Sanctum interior rides the authored field: the world ground IS the record', () => {
    const height = instancedFieldHeight('gravewyrm_sanctum');
    expect(height).not.toBeNull();
    for (const [x, z] of [
      [0, -222],
      [0, -184],
      [-36, -144],
      [0, -22],
      [0, 107],
      [0, 192],
    ] as const) {
      expect(groundHeight(O.x + x, O.z + z, SEED)).toBeCloseTo(authoredFieldHeight(FIELD, x, z), 3);
    }
  });
});

// The Smith's Heart's route contract (docs/design/raid/smith_heart.md): the
// raid walks end to end over the REAL collision seam (colliders.ts isBlocked
// over the field's cliffs, props and gates), as a main-map walk, a portal hop
// and a walk in the Heart, and the gates cut it exactly where the design says:
// - with every gate open, one flood from the Cleft reaches the Gallery's
//   three landings, the Quarry, the Balcony, the Grand Stair and the Seal
//   Dais (the portal), the whole Ring, every pack spot and the four guardian
//   arenas, and NOTHING of the Heart (no floor joins the two areas);
// - one flood from the Heart's arrival reaches the terrace, the return
//   portal, the bridge, the platform, its four altars, the final boss and
//   the exit portal's spot, and nothing of the main map;
// - with every gate shut (a fresh claim), the Gallery is all there is;
// - the Pit Mouth alone opens the Quarry but not the Balcony (the Slab holds);
// - the Slab open lets the raid onto the Ring, down the Grand Stair to the
//   dais, and into all three remaining veins up to their arena mouths, in any
//   order;
// - the dais has exactly two ways in, the Grand Stair from the Balcony and
//   the North Stair from the Ring's north, each enough on its own, and the
//   North Stair cuts the walk from the Breath's mouth to the portal;
// - walked floor never steps more than a body's step between neighbours
//   without a collider between them, and every path is at least 12 yd wide;
// - nobody falls anywhere but at the Storm Cornice's four broken gaps (the
//   Guardian of the Breath's fight, design doc 7.2): there, and only there,
//   the lip stands open to the void (a body stepping in falls; the floods
//   below never step into the void, a fall is no walk).

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  RING_PACK_DEGREES,
  SMITH_HEART_GATES,
  SMITH_HEART_SEAL_MARKERS,
  SMITH_HEART_SPAWNS,
} from '../src/sim/content/smith_heart';
import {
  BREATH,
  CORNICE_GAPS,
  GALLERY_LANDINGS,
  GRAND_STAIR,
  HAMMER_PIT,
  HEART_ALTARS,
  HEART_ARRIVAL,
  HEART_RETURN_PORTAL,
  HEART_ROOM,
  inSmithHeartRoom,
  NORTH_STAIR,
  QUENCH,
  RING_PORTAL,
  RING_PORTAL_LANDING,
  ringPoint,
  SMITH_HEART_BOSS_SPOTS,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';
import { setOpenDungeonGates } from '../src/sim/instances/dungeon_gate_state';
import { MAX_STEP_HEIGHT } from '../src/sim/physics/character';
import { PLAYER_INTEREST_RADIUS } from '../src/sim/types';

const SEED = 7;
const DUNGEON = DUNGEONS.smith_heart;
const SLOT = 5;
const O = instanceOrigin(DUNGEON.index, SLOT);
const FIELD = SMITH_HEART_FIELD;
const { minX, maxX, minZ, maxZ } = FIELD.bounds;
const W = maxX - minX + 1;
const H = maxZ - minZ + 1;
const ALL_GATES = SMITH_HEART_GATES.map((g) => g.id);

function cell(x: number, z: number): number {
  return (Math.round(z) - minZ) * W + (Math.round(x) - minX);
}

/** Is a one-yard cell the void (no floor: a body stepping there falls)? */
function voidCell(x: number, z: number): boolean {
  return authoredFieldHeight(FIELD, x, z) <= FIELD.voidHeight + 1;
}

/** Every one-yard cell a body reaches from `start` with `open` gates (never
 *  stepping into the void: `intoVoid` lets it, to find where the rim is open). */
function flood(
  open: readonly string[],
  start: { x: number; z: number } = DUNGEON.entry,
  intoVoid = false,
): Uint8Array {
  setOpenDungeonGates(O.x, O.z, [...open]);
  const seen = new Uint8Array(W * H);
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
      if (seen[i]) continue;
      if (isBlocked(SEED, O.x + nx, O.z + nz, 0.5)) continue;
      seen[i] = 1;
      // A body that steps into the void falls: it walks on from nowhere.
      if (!intoVoid && voidCell(nx, nz)) continue;
      queue.push(nx, nz);
    }
  }
  return seen;
}

/** One-yard steps from `start` to every reached cell (-1 where unreached),
 *  the cells `cut` names treated as blocked (a stair taken away). */
function walkSteps(
  open: readonly string[],
  start: { x: number; z: number },
  cut: (x: number, z: number) => boolean = () => false,
): Int32Array {
  setOpenDungeonGates(O.x, O.z, [...open]);
  const steps = new Int32Array(W * H).fill(-1);
  const queue: number[] = [Math.round(start.x), Math.round(start.z)];
  steps[cell(start.x, start.z)] = 0;
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q];
    const z = queue[q + 1];
    const here = steps[cell(x, z)];
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
      if (steps[i] >= 0 || cut(nx, nz)) continue;
      if (isBlocked(SEED, O.x + nx, O.z + nz, 0.5)) continue;
      if (voidCell(nx, nz)) continue;
      steps[i] = here + 1;
      queue.push(nx, nz);
    }
  }
  return steps;
}

/** The fewest steps to any cell within 2 yd of (x, z), or -1. */
function stepsTo(steps: Int32Array, p: { x: number; z: number }): number {
  let best = -1;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const s = steps[cell(Math.round(p.x) + dx, Math.round(p.z) + dz)];
      if (s >= 0 && (best < 0 || s < best)) best = s;
    }
  return best;
}

/** Is any cell within 2 yd of (x, z) reached? (A spot may hold a prop.) */
function reaches(seen: Uint8Array, p: { x: number; z: number }): boolean {
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = Math.round(p.x) + dx;
      const z = Math.round(p.z) + dz;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (seen[cell(x, z)]) return true;
    }
  return false;
}

const SPOTS = {
  cleft: { x: -198, z: -212 },
  h1: GALLERY_LANDINGS.h1,
  h2: GALLERY_LANDINGS.h2,
  h3: GALLERY_LANDINGS.h3,
  pit: { x: HAMMER_PIT.x - 20, z: HAMMER_PIT.z },
  balconyTip: { x: 0, z: -62 },
  grandStair: { x: 0, z: -40 },
  northStair: { x: 0, z: 40 },
  dais: RING_PORTAL_LANDING,
  portal: RING_PORTAL,
  ring: ringPoint(0),
  b1: BREATH.b1,
  b2: BREATH.b2,
  b3: BREATH.b3,
  breathMouth: { x: -80, z: 187 },
  cornice: SMITH_HEART_BOSS_SPOTS.breath,
  q1: QUENCH.q1,
  q2: QUENCH.q2,
  q3: { x: 160, z: -86 },
  lake: SMITH_HEART_BOSS_SPOTS.quench,
  f1: { x: -104, z: 0 },
  f3: { x: -136, z: -20 },
  anvil: SMITH_HEART_BOSS_SPOTS.heat,
} as const;

const HEART_SPOTS = {
  arrival: HEART_ARRIVAL,
  returnPortal: HEART_RETURN_PORTAL,
  platform: { x: HEART_ROOM.x - 14, z: HEART_ROOM.z - 14 },
  final: SMITH_HEART_BOSS_SPOTS.final,
  exitPortal: DUNGEON.bossExitPortal ?? { x: Number.NaN, z: Number.NaN },
  // Each altar's foot, the side a raid stands on (the altar is solid).
  ...Object.fromEntries(
    HEART_ALTARS.map((a) => [
      `altar_${a.vein}`,
      { x: a.x + (HEART_ROOM.x - a.x) * 0.15, z: a.z + (HEART_ROOM.z - a.z) * 0.15 },
    ]),
  ),
} as Record<string, { x: number; z: number }>;

describe("the Smith's Heart route", () => {
  it('is a raid of ten in its own instance band', () => {
    expect(DUNGEON.suggestedPlayers).toBe(10);
    expect(DUNGEON.interior).toBe('smith_heart');
    const others = Object.values(DUNGEONS).filter((d) => d.id !== DUNGEON.id);
    expect(others.some((d) => d.index === DUNGEON.index)).toBe(false);
    // The field fits one slot of its band (x 600 wide, z 500 tall).
    expect(Math.max(-minX, maxX)).toBeLessThan(300);
    expect(Math.max(-minZ, maxZ)).toBeLessThan(250);
  });

  it('walks from the Cleft through all four arenas to the portal with every gate open', () => {
    const seen = flood(ALL_GATES);
    const missed = Object.entries(SPOTS)
      .filter(([, p]) => !reaches(seen, p))
      .map(([k]) => k);
    expect(missed).toEqual([]);
    // The whole Ring, every 10 degrees of its walked arc.
    const ringMissed: number[] = [];
    for (let d = 0; d < 360; d += 10) {
      if (d > 140 && d < 220) continue; // the Balcony and its two stairs
      if (!reaches(seen, ringPoint(d))) ringMissed.push(d);
    }
    expect(ringMissed).toEqual([]);
    // Every spawn of the main map stands on reached floor.
    const stranded = SMITH_HEART_SPAWNS.filter((s) => !inSmithHeartRoom(s.x, s.z))
      .filter((s) => !reaches(seen, s))
      .map((s) => `${s.mobId}@${s.x.toFixed(0)},${s.z.toFixed(0)}`);
    expect(stranded).toEqual([]);
  });

  it('never walks from the main map into the Heart, nor back', () => {
    const main = flood(ALL_GATES);
    for (const [k, p] of Object.entries(HEART_SPOTS)) expect(reaches(main, p), k).toBe(false);
    let mainInHeart = 0;
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++)
        if (main[cell(x, z)] && inSmithHeartRoom(x, z)) mainInHeart++;
    expect(mainInHeart).toBe(0);
    const heart = flood(ALL_GATES, HEART_ARRIVAL);
    for (const [k, p] of Object.entries(SPOTS)) expect(reaches(heart, p), k).toBe(false);
    let heartOutside = 0;
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++)
        if (heart[cell(x, z)] && !inSmithHeartRoom(x, z)) heartOutside++;
    expect(heartOutside).toBe(0);
  });

  it('walks the Heart from the arrival to the final boss, its altars and its exit', () => {
    const seen = flood(ALL_GATES, HEART_ARRIVAL);
    const missed = Object.entries(HEART_SPOTS)
      .filter(([, p]) => !reaches(seen, p))
      .map(([k]) => k);
    expect(missed).toEqual([]);
    // The final boss stands on reached floor of the Heart.
    for (const s of SMITH_HEART_SPAWNS.filter((sp) => inSmithHeartRoom(sp.x, sp.z))) {
      expect(reaches(seen, s), s.mobId).toBe(true);
    }
    // The arrival is far outside the final boss's reach.
    const f = SMITH_HEART_BOSS_SPOTS.final;
    expect(Math.hypot(HEART_ARRIVAL.x - f.x, HEART_ARRIVAL.z - f.z)).toBeGreaterThan(50);
  });

  it('the Heart Bridge sealed shuts the platform off from the terrace', () => {
    const shut = flood(
      ALL_GATES.filter((g) => g !== 'heart_bridge'),
      HEART_ARRIVAL,
    );
    expect(reaches(shut, HEART_RETURN_PORTAL)).toBe(true);
    expect(reaches(shut, SMITH_HEART_BOSS_SPOTS.final)).toBe(false);
  });

  it('a fresh claim holds the raid in the Hammer Gallery', () => {
    const seen = flood([]);
    expect(reaches(seen, SPOTS.h3)).toBe(true);
    expect(reaches(seen, SPOTS.pit)).toBe(false);
    expect(reaches(seen, SPOTS.balconyTip)).toBe(false);
  });

  it('the Pit Mouth opens the Quarry, but the Slab holds the Balcony', () => {
    const seen = flood(['hammer_pit_mouth']);
    expect(reaches(seen, SPOTS.pit)).toBe(true);
    expect(reaches(seen, SPOTS.balconyTip)).toBe(false);
    expect(reaches(seen, SPOTS.ring)).toBe(false);
    expect(reaches(seen, SPOTS.dais)).toBe(false);
  });

  it('the Slab open: the Ring, the dais and all three veins in any order', () => {
    const seen = flood(['hammer_pit_mouth', 'the_slab']);
    for (const k of [
      'balconyTip',
      'ring',
      'dais',
      'portal',
      'b3',
      'breathMouth',
      'q3',
      'f3',
    ] as const) {
      expect(reaches(seen, SPOTS[k]), k).toBe(true);
    }
    for (const k of ['cornice', 'lake', 'anvil'] as const) {
      expect(reaches(seen, SPOTS[k]), k).toBe(false);
    }
    // Each arena mouth is independent of the other two veins.
    for (const [mouth, inside, others] of [
      ['cornice_mouth', 'cornice', ['lake', 'anvil']],
      ['lake_mouth', 'lake', ['cornice', 'anvil']],
      ['anvil_mouth', 'anvil', ['cornice', 'lake']],
    ] as const) {
      const one = flood(['hammer_pit_mouth', 'the_slab', mouth]);
      expect(reaches(one, SPOTS[inside]), inside).toBe(true);
      for (const o of others) expect(reaches(one, SPOTS[o]), o).toBe(false);
    }
  });

  it('reaches the dais by either stair alone, and by nothing else', () => {
    const slabOpen = ['hammer_pit_mouth', 'the_slab'];
    // A stair taken away: its band across the chasm, a yard past each side.
    const grand = (x: number, z: number) =>
      Math.abs(x) <= GRAND_STAIR.halfWidth + 1 && z > GRAND_STAIR.top + 1 && z < GRAND_STAIR.foot;
    const north = (x: number, z: number) =>
      Math.abs(x) <= NORTH_STAIR.halfWidth + 1 && z < NORTH_STAIR.top - 1 && z > NORTH_STAIR.foot;
    const ring = ringPoint(0, 70);
    // Only the North Stair: from the Ring's north down to the portal.
    expect(stepsTo(walkSteps(slabOpen, ring, grand), SPOTS.portal)).toBeGreaterThan(0);
    // Only the Grand Stair: from the Balcony's tip down to the portal.
    expect(stepsTo(walkSteps(slabOpen, SPOTS.balconyTip, north), SPOTS.portal)).toBeGreaterThan(0);
    // Neither: the dais is an island (no other floor reaches it).
    const both = (x: number, z: number) => grand(x, z) || north(x, z);
    expect(stepsTo(walkSteps(slabOpen, ring, both), SPOTS.portal)).toBe(-1);
    expect(stepsTo(walkSteps(slabOpen, SPOTS.balconyTip, both), SPOTS.portal)).toBe(-1);
  });

  it('the North Stair cuts the walk from the Breath mouth to the portal', () => {
    const slabOpen = ['hammer_pit_mouth', 'the_slab'];
    const mouth = ringPoint(0, 70);
    const direct = stepsTo(walkSteps(slabOpen, mouth), SPOTS.portal);
    // Straight down: about the Ring's radius (a hand of side steps allowed).
    expect(direct).toBeGreaterThan(0);
    expect(direct).toBeLessThan(80);
    // Without it, round the Ring and over the Balcony: more than three times as far.
    const north = (x: number, z: number) =>
      Math.abs(x) <= NORTH_STAIR.halfWidth + 1 && z < NORTH_STAIR.top - 1 && z > NORTH_STAIR.foot;
    const around = stepsTo(walkSteps(slabOpen, mouth, north), SPOTS.portal);
    expect(around).toBeGreaterThan(direct * 3);
  });

  it('never steps more than a body can climb between reached neighbours', () => {
    const bad: string[] = [];
    for (const start of [DUNGEON.entry, HEART_ARRIVAL]) {
      const seen = flood(ALL_GATES, start);
      for (let z = minZ; z < maxZ; z++)
        for (let x = minX; x < maxX; x++) {
          if (!seen[cell(x, z)]) continue;
          const h = authoredFieldHeight(FIELD, x, z);
          for (const [dx, dz] of [
            [1, 0],
            [0, 1],
          ]) {
            if (!seen[cell(x + dx, z + dz)]) continue;
            // A gap's lip is a fall, not a step (pinned below).
            if (voidCell(x, z) || voidCell(x + dx, z + dz)) continue;
            const step = Math.abs(authoredFieldHeight(FIELD, x + dx, z + dz) - h);
            if (step > Math.max(MAX_STEP_HEIGHT, FIELD.cliffStep) + 0.05) {
              bad.push(`(${x},${z}) step ${step.toFixed(2)}`);
            }
          }
        }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("opens the rim to the void only at the Storm Cornice's four gaps", () => {
    // With every gate open, the only void a body can step into from the
    // whole main map lies in a gap's throat; each gap opens onto it.
    const seen = flood(ALL_GATES);
    const strays: string[] = [];
    const opened = new Set<number>();
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++) {
        if (!seen[cell(x, z)] || !voidCell(x, z)) continue;
        const g = CORNICE_GAPS.findIndex((p) => Math.hypot(x - p.x, z - p.z) <= p.r + 1.5);
        if (g < 0) strays.push(`(${x},${z})`);
        else opened.add(g);
      }
    expect(strays.slice(0, 10)).toEqual([]);
    expect(opened.size).toBe(CORNICE_GAPS.length);
    // The gaps never cut the walk: the Cornice and the guardian are reached
    // without stepping through one (the flood above never steps on from
    // the void), and the corpse run from the Cleft still reaches the portal.
    expect(reaches(seen, SMITH_HEART_BOSS_SPOTS.breath)).toBe(true);
    expect(reaches(seen, SPOTS.portal)).toBe(true);
  });

  it('every walkway is at least 12 yd wide (a raid of ten moves through it)', () => {
    for (const s of FIELD.surfaces) {
      if (s.kind === 'path') expect(s.halfWidth * 2, s.id).toBeGreaterThanOrEqual(12);
    }
    for (const g of SMITH_HEART_GATES) expect(g.hw * 2, g.id).toBeGreaterThanOrEqual(12);
  });

  it('keeps every floor within interest range of a seal marker (seal and portal mirror)', () => {
    const far: string[] = [];
    for (let z = minZ; z <= maxZ; z += 3)
      for (let x = minX; x <= maxX; x += 3) {
        if (!authoredFieldSurfaceAt(FIELD, x, z)) continue;
        const d = Math.min(...SMITH_HEART_SEAL_MARKERS.map((m) => Math.hypot(m.x - x, m.z - z)));
        if (d > PLAYER_INTEREST_RADIUS - 5) far.push(`(${x}, ${z}) ${d.toFixed(0)}`);
      }
    expect(far.slice(0, 10)).toEqual([]);
  });

  it('places the eight Ring packs two between each pair of vein mouths', () => {
    const between = (a: number, b: number) =>
      RING_PACK_DEGREES.filter((d) => d > a && d < b).length;
    expect(between(0, 90)).toBe(2);
    expect(between(90, 180)).toBe(2);
    expect(between(180, 270)).toBe(2);
    expect(between(270, 360)).toBe(2);
  });

  it('grows every guardian arena to between 85 and 105 yd across, the Heart to 84+', () => {
    const extent = (id: string) => {
      const s = FIELD.surfaces.find((x) => x.id === id);
      if (!s || s.kind !== 'poly') throw new Error(id);
      const xs = s.points.map((p) => p[0]);
      const zs = s.points.map((p) => p[1]);
      return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
    };
    for (const id of ['hammer_pit', 'storm_cornice', 'lake_shelf', 'smiths_forge']) {
      const e = extent(id);
      expect(Math.max(e.w, e.d), id).toBeGreaterThanOrEqual(85);
      expect(Math.max(e.w, e.d), id).toBeLessThanOrEqual(105);
      expect(Math.min(e.w, e.d), id).toBeGreaterThanOrEqual(70);
    }
    expect(HEART_ROOM.r * 2).toBeGreaterThanOrEqual(84);
  });
});

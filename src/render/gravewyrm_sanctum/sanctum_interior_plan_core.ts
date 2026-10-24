// Pure placement plan for the Gravewyrm Sanctum's interior AAA pass: the
// second Blender kit (public/models/props/gravewyrm_sanctum_interior.glb,
// docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_interior.py),
// instanced by the same painter as the first kit (sanctum_kit.ts), zone by
// zone:
//
// - The Lock Terrace (Korgath): the rock pedestal the terrace stands on
//   (Kit_LockSpur, a hand under the floor, notched under the Chain Bridge's
//   deck), the curb stones round its rim (Kit_LockCurb, knee low, open at
//   both chain stairs and the bridge), and lip modules hanging under the two
//   chain stairs' sides (Kit_LipRock*, every one under the stair's floor).
//   The carved seal pillars are the chains painter's (sanctum_chains.ts).
// - The Ritual Vault (Velkhar): the carved thaw pyres (Kit_ThawPyreV2, in
//   place of the first kit's Kit_ThawPyre when the second kit is there:
//   resolveInteriorReplacements), bone heaps against the walls between the
//   pools (knee low), and ice and slate lips under the stairs in and out
//   (the works road, the vault stair, the shore and lake stairs).
// - The walks between the bosses: rubble gathered on every walk's last yard
//   before its lip drops into the gulf (knee low, a body steps over it; never
//   in a boss arena, never on a stair), and lip rocks round the round
//   terraces the first kit's straight lip modules skip (the landing, the
//   road's two bends, the hollow's shelf).
//
// Every piece is render-only dressing: nothing here stands in a body's way
// over walkable floor (tests/gravewyrm_sanctum_interior_kit.test.ts sweeps
// the shipped meshes against the walked floor). Three-free, DOM-free,
// deterministic (hashes only).

import {
  GRAVEWYRM_SANCTUM_FIELD,
  LOCK_TERRACE,
  RITUAL_VAULT,
  THAW_POOLS,
} from '../../sim/content/gravewyrm_sanctum_layout';
import { authoredFieldCliffRuns } from '../../sim/instances/authored_field';
import type { FieldSurface } from '../../sim/instances/authored_field/types';
import type { SanctumKitPlacement } from './sanctum_kit_plan_core';
import { sanctumFloorAt, sanctumGround, sanctumHash } from './sanctum_plan_core';

/** The pedestal and the curb stand a hand under / on the terrace floor. */
export function planLockTerrace(): SanctumKitPlacement[] {
  return [
    {
      piece: 'Kit_LockSpur',
      x: LOCK_TERRACE.x,
      z: LOCK_TERRACE.z,
      y: LOCK_TERRACE.h,
      rot: 0,
      scale: 1,
      // Scenery under the rim: the terrace's floor shades it; it casts none.
      noShadow: true,
    },
    {
      piece: 'Kit_LockCurb',
      x: LOCK_TERRACE.x,
      z: LOCK_TERRACE.z,
      y: LOCK_TERRACE.h,
      rot: 0,
      scale: 1,
    },
  ];
}

/** Lip module length along its run (yards) and the variants. */
export const LIP_ROCK_LENGTH = 6.4;
const LIP_ROCKS: readonly string[] = ['Kit_LipRockA', 'Kit_LipRockB', 'Kit_LipRockC'];
const LIP_ICE: readonly string[] = ['Kit_LipIceA', 'Kit_LipIceB'];
/** How far inside the stair's edge its floor is read (the cliff probe's). */
const LIP_PROBE = 0.6;
/** The module's top stands this far under the lowest floor along it. */
const LIP_DROP = 0.14;

type PathSurface = Extract<FieldSurface, { kind: 'path' }>;

function pathById(id: string): PathSurface {
  const s = GRAVEWYRM_SANCTUM_FIELD.surfaces.find((f) => f.id === id);
  if (!s || s.kind !== 'path') throw new Error(`no path ${id}`);
  return s;
}

/**
 * Lip modules along both sides of a stair's sloping run, their drop turned
 * outward, each stood at the LOWEST floor along its span (so no module ever
 * rises over a step) and only where the ground beyond the side is the gulf.
 */
export function planStairLips(
  id: string,
  salt: number,
  pieces: readonly string[] = LIP_ROCKS,
): SanctumKitPlacement[] {
  const s = pathById(id);
  const out: SanctumKitPlacement[] = [];
  let k = 0;
  for (let i = 0; i < s.points.length - 1; i++) {
    const [ax, az] = s.points[i];
    const [bx, bz] = s.points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 2) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const n = Math.max(1, Math.round(len / LIP_ROCK_LENGTH));
    for (const side of [-1, 1]) {
      // The outward side's unit normal.
      const nx = -uz * side;
      const nz = ux * side;
      for (let j = 0; j < n; j++) {
        const t0 = j / n;
        const t1 = (j + 1) / n;
        const tm = (t0 + t1) / 2;
        const cx = ax + (bx - ax) * tm + nx * s.halfWidth;
        const cz = az + (bz - az) * tm + nz * s.halfWidth;
        // Only over the gulf (another surface's floor beyond: no lip).
        if (sanctumFloorAt(cx + nx * 2.5, cz + nz * 2.5) !== null) continue;
        let floor = Number.POSITIVE_INFINITY;
        for (const t of [t0, tm, t1]) {
          const px = ax + (bx - ax) * t + nx * (s.halfWidth - LIP_PROBE);
          const pz = az + (bz - az) * t + nz * (s.halfWidth - LIP_PROBE);
          floor = Math.min(floor, sanctumGround(px, pz));
        }
        out.push({
          piece: pieces[Math.floor(sanctumHash(k + salt, 41) * pieces.length)],
          x: cx,
          z: cz,
          y: floor - LIP_DROP,
          // Local +Z (the drop face) turns to the outward normal.
          rot: Math.atan2(nx, nz),
          scale: 1,
          stretch: (len / n / LIP_ROCK_LENGTH) * 1.08,
          depth: 0.9 + sanctumHash(k + salt, 43) * 0.3,
          noShadow: true,
          // The low tier keeps the terrain's own skirt (as before the pass).
          cosmetic: true,
        });
        k++;
      }
    }
  }
  return out;
}

/** The interior pieces that stand in place of a first-kit piece at the same
 *  placement, and the piece each replaces. */
export const INTERIOR_REPLACES: Readonly<Record<string, string>> = {
  Kit_ThawPyreV2: 'Kit_ThawPyre',
};

/** Bone heaps in the vault: between the pools, against the walls (angle
 *  from north toward east, distance from the vault's centre). */
const BONE_HEAPS: readonly [number, number][] = [
  [Math.PI / 3, 17.2],
  [(5 * Math.PI) / 3, 17.2],
  // Either side of the vault stair's mouth (south), clear of its walk.
  [Math.PI * 0.8, 17.0],
  [Math.PI * 1.2, 17.0],
];

/** The Ritual Vault: the thaw pyres at the pools' centres (the props' own
 *  turn, toward the vault's centre) and the bone heaps. */
export function planRitualVault(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = THAW_POOLS.map((p) => ({
    piece: 'Kit_ThawPyreV2',
    x: p.x,
    z: p.z,
    rot: Math.atan2(RITUAL_VAULT.x - p.x, RITUAL_VAULT.z - p.z),
    scale: 1,
  }));
  for (const [i, [a, r]] of BONE_HEAPS.entries()) {
    out.push({
      piece: 'Kit_BoneHeap',
      x: RITUAL_VAULT.x + Math.sin(a) * r,
      z: RITUAL_VAULT.z + Math.cos(a) * r,
      // Its long side along the wall, its front toward the centre.
      rot: a + Math.PI + (sanctumHash(i, 51) - 0.5) * 0.4,
      scale: 0.95 + sanctumHash(i, 52) * 0.25,
      cosmetic: true,
    });
  }
  return out;
}

/** Drop whichever of each replaced pair cannot draw: the interior piece when
 *  its kit is missing (`has` false), else the first-kit piece it replaces at
 *  the same spot. A first-kit placement tagged `withoutPiece` (the terrace's
 *  frozen falls, sculpted into the pedestal) drops once that piece is there. */
export function resolveInteriorReplacements(
  plan: readonly SanctumKitPlacement[],
  has: (piece: string) => boolean,
): SanctumKitPlacement[] {
  const replaced = new Set<string>();
  for (const [v2, old] of Object.entries(INTERIOR_REPLACES)) if (has(v2)) replaced.add(old);
  return plan.filter((p) => {
    if (p.withoutPiece !== undefined && has(p.withoutPiece)) return false;
    return INTERIOR_REPLACES[p.piece] ? has(p.piece) : !replaced.has(p.piece);
  });
}

/** Rubble module length along a lip (yards) and the spacing between. */
export const RUBBLE_LENGTH = 4.8;
const RUBBLE_STEP = 5.6;
/** Surfaces whose rims carry no rubble: the boss arenas (the terrace's curb,
 *  the vault's walls, the lake's plates and its shelf) keep their floors
 *  clean for the fights' telegraphs. */
const RUBBLE_SKIP: ReadonlySet<string> = new Set([
  'lock_terrace',
  'ritual_vault',
  'frozen_lake',
  'hollow_shelf',
]);

function surfaceById(id: string): FieldSurface | undefined {
  return GRAVEWYRM_SANCTUM_FIELD.surfaces.find((f) => f.id === id);
}

/** Whether a rubble module's whole footprint lies on its own floor or over
 *  the gulf: none where it would spill onto a lower walk beside it (a stair,
 *  a ramp, the next terrace), where its knee-high stones would stand a body
 *  tall over that floor. */
function rubbleFootprintClear(
  x: number,
  z: number,
  nx: number,
  nz: number,
  floor: number,
): boolean {
  // Along the lip (the module's length) and across it (the walk's side, the spill).
  const tx = -nz;
  const tz = nx;
  for (const u of [-3.8, -2.6, -1.3, 0, 1.3, 2.6, 3.8])
    for (const v of [-2.0, -1.0, 0.0, 0.8, 1.6]) {
      const f = sanctumFloorAt(x + tx * u + nx * v, z + tz * u + nz * v);
      if (f === null) continue;
      if (Math.abs(f - floor) > 0.25) return false;
    }
  return true;
}

/** Rubble on the last yard of every walk whose lip drops into the gulf. */
export function planEdgeRubble(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  let k = 0;
  for (const run of authoredFieldCliffRuns(GRAVEWYRM_SANCTUM_FIELD)) {
    const s = surfaceById(run.surface);
    if (!s || s.hidden || RUBBLE_SKIP.has(s.id)) continue;
    if (s.kind === 'path' && s.stairs) continue;
    if (run.high - run.low < 3) continue;
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    const n = Math.floor(len / RUBBLE_STEP);
    const slots: number[] = [];
    if (n === 0) {
      // A short run (a round terrace's facet): one module now and then.
      if (sanctumHash(k, 61) < len / RUBBLE_STEP) slots.push(0.5);
    } else for (let j = 0; j < n; j++) slots.push((j + 0.5) / n);
    const icy = s.ground === 'snow' || s.ground === 'ice';
    for (const t of slots) {
      k++;
      // Not everywhere: a lip reads natural with gaps.
      if (sanctumHash(k, 62) < 0.42) continue;
      const x = run.ax + (run.bx - run.ax) * t;
      const z = run.az + (run.bz - run.az) * t;
      if (sanctumFloorAt(x + run.nx * 2.5, z + run.nz * 2.5) !== null) continue;
      const floor = sanctumFloorAt(x - run.nx * 0.6, z - run.nz * 0.6);
      if (floor === null) continue;
      if (!rubbleFootprintClear(x, z, run.nx, run.nz, floor)) continue;
      const variant = sanctumHash(k, 63) < 0.5 ? 'A' : 'B';
      out.push({
        piece: `${icy ? 'Kit_EdgeRubbleIce' : 'Kit_EdgeRubble'}${variant}`,
        x,
        z,
        y: floor,
        rot: Math.atan2(run.nx, run.nz),
        scale: 0.9 + sanctumHash(k, 64) * 0.25,
        cosmetic: true,
        // Knee low on the floor: no shadow of its own, and the middle tier
        // keeps about half of them.
        noShadow: true,
        shed: sanctumHash(k, 65),
      });
    }
  }
  return out;
}

/** Snowfields that bank wind drifts near their rims (the fork, the wings'
 *  shelves, the Thaw Works' terraces, the shore). */
const DRIFT_FIELDS: ReadonlySet<string> = new Set([
  'fork',
  'serac_upper',
  'serac_lower',
  'anchor_lower',
  'works_upper',
  'works_lower',
  'shore_of_the_held',
]);

/** Wind drifts on the snowfields, a few yards in from their rims, their lee
 *  faces downwind (east), knee low (a body walks through them). */
export function planDrifts(): SanctumKitPlacement[] {
  const out: SanctumKitPlacement[] = [];
  let k = 0;
  for (const run of authoredFieldCliffRuns(GRAVEWYRM_SANCTUM_FIELD)) {
    if (!DRIFT_FIELDS.has(run.surface)) continue;
    const len = Math.hypot(run.bx - run.ax, run.bz - run.az);
    const n = Math.max(1, Math.floor(len / 9));
    for (let j = 0; j < n; j++) {
      k++;
      if (sanctumHash(k, 81) < (len < 6 ? 0.8 : 0.45)) continue;
      const t = (j + 0.3 + sanctumHash(k, 82) * 0.4) / n;
      const inset = 3.2 + sanctumHash(k, 83) * 2.5;
      const x = run.ax + (run.bx - run.ax) * t - run.nx * inset;
      const z = run.az + (run.bz - run.az) * t - run.nz * inset;
      const floor = sanctumFloorAt(x, z);
      if (floor === null || !rubbleFootprintClear(x, z, 1, 0, floor)) continue;
      out.push({
        piece: sanctumHash(k, 84) < 0.5 ? 'Kit_DriftA' : 'Kit_DriftB',
        x,
        z,
        y: floor,
        // The lee (local +X) downwind, east, give or take.
        rot: (sanctumHash(k, 85) - 0.5) * 0.7,
        scale: 0.85 + sanctumHash(k, 86) * 0.4,
        cosmetic: true,
        noShadow: true,
        shed: sanctumHash(k, 87),
      });
    }
  }
  return out;
}

/** Lip rocks round a round terrace (the first kit's lip modules skip its
 *  short facets): modules round the rim wherever the gulf lies beyond. */
export function planCircleLips(id: string, salt: number): SanctumKitPlacement[] {
  const s = surfaceById(id);
  if (!s || s.kind !== 'circle') throw new Error(`no circle ${id}`);
  const out: SanctumKitPlacement[] = [];
  const n = Math.max(6, Math.round((2 * Math.PI * s.r) / LIP_ROCK_LENGTH));
  for (let j = 0; j < n; j++) {
    const a = (2 * Math.PI * j) / n;
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    const x = s.x + nx * s.r;
    const z = s.z + nz * s.r;
    if (sanctumFloorAt(x + nx * 2.5, z + nz * 2.5) !== null) continue;
    const floor = Math.min(
      sanctumGround(x - nx * LIP_PROBE, z - nz * LIP_PROBE),
      sanctumGround(
        s.x + Math.sin(a + 0.5 / s.r) * (s.r - LIP_PROBE),
        s.z + Math.cos(a + 0.5 / s.r) * (s.r - LIP_PROBE),
      ),
    );
    out.push({
      piece: LIP_ROCKS[Math.floor(sanctumHash(j + salt, 71) * LIP_ROCKS.length)],
      x,
      z,
      y: floor - LIP_DROP,
      rot: Math.atan2(nx, nz),
      scale: 1,
      stretch: ((2 * Math.PI * s.r) / n / LIP_ROCK_LENGTH) * 1.12,
      depth: 0.9 + sanctumHash(j + salt, 72) * 0.3,
      noShadow: true,
      cosmetic: true,
    });
  }
  return out;
}

/** Every piece the interior plan places, known without running the plan (its
 *  lip and rubble probes walk every cliff run): the dressing registers their
 *  empty stand-ins from this at module load. Pinned equal to the plan's own
 *  pieces by `tests/gravewyrm_sanctum_interior_kit.test.ts`. */
export const SANCTUM_INTERIOR_PLAN_PIECES: readonly string[] = [
  'Kit_LockSpur',
  'Kit_LockCurb',
  'Kit_ThawPyreV2',
  'Kit_BoneHeap',
  ...LIP_ROCKS,
  ...LIP_ICE,
  'Kit_EdgeRubbleA',
  'Kit_EdgeRubbleB',
  'Kit_EdgeRubbleIceA',
  'Kit_EdgeRubbleIceB',
  'Kit_DriftA',
  'Kit_DriftB',
];

/** The whole interior plan (instance-local frame). */
export function planSanctumInteriorPlacements(): SanctumKitPlacement[] {
  return [
    ...planLockTerrace(),
    ...planStairLips('west_chain_stair', 0),
    ...planStairLips('east_chain_stair', 17),
    ...planRitualVault(),
    ...planStairLips('works_road', 31, LIP_ICE),
    ...planStairLips('vault_stair', 43, LIP_ICE),
    ...planStairLips('shore_stair', 57),
    ...planStairLips('lake_stair', 71),
    // Every other sloping walk's sides: the landing stair, the haul road's
    // three legs, the two wings' walks and the anchor ramp.
    ...planStairLips('landing_stair', 151),
    ...planStairLips('sledge_road_upper', 163),
    ...planStairLips('sledge_road_middle', 177),
    ...planStairLips('sledge_road_lower', 191),
    ...planStairLips('serac_walk', 203, LIP_ICE),
    ...planStairLips('anchor_walk', 211),
    ...planStairLips('anchor_ramp', 223),
    ...planEdgeRubble(),
    ...planDrifts(),
    ...planCircleLips('gate_landing', 101),
    ...planCircleLips('road_upper_bend', 113),
    ...planCircleLips('road_lower_bend', 127),
    ...planCircleLips('hollow_shelf', 139),
  ];
}

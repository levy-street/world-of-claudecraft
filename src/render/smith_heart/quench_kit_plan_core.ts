// Pure plan of the Quench vein's Blender kit (phase 2H: docs/design/raid/kit/
// build_smith_heart_quench_kit.py, painted by quench_kit.ts): where every
// Kit_* piece of the Quench stands, from its mouth down to the Frozen Lake.
//
//   - the basin's carved fire bowls, its steam vents, the old ice heaped
//     against its walls past the shelf's rim, the Smith's great blades of ice
//     sunk in the lake, the Singing Ice's heaved blades and the landings'
//     frost-cracked standing stones, on the layout's props and colliders;
//   - the low walls along every Quench walk over the void (the shared lip
//     planner's modules, past the lip over the drop, never over a walk);
//   - frozen falls hung on the vein's walls (the mountain's first band of
//     rock where it climbs well over the floor below it);
//   - the Singing Ice's crack webs and the lake's long cracks (flat inlays
//     every telegraph draws over), and low drifts of snow at the lake's edge.
//
// Nothing render-only stands over a walked floor beyond a hand: the inlays
// are flat, the drifts a hand high, the walls and the heaped ice stand past
// the lips, the falls on the rock, and every solid a body can touch stands
// on a layout collider. Three-free, DOM-free, deterministic (a hash, never rng).

import { QUENCH, SMITH_HEART_FIELD, smithHeartAreaAt } from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash, heartPropBase } from './heart_plan_core';
import { heartRockPieceOf, planHeartRock } from './heart_rock_plan_core';
import { heartFloorClearance } from './heart_walls_core';
import { lipWallClear, planLipWalls } from './lip_walls_core';

/** The layout prop kinds the kit draws in place of their placeholders. */
export const QUENCH_KIT_KINDS: ReadonlySet<string> = new Set([
  'sh_brazier',
  'sh_sunk_blade',
  'sh_ice_shelf',
  'sh_steam_vent',
  'sh_ice_blade',
  'sh_frost_stone',
]);

/** Every walked floor of the Quench (their lips over the void take the
 *  low walls). */
export const QUENCH_WALK_SURFACES: ReadonlySet<string> = new Set([
  'quench_mouth',
  'quench_q1',
  'quench_stair',
  'quench_q2',
  'quench_shelf_stair',
  'singing_ice',
  'lake_descent',
  'lake_shelf',
  'frozen_lake',
]);

/** The flat Quench floors snow banks on (never a stair: a drift laid flat
 *  on a slope would hover). */
export const QUENCH_DRIFT_FLOORS: ReadonlySet<string> = new Set([
  'quench_q1',
  'quench_q2',
  'singing_ice',
  'lake_shelf',
]);

/** A wall module's half length at stretch 1, and its span out past the lip
 *  (yards, pinned against the GLB). */
export const QUENCH_WALL = { half: 3, near: 0.05, far: 1.0, height: 1.05 } as const;
/** A wall module's length along a lip (yards). */
export const QUENCH_WALL_MODULE = 4;

/** Where a brazier's fire burns over its foot (the kit's bed of coals:
 *  quench_pieces.py BRAZIER_FIRE), pinned against the GLB. */
export const QUENCH_BRAZIER_FIRE = 2.05;

const F = SMITH_HEART_FIELD;

function nearestLanding(x: number, z: number): { x: number; z: number } {
  return Math.hypot(x - QUENCH.q1.x, z - QUENCH.q1.z) < Math.hypot(x - QUENCH.q2.x, z - QUENCH.q2.z)
    ? QUENCH.q1
    : QUENCH.q2;
}

/** The layout's props fitted with their pieces: the fire bowls, the vents,
 *  the heaped ice (its face to the lake), the sunk blades, the Singing
 *  Ice's blades and the landings' stones (their cracked faces out). */
export function planQuenchProps(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  let shelf = 0;
  for (const p of F.props) {
    if (!QUENCH_KIT_KINDS.has(p.kind)) continue;
    // An encounter-owned body (the Smith's four blades) is drawn by its
    // fight (smith_heart_fx/quench_blades_fx.ts), sunk or risen.
    if (p.encounterOwned) continue;
    const y = heartPropBase(p.x, p.z);
    const spin = heartHash(Math.round(p.x * 7), Math.round(p.z * 7)) * Math.PI * 2;
    if (p.kind === 'sh_brazier') {
      out.push({ piece: 'Kit_LakeBrazier', x: p.x, y, z: p.z, rot: spin });
    } else if (p.kind === 'sh_steam_vent') {
      out.push({ piece: 'Kit_SteamVent', x: p.x, y: y + 0.01, z: p.z, rot: spin, noShadow: true });
    } else if (p.kind === 'sh_ice_shelf') {
      // Its face (local +Z) square to the lake, a breath off it.
      const L = QUENCH.lake;
      out.push({
        piece: shelf++ % 2 ? 'Kit_IceShelfB' : 'Kit_IceShelfA',
        x: p.x,
        y,
        z: p.z,
        rot: Math.atan2(L.x - p.x, L.z - p.z) + (heartHash(shelf, 43) - 0.5) * 0.3,
        scale: 0.95 + heartHash(shelf, 41) * 0.2,
        noShadow: true,
      });
    } else if (p.kind === 'sh_sunk_blade') {
      out.push({ piece: 'Kit_SunkBlade', x: p.x, y, z: p.z, rot: p.rot });
    } else if (p.kind === 'sh_ice_blade') {
      out.push({ piece: 'Kit_IceBlade', x: p.x, y, z: p.z, rot: p.rot });
    } else {
      // A landing's stone: its cracked face (local +Z) out to the drop.
      const c = nearestLanding(p.x, p.z);
      out.push({
        piece: 'Kit_FrostStone',
        x: p.x,
        y,
        z: p.z,
        rot: Math.atan2(p.x - c.x, p.z - c.z),
      });
    }
  }
  return out;
}

/** The walls along every Quench walk's lip over the void. */
export function planQuenchWalls(): HeartKitPlacement[] {
  return planLipWalls({
    surfaces: QUENCH_WALK_SURFACES,
    pieceA: 'Kit_QuenchWallA',
    pieceB: 'Kit_QuenchWallB',
    bShare: 0.25,
    module: QUENCH_WALL_MODULE,
    half: QUENCH_WALL.half,
    far: QUENCH_WALL.far,
  });
}

/** Does a Quench wall module stand wholly over the drop? */
export function quenchWallClear(x: number, z: number, rot: number, stretch: number): boolean {
  return lipWallClear(x, z, rot, stretch, QUENCH_WALL.half, QUENCH_WALL.far);
}

/** The frozen falls' rules: how far past the floor the rock's front may
 *  stand (its first band), how far over the floor it must climb, how far
 *  apart two falls hang, how many, and how far each stands out of the
 *  rock's front plane (yards). */
export const QUENCH_FALL_RULES = { maxBack: 16, climb: 26, spacing: 26, count: 9, out: -1.6 };
/** The two falls' heights (their head over their foot, pinned against the
 *  GLB) and where each one's head hangs over the floor it faces. */
export const QUENCH_FALLS = {
  Kit_FrozenFallA: { height: 25.4, head: 17 },
  Kit_FrozenFallB: { height: 17.6, head: 12 },
} as const;

/** The frozen falls on the vein's walls: on the mountain's first band of
 *  rock in the Quench where it climbs well over the floor it faces, its
 *  front square to that floor, spaced along the vein. */
export function planQuenchFalls(): HeartKitPlacement[] {
  const R = QUENCH_FALL_RULES;
  const candidates: {
    x: number;
    z: number;
    rot: number;
    floor: number;
    crest: number;
    k: number;
  }[] = [];
  for (const [i, p] of planHeartRock().entries()) {
    if (p.cosmetic) continue;
    if (smithHeartAreaAt(p.x, p.z) !== 'quench') continue;
    const c = heartFloorClearance(p.x, p.z);
    if (!Number.isFinite(c.d) || c.d > R.maxBack) continue;
    // The floor it faces is a Quench walk (never the Quarry's terraces or
    // the Breath's, though their rock may lie in the Quench's quarter).
    const reach = c.d + 3;
    const faced = authoredFieldSurfaceAt(F, p.x + c.toX * reach, p.z + c.toZ * reach);
    if (!faced || !QUENCH_WALK_SURFACES.has(faced.id)) continue;
    const m = heartRockPieceOf(p.piece);
    const crest = p.y + m.height * (p.scale ?? 1) * (p.rise ?? 1);
    if (crest < c.floor + R.climb) continue;
    candidates.push({ x: p.x, z: p.z, rot: p.rot, floor: c.floor, crest, k: heartHash(i, 97) });
  }
  candidates.sort((a, b) => a.k - b.k);
  const out: HeartKitPlacement[] = [];
  for (const c of candidates) {
    if (out.length >= R.count) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < R.spacing)) continue;
    const piece = out.length % 3 === 1 ? 'Kit_FrozenFallB' : 'Kit_FrozenFallA';
    const fall = QUENCH_FALLS[piece];
    const head = Math.min(c.crest - 4, c.floor + fall.head);
    out.push({
      piece,
      x: c.x + Math.sin(c.rot) * R.out,
      y: head,
      z: c.z + Math.cos(c.rot) * R.out,
      rot: c.rot,
      scale: 0.9 + heartHash(out.length, 101) * 0.25,
      noShadow: true,
      cosmetic: true,
    });
  }
  return out;
}

/** The Singing Ice's crack webs and long cracks, the lake's long cracks
 *  (flat inlays), and low drifts of snow at the lake's edge and on the
 *  landings. */
export function planQuenchDressing(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const I = QUENCH.ice;
  const spots: { x: number; z: number; piece: string; on?: string }[] = [];
  // The Singing Ice: webs where the raid would stand bunched, long cracks
  // between them (the sheet already singing under the weight).
  for (let k = 0; k < 9; k++) {
    const u = (k % 3) / 2;
    const v = Math.floor(k / 3) / 2;
    spots.push({
      x: I.x0 + 6 + u * (I.x1 - I.x0 - 12) + (heartHash(k, 3) - 0.5) * 5,
      z: I.z0 + 5 + v * (I.z1 - I.z0 - 10) + (heartHash(k, 5) - 0.5) * 4,
      piece: k % 2 ? 'Kit_IceCrackA' : 'Kit_IceCrackB',
      on: 'singing_ice',
    });
  }
  // The Frozen Lake: long pressure cracks, a few.
  const L = QUENCH.lake;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + heartHash(k, 7) * 0.6;
    const r = 0.25 + heartHash(k, 9) * 0.55;
    spots.push({
      x: L.x + Math.sin(a) * L.rx * r,
      z: L.z + Math.cos(a) * L.rz * r,
      piece: k % 3 ? 'Kit_IceCrackA' : 'Kit_IceCrackB',
      on: 'frozen_lake',
    });
  }
  for (const [i, s] of spots.entries()) {
    const surf = authoredFieldSurfaceAt(F, s.x, s.z);
    if (!surf || surf.id !== s.on) continue;
    out.push({
      piece: s.piece,
      x: s.x,
      y: authoredFieldHeight(F, s.x, s.z) + 0.012,
      z: s.z,
      rot: heartHash(i, 79) * Math.PI * 2,
      noShadow: true,
      cosmetic: true,
    });
  }
  // Drifts of snow banked against the low walls on the landings' rims, the
  // shelf's and the sheet's (a yard in from the wall, along it).
  for (const [i, w] of planQuenchWalls().entries()) {
    if (heartHash(i, 23) > 0.4) continue;
    const x = w.x - Math.sin(w.rot) * 1.3;
    const z = w.z - Math.cos(w.rot) * 1.3;
    const surf = authoredFieldSurfaceAt(F, x, z);
    // Only on the flat floors (a drift laid on a stair would hover).
    if (!surf || !QUENCH_DRIFT_FLOORS.has(surf.id)) continue;
    out.push({
      piece: heartHash(i, 29) < 0.7 ? 'Kit_SnowDriftA' : 'Kit_SnowDriftB',
      x,
      y: authoredFieldHeight(F, x, z) + 0.01,
      z,
      rot: w.rot + (heartHash(i, 31) - 0.5) * 0.2,
      scale: 0.7 + heartHash(i, 37) * 0.4,
      noShadow: true,
      cosmetic: true,
    });
  }
  // Drifts of snow along the lake's edge, on the shelf just outside the ice.
  const drifts = 18;
  for (let k = 0; k < drifts; k++) {
    const a = ((k + heartHash(k, 13) * 0.5) / drifts) * Math.PI * 2;
    const out1 = 1.6 + heartHash(k, 17) * 1.4;
    const x = L.x + Math.sin(a) * (L.rx + out1);
    const z = L.z + Math.cos(a) * (L.rz + out1);
    const surf = authoredFieldSurfaceAt(F, x, z);
    if (surf?.id !== 'lake_shelf') continue;
    out.push({
      piece: k % 3 ? 'Kit_SnowDriftA' : 'Kit_SnowDriftB',
      x,
      y: authoredFieldHeight(F, x, z) + 0.01,
      z,
      // Along the edge: local +X on the tangent.
      rot: a + Math.PI / 2 + (heartHash(k, 19) - 0.5) * 0.4,
      scale: 0.55 + heartHash(k, 21) * 0.35,
      noShadow: true,
      cosmetic: true,
    });
  }
  return out;
}

/** The whole Quench kit's dressing. */
export function planQuenchKit(): HeartKitPlacement[] {
  return [
    ...planQuenchProps(),
    ...planQuenchWalls(),
    ...planQuenchFalls(),
    ...planQuenchDressing(),
  ];
}

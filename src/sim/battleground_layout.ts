// Thornhollow Fields, the ranked 5v5 capture-the-flag battleground, fought at
// THORNHOLLOW: a walled hollow in the old growth under Thornpeak.
//
// The LAYOUT is Thornhollow Fields' original, combat-tuned field: a 100x280 walled
// rectangle, a keep at each end whose mouth is the only way in or out, two
// full-width curtain walls carving the space into three chambers, exactly TWO
// contested crossings per curtain (the main gate and the gatehouse room), a low
// barricade breaking the straight charge into each keep mouth, and the hollow
// heart ruin sealing main-gate-to-main-gate sight. Nothing about where a
// fighter can stand has moved.
//
// The FIELD is an authored map (data/battleground/thornhollow.map.json, built
// by scripts/assets/build_battleground_map.mjs from that same plan) compiled by
// scripts/assets/compile_thornhollow.mjs into
// src/sim/thornhollow_field.generated.ts: terrain stamp chain, per-asset baked
// collision, art placements, ground paint, and the game-mode anchors. This
// module is the mode's view of that record (the handful of positions the
// flag/respawn/graveyard/rune logic reasons about) plus the collider set the
// spatial grid mounts (src/sim/colliders.ts bandSlotColliders).
//
// Walls and cover are NOT segments here: they are ordinary placements that draw
// themselves and block with their own baked collision, so what you fight around
// is what you see. Sim layer: no three.js imports; the generated module is
// plain data.

import { bgFieldHeightLocal } from './battleground_field';
import type { Collider } from './colliders';
import {
  TH_BASES,
  TH_COLLIDERS,
  TH_GRAVEYARDS,
  TH_HALF_X,
  TH_HALF_Z,
  TH_POWER_RUNES,
  TH_SPEED_RUNES,
} from './thornhollow_field.generated';

export type BgTeam = 0 | 1; // 0 = Crimson (south, -z), 1 = Azure (north, +z)
export const BG_TEAM_NAMES = ['Crimson', 'Azure'] as const;
export const BG_TEAM_COLORS = [0xd1413a, 0x3a78d1] as const; // red, blue: flags/banners/blips

// Field footprint: the walled rectangle, rampart lines included. The PLAY rect
// is the ground inside those ramparts' inner faces; the yard between the two is
// the wall itself.
export const BG_HALF_X = TH_HALF_X; // 50
export const BG_HALF_Z = TH_HALF_Z; // 140
export const BG_PLAY_HALF_X = 49;
export const BG_PLAY_HALF_Z = 139;
export const BG_FLAG_Z = 118; // |z| of each team's flag stand (keep court)

/** Keep enclosure, restated for the mode: the walls themselves come from the
 *  authored map, but the form-up containment has to agree with them. */
export const KEEP_HALF_X = 16;
export const KEEP_BACK_DZ = 10; // back wall sits this far behind the flag
export const KEEP_MOUTH_DZ = 10; // mouth line this far field-side of the flag

export interface BgBaseDef {
  team: BgTeam;
  flag: { x: number; z: number }; // flag home + capture point
  spawns: { x: number; z: number }[]; // respawn ring inside the keep court
  banner: { x: number; z: number };
}

export const BG_BASES: BgBaseDef[] = TH_BASES.map((b) => ({
  team: b.team,
  flag: { ...b.flag },
  spawns: b.spawns.map((s) => ({ ...s })),
  banner: { ...b.banner },
}));

// Rune pads: one Sprint Rune at each flag approach plus two mid-field flanks,
// and one Battle/Ward pad at each curtain's courtyard-side main-gate mouth,
// exactly where the plan places them.
export const BG_SPEED_RUNES: { x: number; z: number }[] = TH_SPEED_RUNES.map((r) => ({ ...r }));
export const BG_POWER_RUNES: { x: number; z: number }[] = TH_POWER_RUNES.map((r) => ({ ...r }));

export interface BgGraveyardPlot {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export const BG_GRAVEYARDS: [BgGraveyardPlot, BgGraveyardPlot] = [
  { ...TH_GRAVEYARDS[0] },
  { ...TH_GRAVEYARDS[1] },
];

/**
 * The keep's interior box for one team: x across the keep's full width, z from
 * the back wall to the mouth line. The form-up containment (social/battleground
 * tickCountdown) reads this, so the gate can never drift from the walls it
 * stands in for. During the countdown a fighter who crosses the line is set
 * back to a spawn spot; once the match goes live the box has no meaning.
 */
export function keepInteriorBounds(team: BgTeam): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const dir = team === 0 ? -1 : 1;
  const flagZ = team === 0 ? -BG_FLAG_Z : BG_FLAG_Z;
  const backZ = flagZ + dir * KEEP_BACK_DZ;
  const mouthZ = flagZ - dir * KEEP_MOUTH_DZ;
  return {
    minX: -KEEP_HALF_X,
    maxX: KEEP_HALF_X,
    minZ: Math.min(backZ, mouthZ),
    maxZ: Math.max(backZ, mouthZ),
  };
}

/**
 * The field's collider set in field-local coordinates: baked per-asset boxes,
 * the editor's invisible collider volumes (the heart ruin's sealed core and the
 * graveyard rails), and the perimeter blockers. Mounted per slot into the
 * open-world spatial grid by src/sim/colliders.ts.
 */
export function battlegroundColliders(): Collider[] {
  return TH_COLLIDERS.map((c) => ({ ...c }));
}

/** A plan wall has to be tall enough to be worth navigating around; below this
 *  it is a kerb, a step or a floor slab, and drawing it would turn the map into
 *  noise. This floor answers a map-drawing question only, and is deliberately
 *  independent of the sight cutoff (`SIGHT_HEIGHT` in colliders.ts) that
 *  decides whether a CAST clears a piece: a 2.5yd parapet is a landmark you
 *  route around whatever a spell fired at it does. */
const BG_PLAN_WALL_MIN_HEIGHT = 2;
/** ...and WIDE enough. A drum tower's crenellations are eight yards up on a
 *  deck nobody can reach, and a torch bracket is a finger of stone: both are
 *  tall boxes, and drawing either would speckle the map with marks a runner
 *  never meets. The floor sits under the narrowest thing that IS a landmark,
 *  the courtyard pillars (about a yard across). */
const BG_PLAN_WALL_MIN_HALF_SPAN = 0.6;

export interface BgPlanWall {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  /** Absolute world-local top of the wall. */
  top: number;
  /** How far the wall rises above the ground beneath it. */
  height: number;
}

/**
 * Structural plan rectangles for the minimap and the M field map: the field's
 * REAL walls (ramparts, keep walls, curtains, gate structures, the heart ruin,
 * the chamber cover), in field-local coordinates. Purely a projection of the
 * collider set, so the plan can never drift from what actually blocks.
 *
 * The filter is "blocks movement, stands taller than a step, and is wider than
 * a post". `cameraTopY` is read here only as the piece's precomputed visual
 * top, the number the height is measured from; it is NOT a sight test, and the
 * sight cutoff it feeds in colliders.ts is deliberately not this filter:
 * whether a cast clears a parapet says nothing about whether a runner has to
 * go around it.
 */
export function bgFieldPlanWalls(): BgPlanWall[] {
  const out: BgPlanWall[] = [];
  for (const c of TH_COLLIDERS) {
    if (c.type !== 'obb' || c.standable) continue;
    if (Math.max(c.hw, c.hd) < BG_PLAN_WALL_MIN_HALF_SPAN) continue;
    const top = c.cameraTopY ?? 0;
    const height = top - bgFieldHeightLocal(c.x, c.z);
    if (height < BG_PLAN_WALL_MIN_HEIGHT) continue;
    out.push({ x: c.x, z: c.z, hw: c.hw, hd: c.hd, rot: c.rot, top, height });
  }
  return out;
}

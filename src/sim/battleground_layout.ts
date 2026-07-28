// Ravenrift, the ranked 5v5 capture-the-flag battleground, fought at
// THORNHOLLOW: a capture-the-flag hollow in the old growth under Thornpeak.
// Crimson and Azure race the ravine floor for each other's banner, each behind
// a two-storey keep on its own plateau, with two flank ridges for the high
// road and the Fightpit sunk into the middle.
//
// The field is an AUTHORED map (data/battleground/thornhollow.map.json, built
// in the map editor), compiled by scripts/assets/compile_thornhollow.mjs into
// src/sim/thornhollow_field.generated.ts: terrain stamp chain, per-asset baked
// collision, art placements, ground paint, and the game-mode anchors. This
// module is the mode's view of that record (the handful of positions the
// flag/respawn/graveyard/rune logic reasons about) plus the collider set the
// spatial grid mounts (src/sim/colliders.ts bandSlotColliders).
//
// Unlike the old code-defined field, walls and cover are NOT segments here:
// they are ordinary placements that draw themselves and block with their own
// baked collision, so what you fight around is what you see. Sim layer: no
// three.js imports; the generated module is plain data.

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

// Field footprint: the full walled rect, ravine slopes included. The PLAY rect
// is the walkable hollow inside the wooded slopes; the space between the two
// is dressing and the perimeter blockers.
export const BG_HALF_X = TH_HALF_X; // 120
export const BG_HALF_Z = TH_HALF_Z; // 226
export const BG_PLAY_HALF_X = 86;
export const BG_PLAY_HALF_Z = 182;
export const BG_FLAG_Z = 167; // |z| of each team's flag stand (keep inner court)

export interface BgBaseDef {
  team: BgTeam;
  flag: { x: number; z: number }; // flag home + capture point
  spawns: { x: number; z: number }[]; // respawn ring before the keep gate
  banner: { x: number; z: number };
}

export const BG_BASES: BgBaseDef[] = TH_BASES.map((b) => ({
  team: b.team,
  flag: { ...b.flag },
  spawns: b.spawns.map((s) => ({ ...s })),
  banner: { ...b.banner },
}));

// Rune pads: six Sprint Runes down the lanes and four Battle/Ward pads on the
// flank approaches, exactly where the map placed them.
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
 * The form-up containment box: each team's whole base area, from the map edge
 * to a line just field-side of the spawn ring. During the countdown a fighter
 * who crosses the line is set back to a spawn spot; once the match goes live
 * the box has no meaning. (Thornhollow's spawn ring stands OUTSIDE the keep
 * gate, so the hold line is the base line, not the keep walls.)
 */
export function keepInteriorBounds(team: BgTeam): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const holdZ = 118; // just field-side of the spawn ring (|z| 125..130)
  if (team === 0) {
    return { minX: -BG_PLAY_HALF_X, maxX: BG_PLAY_HALF_X, minZ: -BG_HALF_Z, maxZ: -holdZ };
  }
  return { minX: -BG_PLAY_HALF_X, maxX: BG_PLAY_HALF_X, minZ: holdZ, maxZ: BG_HALF_Z };
}

/**
 * The field's collider set in field-local coordinates: baked per-asset boxes,
 * the editor's invisible collider volumes (the rampart/stair/podium decks are
 * STANDABLE entries here), and the perimeter blockers. Mounted per slot into
 * the open-world spatial grid by src/sim/colliders.ts.
 */
export function battlegroundColliders(): Collider[] {
  return TH_COLLIDERS.map((c) => ({ ...c }));
}

/** A plan wall has to be tall enough to be worth navigating around; below this
 *  it is a kerb, a step or a floor slab, and drawing it would turn the map into
 *  noise. Deliberately LOWER than the camera-occlusion threshold: a 2.5yd
 *  parapet is a landmark you route around even though you can see over it. */
const BG_PLAN_WALL_MIN_HEIGHT = 2;

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
 * REAL walls (keep curtains, court walls, gate structures, the ruins), in
 * field-local coordinates. Purely a projection of the collider set, so the plan
 * can never drift from what actually blocks.
 *
 * The filter is "blocks movement and stands taller than a step", NOT the
 * camera's occlusion flag: whether the chase cam can see over a parapet says
 * nothing about whether a runner has to go around it.
 */
export function bgFieldPlanWalls(): BgPlanWall[] {
  const out: BgPlanWall[] = [];
  for (const c of TH_COLLIDERS) {
    if (c.type !== 'obb' || c.standable) continue;
    const top = c.cameraTopY ?? 0;
    const height = top - bgFieldHeightLocal(c.x, c.z);
    if (height < BG_PLAN_WALL_MIN_HEIGHT) continue;
    out.push({ x: c.x, z: c.z, hw: c.hw, hd: c.hd, rot: c.rot, top, height });
  }
  return out;
}

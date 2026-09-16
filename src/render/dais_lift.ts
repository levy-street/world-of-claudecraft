// Render-only dais lift, shared by the dungeon builder (placeDais) and every
// ground-draped actionable cue (the rift death-zone danger ring). The raised
// boss dais is a purely VISUAL platform of foundation blocks: the sim keeps
// the dais walkable flat, so a telegraph drawn at sim ground height sits
// under the blocks and disappears exactly where the boss is tanked (the
// 2026-07-21 S-raid playtest: "platform boss made the aoe circles
// invisible"). Both consumers read the same height and the same on-dais
// test from here so they can never drift apart.
//
// Pure and three-free so a Vitest imports it directly.

import { dungeonFloorLift } from '../sim/dungeon_floor';

/** Visual height of the raised dais (2u foundation blocks at 0.3 y-scale). */
export const DAIS_PLATFORM_HEIGHT = 0.6;

/** The dais facts the lift reads off a DungeonLayout (or a rift floor's).
 *  (The rift's entity ground and camera clamp apply riftLiftAt alone; no
 *  rift layout carries platforms yet, so nothing there is out of step.) */
export interface DaisLiftLayout {
  dais: DaisDisc | null | undefined;
  /** Flanking platforms (DungeonLayout.platforms): always raised. */
  platforms?: readonly DaisDisc[] | null;
}

interface DaisDisc {
  x: number;
  z: number;
  r: number;
}

/** The extra visual height at an instance-local point: DAIS_PLATFORM_HEIGHT
 * on a RAISED dais or on any flanking platform, else 0. `raised` is the
 * placeDais decision (style.daisRaised override, else the variant default);
 * the platforms ignore it. */
export function daisVisualLift(
  layout: DaisLiftLayout | null | undefined,
  raised: boolean,
  localX: number,
  localZ: number,
): number {
  if (!layout) return 0;
  if (layout.dais && raised && insideDisc(layout.dais, localX, localZ)) return DAIS_PLATFORM_HEIGHT;
  for (const platform of layout.platforms ?? []) {
    if (insideDisc(platform, localX, localZ)) return DAIS_PLATFORM_HEIGHT;
  }
  return 0;
}

function insideDisc(disc: DaisDisc, lx: number, lz: number): boolean {
  const dx = lx - disc.x;
  const dz = lz - disc.z;
  return dx * dx + dz * dz <= disc.r * disc.r;
}

/** A world-space ground sampler (the renderer's groundHeight closure). */
export type GroundSampler = (x: number, z: number) => number;

/** Rim samples a flat cue's footprint is probed at, on top of its centre. */
export const GROUND_CUE_RIM_SAMPLES = 8;

/**
 * Ground height for a FLAT one-sample ground cue (a warning ring, a fire
 * patch) of `radius` centred at world (x, z): the centre's ground height
 * plus the tallest interior plateau step under the footprint, so a cue
 * whose footprint straddles a raised dais or flanking-platform rim draws
 * on the block tops instead of vanishing under them (the 2026-07-21
 * "invisible aoe circles" playtest, in geometry form). Terrain is
 * untouched: `plateau` is the interior floor lift, 0 everywhere outside an
 * instanced interior and on its flat floor, so the open world samples
 * exactly as before. Per-vertex draped visuals need none of this.
 */
export function groundCueY(
  ground: GroundSampler,
  x: number,
  z: number,
  radius: number,
  plateau: GroundSampler = dungeonFloorLift,
): number {
  return ground(x, z) + plateauStepUnder(plateau, x, z, radius);
}

/** The tallest interior lift under the footprint, relative to the centre's
 *  (never negative: a cue centred on a plateau does not sink for the floor
 *  beside it). */
export function plateauStepUnder(
  plateau: GroundSampler,
  x: number,
  z: number,
  radius: number,
): number {
  const centre = plateau(x, z);
  let step = 0;
  for (let i = 0; i < GROUND_CUE_RIM_SAMPLES; i++) {
    const a = (i / GROUND_CUE_RIM_SAMPLES) * Math.PI * 2;
    const rise = plateau(x + Math.sin(a) * radius, z + Math.cos(a) * radius) - centre;
    if (rise > step) step = rise;
  }
  return step;
}

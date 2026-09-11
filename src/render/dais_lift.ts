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

/** Visual height of the raised dais (2u foundation blocks at 0.3 y-scale). */
export const DAIS_PLATFORM_HEIGHT = 0.6;

/** The dais facts the lift reads off a DungeonLayout (or a rift floor's). */
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

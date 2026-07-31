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

/** The extra visual height at an instance-local point: DAIS_PLATFORM_HEIGHT
 * on a RAISED dais, else 0. `raised` is the placeDais decision
 * (style.daisRaised override, else the variant default). */
export function daisVisualLift(
  dais: { x: number; z: number; r: number } | null | undefined,
  raised: boolean,
  localX: number,
  localZ: number,
): number {
  if (!dais || !raised) return 0;
  const dx = localX - dais.x;
  const dz = localZ - dais.z;
  return dx * dx + dz * dz <= dais.r * dais.r ? DAIS_PLATFORM_HEIGHT : 0;
}

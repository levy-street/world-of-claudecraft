// Pure derivation of how many combo-point pips to light over an entity's
// nameplate. Combo points belong to the *local player* and are character-bound
// (retail-style), so the renderer draws them over the player's CURRENT target:
// that is the entity the next finisher will spend them on. Kept DOM/Three-free
// so it can be unit-tested directly.
import type { Entity } from '../sim/types';

// Combo points cap at 5 in the sim (Sim.awardCombo).
export const COMBO_PIP_MAX = 5;

// Pips to show over `e` given the viewing player's combo state. Zero unless `e`
// is the player's current living target; clamped into [0, COMBO_PIP_MAX] so a
// transient overshoot never overflows the row.
export function comboPipsFor(player: Entity, e: Entity): number {
  if (player.targetId !== e.id || e.dead) return 0;
  return Math.max(0, Math.min(COMBO_PIP_MAX, player.comboPoints));
}

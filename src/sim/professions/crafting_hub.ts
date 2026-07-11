// Level-20 crafting hub gate (issue #1297). Pure leaf, no Sim/Entity import
// (matches focus.ts's "in town" gate shape): the caller (crafting.ts, itself
// behind the SimContext seam) resolves the player's position/level from
// SimContext and passes them in as plain values.
//
// Two independent gates compose: being within CRAFTING_HUB_RADIUS of
// CRAFTING_HUB_POS (content/professions.ts), and being at or above
// CRAFTING_HUB_MIN_LEVEL. Both must hold for `canUseCraftingHubStation`.

import {
  CRAFTING_HUB_MIN_LEVEL,
  CRAFTING_HUB_POS,
  CRAFTING_HUB_RADIUS,
} from '../content/professions';

/** True while `pos` sits within the crafting hub's gate circle. */
export function isAtCraftingHub(pos: { x: number; z: number }): boolean {
  const dx = pos.x - CRAFTING_HUB_POS.x;
  const dz = pos.z - CRAFTING_HUB_POS.z;
  return dx * dx + dz * dz <= CRAFTING_HUB_RADIUS * CRAFTING_HUB_RADIUS;
}

/** True once a character has reached the hub's minimum level. */
export function meetsCraftingHubLevel(level: number): boolean {
  return level >= CRAFTING_HUB_MIN_LEVEL;
}

/** Both gates composed: whether a player at `pos` and `level` may use a
 *  station-bound (hub-gated) recipe right now. */
export function canUseCraftingHubStation(pos: { x: number; z: number }, level: number): boolean {
  return isAtCraftingHub(pos) && meetsCraftingHubLevel(level);
}

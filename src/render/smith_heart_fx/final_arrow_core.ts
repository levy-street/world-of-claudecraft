// Which of the Masterless Strength's marks raise the raid's personal arrow
// (council_rush_arrow.ts, the Breath's and the council's family) over the
// LOCAL player's head: drawn for the marked player alone (the owner's rule:
// arrows and alarms only for the one affected). Jose's playtest of 2026-11-19
// took the fight's on-screen alert panel away, so every mark that singles one
// player out to move reads here and on the floor instead:
//   - Weight of the Anvil (anvilMark): its circle follows you; the raid gathers
//     on you;
//   - the stars' marks: Crossing Blade (its line runs through you) and Sky
//     Strike (lightning falls where you stand);
//   - Heroic's Ember Mark and Drawn Lightning;
//   - part 2's Bursting Coal and Wind-Tethered.
// Crushed and Mounting Weight are a tank's own debuffs (its aura bar), never an
// arrow.
// Pure: the painter (final_kit_fx.ts) reads it; tests/smith_heart_final_ui.test.ts
// pins the list.

import { FINAL_AURAS } from '../../sim/encounters/smith_heart/final_ids';
import { FINAL_PHASE_AURAS } from '../../sim/encounters/smith_heart/final_phase_ids';
import type { Entity } from '../../sim/types';

/** The marks that raise the arrow, in the order they are read. */
export const FINAL_ARROW_AURAS: readonly string[] = [
  FINAL_PHASE_AURAS.coal,
  FINAL_PHASE_AURAS.tether,
  FINAL_AURAS.anvilMark,
  FINAL_AURAS.bladeMark,
  FINAL_AURAS.skyMark,
  FINAL_AURAS.ember,
  FINAL_AURAS.drawn,
];

/** `e`'s arrow mark (the first of FINAL_ARROW_AURAS it wears), else null. */
export function finalArrowMark(
  e: Pick<Entity, 'auras'>,
): { remaining: number; duration: number } | null {
  for (const a of e.auras) if (FINAL_ARROW_AURAS.includes(a.id)) return a;
  return null;
}

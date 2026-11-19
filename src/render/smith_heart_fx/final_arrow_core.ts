// Which of the Masterless Strength's marks raise the raid's personal arrow
// (council_rush_arrow.ts, the Breath's and the council's family) over the
// LOCAL player's head: drawn for the marked player alone (the owner's rule:
// arrows and alarms only for the one affected). Jose's playtest of 2026-11-19:
//   - Weight of the Anvil (anvilMark): its circle follows you; the raid gathers
//     on you.
// Pure: the painter (final_kit_fx.ts) reads it; tests/smith_heart_final_ui.test.ts
// pins the list.

import { FINAL_AURAS } from '../../sim/encounters/smith_heart/final_ids';
import type { Entity } from '../../sim/types';

/** The marks that raise the arrow, in the order they are read. */
export const FINAL_ARROW_AURAS: readonly string[] = [FINAL_AURAS.anvilMark];

/** `e`'s arrow mark (the first of FINAL_ARROW_AURAS it wears), else null. */
export function finalArrowMark(
  e: Pick<Entity, 'auras'>,
): { remaining: number; duration: number } | null {
  for (const a of e.auras) if (FINAL_ARROW_AURAS.includes(a.id)) return a;
  return null;
}

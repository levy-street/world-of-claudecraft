// Which players the Guardian of the Breath singles out to move, for the Rush's
// red arrow over their heads (council_rush_arrow.ts; the owner's run of
// 2026-11-17: the same arrow and alarm as the Rush and the Quench's blades):
// a sky strike's mark and Drawn Lightning (auras on the player), and the
// target of a bar the guardian aims at one player (Storm Lance, Leaping
// Bolt). Pure: the painter and the audio read the same rules.

import { BREATH_AURAS, BREATH_TARGETED_CASTS } from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity } from '../../sim/types';

/** The aura marks that raise the arrow. */
export const BREATH_ARROW_AURAS: readonly string[] = [BREATH_AURAS.skyMark, BREATH_AURAS.drawn];

/** The bars aimed at one player that raise the arrow over their target. */
export const BREATH_TARGETED_BARS: readonly string[] = BREATH_TARGETED_CASTS;

/** The most aura arrows at once (a volley's marks and the conductor). */
export const BREATH_ARROWS = 4;

/** `e`'s arrow mark (the first of BREATH_ARROW_AURAS it wears), else null. */
export function breathArrowMark(
  e: Pick<Entity, 'auras'>,
): { remaining: number; duration: number } | null {
  for (const a of e.auras) if (BREATH_ARROW_AURAS.includes(a.id)) return a;
  return null;
}

/** The guardian's bar when it is one aimed at a single player, else null. */
export function breathTargetedBar(g: Pick<Entity, 'castingAbility'>): string | null {
  const bar = g.castingAbility;
  return bar && BREATH_TARGETED_BARS.includes(bar) ? bar : null;
}

// Which players the Guardian of the Breath singles out PERSONALLY, for the
// Rush's red arrow over their heads (council_rush_arrow.ts). Jose's playtest
// of 2026-11-18 ("lots of arrows over my head") trimmed it to the marks where
// ONE player is chosen and must do something nobody else does:
//   - Drawn Lightning (aura): for ten seconds the storm strikes at their feet
//     every two seconds; they alone must lead it away from the raid;
//   - the Knotted Gale's portal marks A to D (auras): each must walk to its
//     portal and stand for its partner;
//   - the Knotted Gale's carrier (aura): the ball rides over their head and
//     they must take it to a lip (the arrow rides over the ball);
//   - Leaping Bolt (the guardian's bar at one player): the target alone must
//     step clear of every ally before it lands (no floor telegraph tells it).
// Never on what the floor already telegraphs: a sky strike's mark (its
// strike's ring lies under the player) and Storm Lance (its line is drawn on
// the floor from the guardian), nor on any isle mechanic (the Herald's lane,
// the Closing Storm, Sky's Reckoning: all on the floor). The alarm in the
// marked player's ear is the audio core's own rule
// (src/game/smith_heart_breath_audio_core.ts), unchanged.
// Pure: the painter reads these rules; tests/smith_heart_breath_arrows.test.ts
// pins exactly which mechanics raise it.

import { BREATH_AURAS, BREATH_CASTS } from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity } from '../../sim/types';

/** The aura marks that raise the arrow. */
export const BREATH_ARROW_AURAS: readonly string[] = [
  BREATH_AURAS.drawn,
  BREATH_AURAS.portalA,
  BREATH_AURAS.portalB,
  BREATH_AURAS.portalC,
  BREATH_AURAS.portalD,
  BREATH_AURAS.laden,
];

/** The carrier's arrow rides over the ball over their head (yards). */
export const LADEN_ARROW_LIFT = 2.6;

/** The bars aimed at one player that raise the arrow over their target
 *  (Leaping Bolt alone: Storm Lance's line is on the floor). */
export const BREATH_TARGETED_BARS: readonly string[] = [BREATH_CASTS.fork];

/** The most aura arrows at once (the conductor, the Knotted Gale's marks
 *  and carriers). */
export const BREATH_ARROWS = 8;

/** `e`'s arrow mark (the first of BREATH_ARROW_AURAS it wears), else null. */
export function breathArrowMark(
  e: Pick<Entity, 'auras'>,
): { remaining: number; duration: number; lift?: number } | null {
  for (const a of e.auras) {
    if (!BREATH_ARROW_AURAS.includes(a.id)) continue;
    if (a.id !== BREATH_AURAS.laden) return a;
    _laden.remaining = a.remaining;
    _laden.duration = a.duration;
    return _laden;
  }
  return null;
}
const _laden = { remaining: 0, duration: 1, lift: LADEN_ARROW_LIFT };

/** The guardian's bar when it is one aimed at a single player, else null. */
export function breathTargetedBar(g: Pick<Entity, 'castingAbility'>): string | null {
  const bar = g.castingAbility;
  return bar && BREATH_TARGETED_BARS.includes(bar) ? bar : null;
}

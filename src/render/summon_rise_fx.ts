// A summoned add rising as it lands. The sim tags the moment it spawns a body that
// climbs out of the ground with a 'flourish' spellfx carrying SUMMON_RISE_CUE
// (sim/mob/summon_rise.ts), but that event is drained on the same frame the add enters
// the world, before the renderer has built a body for it, so a one-time gesture would
// land on nothing. This offers the rise gesture every frame for a short window instead:
// the first frame the add's body exists, it plays its entrance (VisualDef.entranceGesture
// names the cue, ClipMap.entrance the clip; the skeleton minion's Awaken pulls it up out
// of a heap of bones), once per entity (CharacterVisual.playEntrance), so the repeats
// that follow are no-ops. A body with no entrance on the cue ignores it. Three-free and
// DOM-free: the host hands in the gesture hook.

import { SUMMON_RISE_CUE } from '../sim/mob/summon_rise';
import type { SimEvent } from '../sim/types';

/** How long a rise stays on offer, in seconds: long enough for a body that waits on its
 *  files to build, short enough that a body first seen later never rises from nothing. */
export const SUMMON_RISE_WINDOW_SECONDS = 1.5;

export class SummonRiseFx {
  private readonly offers = new Map<number, number>();
  private clock = 0;

  constructor(private readonly playGesture?: (entityId: number, gesture: string) => void) {}

  /** A summoned add's rise cue opens its window (and offers at once). */
  handleEvent(ev: SimEvent): void {
    if (ev.type !== 'spellfx' || ev.fx !== 'flourish' || ev.ability !== SUMMON_RISE_CUE) return;
    this.offers.set(ev.sourceId, this.clock + SUMMON_RISE_WINDOW_SECONDS);
    this.playGesture?.(ev.sourceId, SUMMON_RISE_CUE);
  }

  /** Re-offer every open rise; close the ones whose window has passed. */
  update(dt: number): void {
    this.clock += dt;
    for (const [id, until] of this.offers) {
      if (this.clock > until) this.offers.delete(id);
      else this.playGesture?.(id, SUMMON_RISE_CUE);
    }
  }

  /** The entity ids with a rise on offer (tests and diagnostics). */
  pending(): number[] {
    return [...this.offers.keys()];
  }
}

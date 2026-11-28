// `SmithHeartTrashGestures`: the Smith's Heart's own trash and add bodies moved by the
// fight's cues (the plan, and why each cue, is `trash_gestures_core.ts`). Hosted by
// `../rift_death_zone.ts` beside the other raid painters, through the renderer's
// gesture seam. It draws nothing: no scene object, no material, no GPU work. Reads
// IWorld only, so offline and online play the same.
//
// A rise stays on offer for a short window; only while one is open does the frame
// look over the bodies (a handful of seconds a fight), so an idle frame costs a
// length check.

import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  SMITH_HEART_TRASH_RISE,
  type TrashRiseOffer,
  trashRiseMatches,
  trashRiseOffer,
  trashSourceGesture,
} from './trash_gestures_core';

export class SmithHeartTrashGestures {
  private readonly offers: TrashRiseOffer[] = [];
  private clock = 0;

  constructor(
    private readonly world?: IWorld,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {}

  /** A rise cue opens its window (offered at once); a claimed cue a body sent plays
   *  its gesture. Never claims the event. */
  handleEvent(ev: SimEvent): void {
    if (!this.playGesture) return;
    if (ev.type === 'spellfxAt') {
      const offer = trashRiseOffer(ev, this.clock);
      if (offer) {
        this.offers.push(offer);
        this.offerRises();
      }
      return;
    }
    if (ev.type !== 'spellfx') return;
    const source = this.world?.entities.get(ev.sourceId);
    const gesture = trashSourceGesture(ev, source?.templateId);
    if (gesture) this.playGesture(ev.sourceId, gesture);
  }

  /** Re-offer every open rise; close the ones whose window has passed. */
  update(dt: number): void {
    this.clock += dt;
    if (this.offers.length === 0) return;
    for (let i = this.offers.length - 1; i >= 0; i--) {
      if (this.clock > this.offers[i].until) this.offers.splice(i, 1);
    }
    if (this.offers.length > 0) this.offerRises();
  }

  /** Every living body a rise reaches plays its entrance (once per entity: the
   *  body's own rule, so the window's repeats do nothing). */
  private offerRises(): void {
    const world = this.world;
    const play = this.playGesture;
    if (!world || !play) return;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      for (const offer of this.offers) {
        if (!trashRiseMatches(offer, e.templateId, e.pos.x, e.pos.z)) continue;
        play(e.id, SMITH_HEART_TRASH_RISE);
        break;
      }
    }
  }
}

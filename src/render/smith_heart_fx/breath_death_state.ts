// The Guardian of the Breath's death as its body sees it: the death's painter
// (breath_death_fx.ts, updated before the body each frame) holds its look
// here for the guardian it reads, and the body's air (breath_body.ts) reads
// it back, so both ride one scene clock: the currents drawn in tight, the
// arcs, the unravelling, its light going out, and no stance of the body's
// own re-sent over a replay's fall. One guardian at a time; nothing is
// copied or allocated (the look is the painter's own, rewritten each frame).

import type { BreathDeathBodyLook } from './breath_death_core';

let heldId = -1;
let held: BreathDeathBodyLook | null = null;

/** Hold `look` for guardian `id` (null releases it). */
export function holdBreathDeath(id: number, look: BreathDeathBodyLook | null): void {
  if (!look) {
    if (heldId === id) {
      heldId = -1;
      held = null;
    }
    return;
  }
  heldId = id;
  held = look;
}

/** The death's look for guardian `id` while its scene plays (or its husk
 *  lies), else null (alive: the fight's own look). */
export function breathDeathFor(id: number): BreathDeathBodyLook | null {
  return heldId === id && held?.active ? held : null;
}

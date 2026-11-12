// The Guardian of the Quench's death as her body sees it: the death's painter
// (quench_death_fx.ts, updated before QuenchBody each frame) holds its look
// here for the guardian it reads, and her body (quench_body.ts) reads it
// back, so both ride one scene clock: her statue glaze climbing, her heart
// blooming then out, the mist, and no fight look of her own over a replay's
// fall. One guardian at a time; nothing is copied or allocated (the look is
// the painter's own, rewritten each frame).

import type { QuenchDeathBodyLook } from './quench_death_core';

let heldId = -1;
let held: QuenchDeathBodyLook | null = null;

/** Hold `look` for guardian `id` (null releases it). */
export function holdQuenchDeath(id: number, look: QuenchDeathBodyLook | null): void {
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

/** The death's look for guardian `id` while its scene plays (or her husk
 *  lies), else null (alive: the fight's own look). */
export function quenchDeathFor(id: number): QuenchDeathBodyLook | null {
  return heldId === id && held?.active ? held : null;
}

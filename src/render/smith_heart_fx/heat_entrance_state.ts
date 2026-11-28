// The Guardian of the Heat's entrance as the other Heat painters see it: the
// entrance's painter (heat_entrance_fx.ts, updated first each frame) holds
// its look here for the guardian it reads, and the body's fire
// (heat_body.ts) and the wellspring (heat_well_fx.ts) read it back, so all
// three ride one scene clock. One guardian at a time; nothing is copied or
// allocated (the look is the painter's own, rewritten each frame).

import type { HeatEntranceLook } from './heat_entrance_core';

let heldId = -1;
let held: HeatEntranceLook | null = null;

/** Hold `look` for guardian `id` (null releases it). */
export function holdHeatEntrance(id: number, look: HeatEntranceLook | null): void {
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

/** The entrance's look for guardian `id` while its scene is on (or it waits
 *  cold), else null (awake: the fight's own look). */
export function heatEntranceFor(id: number): HeatEntranceLook | null {
  return heldId === id && held?.active ? held : null;
}

// The Guardian of the Breath's entrance as its body sees it: the entrance's
// painter (breath_entrance_fx.ts, updated before the body each frame) holds
// its look here for the guardian it reads, and the body's air (breath_body.ts)
// reads it back, so both ride one scene clock: no currents, glow or orbit
// round a guardian that is still the wind, filling in as it forms, and the
// entrance's own stances, never the body's, while the scene is on. One
// guardian at a time; nothing is copied or allocated (the look is the
// painter's own, rewritten each frame).

import type { BreathEntranceLook } from './breath_entrance_core';

let heldId = -1;
let held: BreathEntranceLook | null = null;

/** Hold `look` for guardian `id` (null releases it). */
export function holdBreathEntrance(id: number, look: BreathEntranceLook | null): void {
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
 *  in the calm), else null (awake: the fight's own look). */
export function breathEntranceFor(id: number): BreathEntranceLook | null {
  return heldId === id && held?.active ? held : null;
}

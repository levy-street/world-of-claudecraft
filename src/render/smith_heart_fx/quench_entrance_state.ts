// The Guardian of the Quench's entrance as her body sees it: the entrance's
// painter (quench_entrance_fx.ts, updated before her body each frame) holds
// its look here for the guardian it reads, and her body's cold and light
// (quench_body.ts) read it back, so both ride one scene clock. One guardian at
// a time; nothing is copied or allocated (the look is the painter's own,
// rewritten each frame).

import type { QuenchEntranceLook } from './quench_entrance_core';

let heldId = -1;
let held: QuenchEntranceLook | null = null;

/** Hold `look` for guardian `id` (null releases it). */
export function holdQuenchEntrance(id: number, look: QuenchEntranceLook | null): void {
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

/** The entrance's look for guardian `id` while her scene is on (or she waits
 *  frozen), else null (awake: the fight's own look). */
export function quenchEntranceFor(id: number): QuenchEntranceLook | null {
  return heldId === id && held?.active ? held : null;
}
